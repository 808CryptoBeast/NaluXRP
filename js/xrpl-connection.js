/* =========================================
   js/xrpl-connection.js
   NaluXrp 🌊 – XRPL Connection Module (Stability Patch)
   - Adds request serialization (single concurrent ledger fetch) to avoid
     request storms that cause WS disconnects (1006) and NotConnectedErrors.
   - Adds global reconnect request rate-limiter to prevent reconnect thrash
     when many callers call client.request while the client is reconnecting.
   - Hardened requestXrpl and client.request wrapper: avoid triggering
     repeated connect attempts; use a single reconnect signal and wait.
   - Keeps consumer registry and ledger-closed fast event behavior.
   - Purpose: make Dashboard ledger stream + Account Inspector coexist without
     causing repeated NotConnectedError loops.
   ========================================= */

(function () {
  "use strict";

  // ---------- GLOBAL STATE ----------
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
      transactionTypes: { Payment: 0, Offer: 0, NFT: 0, TrustSet: 0, Other: 0 },
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
    _pauseReasons: new Set(),
    processingPaused: false,
    processingPauseReason: null,
    _consumers: new Set(),
    _overloadedUntil: 0,
    // new helpers
    _lastReconnectRequestAt: 0,
    _reconnectCooldownMs: 2000 // don't trigger reconnect more than once per 2s
  };

  // ---------- CONFIG ----------
  const RAW_TX_WINDOW_SIZE = 800;
  const MAX_LEDGER_HISTORY = 60;
  const RPC_HTTP_ENDPOINTS = ["https://xrplcluster.com/", "https://xrpl.ws/"];
  const DEFAULT_RPC_TIMEOUT_MS = 15000;

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

  // ---------- UTILITIES ----------
  function nowMs() { return Date.now(); }

  function getCurrentServerList() {
    const list = XRPL_SERVER_PROFILES[window.XRPL.network];
    return Array.isArray(list) && list.length ? list : XRPL_SERVER_PROFILES["xrpl-mainnet"];
  }

  function safeNotify(message, type = "info", timeout = 3000) {
    if (typeof window.showNotification === "function") window.showNotification(message, type, timeout);
    console.log(`[${type.toUpperCase()}] ${message}`);
  }

  function dispatchConnectionEvent() {
    window.dispatchEvent(new CustomEvent("xrpl-connection", {
      detail: {
        connected: window.XRPL.connected,
        server: window.XRPL.server?.name || null,
        url: window.XRPL.server?.url || null,
        network: window.XRPL.network,
        mode: window.XRPL.mode,
        modeReason: window.XRPL.modeReason,
        lastUpdate: window.XRPL.lastLedgerTime
      }
    }));
  }

  function setMode(mode, reason = "") {
    if (window.XRPL.mode === mode && window.XRPL.modeReason === reason) return;
    window.XRPL.mode = mode;
    window.XRPL.modeReason = reason;
    console.log(`🌊 XRPL Mode: ${mode} - ${reason}`);
  }

  function rippleTimeToDate(rippleTime) {
    return new Date((rippleTime + 946684800) * 1000);
  }

  function updateHistory(key, value, maxLength = 50) {
    const numValue = parseFloat(value) || 0;
    const s = window.XRPL.state;
    if (!Array.isArray(s[key])) return;
    s[key].push(numValue);
    if (s[key].length > maxLength) s[key].shift();
  }

  // ---------- HTTP JSON-RPC fallback ----------
  async function tryFetchJson(url, { method = "GET", body = null, timeoutMs = DEFAULT_RPC_TIMEOUT_MS, headers = {} } = {}) {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeoutMs);
      const resp = await fetch(url, {
        method,
        headers: {
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...headers
        },
        body: body ? JSON.stringify(body) : null,
        signal: controller.signal
      });
      clearTimeout(id);
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      return await resp.json();
    } catch (err) {
      console.warn("tryFetchJson failed", err && err.message ? err.message : err);
      return null;
    }
  }

  function unwrapRpcResult(json) {
    const r = json?.result;
    if (!r) return null;
    if (r.error) return null;
    if (r.status === "success" && r.result && typeof r.result === "object") return r.result;
    return r;
  }

  async function rpcCall(method, paramsObj, { timeoutMs = DEFAULT_RPC_TIMEOUT_MS, retries = 1 } = {}) {
    const endpoints = [];
    if (window.NALU_RPC_HTTP && typeof window.NALU_RPC_HTTP === "string") endpoints.push(window.NALU_RPC_HTTP);
    endpoints.push(...RPC_HTTP_ENDPOINTS);

    const body = { method, params: [paramsObj] };

    for (const base of endpoints) {
      const url = base.endsWith("/") ? base : base + "/";
      let attempt = 0;
      while (attempt <= retries) {
        const j = await tryFetchJson(url, { method: "POST", body, timeoutMs });
        const out = unwrapRpcResult(j);
        if (out) return out;
        attempt++;
        if (attempt <= retries) await new Promise((r) => setTimeout(r, 200 * attempt));
      }
    }
    return null;
  }

  // ---------- CONSUMER REGISTRY ----------
  window.registerXRPLConsumer = function (name) {
    try {
      if (!name) return;
      window.XRPL._consumers.add(String(name));
      console.log("XRPL consumer registered:", name, "count:", window.XRPL._consumers.size);
      if (window.XRPL._consumers.size > 0 && window.XRPL.processingPaused) window.resumeXRPLProcessing("__no_consumers__");
      if (window.XRPL.connected && !window.XRPL.processingPaused) startActivePolling();
    } catch (e) { console.warn("registerXRPLConsumer error", e); }
  };

  window.unregisterXRPLConsumer = function (name) {
    try {
      if (!name) return;
      window.XRPL._consumers.delete(String(name));
      console.log("XRPL consumer unregistered:", name, "count:", window.XRPL._consumers.size);
      if (window.XRPL._consumers.size === 0) window.pauseXRPLProcessing("__no_consumers__");
    } catch (e) { console.warn("unregisterXRPLConsumer error", e); }
  };

  window.getXRPLConsumerCount = function () {
    return window.XRPL._consumers ? window.XRPL._consumers.size : 0;
  };

  // ---------- RECONNECT RATE LIMIT ----------
  function attemptSharedReconnect(reason) {
    try {
      const now = nowMs();
      const last = window.XRPL._lastReconnectRequestAt || 0;
      if (now - last < (window.XRPL._reconnectCooldownMs || 2000)) {
        // rate-limited: ignore
        return;
      }
      window.XRPL._lastReconnectRequestAt = now;

      console.log("🔁 attemptSharedReconnect:", reason);
      if (typeof window.reconnectXRPL === "function") window.reconnectXRPL();
      else if (typeof window.connectXRPL === "function") window.connectXRPL();
    } catch (e) {
      console.warn("attemptSharedReconnect failed:", e && e.message ? e.message : e);
    }
  }

  // ---------- REQUEST GUARD / QUEUE ----------
  // Serialize heavy ledger-related requests to avoid request storms that can
  // drop the WS connection. We allow small/fast concurrent requests in future,
  // but ledger fetches (fetchAndProcessLedger, account_tx heavy scans) must be
  // limited (1 concurrent).
  const requestLock = {
    ledgerFetchInProgress: false,
    ledgerFetchQueue: []
  };

  async function withLedgerFetchLock(fn) {
    // If no current fetch, run immediately
    if (!requestLock.ledgerFetchInProgress) {
      requestLock.ledgerFetchInProgress = true;
      try {
        const r = await fn();
        return r;
      } finally {
        requestLock.ledgerFetchInProgress = false;
        // dequeue next
        const next = requestLock.ledgerFetchQueue.shift();
        if (next) {
          // run next but don't await here
          withLedgerFetchLock(next).catch(() => {});
        }
      }
    } else {
      // queue and return a promise that resolves when run
      return new Promise((resolve, reject) => {
        requestLock.ledgerFetchQueue.push(async () => {
          try {
            const v = await fn();
            resolve(v);
          } catch (e) {
            reject(e);
          }
        });
      });
    }
  }

  // ---------- Defensive monkey-patch for direct client.request ----------
  function installClientRequestMonkeyPatch() {
    try {
      if (typeof xrpl === "undefined" || !xrpl.Client || xrpl.Client.prototype.__nalu_monkeypatched) return;
      const orig = xrpl.Client.prototype.request;
      xrpl.Client.prototype.__nalu_monkeypatched = true;
      xrpl.Client.prototype.request = async function (payload) {
        try {
          return await orig.call(this, payload);
        } catch (err) {
          const msg = String(err && (err.message || err)).toLowerCase();
          const isNotConnected = msg.includes("notconnected") || msg.includes("not connected") || msg.includes("websocket was closed") || msg.includes("socket hang up");
          if (!isNotConnected) throw err;

          // If client is reconnecting or we recently requested reconnect, wait a short time
          console.warn("xrpl.Client.request: NotConnected -> waiting for shared reconnect (non-aggressive)");
          attemptSharedReconnect("client.request NotConnectedError (monkeypatch)");
          // Wait for a short period for connect to happen; if not connected fallback to error
          const ok = await waitForXRPLConnection(3000);
          if (ok) {
            try {
              return await orig.call(this, payload);
            } catch (err2) {
              throw err2;
            }
          }
          // last-resort: rethrow original error so caller can fallback to requestXrpl
          throw err;
        }
      };
      console.log("xrpl.Client.prototype.request monkey-patch installed (defensive)");
    } catch (e) {
      console.warn("installClientRequestMonkeyPatch failed", e && e.message ? e.message : e);
    }
  }

  try { installClientRequestMonkeyPatch(); } catch (_) {}
  if (typeof xrpl === "undefined") {
    document.addEventListener("DOMContentLoaded", installClientRequestMonkeyPatch, { once: true });
    window.addEventListener("load", installClientRequestMonkeyPatch, { once: true });
  }

  // ---------- resilient client.request wrapper ----------
  function wrapClientRequest(client) {
    if (!client || typeof client.request !== "function") return;
    if (client.__nalu_wrapped_request) return;
    client.__nalu_wrapped_request = true;
    const original = client.request.bind(client);

    client.request = async function resilientRequest(payload) {
      // For heavy ledger fetches (command === 'ledger'), we serialize via lock
      const cmd = (payload && (payload.command || payload.method || "")).toString().toLowerCase();
      const isLedgerFetch = cmd === "ledger" || (cmd === "ledger_data");

      const runner = async () => {
        const MAX_ATTEMPTS = 3;
        let lastErr = null;
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
          try {
            if (typeof client.isConnected === "function" && !client.isConnected()) {
              // only request reconnect once (rate-limited)
              attemptSharedReconnect("wrapClientRequest: client not connected");
              // wait for connection to appear briefly
              await new Promise((r) => setTimeout(r, 500 + attempt * 300));
            }
            const res = await original(payload);
            return res;
          } catch (err) {
            lastErr = err;
            const msg = String(err && (err.message || err)).toLowerCase();
            const isNotConnected = msg.includes("notconnected") || msg.includes("not connected") || msg.includes("websocket was closed") || msg.includes("socket hang up");
            if (isNotConnected) {
              // If not connected, give other parts of system time to reconnect, but don't aggressively loop
              await new Promise((r) => setTimeout(r, 400 + attempt * 300));
              continue;
            }
            if (msg.includes("timeout") && attempt < MAX_ATTEMPTS - 1) {
              await new Promise((r) => setTimeout(r, 300 + attempt * 200));
              continue;
            }
            throw err;
          }
        }
        throw lastErr || new Error("client.request failed");
      };

      if (isLedgerFetch) {
        return withLedgerFetchLock(runner);
      } else {
        return runner();
      }
    };
  }

  // ---------- CORE: connect/reconnect/verify ----------
  async function connectXRPL() {
    if (window.XRPL.connecting) {
      console.log("⏳ Already connecting...");
      return;
    }
    window.XRPL.connecting = true;
    const servers = getCurrentServerList();
    updateConnectionStatus(false, "Connecting...");
    console.log("🌊 Connecting to", window.XRPL.network);

    for (const server of servers) {
      const ok = await attemptConnection(server);
      if (ok) { window.XRPL.connecting = false; return true; }
    }

    window.XRPL.connecting = false;
    handleConnectionFailure();
    return false;
  }

  async function attemptConnection(server) {
    try {
      console.log("🔌 Trying", server.name, server.url);
      await cleanupConnection();

      window.XRPL.client = new xrpl.Client(server.url, { timeout: 10000, connectionTimeout: 15000 });
      wrapClientRequest(window.XRPL.client);

      setupConnectionListeners();

      await Promise.race([ window.XRPL.client.connect(), new Promise((_, rej) => setTimeout(() => rej(new Error("Timeout")), 15000)) ]);

      const info = await verifyConnectionAndSubscribe();
      if (!info) throw new Error("Failed to verify connection");

      window.XRPL.connected = true;
      window.XRPL.server = server;
      window.XRPL.reconnectAttempts = 0;

      updateInitialState(info);
      updateConnectionStatus(true, server.name);

      if (getXRPLConsumerCount() > 0) startActivePolling();

      setMode("live", "Connected");
      safeNotify("✅ Connected to " + server.name, "success");
      dispatchConnectionEvent();
      console.log("✅ Connected to", server.name);
      return true;
    } catch (err) {
      console.warn("❌ attemptConnection failed:", server.name, err && err.message ? err.message : err);
      await cleanupConnection();
      return false;
    }
  }

  async function verifyConnectionAndSubscribe() {
    const client = window.XRPL.client;
    if (!client) return null;
    const response = await client.request({ command: "server_info", timeout: 10000 });
    if (!response || !response.result || !response.result.info) throw new Error("Invalid server_info");
    try {
      await client.request({ command: "subscribe", streams: ["ledger"] });
      console.log("✅ Subscribed to ledger stream");
    } catch (e) {
      console.warn("⚠️ Subscription failed, using polling:", e && e.message ? e.message : e);
    }
    return response.result.info;
  }

  function updateInitialState(info) {
    const s = window.XRPL.state;
    if (info.validated_ledger) {
      s.ledgerIndex = info.validated_ledger.seq;
      window.XRPL.lastLedgerIndex = info.validated_ledger.seq;
      s.ledgerTime = new Date();
      s.txPerLedger = info.validated_ledger.txn_count || 0;
    }
    s.feeAvg = info.validated_ledger?.base_fee_xrp || 0.00001;
    s.loadFee = (info.load_factor || 1000000) / 1000000;
    s.validators = info.peers || 0;
    s.quorum = info.validation_quorum || 0.8;
    sendStateToDashboard();
  }

  // ---------- PAUSE / RESUME API ----------
  (function () {
    function updateProcessingPausedState() {
      const paused = window.XRPL._pauseReasons && window.XRPL._pauseReasons.size > 0;
      window.XRPL.processingPaused = !!paused;
      window.XRPL.processingPauseReason = paused ? Array.from(window.XRPL._pauseReasons).join(",") : null;

      if (window.XRPL.processingPaused) {
        if (window.XRPL.ledgerPollInterval) { clearInterval(window.XRPL.ledgerPollInterval); window.XRPL.ledgerPollInterval = null; }
        setMode("paused", `processing paused (${window.XRPL.processingPauseReason})`);
        dispatchConnectionEvent();
        console.log("⏸️ XRPL processing paused:", window.XRPL.processingPauseReason);
      } else {
        if (getXRPLConsumerCount() > 0) startActivePolling();
        setMode("live", "processing active");
        dispatchConnectionEvent();
        console.log("▶️ XRPL processing resumed");
        try { checkForNewLedger(); } catch (_) {}
      }
    }

    window.pauseXRPLProcessing = function (reason) {
      try {
        if (!reason) reason = "manual";
        if (!window.XRPL._pauseReasons) window.XRPL._pauseReasons = new Set();
        window.XRPL._pauseReasons.add(String(reason));
        updateProcessingPausedState();
      } catch (e) { console.warn("pauseXRPLProcessing error", e); }
    };

    window.resumeXRPLProcessing = function (reason) {
      try {
        if (!window.XRPL._pauseReasons) window.XRPL._pauseReasons = new Set();
        if (reason == null) window.XRPL._pauseReasons.clear();
        else window.XRPL._pauseReasons.delete(String(reason));
        updateProcessingPausedState();
      } catch (e) { console.warn("resumeXRPLProcessing error", e); }
    };

    window.isXRPLProcessingPaused = function () { return !!(window.XRPL && window.XRPL.processingPaused); };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", function () {
        try {
          if (document.hidden) {
            if (!window.XRPL._pauseReasons) window.XRPL._pauseReasons = new Set();
            window.XRPL._pauseReasons.add("__visibility__");
            updateProcessingPausedState();
          } else {
            if (!window.XRPL._pauseReasons) window.XRPL._pauseReasons = new Set();
            window.XRPL._pauseReasons.delete("__visibility__");
            updateProcessingPausedState();
          }
        } catch (_) {}
      });
    }
  })();

  // ---------- ACTIVE POLLING ----------
  function startActivePolling() {
    if (window.XRPL.ledgerPollInterval) clearInterval(window.XRPL.ledgerPollInterval);
    if (getXRPLConsumerCount() === 0) { console.log("No active consumers — skipping active polling"); return; }

    window.XRPL.ledgerPollInterval = setInterval(async function () {
      if (!window.XRPL.connected || !window.XRPL.client) return;
      if (window.XRPL.processingPaused) return;
      try { await checkForNewLedger(); } catch (e) { console.warn("Polling error:", e && e.message ? e.message : e); }
    }, 4000);

    setTimeout(() => { try { checkForNewLedger(); } catch (_) {} }, 1000);
  }

  // ---------- CHECK FOR LEDGER ----------
  async function checkForNewLedger() {
    if (!window.XRPL.connected || !window.XRPL.client) return;
    if (window.XRPL.processingPaused) return;

    try {
      const resp = await window.XRPL.client.request({ command: "server_info", timeout: 8000 });
      const info = resp.result.info;
      const currentLedger = info.validated_ledger?.seq;
      if (!currentLedger) return;
      if (currentLedger > window.XRPL.lastLedgerIndex) {
        console.log("🆕 New ledger:", "#" + currentLedger);
        await fetchAndProcessLedger(currentLedger, info);
      } else {
        window.XRPL.lastLedgerTime = Date.now();
      }
    } catch (error) {
      console.warn("Check ledger error:", error && (error.message ? error.message : error));
      const m = String(error && (error.message || "")).toLowerCase();
      if (m.includes("timeout") || m.includes("closed") || m.includes("notconnected") || m.includes("websocket was closed")) handleDisconnection();
    }
  }

  // ---------- FETCH & PROCESS LEDGER ----------
  async function fetchAndProcessLedger(ledgerIndex, serverInfoHint) {
    if (!window.XRPL.client) return;

    // Quick minimal update and lightweight event to keep UI responsive
    if (ledgerIndex > window.XRPL.lastLedgerIndex) {
      window.XRPL.lastLedgerIndex = ledgerIndex;
      window.XRPL.lastLedgerTime = Date.now();
      try { window.XRPL.state.ledgerIndex = ledgerIndex; window.XRPL.state.ledgerTime = new Date(); updateHistory("ledgerHistory", ledgerIndex); } catch (_) {}
      window.dispatchEvent(new CustomEvent("xrpl-ledger-closed", { detail: { ledgerIndex, timestamp: window.XRPL.lastLedgerTime, server: window.XRPL.server?.name || null, network: window.XRPL.network } }));
    } else {
      window.XRPL.lastLedgerTime = Date.now();
    }

    // Skip heavy fetch if paused or no consumers
    if (window.XRPL.processingPaused || getXRPLConsumerCount() === 0) {
      console.log("fetchAndProcessLedger: processing paused or no consumers — skipping heavy fetch for", ledgerIndex);
      return;
    }

    // serialize ledger fetches using lock to avoid client.request storms
    return withLedgerFetchLock(async () => {
      try {
        console.log("🔍 Fetching ledger #", ledgerIndex, "with transactions...");
        const ledgerResp = await window.XRPL.client.request({ command: "ledger", ledger_index: ledgerIndex, transactions: true, expand: true, binary: false });
        const ledgerData = ledgerResp.result.ledger;
        if (!ledgerData) { console.warn("⚠️ No ledger data in response"); return; }

        const closeDate = ledgerData.close_time ? rippleTimeToDate(ledgerData.close_time) : new Date();
        const closeTimeSec = Math.floor(closeDate.getTime() / 1000);
        let durationSec = 4.0;
        if (window.XRPL.lastCloseTimeSec != null) durationSec = Math.max(1, closeTimeSec - window.XRPL.lastCloseTimeSec);
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
        s.recentLedgers.push({ ledgerIndex: s.ledgerIndex, closeTime: closeDate.toISOString(), totalTx, tps, avgFeeXRP: txMetrics.avgFeeXRP, successRate: txMetrics.successRate });
        if (s.recentLedgers.length > MAX_LEDGER_HISTORY) s.recentLedgers.splice(0, s.recentLedgers.length - MAX_LEDGER_HISTORY);

        const normalizedBatch = txMetrics.normalized || [];
        if (!Array.isArray(s.recentTransactions)) s.recentTransactions = [];
        if (normalizedBatch.length) {
          Array.prototype.push.apply(s.recentTransactions, normalizedBatch);
          if (s.recentTransactions.length > RAW_TX_WINDOW_SIZE) s.recentTransactions.splice(0, s.recentTransactions.length - RAW_TX_WINDOW_SIZE);
        }

        window.XRPL.lastLedgerIndex = s.ledgerIndex;
        window.XRPL.lastLedgerTime = Date.now();

        let info = serverInfoHint || null;
        if (!info) {
          try { const resp = await window.XRPL.client.request({ command: "server_info", timeout: 8000 }); info = resp.result.info; } catch (e) { info = null; }
        }
        if (info) { s.feeAvg = (info.validated_ledger && info.validated_ledger.base_fee_xrp) || s.feeAvg; s.loadFee = (info.load_factor || 1000000) / 1000000; s.validators = info.peers || s.validators; }

        window.dispatchEvent(new CustomEvent("xrpl-tx-batch", { detail: { ledgerIndex: s.ledgerIndex, closeTime: closeDate, transactions: normalizedBatch } }));
        sendStateToDashboard();
      } catch (error) {
        console.warn("Fetch ledger error:", error && (error.message ? error.message : error));
        const m = String(error && (error.message || "")).toLowerCase();
        if (m.includes("websocket was closed") || m.includes("notconnected") || m.includes("closed")) handleDisconnection();
      }
    });
  }

  // ---------- TX ANALYSIS ----------
  function analyzeLedgerTransactions(ledger) {
    const txs = ledger.transactions || [];
    const aggregatedTypes = { Payment: 0, Offer: 0, NFT: 0, TrustSet: 0, Other: 0 };
    let totalTx = 0, successCount = 0, totalFeeDrops = 0;
    const normalized = [];

    function classify(txType) {
      if (!txType) return "Other";
      if (txType === "Payment") return "Payment";
      if (txType === "OfferCreate" || txType === "OfferCancel" || (typeof txType === "string" && txType.indexOf("AMM") === 0)) return "Offer";
      if (typeof txType === "string" && (txType.indexOf("NFToken") === 0 || txType.indexOf("NFT") === 0)) return "NFT";
      if (txType === "TrustSet") return "TrustSet";
      return "Other";
    }

    for (let i = 0; i < txs.length; i++) {
      const entry = txs[i];
      const extracted = extractTxAndMeta(entry);
      const tx = extracted.tx;
      const meta = extracted.meta;
      if (!tx || !tx.TransactionType) { if (i < 2) console.warn("⚠️ Transaction missing type", entry); continue; }
      totalTx++;
      const cat = classify(tx.TransactionType);
      aggregatedTypes[cat] = (aggregatedTypes[cat] || 0) + 1;
      if (meta && typeof meta.TransactionResult === "string") { if (meta.TransactionResult.indexOf("tes") === 0) successCount++; } else successCount++;
      if (tx.Fee != null) { const feeDrops = Number(tx.Fee); if (!Number.isNaN(feeDrops)) totalFeeDrops += feeDrops; }
      const n = normalizeTransaction(entry, ledger.ledger_index, ledger.close_time ? rippleTimeToDate(ledger.close_time) : null);
      if (n) normalized.push(n);
    }

    const avgFeeXRP = totalTx > 0 && totalFeeDrops > 0 ? totalFeeDrops / 1_000_000 / totalTx : 0;
    const successRate = totalTx > 0 ? (successCount / totalTx) * 100 : 100;
    return { totalTx, aggregatedTypes, avgFeeXRP, successRate, normalized };
  }

  // ---------- SEND STATE ----------
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
      avgFee: s.feeAvg,
      validators: { total: s.validators, healthy: Math.round(s.validators * 0.95), missed: 0, geoDiversity: "—" },
      txPerLedger: s.txPerLedger,
      loadFactor: s.loadFee,
      txTypes,
      latestLedger: { ledgerIndex: s.ledgerIndex, closeTime: s.ledgerTime || new Date(), totalTx: s.txPerLedger, txTypes: { ...txTypes }, avgFee: s.feeAvg, successRate: 99.9 },
      recentTransactions: s.recentTransactions || [],
      recentLedgers: s.recentLedgers || []
    };

    if (window.NaluDashboard && typeof window.NaluDashboard.applyXRPLState === "function") {
      try { window.NaluDashboard.applyXRPLState(dashboardState); } catch (e) { console.warn("Dashboard applyXRPLState error", e && e.message ? e.message : e); }
    }

    window.dispatchEvent(new CustomEvent("xrpl-ledger", { detail: { ...window.XRPL.state, txTypes, latestLedger: dashboardState.latestLedger } }));
  }

  // ---------- CONNECTION LISTENERS ----------
  function setupConnectionListeners() {
    const client = window.XRPL.client;
    if (!client) return;
    try { if (typeof client.removeAllListeners === "function") client.removeAllListeners(); } catch (_) {}

    client.on("ledgerClosed", function (ledger) {
      try {
        const idx = Number(ledger.ledger_index);
        if (!idx) return;

        // Always emit lightweight closed event immediately
        if (idx > window.XRPL.lastLedgerIndex) {
          window.XRPL.lastLedgerIndex = idx;
          window.XRPL.lastLedgerTime = Date.now();
          try { window.XRPL.state.ledgerIndex = idx; window.XRPL.state.ledgerTime = new Date(); updateHistory("ledgerHistory", idx); } catch (_) {}
          window.dispatchEvent(new CustomEvent("xrpl-ledger-closed", { detail: { ledgerIndex: idx, timestamp: window.XRPL.lastLedgerTime, server: window.XRPL.server?.name || null, network: window.XRPL.network } }));
        } else {
          window.XRPL.lastLedgerTime = Date.now();
          return;
        }

        if (window.XRPL.processingPaused || getXRPLConsumerCount() === 0) {
          console.log("ledgerClosed: processing paused or no consumers, skipping heavy fetch:", idx);
          return;
        }

        // fetch & process ledger (serialized by withLedgerFetchLock)
        fetchAndProcessLedger(idx, null).catch(e => console.warn("ledgerClosed fetch failed", e && e.message ? e.message : e));
      } catch (e) {
        console.warn("Ledger closed handler error:", e && e.message ? e.message : e);
      }
    });

    client.on("error", function (error) { console.warn("🔌 WebSocket error:", error && error.message ? error.message : error); });
    client.on("disconnected", function (code) { console.warn("🔌 Disconnected (code " + code + ")"); handleDisconnection(); });
    if (client.on) client.on("close", hadError => { console.warn("WS close event", hadError); handleDisconnection(); });
  }

  // ---------- DISCONNECTION ----------
  function handleDisconnection() {
    console.warn("🔌 Handling disconnection...");
    window.XRPL.connected = false;
    window.XRPL.connecting = false;
    if (window.XRPL.ledgerPollInterval) { clearInterval(window.XRPL.ledgerPollInterval); window.XRPL.ledgerPollInterval = null; }
    updateConnectionStatus(false, "Disconnected");
    dispatchConnectionEvent();

    window.XRPL.reconnectAttempts += 1;
    const base = Math.min(3000 * window.XRPL.reconnectAttempts, 10000);
    const jitter = Math.floor(Math.random() * 1000);
    const delay = Math.min(base + jitter, 30000);

    console.log("🔄 Reconnecting in", delay, "ms (attempt", window.XRPL.reconnectAttempts, ")");
    if (window.XRPL.reconnectTimeout) clearTimeout(window.XRPL.reconnectTimeout);
    window.XRPL.reconnectTimeout = setTimeout(() => { if (!window.XRPL.connected) connectXRPL(); }, delay);
  }

  function handleConnectionFailure() {
    console.warn("❌ All servers failed, retrying...");
    updateConnectionStatus(false, "Retrying...");
    setMode("connecting", "All servers failed, retrying");
    const delay = Math.min(5000 * (window.XRPL.reconnectAttempts + 1), 30000);
    if (window.XRPL.reconnectTimeout) clearTimeout(window.XRPL.reconnectTimeout);
    window.XRPL.reconnectTimeout = setTimeout(() => { window.XRPL.reconnectAttempts += 1; connectXRPL(); }, delay);
    dispatchConnectionEvent();
  }

  async function cleanupConnection() {
    if (window.XRPL.ledgerPollInterval) { clearInterval(window.XRPL.ledgerPollInterval); window.XRPL.ledgerPollInterval = null; }
    if (window.XRPL.reconnectTimeout) { clearTimeout(window.XRPL.reconnectTimeout); window.XRPL.reconnectTimeout = null; }
    if (window.XRPL.client) {
      try { if (typeof window.XRPL.client.removeAllListeners === "function") window.XRPL.client.removeAllListeners(); await window.XRPL.client.disconnect(); } catch (e) {}
      window.XRPL.client = null;
    }
    window.XRPL.connected = false;
    window.XRPL.connecting = false;
  }

  // ---------- UI STATUS ----------
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

  async function reconnectXRPL() {
    console.log("🔄 Manual reconnect");
    safeNotify("Reconnecting to XRPL...", "info");
    window.XRPL.reconnectAttempts = 0;
    return connectXRPL();
  }

  function getXRPLState() {
    return { ...window.XRPL.state, connected: window.XRPL.connected, server: window.XRPL.server?.name || "Unknown", serverUrl: window.XRPL.server?.url || null, lastUpdate: window.XRPL.lastLedgerTime, mode: window.XRPL.mode, modeReason: window.XRPL.modeReason, network: window.XRPL.network };
  }

  function isXRPLConnected() {
    return window.XRPL.connected && Date.now() - window.XRPL.lastLedgerTime < 60000;
  }

  // ---------- SHARED REQUEST WRAPPER (requestXrpl) ----------
  function waitForXRPLConnection(timeoutMs = 12000) {
    return new Promise((resolve) => {
      try {
        if (window.XRPL.connected) return resolve(true);
        const onConn = (ev) => {
          const d = ev && ev.detail;
          if (d && d.connected) {
            window.removeEventListener("xrpl-connection", onConn);
            clearTimeout(t);
            resolve(true);
          }
        };
        window.addEventListener("xrpl-connection", onConn);
        const t = setTimeout(() => { window.removeEventListener("xrpl-connection", onConn); resolve(false); }, timeoutMs);
      } catch (_) { resolve(false); }
    });
  }

  if (typeof window.requestXrpl === "function" && !window.__nalu_external_requestXrpl) {
    window.__nalu_external_requestXrpl = window.requestXrpl;
  }

  // requestXrpl will:
  // - prefer shared WS client when connected
  // - if NotConnectedError occurs it will request a reconnect (rate-limited) and wait briefly
  // - fall back to HTTP RPC if allowed
  window.requestXrpl = async function requestXrpl(payload, opts) {
    const options = opts || {};
    const timeoutMs = Number(options.timeoutMs || 20000);
    const allowHttpFallback = options.allowHttpFallback !== false;

    // If there's an external implementation keep compatibility
    if (window.__nalu_external_requestXrpl && typeof window.__nalu_external_requestXrpl === "function") {
      try { const r = await window.__nalu_external_requestXrpl(payload, options); return r?.result || r; } catch (e) { /* fall through */ }
    }

    // Try WS client first with guarded behavior
    let lastErr = null;

    if (window.XRPL.client && typeof window.XRPL.client.request === "function") {
      const MAX_ATTEMPTS = 2;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        try {
          if (!window.XRPL.connected) {
            // Ask shared manager to reconnect (rate-limited) then wait a bit
            attemptSharedReconnect("requestXrpl pre-check");
            await waitForXRPLConnection(Math.min(5000, timeoutMs));
          }
          // Special-case ledger requests: serialize heavy calls to avoid storming
          const cmd = (payload && (payload.command || payload.method || "")).toString().toLowerCase();
          if (cmd === "ledger" || cmd === "ledger_data") {
            return await withLedgerFetchLock(async () => {
              const reqPromise = window.XRPL.client.request(payload);
              const timed = Promise.race([reqPromise, new Promise((_, rej) => setTimeout(() => rej(new Error("Timeout")), timeoutMs))]);
              const res = await timed;
              return res?.result || res;
            });
          } else {
            const reqPromise = window.XRPL.client.request(payload);
            const timed = Promise.race([reqPromise, new Promise((_, rej) => setTimeout(() => rej(new Error("Timeout")), timeoutMs))]);
            const res = await timed;
            return res?.result || res;
          }
        } catch (err) {
          lastErr = err;
          const m = String(err && (err.message || "")).toLowerCase();
          const isNotConnected = m.includes("notconnected") || m.includes("not connected") || m.includes("websocket was closed") || m.includes("socket hang up");
          if (isNotConnected) {
            attemptSharedReconnect("requestXrpl NotConnectedError");
            // wait a moment for reconnect then retry once
            await new Promise((r) => setTimeout(r, 500 + attempt * 300));
            continue;
          }
          if (m.includes("timeout") && attempt < MAX_ATTEMPTS - 1) {
            await new Promise((r) => setTimeout(r, 300 + attempt * 200));
            continue;
          }
          break;
        }
      }
    }

    // If WS failed or not present, attempt HTTP RPC fallback
    if (allowHttpFallback) {
      try {
        const method = payload.command || payload.method || "rpc";
        const params = { ...payload };
        const out = await rpcCall(method, params, { timeoutMs, retries: 1 });
        if (out) return out;
      } catch (e) {
        lastErr = e;
      }
    }

    throw lastErr || new Error("XRPL client unavailable");
  };

  // ---------- TX NORMALIZATION helpers ----------
  function extractTxAndMeta(entry) {
    if (!entry || typeof entry !== "object") return { tx: null, meta: null };
    if (entry.tx_json && typeof entry.tx_json === "object") return { tx: entry.tx_json, meta: entry.meta || entry.metaData || null };
    if (entry.TransactionType) return { tx: entry, meta: entry.meta || entry.metaData || null };
    if (entry.tx && typeof entry.tx === "object" && entry.tx.TransactionType) return { tx: entry.tx, meta: entry.meta || entry.metaData || null };
    if (entry.transaction && typeof entry.transaction === "object" && entry.transaction.TransactionType) return { tx: entry.transaction, meta: entry.meta || entry.metaData || null };
    return { tx: null, meta: null };
  }

  function normalizeTransaction(entry, ledgerIndex, closeTime) {
    const { tx, meta } = extractTxAndMeta(entry);
    if (!tx || !tx.TransactionType) return null;
    const hash = tx.hash || entry.hash || null;
    const type = tx.TransactionType;
    const account = tx.Account || tx.account || null;
    const destination = tx.Destination || tx.destination || null;
    const success = meta && typeof meta.TransactionResult === "string" ? meta.TransactionResult.startsWith("tes") : true;
    const feeDrops = tx.Fee != null ? Number(tx.Fee) : 0;
    const feeXRP = Number.isFinite(feeDrops) ? feeDrops / 1_000_000 : 0;
    const amount = tx.Amount != null ? tx.Amount : tx.amount;
    const delivered = meta && meta.delivered_amount != null ? meta.delivered_amount : amount != null ? amount : null;
    const amountXRP = (function(a){ if (a==null) return 0; if (typeof a==='string') { const d=Number(a); return Number.isFinite(d)?d/1_000_000:0 } if (typeof a==='object'&&a.value!=null) { const v=Number(a.value); return Number.isFinite(v)?v:0} return 0 })(delivered);
    const sourceTag = tx.SourceTag != null ? tx.SourceTag : tx.Source_Tag;
    const destinationTag = tx.DestinationTag != null ? tx.DestinationTag : tx.Destination_Tag;
    return { hash: hash||undefined, ledgerIndex: Number(ledgerIndex)||null, closeTime: closeTime instanceof Date?closeTime:null, type, account, destination, amount: delivered, amountXRP, feeDrops, feeXRP, success, result: meta && typeof meta.TransactionResult === "string" ? meta.TransactionResult : null, sequence: tx.Sequence != null ? tx.Sequence : null, sourceTag: sourceTag != null ? sourceTag : null, destinationTag: destinationTag != null ? destinationTag : null, flags: tx.Flags != null ? tx.Flags : null };
  }

  // ---------- AUTO-REGISTER COMMON CONSUMERS ----------
  function autoRegisterCommonConsumers() {
    try {
      if (window.NaluDashboard && typeof window.registerXRPLConsumer === "function") window.registerXRPLConsumer("dashboard");
      if ((window.UnifiedInspector || window.initInspector || document.getElementById("inspector")) && typeof window.registerXRPLConsumer === "function") window.registerXRPLConsumer("account-inspector");
    } catch (e) { console.warn("autoRegisterCommonConsumers failed", e && e.message ? e.message : e); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(autoRegisterCommonConsumers, 300));
  else setTimeout(autoRegisterCommonConsumers, 300);

  // ---------- INIT ----------
  document.addEventListener("DOMContentLoaded", function () {
    console.log("🌊 Initializing XRPL connection on:", window.XRPL.network);
    if (typeof xrpl === "undefined") {
      console.error("❌ xrpl.js library not loaded!");
      updateConnectionStatus(false, "Library not loaded");
      return;
    }
    setTimeout(() => connectXRPL(), 500);
  });

  // ---------- KEEP ALIVE ----------
  setInterval(function () {
    if (!window.XRPL.connected && !window.XRPL.connecting) {
      console.log("💓 Keep-alive: Reconnecting...");
      connectXRPL();
    }
  }, 30000);

  // ---------- EXPORTS ----------
  window.connectXRPL = connectXRPL;
  window.reconnectXRPL = reconnectXRPL;
  window.getXRPLState = getXRPLState;
  window.isXRPLConnected = isXRPLConnected;
  window.setXRPLNetwork = function (networkId) {
    if (!XRPL_SERVER_PROFILES[networkId]) { console.warn("Unknown network:", networkId); return; }
    if (window.XRPL.network === networkId) return;
    window.XRPL.network = networkId;
    window.XRPL.reconnectAttempts = 0;
    setMode("connecting", "Network switched");
    cleanupConnection().then(() => connectXRPL());
  };

  console.log("🌊 XRPL Connection module loaded (stability patch)");
})();
