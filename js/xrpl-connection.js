/* =========================================
   FILE: js/xrpl-connection.js
   NaluXrp 🌊 – XRPL Connection Module (Deep, Hardened)
   Always Connected + Raw Transaction Streaming

   FIXES ADDED:
   - WS failover rotation (round-robin) across network profile servers
   - Exponential backoff + jitter reconnect (no hot-loop)
   - Safe request wrapper with hard timeouts (prevents hangs)
   - server_info treated as non-fatal; fallback to ledger_current where possible
   - requestXrpl wrapper hardened + optional HTTP JSON-RPC fallback

   PATCH NOTES (IMPORTANT):
   - FIXED: attemptConnection() used `const info` then reassigned -> crash -> perpetual disconnects
   - requestXrpl returns a consistent shape from WS (xrpl.js) and HTTP fallback ({ result: ... })
   ========================================= */

(function () {
  "use strict";

  // -------------------- PUBLIC OBJECT --------------------
  window.XRPL = window.XRPL || {
    client: null,
    connected: false,
    connecting: false,
    server: null,
    reconnectAttempts: 0,
    maxReconnectAttempts: 999,
    lastLedgerTime: Date.now(),
    lastLedgerIndex: 0,
    lastCloseTimeSec: null,
    ledgerPollInterval: null,
    reconnectTimeout: null,
    state: {
      ledgerIndex: 0,
      ledgerTime: null,
      txnPerSec: 0,
      txPerLedger: 0,
      feeAvg: 0.00001,
      loadFee: 1.0,
      validators: 0,
      quorum: 0,
      transactionTypes: {
        Payment: 0,
        Offer: 0,
        NFT: 0,
        TrustSet: 0,
        Other: 0
      },
      closeTimes: [],
      tpsHistory: [],
      feeHistory: [],
      ledgerHistory: [],
      txCountHistory: [],
      recentTransactions: [],
      recentLedgers: []
    },
    mode: "connecting",
    modeReason: "Initializing",
    network: "xrpl-mainnet",

    // Hardened extras
    serverIndex: 0,
    lastServerInfoOkAt: 0,
    lastServerInfoErrorAt: 0,
    lastServerInfoError: null,
    lastDisconnectCode: null
  };

  // -------------------- CONSTANTS --------------------
  const RAW_TX_WINDOW_SIZE = 800;
  const MAX_LEDGER_HISTORY = 60;

  const WS_CONNECT_TIMEOUT_MS = Number.isFinite(Number(window.NALU_WS_CONNECT_TIMEOUT_MS))
    ? Number(window.NALU_WS_CONNECT_TIMEOUT_MS)
    : 15000;

  const WS_REQUEST_TIMEOUT_MS = Number.isFinite(Number(window.NALU_WS_REQUEST_TIMEOUT_MS))
    ? Number(window.NALU_WS_REQUEST_TIMEOUT_MS)
    : 12000;

  const LEDGER_POLL_INTERVAL_MS = 4000;
  const KEEPALIVE_INTERVAL_MS = 30000;

  const SERVER_INFO_CACHE_MS = 8000;

  const BACKOFF_MIN_MS = 1200;
  const BACKOFF_MAX_MS = 20000;

  // Optional HTTP fallback for requestXrpl only
  // Set window.NALU_RPC_HTTP = "https://xrplcluster.com/"
  // Set window.NALU_DISABLE_HTTP_FALLBACK = true to disable
  const DISABLE_HTTP_FALLBACK = !!window.NALU_DISABLE_HTTP_FALLBACK;
  const HTTP_RPC_ENDPOINTS = [
    typeof window.NALU_RPC_HTTP === "string" && window.NALU_RPC_HTTP.startsWith("http") ? window.NALU_RPC_HTTP : null,
    "https://xrplcluster.com/",
    "https://xrpl.ws/"
  ].filter(Boolean);

  // -------------------- NETWORK PROFILES --------------------
  const XRPL_SERVER_PROFILES = {
    "xrpl-mainnet": [
      { url: "wss://xrplcluster.com", name: "XRPL Cluster" },
      { url: "wss://s2.ripple.com", name: "Ripple S2" },
      { url: "wss://s1.ripple.com", name: "Ripple S1" },
      { url: "wss://xrpl.link", name: "XRPL Link" }
    ],
    "xrpl-testnet": [{ url: "wss://s.altnet.rippletest.net:51233", name: "XRPL Testnet" }],
    "xahau-mainnet": [
      { url: "wss://xahau.network", name: "Xahau Mainnet" },
      { url: "wss://xahau.xrpl-labs.com", name: "Xahau Labs" }
    ]
  };

  // -------------------- UTILITIES --------------------
  function getCurrentServerList() {
    const list = XRPL_SERVER_PROFILES[window.XRPL.network];
    return Array.isArray(list) && list.length ? list : XRPL_SERVER_PROFILES["xrpl-mainnet"];
  }

  function safeNotify(message, type = "info", timeout = 3000) {
    if (typeof window.showNotification === "function") {
      window.showNotification(message, type, timeout);
    }
    console.log(`[${type.toUpperCase()}] ${message}`);
  }

  function dispatchConnectionEvent() {
    window.dispatchEvent(
      new CustomEvent("xrpl-connection", {
        detail: {
          connected: window.XRPL.connected,
          server: window.XRPL.server?.name || null,
          url: window.XRPL.server?.url || null,
          network: window.XRPL.network,
          mode: window.XRPL.mode,
          modeReason: window.XRPL.modeReason,
          lastUpdate: window.XRPL.lastLedgerTime,
          lastLedgerIndex: window.XRPL.lastLedgerIndex,
          lastDisconnectCode: window.XRPL.lastDisconnectCode || null,
          lastServerInfoError: window.XRPL.lastServerInfoError || null
        }
      })
    );
  }

  function setMode(mode, reason = "") {
    if (window.XRPL.mode === mode && window.XRPL.modeReason === reason) return;
    window.XRPL.mode = mode;
    window.XRPL.modeReason = reason;
    console.log(`🌊 XRPL Mode: ${mode} - ${reason}`);
  }

  function rippleTimeToDate(rippleTime) {
    return new Date((Number(rippleTime) + 946684800) * 1000);
  }

  function updateHistory(key, value, maxLength = 50) {
    const numValue = parseFloat(value) || 0;
    const s = window.XRPL.state;
    if (!Array.isArray(s[key])) return;
    s[key].push(numValue);
    if (s[key].length > maxLength) s[key].shift();
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function jitter(ms) {
    return ms + Math.floor(Math.random() * 500);
  }

  function backoffMs() {
    const base = clamp(
      BACKOFF_MIN_MS * Math.pow(1.45, window.XRPL.reconnectAttempts || 0),
      BACKOFF_MIN_MS,
      BACKOFF_MAX_MS
    );
    return jitter(Math.floor(base));
  }

  function withTimeout(promise, timeoutMs, label) {
    const ms = clamp(Number(timeoutMs) || 0, 250, 120_000);
    let t;
    const timeout = new Promise((_, reject) => {
      t = setTimeout(() => reject(new Error(`TimeoutError: ${label || "request"} (${ms}ms)`)), ms);
    });
    return Promise.race([promise.finally(() => clearTimeout(t)), timeout]);
  }

  function isLikelyTransportError(msg) {
    const m = String(msg || "").toLowerCase();
    return (
      m.includes("timeout") ||
      m.includes("timed out") ||
      m.includes("websocket was closed") ||
      m.includes("closed") ||
      m.includes("disconnected")
    );
  }

  // -------------------- AMOUNT HELPERS --------------------
  function parseXrpAmount(amount) {
    if (amount == null) return 0;
    if (typeof amount === "string") {
      const drops = Number(amount);
      if (!Number.isFinite(drops)) return 0;
      return drops / 1_000_000;
    }
    if (typeof amount === "object" && amount.value != null) {
      const v = Number(amount.value);
      return Number.isFinite(v) ? v : 0;
    }
    return 0;
  }

  // -------------------- TX EXTRACTION / NORMALIZATION --------------------
  function extractTxAndMeta(entry) {
    if (!entry || typeof entry !== "object") return { tx: null, meta: null };

    if (entry.tx_json && typeof entry.tx_json === "object") {
      return { tx: entry.tx_json, meta: entry.meta || entry.metaData || null };
    }

    if (entry.TransactionType) {
      return { tx: entry, meta: entry.meta || entry.metaData || null };
    }

    if (entry.tx && typeof entry.tx === "object" && entry.tx.TransactionType) {
      return { tx: entry.tx, meta: entry.meta || entry.metaData || null };
    }

    if (entry.transaction && typeof entry.transaction === "object" && entry.transaction.TransactionType) {
      return { tx: entry.transaction, meta: entry.meta || entry.metaData || null };
    }

    return { tx: null, meta: null };
  }

  function normalizeTransaction(entry, ledgerIndex, closeTime) {
    const { tx, meta } = extractTxAndMeta(entry);
    if (!tx || !tx.TransactionType) return null;

    const hash = tx.hash || entry.hash || null;
    const type = tx.TransactionType;
    const account = tx.Account || tx.account || null;
    const destination = tx.Destination || tx.destination || null;

    const success =
      meta && typeof meta.TransactionResult === "string" ? meta.TransactionResult.startsWith("tes") : true;

    const feeDrops = tx.Fee != null ? Number(tx.Fee) : 0;
    const feeXRP = Number.isFinite(feeDrops) ? feeDrops / 1_000_000 : 0;

    const amount = tx.Amount != null ? tx.Amount : tx.amount;
    const delivered =
      meta && meta.delivered_amount != null ? meta.delivered_amount : amount != null ? amount : null;

    const amountXRP = parseXrpAmount(delivered);

    const sourceTag = tx.SourceTag != null ? tx.SourceTag : tx.Source_Tag;
    const destinationTag = tx.DestinationTag != null ? tx.DestinationTag : tx.Destination_Tag;

    return {
      hash: hash || undefined,
      ledgerIndex: Number(ledgerIndex) || null,
      closeTime: closeTime instanceof Date ? closeTime : null,
      type,
      account,
      destination,
      amount: delivered,
      amountXRP,
      feeDrops,
      feeXRP,
      success,
      result: meta && typeof meta.TransactionResult === "string" ? meta.TransactionResult : null,
      sequence: tx.Sequence != null ? tx.Sequence : null,
      sourceTag: sourceTag != null ? sourceTag : null,
      destinationTag: destinationTag != null ? destinationTag : null,
      flags: tx.Flags != null ? tx.Flags : null
    };
  }

  // -------------------- NETWORK SWITCHING --------------------
  function setXRPLNetwork(networkId) {
    if (!XRPL_SERVER_PROFILES[networkId]) {
      console.warn(`⚠️ Unknown network: ${networkId}`);
      return;
    }
    if (window.XRPL.network === networkId) return;

    console.log(`🌐 Switching to ${networkId}`);
    window.XRPL.network = networkId;
    window.XRPL.reconnectAttempts = 0;
    window.XRPL.serverIndex = 0;
    setMode("connecting", "Network switched");

    cleanupConnection().then(function () {
      connectXRPL();
    });
  }

  // -------------------- SAFE REQUESTS --------------------
  async function safeClientRequest(payload, timeoutMs = WS_REQUEST_TIMEOUT_MS) {
    if (!window.XRPL.client) throw new Error("XRPL client not available");

    const cleanPayload = payload && typeof payload === "object" ? { ...payload } : payload;
    if (cleanPayload && cleanPayload.api_version != null) delete cleanPayload.api_version;

    return withTimeout(window.XRPL.client.request(cleanPayload), timeoutMs, JSON.stringify(cleanPayload));
  }

  // -------------------- CONNECTION STATUS UI --------------------
  function updateConnectionStatus(connected, serverName) {
    const dot = document.getElementById("connDot");
    const text = document.getElementById("connText");
    if (!dot || !text) return;

    if (connected) {
      dot.classList.add("live");
      text.textContent = "LIVE — " + (serverName || "XRPL");
      text.style.color = "#50fa7b";
      text.style.cursor = "default";
      text.onclick = null;
    } else {
      dot.classList.remove("live");
      text.textContent = serverName || "Connecting...";
      text.style.color = "#ffb86c";
      text.style.cursor = "pointer";
      text.title = "Click to reconnect";
      text.onclick = reconnectXRPL;
    }
  }

  // -------------------- SERVER ROTATION --------------------
  function nextServer() {
    const servers = getCurrentServerList();
    const idx = window.XRPL.serverIndex % servers.length;
    window.XRPL.serverIndex = (window.XRPL.serverIndex + 1) % servers.length;
    return servers[idx];
  }

  // -------------------- MAIN CONNECTION --------------------
  async function connectXRPL() {
    if (window.XRPL.connecting) {
      console.log("⏳ Already connecting...");
      return false;
    }

    if (typeof xrpl === "undefined" || !xrpl.Client) {
      console.error("❌ xrpl.js library not loaded!");
      updateConnectionStatus(false, "Library not loaded");
      setMode("offline", "xrpl library missing");
      dispatchConnectionEvent();
      return false;
    }

    window.XRPL.connecting = true;
    setMode("connecting", "Connecting...");
    updateConnectionStatus(false, "Connecting...");
    dispatchConnectionEvent();

    const server = nextServer();
    const success = await attemptConnection(server);

    window.XRPL.connecting = false;

    if (success) return true;

    handleConnectionFailure();
    return false;
  }

  // -------------------- ATTEMPT CONNECTION --------------------
  async function attemptConnection(server) {
    try {
      console.log("🔌 Trying", server.name, "...");
      await cleanupConnection();

      window.XRPL.client = new xrpl.Client(server.url, {
        timeout: WS_REQUEST_TIMEOUT_MS,
        connectionTimeout: WS_CONNECT_TIMEOUT_MS
      });

      setupConnectionListeners();

      await withTimeout(window.XRPL.client.connect(), WS_CONNECT_TIMEOUT_MS, `connect(${server.url})`);

      // IMPORTANT: must be `let` because we may synthesize info
      let info = await verifyConnectionAndSubscribe();

      // server_info can be flaky; accept ledger_current if available
      if (!info || !info.validated_ledger || !info.validated_ledger.seq) {
        console.warn("⚠️ server_info incomplete; trying ledger_current for sanity...");
        const cur = await safeClientRequest({ command: "ledger_current" }, 8000).catch(() => null);
        const idx = cur?.result?.ledger_current_index ?? null;
        if (!idx) throw new Error("Failed to verify connection (no validated ledger)");

        info = info || {};
        info.validated_ledger = { seq: idx, txn_count: 0 };
      }

      window.XRPL.connected = true;
      window.XRPL.server = server;
      window.XRPL.reconnectAttempts = 0;
      window.XRPL.lastDisconnectCode = null;

      updateInitialState(info);
      updateConnectionStatus(true, server.name);

      startActivePolling();
      setMode("live", "Connected");
      safeNotify("✅ Connected to " + server.name, "success");
      dispatchConnectionEvent();

      console.log("✅ Connected to", server.name);
      return true;
    } catch (err) {
      console.warn("❌", server.name, "failed:", err && err.message ? err.message : err);
      window.XRPL.lastServerInfoErrorAt = Date.now();
      window.XRPL.lastServerInfoError = err && err.message ? err.message : String(err);
      await cleanupConnection();
      return false;
    }
  }

  // -------------------- VERIFY & SUBSCRIBE --------------------
  async function verifyConnectionAndSubscribe() {
    const client = window.XRPL.client;
    if (!client) return null;

    let info = null;
    try {
      const response = await safeClientRequest({ command: "server_info" }, 12000);
      info = response?.result?.info || null;

      if (info) {
        window.XRPL.lastServerInfoOkAt = Date.now();
        window.XRPL.lastServerInfoError = null;
      }
    } catch (e) {
      window.XRPL.lastServerInfoErrorAt = Date.now();
      window.XRPL.lastServerInfoError = e && e.message ? e.message : String(e);
      console.warn("⚠️ server_info failed (non-fatal):", window.XRPL.lastServerInfoError);
    }

    try {
      await safeClientRequest({ command: "subscribe", streams: ["ledger"] }, 10000);
      console.log("✅ Subscribed to ledger stream");
    } catch (e) {
      console.warn("⚠️ Subscription failed, using polling:", e && e.message ? e.message : e);
    }

    return info;
  }

  // -------------------- INITIAL STATE --------------------
  function updateInitialState(info) {
    const s = window.XRPL.state;

    if (info && info.validated_ledger) {
      s.ledgerIndex = info.validated_ledger.seq;
      window.XRPL.lastLedgerIndex = info.validated_ledger.seq;
      s.ledgerTime = new Date();
      s.txPerLedger = info.validated_ledger.txn_count || 0;
    }

    s.feeAvg = info?.validated_ledger?.base_fee_xrp || s.feeAvg || 0.00001;
    s.loadFee = (info?.load_factor || 1000000) / 1000000;
    s.validators = info?.peers || 0;
    s.quorum = info?.validation_quorum || 0.8;

    console.log("📊 Initial: Ledger #", s.ledgerIndex, ",", s.txPerLedger, "tx");
    sendStateToDashboard();
  }

  // -------------------- ACTIVE POLLING --------------------
  function startActivePolling() {
    if (window.XRPL.ledgerPollInterval) clearInterval(window.XRPL.ledgerPollInterval);

    window.XRPL.ledgerPollInterval = setInterval(async function () {
      if (!window.XRPL.connected || !window.XRPL.client) return;
      try {
        await checkForNewLedger();
      } catch (e) {
        console.warn("Polling error:", e && e.message ? e.message : e);
      }
    }, LEDGER_POLL_INTERVAL_MS);

    setTimeout(function () {
      checkForNewLedger();
    }, 1000);
  }

  // -------------------- CHECK FOR NEW LEDGER --------------------
  async function checkForNewLedger() {
    if (!window.XRPL.connected || !window.XRPL.client) return;

    try {
      let currentLedger = null;

      const now = Date.now();
      const canUseCache = now - window.XRPL.lastServerInfoOkAt < SERVER_INFO_CACHE_MS;

      if (!canUseCache) {
        const resp = await safeClientRequest({ command: "server_info" }, 9000).catch(() => null);
        const info = resp?.result?.info || null;
        if (info && info.validated_ledger && info.validated_ledger.seq) {
          currentLedger = info.validated_ledger.seq;
          window.XRPL.lastServerInfoOkAt = now;
          window.XRPL.lastServerInfoError = null;
        } else {
          window.XRPL.lastServerInfoErrorAt = now;
          window.XRPL.lastServerInfoError = "server_info invalid/empty";
        }
      }

      if (!currentLedger) {
        const cur = await safeClientRequest({ command: "ledger_current" }, 7000).catch(() => null);
        currentLedger = cur?.result?.ledger_current_index ?? null;
      }

      if (!currentLedger) {
        window.XRPL.lastLedgerTime = Date.now();
        return;
      }

      if (currentLedger > window.XRPL.lastLedgerIndex) {
        console.log("🆕 New ledger:", "#" + currentLedger);
        await fetchAndProcessLedger(currentLedger, null);
      } else {
        window.XRPL.lastLedgerTime = Date.now();
      }
    } catch (error) {
      console.warn("Check ledger error:", error && error.message ? error.message : error);
      if (isLikelyTransportError(error?.message)) {
        handleDisconnection("polling_error");
      }
    }
  }

  // -------------------- FETCH & PROCESS LEDGER --------------------
  async function fetchAndProcessLedger(ledgerIndex, serverInfoHint) {
    if (!window.XRPL.client) return;

    try {
      console.log("🔍 Fetching ledger #", ledgerIndex, "with transactions...");

      const ledgerResp = await safeClientRequest(
        {
          command: "ledger",
          ledger_index: ledgerIndex,
          transactions: true,
          expand: true,
          binary: false
        },
        20000
      );

      const ledgerData = ledgerResp?.result?.ledger || null;
      if (!ledgerData) {
        console.warn("⚠️ No ledger data in response");
        return;
      }

      const closeDate = ledgerData.close_time ? rippleTimeToDate(ledgerData.close_time) : new Date();

      const closeTimeSec = Math.floor(closeDate.getTime() / 1000);
      let durationSec = 4.0;
      if (window.XRPL.lastCloseTimeSec != null) {
        durationSec = Math.max(1, closeTimeSec - window.XRPL.lastCloseTimeSec);
      }
      window.XRPL.lastCloseTimeSec = closeTimeSec;

      const txMetrics = analyzeLedgerTransactions(ledgerData);
      const totalTx = txMetrics.totalTx;
      const tps = totalTx > 0 ? totalTx / durationSec : 0;

      const s = window.XRPL.state;
      s.ledgerIndex = Number(ledgerData.ledger_index || ledgerIndex);
      s.ledgerTime = closeDate;
      s.txPerLedger = totalTx;
      s.txnPerSec = tps;
      s.transactionTypes = { ...txMetrics.aggregatedTypes };

      if (txMetrics.avgFeeXRP > 0) s.feeAvg = txMetrics.avgFeeXRP;

      updateHistory("tpsHistory", tps);
      updateHistory("feeHistory", s.feeAvg);
      updateHistory("ledgerHistory", s.ledgerIndex);
      updateHistory("txCountHistory", totalTx);

      if (!Array.isArray(s.closeTimes)) s.closeTimes = [];
      s.closeTimes.push({ label: "#" + s.ledgerIndex, value: durationSec });
      if (s.closeTimes.length > 25) s.closeTimes.shift();

      if (!Array.isArray(s.recentLedgers)) s.recentLedgers = [];
      s.recentLedgers.push({
        ledgerIndex: s.ledgerIndex,
        closeTime: closeDate.toISOString(),
        totalTx: totalTx,
        tps: tps,
        avgFeeXRP: txMetrics.avgFeeXRP,
        successRate: txMetrics.successRate
      });
      if (s.recentLedgers.length > MAX_LEDGER_HISTORY) {
        s.recentLedgers.splice(0, s.recentLedgers.length - MAX_LEDGER_HISTORY);
      }

      const normalizedBatch = txMetrics.normalized || [];
      if (!Array.isArray(s.recentTransactions)) s.recentTransactions = [];
      if (normalizedBatch.length) {
        Array.prototype.push.apply(s.recentTransactions, normalizedBatch);
        if (s.recentTransactions.length > RAW_TX_WINDOW_SIZE) {
          s.recentTransactions.splice(0, s.recentTransactions.length - RAW_TX_WINDOW_SIZE);
        }
      }

      window.XRPL.lastLedgerIndex = s.ledgerIndex;
      window.XRPL.lastLedgerTime = Date.now();

      let info = serverInfoHint || null;
      if (!info) {
        const resp = await safeClientRequest({ command: "server_info" }, 9000).catch(() => null);
        info = resp?.result?.info || null;
      }

      if (info) {
        s.feeAvg = (info.validated_ledger && info.validated_ledger.base_fee_xrp) || s.feeAvg;
        s.loadFee = (info.load_factor || 1000000) / 1000000;
        s.validators = info.peers || s.validators;
      }

      window.dispatchEvent(
        new CustomEvent("xrpl-tx-batch", {
          detail: { ledgerIndex: s.ledgerIndex, closeTime: closeDate, transactions: normalizedBatch }
        })
      );

      sendStateToDashboard();
    } catch (error) {
      console.warn("Fetch ledger error:", error && error.message ? error.message : error);
      if (isLikelyTransportError(error?.message)) {
        handleDisconnection("ledger_fetch_error");
      }
    }
  }

  // -------------------- TRANSACTION ANALYSIS --------------------
  function analyzeLedgerTransactions(ledger) {
    const txs = ledger.transactions || [];

    const aggregatedTypes = { Payment: 0, Offer: 0, NFT: 0, TrustSet: 0, Other: 0 };
    let totalTx = 0;
    let successCount = 0;
    let totalFeeDrops = 0;
    const normalized = [];

    function classify(txType) {
      if (!txType) return "Other";
      if (txType === "Payment") return "Payment";
      if (
        txType === "OfferCreate" ||
        txType === "OfferCancel" ||
        (typeof txType === "string" && txType.indexOf("AMM") === 0)
      ) {
        return "Offer";
      }
      if (typeof txType === "string" && (txType.indexOf("NFToken") === 0 || txType.indexOf("NFT") === 0)) return "NFT";
      if (txType === "TrustSet") return "TrustSet";
      return "Other";
    }

    for (let i = 0; i < txs.length; i++) {
      const entry = txs[i];
      const extracted = extractTxAndMeta(entry);
      const tx = extracted.tx;
      const meta = extracted.meta;

      if (!tx || !tx.TransactionType) continue;

      totalTx += 1;

      const cat = classify(tx.TransactionType);
      aggregatedTypes[cat] = (aggregatedTypes[cat] || 0) + 1;

      if (meta && typeof meta.TransactionResult === "string") {
        if (meta.TransactionResult.indexOf("tes") === 0) successCount += 1;
      } else {
        successCount += 1;
      }

      if (tx.Fee != null) {
        const feeDrops = Number(tx.Fee);
        if (!Number.isNaN(feeDrops)) totalFeeDrops += feeDrops;
      }

      const n = normalizeTransaction(entry, ledger.ledger_index, ledger.close_time ? rippleTimeToDate(ledger.close_time) : null);
      if (n) normalized.push(n);
    }

    const avgFeeXRP = totalTx > 0 && totalFeeDrops > 0 ? totalFeeDrops / 1_000_000 / totalTx : 0;
    const successRate = totalTx > 0 ? (successCount / totalTx) * 100 : 100;

    return { totalTx, aggregatedTypes, avgFeeXRP, successRate, normalized };
  }

  // -------------------- SEND STATE TO DASHBOARD + ANALYTICS --------------------
  function sendStateToDashboard() {
    const s = window.XRPL.state;

    const txTypes = {
      Payment: s.transactionTypes.Payment || 0,
      Offer: s.transactionTypes.Offer || 0,
      OfferCreate: 0,
      OfferCancel: 0,
      NFT: s.transactionTypes.NFT || 0,
      NFTokenMint: 0,
      NFTokenBurn: 0,
      TrustSet: s.transactionTypes.TrustSet || 0,
      Other: s.transactionTypes.Other || 0
    };

    const dashboardState = {
      ledgerIndex: s.ledgerIndex,
      ledgerAge: "just now",
      tps: s.txnPerSec,
      tpsTrend: "",
      avgFee: s.feeAvg,
      validators: {
        total: s.validators,
        healthy: Math.round(s.validators * 0.95),
        missed: 0,
        geoDiversity: "—"
      },
      txPerLedger: s.txPerLedger,
      txSpread: "—",
      loadFactor: s.loadFee,
      loadNote: s.loadFee > 1.2 ? "Elevated" : "Normal",
      closeTimes: s.closeTimes || [],
      txTypes: txTypes,
      amm: {},
      trustlines: {},
      nfts: {},
      whales: [],
      latency: { avgMs: 0, fastShare: 0.7, mediumShare: 0.2, slowShare: 0.1 },
      orderbook: [],
      gateways: [],
      latestLedger: {
        ledgerIndex: s.ledgerIndex,
        closeTime: s.ledgerTime || new Date(),
        totalTx: s.txPerLedger,
        txTypes: { ...txTypes },
        avgFee: s.feeAvg,
        successRate: 99.9
      },
      recentTransactions: s.recentTransactions || [],
      recentLedgers: s.recentLedgers || []
    };

    if (window.NaluDashboard && typeof window.NaluDashboard.applyXRPLState === "function") {
      try {
        window.NaluDashboard.applyXRPLState(dashboardState);
      } catch (e) {
        console.warn("Dashboard applyXRPLState error:", e && e.message ? e.message : e);
      }
    }

    window.dispatchEvent(
      new CustomEvent("xrpl-ledger", {
        detail: {
          ...window.XRPL.state,
          txTypes: txTypes,
          latestLedger: dashboardState.latestLedger
        }
      })
    );
  }

  // -------------------- CONNECTION LISTENERS --------------------
  function setupConnectionListeners() {
    const client = window.XRPL.client;
    if (!client) return;

    client.removeAllListeners();

    client.on("ledgerClosed", function (ledger) {
      try {
        const idx = Number(ledger.ledger_index);
        if (!idx || idx <= window.XRPL.lastLedgerIndex) return;
        console.log("📨 ledgerClosed event:", idx);
        fetchAndProcessLedger(idx, null);
      } catch (e) {
        console.warn("Ledger closed handler error:", e && e.message ? e.message : e);
      }
    });

    client.on("error", function (error) {
      console.warn("🔌 WebSocket error:", error && error.message ? error.message : error);
    });

    client.on("disconnected", function (code) {
      console.warn("🔌 Disconnected (code " + code + ")");
      window.XRPL.lastDisconnectCode = code;
      handleDisconnection("ws_disconnected");
    });
  }

  // -------------------- DISCONNECTION HANDLING --------------------
  function handleDisconnection(reason) {
    if (!window.XRPL.connected && !window.XRPL.connecting) {
      scheduleReconnect(reason || "disconnected");
      return;
    }

    console.warn("🔌 Handling disconnection...", reason || "");
    window.XRPL.connected = false;

    if (window.XRPL.ledgerPollInterval) {
      clearInterval(window.XRPL.ledgerPollInterval);
      window.XRPL.ledgerPollInterval = null;
    }

    updateConnectionStatus(false, "Disconnected");
    setMode("connecting", "Disconnected: " + (reason || "unknown"));
    dispatchConnectionEvent();

    scheduleReconnect(reason || "disconnected");
  }

  function scheduleReconnect(reason) {
    if (window.XRPL.reconnectTimeout) clearTimeout(window.XRPL.reconnectTimeout);

    window.XRPL.reconnectAttempts += 1;
    const delay = backoffMs();

    console.log("🔄 Reconnecting in", delay, "ms (attempt", window.XRPL.reconnectAttempts, ")", reason || "");
    window.XRPL.reconnectTimeout = setTimeout(function () {
      connectXRPL();
    }, delay);
  }

  // -------------------- CONNECTION FAILURE (TRY AGAIN) --------------------
  function handleConnectionFailure() {
    console.warn("❌ Connection attempt failed, retrying via failover rotation...");
    updateConnectionStatus(false, "Retrying...");
    setMode("connecting", "Connection failed, retrying");

    scheduleReconnect("connect_failure");
    dispatchConnectionEvent();
  }

  // -------------------- CLEANUP --------------------
  async function cleanupConnection() {
    if (window.XRPL.ledgerPollInterval) {
      clearInterval(window.XRPL.ledgerPollInterval);
      window.XRPL.ledgerPollInterval = null;
    }

    if (window.XRPL.reconnectTimeout) {
      clearTimeout(window.XRPL.reconnectTimeout);
      window.XRPL.reconnectTimeout = null;
    }

    if (window.XRPL.client) {
      try {
        window.XRPL.client.removeAllListeners();
        await withTimeout(window.XRPL.client.disconnect(), 8000, "disconnect()");
      } catch (_) {
        /* ignore */
      }
      window.XRPL.client = null;
    }

    window.XRPL.connected = false;
  }

  // -------------------- MANUAL RECONNECT --------------------
  async function reconnectXRPL() {
    console.log("🔄 Manual reconnect");
    safeNotify("Reconnecting to XRPL...", "info");
    window.XRPL.reconnectAttempts = 0;
    return connectXRPL();
  }

  // -------------------- PUBLIC API --------------------
  function getXRPLState() {
    return {
      ...window.XRPL.state,
      connected: window.XRPL.connected,
      server: window.XRPL.server?.name || "Unknown",
      serverUrl: window.XRPL.server?.url || null,
      lastUpdate: window.XRPL.lastLedgerTime,
      mode: window.XRPL.mode,
      modeReason: window.XRPL.modeReason,
      network: window.XRPL.network
    };
  }

  function isXRPLConnected() {
    return window.XRPL.connected && Date.now() - window.XRPL.lastLedgerTime < 60000;
  }

  // -------------------- HTTP JSON-RPC FALLBACK (requestXrpl only) --------------------
  async function tryFetchJson(url, body, timeoutMs) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      if (!resp.ok) return null;
      return await resp.json();
    } catch (_) {
      return null;
    } finally {
      clearTimeout(id);
    }
  }

  function unwrapRpcResult(json) {
    const r = json?.result;
    if (!r) return null;
    if (r.status === "success" && r.result && typeof r.result === "object") return r.result;
    return r;
  }

  async function httpRpcRequest(payload, timeoutMs = 15000) {
    if (DISABLE_HTTP_FALLBACK) throw new Error("HTTP fallback disabled");

    const body = { method: payload.command, params: [{ ...payload }] };
    if (body.params[0].api_version != null) delete body.params[0].api_version;

    for (const base of HTTP_RPC_ENDPOINTS) {
      const url = base.endsWith("/") ? base : base + "/";
      const j = await tryFetchJson(url, body, timeoutMs);
      const out = unwrapRpcResult(j);
      if (out) return out;
    }

    throw new Error("HTTP JSON-RPC failed (all endpoints)");
  }

  // -------------------- SHARED REQUEST WRAPPER (HARDENED) --------------------
  /**
   * requestXrpl(payload, { timeoutMs })
   * - Uses shared WS when connected (hard timeout)
   * - If WS offline, waits briefly for connect
   * - If still offline or WS request fails, optionally falls back to HTTP JSON-RPC
   */
  window.requestXrpl = async function (payload, { timeoutMs = WS_REQUEST_TIMEOUT_MS } = {}) {
    if (!payload) throw new Error("payload required");

    if (window.XRPL.client && window.XRPL.connected && typeof window.XRPL.client.request === "function") {
      try {
        return await safeClientRequest(payload, timeoutMs);
      } catch (e) {
        if (!DISABLE_HTTP_FALLBACK) {
          const r = await httpRpcRequest(payload, timeoutMs).catch(() => null);
          if (r) return { result: r };
        }
        if (isLikelyTransportError(e?.message)) handleDisconnection("request_ws_failed");
        throw e;
      }
    }

    try {
      connectXRPL();
    } catch (_) {}

    const start = Date.now();
    const intervalMs = 200;

    while (Date.now() - start < timeoutMs) {
      if (window.XRPL.client && window.XRPL.connected && typeof window.XRPL.client.request === "function") {
        try {
          return await safeClientRequest(payload, timeoutMs);
        } catch (e) {
          if (!DISABLE_HTTP_FALLBACK) {
            const r = await httpRpcRequest(payload, timeoutMs).catch(() => null);
            if (r) return { result: r };
          }
          if (isLikelyTransportError(e?.message)) handleDisconnection("request_ws_failed_after_wait");
          throw e;
        }
      }
      await sleep(intervalMs);
    }

    if (!DISABLE_HTTP_FALLBACK) {
      const r = await httpRpcRequest(payload, timeoutMs);
      return { result: r };
    }

    throw new Error("Timed out waiting for shared XRPL connection");
  };

  // -------------------- INITIALIZATION --------------------
  document.addEventListener("DOMContentLoaded", function () {
    console.log("🌊 Initializing XRPL connection on:", window.XRPL.network);

    if (typeof xrpl === "undefined") {
      console.error("❌ xrpl.js library not loaded!");
      updateConnectionStatus(false, "Library not loaded");
      setMode("offline", "Library not loaded");
      dispatchConnectionEvent();
      return;
    }

    setTimeout(function () {
      connectXRPL();
    }, 500);
  });

  // -------------------- KEEP ALIVE --------------------
  setInterval(function () {
    if (!window.XRPL.connected && !window.XRPL.connecting) {
      console.log("💓 Keep-alive: Reconnecting...");
      connectXRPL();
    }
  }, KEEPALIVE_INTERVAL_MS);

  // -------------------- EXPORTS --------------------
  window.connectXRPL = connectXRPL;
  window.reconnectXRPL = reconnectXRPL;
  window.getXRPLState = getXRPLState;
  window.isXRPLConnected = isXRPLConnected;
  window.setXRPLNetwork = setXRPLNetwork;

  console.log("🌊 XRPL Connection module loaded (Deep + Hardened failover + requestXrpl fallback)");
})();
