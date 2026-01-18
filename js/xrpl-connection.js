/* =========================================
   NaluXrp 🌊 – XRPL Connection Module (Stable Queue + Backfill)
   - Stream-first (ledgerClosed), polling fallback only if subscription fails
   - Sequential ledger fetch queue (dedupe + sorted)
   - Backfill missing ledgers (prevents skips like missing #...578)
   - Backoff for "too much load" + retry + requeue for ledgerNotFound
   - Never emits "partial" ledger cards (prevents TotalTX=0 with old txTypes)
   ========================================= */

(function () {
  // -----------------------------
  // GLOBAL
  // -----------------------------
  window.XRPL = window.XRPL || {
    client: null,
    connected: false,
    connecting: false,
    server: null,
    reconnectAttempts: 0,
    maxReconnectAttempts: 999,
    lastLedgerTime: Date.now(),

    // IMPORTANT:
    // lastLedgerIndex = last *processed/analyzed* ledger index (not just "network head")
    lastLedgerIndex: 0,

    // network head (validated ledger seq from server_info)
    headLedgerIndex: 0,

    lastCloseTimeSec: null,
    ledgerPollInterval: null,
    serverInfoInterval: null,
    reconnectTimeout: null,
    subscriptionActive: false,

    // Queue state
    _ledgerQueue: [],
    _ledgerQueueSet: new Set(),
    _processingQueue: false,
    _lastFetchAt: 0,
    _loadBackoffMs: 0,

    // last analyzed snapshot for dashboard stream
    _lastAnalyzed: null,

    state: {
      ledgerIndex: 0,      // network head for top metrics
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

      // Deep analytics
      recentTransactions: [],
      recentLedgers: []
    },

    mode: "connecting",
    modeReason: "Initializing",
    network: "xrpl-mainnet"
  };

  // -----------------------------
  // CONSTANTS
  // -----------------------------
  const RAW_TX_WINDOW_SIZE = 800;
  const MAX_LEDGER_HISTORY = 60;

  const POLL_INTERVAL_MS = 4500;               // fallback only
  const SERVER_INFO_INTERVAL_MS = 12000;       // keep metrics fresh
  const MIN_FETCH_INTERVAL_MS = 950;           // rate-limit ledger fetch
  const LEDGER_NOT_FOUND_RETRIES = 3;
  const LEDGER_NOT_FOUND_DELAY_MS = 1400;
  const LEDGER_NOT_FOUND_REQUEUE_MS = 6500;    // requeue later if still missing
  const LOAD_RETRY_LIMIT = 2;
  const LOAD_BACKOFF_BASE_MS = 2000;

  const MAX_QUEUE_SIZE = 24;                   // avoid storms
  const MAX_BACKFILL_GAP = 12;                 // how many missing ledgers we will backfill at once

  // -----------------------------
  // NETWORK PROFILES
  // -----------------------------
  const XRPL_SERVER_PROFILES = {
    "xrpl-mainnet": [
      { url: "wss://xrplcluster.com", name: "XRPL Cluster" },
      { url: "wss://s2.ripple.com", name: "Ripple S2" },
      { url: "wss://s1.ripple.com", name: "Ripple S1" },
      { url: "wss://xrpl.link", name: "XRPL Link" }
    ],
    "xrpl-testnet": [
      { url: "wss://s.altnet.rippletest.net:51233", name: "XRPL Testnet" }
    ],
    "xahau-mainnet": [
      { url: "wss://xahau.network", name: "Xahau Mainnet" },
      { url: "wss://xahau.xrpl-labs.com", name: "Xahau Labs" }
    ]
  };

  // -----------------------------
  // UTIL
  // -----------------------------
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

  function setMode(mode, reason = "") {
    if (window.XRPL.mode === mode && window.XRPL.modeReason === reason) return;
    window.XRPL.mode = mode;
    window.XRPL.modeReason = reason;
    console.log(`🌊 XRPL Mode: ${mode} - ${reason}`);
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
          lastUpdate: window.XRPL.lastLedgerTime
        }
      })
    );
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

  // -----------------------------
  // AMOUNT HELPERS
  // -----------------------------
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

  // -----------------------------
  // TX EXTRACTION / NORMALIZATION
  // -----------------------------
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
      meta && typeof meta.TransactionResult === "string"
        ? meta.TransactionResult.startsWith("tes")
        : true;

    const feeDrops = tx.Fee != null ? Number(tx.Fee) : 0;
    const feeXRP = Number.isFinite(feeDrops) ? feeDrops / 1_000_000 : 0;

    const amount = tx.Amount != null ? tx.Amount : tx.amount;
    const delivered =
      meta && meta.delivered_amount != null ? meta.delivered_amount : amount != null ? amount : null;

    const amountXRP = parseXrpAmount(delivered);

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
      result: meta && typeof meta.TransactionResult === "string" ? meta.TransactionResult : null
    };
  }

  // -----------------------------
  // NETWORK SWITCHING
  // -----------------------------
  function setXRPLNetwork(networkId) {
    if (!XRPL_SERVER_PROFILES[networkId]) {
      console.warn(`⚠️ Unknown network: ${networkId}`);
      return;
    }
    if (window.XRPL.network === networkId) return;

    console.log(`🌐 Switching to ${networkId}`);
    window.XRPL.network = networkId;
    window.XRPL.reconnectAttempts = 0;
    setMode("connecting", "Network switched");

    cleanupConnection().then(() => connectXRPL());
  }

  // -----------------------------
  // QUEUE HELPERS (backfill + dedupe)
  // -----------------------------
  function enqueueLedgerIndex(idx, source = "unknown") {
    const ledgerIndex = Number(idx);
    if (!Number.isFinite(ledgerIndex) || ledgerIndex <= 0) return;

    // If we see a ledger ahead of what we've processed, backfill small gaps
    backfillIfGap(ledgerIndex, source);

    // Dedupe
    if (window.XRPL._ledgerQueueSet.has(ledgerIndex)) return;

    // Ignore if already processed
    if (ledgerIndex <= window.XRPL.lastLedgerIndex) return;

    // Bound queue size
    if (window.XRPL._ledgerQueue.length >= MAX_QUEUE_SIZE) {
      // keep newest half (sorted order)
      window.XRPL._ledgerQueue.sort((a, b) => a - b);
      const keep = window.XRPL._ledgerQueue.slice(-Math.floor(MAX_QUEUE_SIZE / 2));
      window.XRPL._ledgerQueue = keep;
      window.XRPL._ledgerQueueSet = new Set(keep);
    }

    window.XRPL._ledgerQueue.push(ledgerIndex);
    window.XRPL._ledgerQueueSet.add(ledgerIndex);

    window.XRPL._ledgerQueue.sort((a, b) => a - b);
    console.log(`🧾 Queue +#${ledgerIndex} (source: ${source})`);

    processLedgerQueue();
  }

  function enqueueRange(from, to, source = "range") {
    const a = Number(from);
    const b = Number(to);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return;
    if (b < a) return;

    // hard cap range
    const count = b - a + 1;
    if (count > MAX_BACKFILL_GAP) {
      // only take the newest MAX_BACKFILL_GAP in that range
      const start = b - MAX_BACKFILL_GAP + 1;
      for (let i = start; i <= b; i++) enqueueLedgerIndex(i, source);
      return;
    }

    for (let i = a; i <= b; i++) enqueueLedgerIndex(i, source);
  }

  function backfillIfGap(seenLedgerIndex, source) {
    const last = Number(window.XRPL.lastLedgerIndex) || 0;
    if (last <= 0) return;

    const gap = seenLedgerIndex - last;
    if (gap <= 1) return;

    // backfill missing ledgers between (last+1 ... seen-1)
    const missingFrom = last + 1;
    const missingTo = seenLedgerIndex - 1;

    // cap backfill to avoid storms; we’ll keep catching up gradually
    const maxTo = Math.min(missingTo, last + MAX_BACKFILL_GAP);

    console.log(`🧩 Gap detected: lastProcessed=${last}, seen=${seenLedgerIndex} → backfill #${missingFrom}..#${maxTo} (${source})`);
    enqueueRange(missingFrom, maxTo, "backfill");
  }

  // -----------------------------
  // QUEUE PROCESSOR (sequential)
  // -----------------------------
  async function processLedgerQueue() {
    if (window.XRPL._processingQueue) return;
    if (!window.XRPL.connected || !window.XRPL.client) return;

    window.XRPL._processingQueue = true;

    try {
      while (window.XRPL.connected && window.XRPL.client && window.XRPL._ledgerQueue.length) {
        const next = window.XRPL._ledgerQueue.shift();
        window.XRPL._ledgerQueueSet.delete(next);

        // If something advanced and this is now old, skip
        if (next <= window.XRPL.lastLedgerIndex) continue;

        // rate limit
        const now = Date.now();
        const since = now - (window.XRPL._lastFetchAt || 0);
        if (since < MIN_FETCH_INTERVAL_MS) {
          await sleep(MIN_FETCH_INTERVAL_MS - since);
        }

        // load backoff
        if (window.XRPL._loadBackoffMs && window.XRPL._loadBackoffMs > 0) {
          await sleep(window.XRPL._loadBackoffMs);
          window.XRPL._loadBackoffMs = 0;
        }

        window.XRPL._lastFetchAt = Date.now();
        await fetchAndProcessLedgerWithRetry(next);

        // After processing one, if head is still ahead, gently backfill forward
        if (window.XRPL.headLedgerIndex > window.XRPL.lastLedgerIndex + 1) {
          const from = window.XRPL.lastLedgerIndex + 1;
          const to = Math.min(window.XRPL.headLedgerIndex, window.XRPL.lastLedgerIndex + MAX_BACKFILL_GAP);
          enqueueRange(from, to, "head-catchup");
        }
      }
    } finally {
      window.XRPL._processingQueue = false;
    }
  }

  async function fetchAndProcessLedgerWithRetry(ledgerIndex) {
    let loadTries = 0;

    for (let attempt = 1; attempt <= LEDGER_NOT_FOUND_RETRIES; attempt++) {
      if (!window.XRPL.connected || !window.XRPL.client) return;

      try {
        console.log(`🔍 Fetching ledger #${ledgerIndex} with transactions... (attempt ${attempt})`);
        await fetchAndProcessLedger(ledgerIndex);
        return;
      } catch (e) {
        const msg = e && e.message ? String(e.message) : String(e);

        // socket issues: let reconnect take over
        if (/closed|disconnected|Timeout|timeout/i.test(msg)) throw e;

        if (/ledgerNotFound/i.test(msg)) {
          if (attempt < LEDGER_NOT_FOUND_RETRIES) {
            await sleep(LEDGER_NOT_FOUND_DELAY_MS);
            continue;
          }

          console.warn(`⚠️ ledgerNotFound persisted for #${ledgerIndex} → will requeue in ${LEDGER_NOT_FOUND_REQUEUE_MS}ms`);
          setTimeout(() => {
            // requeue later; by then the server usually has full tx expansion
            enqueueLedgerIndex(ledgerIndex, "ledgerNotFound-requeue");
          }, LEDGER_NOT_FOUND_REQUEUE_MS);
          return;
        }

        if (/too much load/i.test(msg)) {
          loadTries += 1;
          const backoff = LOAD_BACKOFF_BASE_MS * loadTries;
          window.XRPL._loadBackoffMs = Math.min(9000, backoff);
          console.warn(`⚠️ Server load warning. Backing off ${window.XRPL._loadBackoffMs}ms`);
          if (loadTries <= LOAD_RETRY_LIMIT) {
            await sleep(window.XRPL._loadBackoffMs);
            continue;
          }
          return;
        }

        console.warn(`⚠️ Fetch ledger error (non-retry):`, msg);
        return;
      }
    }
  }

  // -----------------------------
  // MAIN CONNECTION
  // -----------------------------
  async function connectXRPL() {
    if (window.XRPL.connecting) {
      console.log("⏳ Already connecting...");
      return false;
    }

    window.XRPL.connecting = true;
    const servers = getCurrentServerList();

    console.log("🌊 Connecting to", window.XRPL.network, "...");
    updateConnectionStatus(false, "Connecting...");

    try {
      for (let i = 0; i < servers.length; i++) {
        const server = servers[i];
        const ok = await attemptConnection(server);
        if (ok) return true;
      }
      handleConnectionFailure();
      return false;
    } finally {
      window.XRPL.connecting = false;
    }
  }

  async function attemptConnection(server) {
    try {
      console.log("🔌 Trying", server.name, "...");
      await cleanupConnection();

      window.XRPL.client = new xrpl.Client(server.url, {
        timeout: 10000,
        connectionTimeout: 15000
      });

      setupConnectionListeners();

      await Promise.race([
        window.XRPL.client.connect(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 15000))
      ]);

      const info = await verifyConnectionAndSubscribe();
      if (!info) throw new Error("Failed to verify connection");

      window.XRPL.connected = true;
      window.XRPL.server = server;
      window.XRPL.reconnectAttempts = 0;

      updateHeadState(info);     // update head metrics
      updateConnectionStatus(true, server.name);
      startActiveLoops();

      setMode("live", "Connected");
      safeNotify("✅ Connected to " + server.name, "success");
      dispatchConnectionEvent();

      console.log("✅ Connected to", server.name);

      // On connect, catch up from last processed to head (bounded)
      if (window.XRPL.headLedgerIndex > 0) {
        if (window.XRPL.lastLedgerIndex === 0) {
          // first run: start from head - 1 so we enqueue head itself
          window.XRPL.lastLedgerIndex = Math.max(0, window.XRPL.headLedgerIndex - 1);
        }
        enqueueRange(window.XRPL.lastLedgerIndex + 1, window.XRPL.headLedgerIndex, "connect-catchup");
      }

      return true;
    } catch (err) {
      console.warn("❌", server.name, "failed:", err && err.message ? err.message : err);
      await cleanupConnection();
      return false;
    }
  }

  async function verifyConnectionAndSubscribe() {
    const client = window.XRPL.client;
    if (!client) return null;

    const response = await client.request({ command: "server_info", timeout: 10000 });
    if (!response.result || !response.result.info) throw new Error("Invalid server_info");

    window.XRPL.subscriptionActive = false;
    try {
      await client.request({ command: "subscribe", streams: ["ledger"] });
      window.XRPL.subscriptionActive = true;
      console.log("✅ Subscribed to ledger stream");
    } catch (e) {
      window.XRPL.subscriptionActive = false;
      console.warn("⚠️ Subscription failed; polling fallback will be used:", e && e.message ? e.message : e);
    }

    return response.result.info;
  }

  // -----------------------------
  // HEAD METRICS UPDATE (NO PARTIAL LEDGER PUSH)
  // -----------------------------
  function updateHeadState(info) {
    const s = window.XRPL.state;

    const head = info.validated_ledger?.seq || 0;
    window.XRPL.headLedgerIndex = head;

    // Update top metrics
    if (head) {
      s.ledgerIndex = head;
      s.ledgerTime = new Date();
      s.txnPerSec = s.txnPerSec || 0;
    }

    s.feeAvg = info.validated_ledger?.base_fee_xrp || s.feeAvg || 0.00001;
    s.loadFee = (info.load_factor || 1000000) / 1000000;
    s.validators = info.peers || s.validators || 0;
    s.quorum = info.validation_quorum || s.quorum || 0.8;

    window.XRPL.lastLedgerTime = Date.now();
    dispatchConnectionEvent();

    // IMPORTANT: we DO NOT call sendStateToDashboard() here
    // because that would create "partial" ledger cards/stream entries.
  }

  // -----------------------------
  // ACTIVE LOOPS
  // -----------------------------
  function startActiveLoops() {
    if (window.XRPL.serverInfoInterval) clearInterval(window.XRPL.serverInfoInterval);
    window.XRPL.serverInfoInterval = setInterval(async () => {
      if (!window.XRPL.connected || !window.XRPL.client) return;
      try {
        const resp = await window.XRPL.client.request({ command: "server_info", timeout: 9000 });
        const info = resp.result?.info;
        if (!info) return;

        updateHeadState(info);

        // gentle catch-up if behind
        if (window.XRPL.headLedgerIndex > window.XRPL.lastLedgerIndex + 1) {
          const from = window.XRPL.lastLedgerIndex + 1;
          const to = Math.min(window.XRPL.headLedgerIndex, window.XRPL.lastLedgerIndex + MAX_BACKFILL_GAP);
          enqueueRange(from, to, "serverInfo-catchup");
        }
      } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        console.warn("server_info refresh error:", msg);
        if (/closed|disconnected|timeout/i.test(msg)) handleDisconnection("server_info_error");
      }
    }, SERVER_INFO_INTERVAL_MS);

    // Polling only if subscription failed
    if (window.XRPL.ledgerPollInterval) clearInterval(window.XRPL.ledgerPollInterval);
    if (!window.XRPL.subscriptionActive) {
      window.XRPL.ledgerPollInterval = setInterval(async () => {
        if (!window.XRPL.connected || !window.XRPL.client) return;
        try {
          await checkForNewLedger();
        } catch (e) {
          console.warn("Polling error:", e && e.message ? e.message : e);
        }
      }, POLL_INTERVAL_MS);

      setTimeout(() => checkForNewLedger(), 900);
    } else {
      window.XRPL.ledgerPollInterval = null;
    }
  }

  async function checkForNewLedger() {
    if (!window.XRPL.connected || !window.XRPL.client) return;

    const resp = await window.XRPL.client.request({ command: "server_info", timeout: 9000 });
    const info = resp.result?.info;
    const currentLedger = info?.validated_ledger?.seq;
    if (!currentLedger) return;

    window.XRPL.headLedgerIndex = currentLedger;
    window.XRPL.state.ledgerIndex = currentLedger;

    if (currentLedger > window.XRPL.lastLedgerIndex) {
      console.log("🆕 New ledger:", "#" + currentLedger, "→ queue #" + currentLedger);
      enqueueLedgerIndex(currentLedger, "poll");
    }
  }

  // -----------------------------
  // FETCH & PROCESS LEDGER
  // -----------------------------
  async function fetchAndProcessLedger(ledgerIndex) {
    if (!window.XRPL.client) throw new Error("No client");

    const ledgerResp = await window.XRPL.client.request({
      command: "ledger",
      ledger_index: ledgerIndex,
      transactions: true,
      expand: true,
      binary: false
    });

    const ledgerData = ledgerResp.result?.ledger;
    if (!ledgerData) throw new Error("No ledger data");

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

    // Update analyzed state
    s.txPerLedger = totalTx;
    s.txnPerSec = tps;
    s.transactionTypes = { ...txMetrics.aggregatedTypes };
    if (txMetrics.avgFeeXRP > 0) s.feeAvg = txMetrics.avgFeeXRP;

    // Update histories
    updateHistory("tpsHistory", tps);
    updateHistory("feeHistory", s.feeAvg);
    updateHistory("ledgerHistory", ledgerIndex);
    updateHistory("txCountHistory", totalTx);

    if (!Array.isArray(s.closeTimes)) s.closeTimes = [];
    s.closeTimes.push({ label: "#" + ledgerIndex, value: durationSec });
    if (s.closeTimes.length > 25) s.closeTimes.shift();

    // Deep analytics
    if (!Array.isArray(s.recentLedgers)) s.recentLedgers = [];
    s.recentLedgers.push({
      ledgerIndex,
      closeTime: closeDate.toISOString(),
      totalTx,
      tps,
      avgFeeXRP: txMetrics.avgFeeXRP,
      successRate: txMetrics.successRate
    });
    if (s.recentLedgers.length > MAX_LEDGER_HISTORY) {
      s.recentLedgers.splice(0, s.recentLedgers.length - MAX_LEDGER_HISTORY);
    }

    const normalizedBatch = txMetrics.normalized || [];
    if (!Array.isArray(s.recentTransactions)) s.recentTransactions = [];
    if (normalizedBatch.length) {
      s.recentTransactions.push(...normalizedBatch);
      if (s.recentTransactions.length > RAW_TX_WINDOW_SIZE) {
        s.recentTransactions.splice(0, s.recentTransactions.length - RAW_TX_WINDOW_SIZE);
      }
    }

    // Mark processed
    window.XRPL.lastLedgerIndex = ledgerIndex;
    window.XRPL.lastLedgerTime = Date.now();

    // Store last analyzed snapshot for dashboard stream (THIS prevents partial cards)
    window.XRPL._lastAnalyzed = {
      ledgerIndex,
      closeTime: closeDate,
      totalTx,
      txTypes: { ...s.transactionTypes },
      avgFee: s.feeAvg,
      successRate: txMetrics.successRate
    };

    // Emit tx batch
    window.dispatchEvent(
      new CustomEvent("xrpl-tx-batch", {
        detail: { ledgerIndex, closeTime: closeDate, transactions: normalizedBatch }
      })
    );

    // Push to dashboard AFTER analysis
    sendStateToDashboard();
  }

  function analyzeLedgerTransactions(ledger) {
    const txs = Array.isArray(ledger.transactions) ? ledger.transactions : [];

    const aggregatedTypes = {
      Payment: 0,
      Offer: 0,
      NFT: 0,
      TrustSet: 0,
      Other: 0
    };

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
      ) return "Offer";
      if (
        typeof txType === "string" &&
        (txType.indexOf("NFToken") === 0 || txType.indexOf("NFT") === 0)
      ) return "NFT";
      if (txType === "TrustSet") return "TrustSet";
      return "Other";
    }

    for (let i = 0; i < txs.length; i++) {
      const entry = txs[i];
      const { tx, meta } = extractTxAndMeta(entry);
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
        if (Number.isFinite(feeDrops)) totalFeeDrops += feeDrops;
      }

      const n = normalizeTransaction(
        entry,
        ledger.ledger_index,
        ledger.close_time ? rippleTimeToDate(ledger.close_time) : null
      );
      if (n) normalized.push(n);
    }

    const avgFeeXRP = totalTx > 0 && totalFeeDrops > 0 ? (totalFeeDrops / 1_000_000) / totalTx : 0;
    const successRate = totalTx > 0 ? (successCount / totalTx) * 100 : 100;

    return { totalTx, aggregatedTypes, avgFeeXRP, successRate, normalized };
  }

  // -----------------------------
  // SEND STATE TO DASHBOARD (NO PARTIAL STREAM)
  // -----------------------------
  function sendStateToDashboard() {
    const s = window.XRPL.state;

    // Use the analyzed snapshot for latestLedger always
    const snap = window.XRPL._lastAnalyzed;
    if (!snap || !snap.ledgerIndex) {
      // If nothing analyzed yet, don't push anything (prevents fake stream cards)
      return;
    }

    // Dashboard expects txTypes with sub-types sometimes
    const txTypes = {
      Payment: snap.txTypes.Payment || 0,
      Offer: snap.txTypes.Offer || 0,
      OfferCreate: 0,
      OfferCancel: 0,
      NFT: snap.txTypes.NFT || 0,
      NFTokenMint: 0,
      NFTokenBurn: 0,
      TrustSet: snap.txTypes.TrustSet || 0,
      Other: snap.txTypes.Other || 0
    };

    const dashboardState = {
      // Head metrics (top)
      ledgerIndex: s.ledgerIndex || window.XRPL.headLedgerIndex || snap.ledgerIndex,
      ledgerAge: "just now",
      tps: s.txnPerSec,
      tpsTrend: "",
      avgFee: s.feeAvg,
      validators: {
        total: s.validators,
        healthy: Math.round((s.validators || 0) * 0.95),
        missed: 0,
        geoDiversity: "—"
      },
      txPerLedger: s.txPerLedger,
      txSpread: "—",
      loadFactor: s.loadFee,
      loadNote: s.loadFee > 1.2 ? "Elevated" : "Normal",
      closeTimes: s.closeTimes || [],

      // IMPORTANT: ledger stream uses THIS (analyzed only)
      latestLedger: {
        ledgerIndex: snap.ledgerIndex,
        closeTime: snap.closeTime,
        totalTx: snap.totalTx,
        txTypes: { ...txTypes },
        avgFee: snap.avgFee,
        successRate: snap.successRate
      },

      txTypes,
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
          txTypes,
          latestLedger: dashboardState.latestLedger
        }
      })
    );
  }

  // -----------------------------
  // LISTENERS
  // -----------------------------
  function setupConnectionListeners() {
    const client = window.XRPL.client;
    if (!client) return;

    if (typeof client.removeAllListeners === "function") client.removeAllListeners();

    client.on("ledgerClosed", (ledger) => {
      try {
        const idx = Number(ledger?.ledger_index);
        if (!idx) return;

        // update head seen from stream
        window.XRPL.headLedgerIndex = Math.max(window.XRPL.headLedgerIndex || 0, idx);
        window.XRPL.state.ledgerIndex = window.XRPL.headLedgerIndex;

        console.log("📨 ledgerClosed event:", idx, "→ queue", idx);
        enqueueLedgerIndex(idx, "ledgerClosed");
      } catch (e) {
        console.warn("ledgerClosed handler error:", e && e.message ? e.message : e);
      }
    });

    client.on("error", (error) => {
      console.warn("🔌 WebSocket error:", error && error.message ? error.message : error);
    });

    client.on("disconnected", (code) => {
      console.warn("🔌 Disconnected (code " + code + ")");
      handleDisconnection("ws_disconnected");
    });
  }

  // -----------------------------
  // DISCONNECTION
  // -----------------------------
  function handleDisconnection(reason = "disconnected") {
    if (!window.XRPL.connected && !window.XRPL.connecting) return;

    console.warn("🔌 Handling disconnection...", reason);
    window.XRPL.connected = false;
    setMode("connecting", "Disconnected: " + reason);

    if (window.XRPL.ledgerPollInterval) {
      clearInterval(window.XRPL.ledgerPollInterval);
      window.XRPL.ledgerPollInterval = null;
    }
    if (window.XRPL.serverInfoInterval) {
      clearInterval(window.XRPL.serverInfoInterval);
      window.XRPL.serverInfoInterval = null;
    }

    // Stop processing; keep lastLedgerIndex so we can backfill after reconnect
    window.XRPL._processingQueue = false;
    window.XRPL._ledgerQueue = [];
    window.XRPL._ledgerQueueSet = new Set();

    updateConnectionStatus(false, "Disconnected");
    dispatchConnectionEvent();

    window.XRPL.reconnectAttempts += 1;
    const delay = Math.min(3000 * window.XRPL.reconnectAttempts, 10000);

    console.log("🔄 Reconnecting in", delay, "ms (attempt", window.XRPL.reconnectAttempts, ")");

    if (window.XRPL.reconnectTimeout) clearTimeout(window.XRPL.reconnectTimeout);
    window.XRPL.reconnectTimeout = setTimeout(() => {
      if (!window.XRPL.connected && !window.XRPL.connecting) connectXRPL();
    }, delay);
  }

  function handleConnectionFailure() {
    console.warn("❌ All servers failed, retrying...");
    updateConnectionStatus(false, "Retrying...");
    setMode("connecting", "All servers failed, retrying");

    const delay = Math.min(5000 * (window.XRPL.reconnectAttempts + 1), 30000);
    console.log("🔄 Retrying all servers in", delay, "ms");

    if (window.XRPL.reconnectTimeout) clearTimeout(window.XRPL.reconnectTimeout);
    window.XRPL.reconnectTimeout = setTimeout(() => {
      window.XRPL.reconnectAttempts += 1;
      connectXRPL();
    }, delay);

    dispatchConnectionEvent();
  }

  // -----------------------------
  // CLEANUP
  // -----------------------------
  async function cleanupConnection() {
    if (window.XRPL.ledgerPollInterval) {
      clearInterval(window.XRPL.ledgerPollInterval);
      window.XRPL.ledgerPollInterval = null;
    }
    if (window.XRPL.serverInfoInterval) {
      clearInterval(window.XRPL.serverInfoInterval);
      window.XRPL.serverInfoInterval = null;
    }
    if (window.XRPL.reconnectTimeout) {
      clearTimeout(window.XRPL.reconnectTimeout);
      window.XRPL.reconnectTimeout = null;
    }

    if (window.XRPL.client) {
      try {
        if (typeof window.XRPL.client.removeAllListeners === "function") {
          window.XRPL.client.removeAllListeners();
        }
        await window.XRPL.client.disconnect();
      } catch (e) {
        // ignore
      }
      window.XRPL.client = null;
    }

    window.XRPL.connected = false;
    window.XRPL.subscriptionActive = false;
  }

  // -----------------------------
  // CONNECTION STATUS UI
  // -----------------------------
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

  // -----------------------------
  // MANUAL RECONNECT
  // -----------------------------
  async function reconnectXRPL() {
    if (window.XRPL.connecting) {
      console.log("⏳ Already connecting...");
      return false;
    }
    console.log("🔄 Manual reconnect");
    safeNotify("Reconnecting to XRPL...", "info");
    window.XRPL.reconnectAttempts = 0;
    return connectXRPL();
  }

  // -----------------------------
  // PUBLIC API
  // -----------------------------
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

  window.requestXrpl = async function requestXrpl(req) {
    if (!window.XRPL.connected || !window.XRPL.client) throw new Error("XRPL not connected");
    return window.XRPL.client.request(req);
  };

  // -----------------------------
  // INIT
  // -----------------------------
  document.addEventListener("DOMContentLoaded", () => {
    console.log("🌊 Initializing XRPL connection on:", window.XRPL.network);

    if (typeof xrpl === "undefined") {
      console.error("❌ xrpl.js library not loaded!");
      updateConnectionStatus(false, "Library not loaded");
      return;
    }

    setTimeout(() => connectXRPL(), 500);
  });

  setInterval(() => {
    if (!window.XRPL.connected && !window.XRPL.connecting) {
      console.log("💓 Keep-alive: Reconnecting...");
      connectXRPL();
    }
  }, 30000);

  window.connectXRPL = connectXRPL;
  window.reconnectXRPL = reconnectXRPL;
  window.getXRPLState = getXRPLState;
  window.isXRPLConnected = isXRPLConnected;
  window.setXRPLNetwork = setXRPLNetwork;

  console.log("🌊 XRPL Connection module loaded (backfill + no partial ledgers)");
})();
