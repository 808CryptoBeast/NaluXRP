/* =========================================================
   xrpl-connection.js — NaluXrp 🌊 (ORDERED LEDGER STREAM + LOW LOAD)
   ---------------------------------------------------------
   Goals:
   - Keep ledger stream flowing in correct ledger order
   - Provide per-ledger tx-type breakdown (Payment / Offer / NFT / TrustSet / Other)
   - Avoid hammering public servers with full-ledger fetches (prevents "too much load" + ledgerNotFound)
   - Hardened failover + safe requestXrpl wrapper for all modules

   Events:
   - window dispatches: "xrpl-ledger" with a state snapshot in e.detail
     Dashboard listens to this.
   ========================================================= */

(() => {
  "use strict";

  const xrpl = window.xrpl;
  if (!xrpl || !xrpl.Client) {
    console.error("❌ xrpl library not found. Ensure xrpl-latest-min.js is loaded before xrpl-connection.js");
    return;
  }

  // Legacy/global container used across NaluXrp modules
  // We preserve window.XRPL shape to avoid breaking other files.
  const LEGACY = (window.XRPL = window.XRPL || {});

  /* =========================
     CONFIG
  ========================= */

  const NETWORKS = {
    "xrpl-mainnet": {
      label: "XRPL Mainnet",
      endpoints: [
        // Keep fastest / most stable first
        "wss://s1.ripple.com",
        "wss://s2.ripple.com",
        // Optional community endpoints (can be flaky; keep after Ripple servers)
        "wss://xrplcluster.com"
      ],
    },
    "xrpl-testnet": {
      label: "XRPL Testnet",
      endpoints: [
        "wss://s.altnet.rippletest.net:51233"
      ],
    },
    "xrpl-devnet": {
      label: "XRPL Devnet",
      endpoints: [
        "wss://s.devnet.rippletest.net:51233"
      ],
    },
  };

  const DEFAULT_NETWORK = "xrpl-mainnet";

  // How many recent ledgers we keep aggregated in memory
  const MAX_LEDGER_WINDOW = 50;

  // Defer finalize a ledger slightly to capture late-arriving tx messages
  const LEDGER_FINALIZE_DELAY_MS = 450;

  // If ordered flush is blocked by missing ledger(s), skip the gap after this long
  const ORDER_GAP_TOLERANCE_MS = 3000;

  // Keepalive interval (uses rippled "ping" command)
  const KEEPALIVE_MS = 25000;

  // Connection timeouts / backoff
  const CONNECT_TIMEOUT_MS = 12000;
  const REQUEST_TIMEOUT_MS = 12000;
  const RECONNECT_BASE_MS = 900;
  const RECONNECT_MAX_MS = 12000;

  /* =========================
     STATE
  ========================= */

  const state = {
    network: DEFAULT_NETWORK,
    endpoint: null,

    // connection lifecycle
    connected: false,
    mode: "offline", // "connecting" | "live" | "offline"
    lastError: null,
    startedAt: Date.now(),

    // live ledger snapshot
    ledgerIndex: null,
    ledgerTime: null,

    // per-ledger summary used by dashboard's conveyor
    latestLedger: null,

    // top-metric values (dashboard uses these)
    totalTx: 0,
    successRate: 100,
    avgFee: 0,
    txTypes: { payment: 0, offer: 0, nft: 0, trust: 0, other: 0 },
    txPerLedger: 0,

    // internals
    _supportsTxStream: false,
    _client: null,
    _endpointIndex: 0,
    _reconnectTimer: null,
    _keepaliveTimer: null,

    // tx aggregation buffers
    _agg: new Map(), // ledgerIndex -> agg
    _finalizeTimers: new Map(), // ledgerIndex -> timerId
    _readySummaries: new Map(), // ledgerIndex -> summary
    _lastEmittedLedger: null,
    _blockedSince: null,
  };

  /* =========================
     HELPERS
  ========================= */

  function nowMs() { return Date.now(); }

  // Ripple Epoch starts 2000-01-01T00:00:00Z, which is 946684800 seconds after Unix epoch
  function rippleTimeToDate(rippleSeconds) {
    if (typeof rippleSeconds !== "number") return null;
    return new Date((rippleSeconds + 946684800) * 1000);
  }

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  function dropsToXrp(drops) {
    const v = typeof drops === "string" ? Number(drops) : (typeof drops === "number" ? drops : 0);
    if (!Number.isFinite(v)) return 0;
    return v / 1_000_000;
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function withTimeout(promise, ms, label = "timeout") {
    let t;
    const timeout = new Promise((_, reject) => {
      t = setTimeout(() => reject(new Error(label)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
  }

  function safeClone(obj) {
    // structuredClone is ideal but not universal; fallback to JSON
    try {
      if (typeof structuredClone === "function") return structuredClone(obj);
    } catch (_) {}
    return JSON.parse(JSON.stringify(obj));
  }

  function syncLegacyXRPL() {
    try {
      LEGACY.client = state._client || null;
      LEGACY.connected = !!state.connected;
      LEGACY.connecting = state.mode === "connecting";
      LEGACY.network = state.network;
      LEGACY.server = state.endpoint ? { url: state.endpoint, name: state.endpoint.replace(/^wss:\/\//, "") } : null;
      LEGACY.mode = state.mode;
      LEGACY.modeReason = state.lastError || "";

      LEGACY.lastLedgerTime = Date.now();
      LEGACY.lastLedgerIndex = state.ledgerIndex || LEGACY.lastLedgerIndex || 0;

      // Keep a compatible 'state' bag for consumers that read window.XRPL.state.*
      LEGACY.state = LEGACY.state || {};
      LEGACY.state.ledgerIndex = state.ledgerIndex || 0;
      LEGACY.state.ledgerTime = state.ledgerTime ? new Date(state.ledgerTime) : null;
      LEGACY.state.txPerLedger = state.txPerLedger || 0;
      LEGACY.state.feeAvg = state.avgFee || 0;
      LEGACY.state.loadFee = LEGACY.state.loadFee || 1.0;
      LEGACY.state.validators = LEGACY.state.validators || 0;

      const tt = state.txTypes || { payment: 0, offer: 0, nft: 0, trust: 0, other: 0 };
      LEGACY.state.transactionTypes = {
        Payment: tt.payment || 0,
        Offer: tt.offer || 0,
        NFT: tt.nft || 0,
        TrustSet: tt.trust || 0,
        Other: tt.other || 0,
      };

      LEGACY.state.recentLedgers = LEGACY.state.recentLedgers || [];
      LEGACY.state.recentTransactions = LEGACY.state.recentTransactions || [];
    } catch (_) {
      // never hard-fail on legacy sync
    }
  }

  function emitState() {
    syncLegacyXRPL();

    const snapshot = safeClone({
      network: state.network,
      endpoint: state.endpoint,
      connected: state.connected,
      mode: state.mode,
      lastError: state.lastError,
      startedAt: state.startedAt,

      ledgerIndex: state.ledgerIndex,
      ledgerTime: state.ledgerTime,

      // metrics
      totalTx: state.totalTx,
      successRate: state.successRate,
      avgFee: state.avgFee,
      txTypes: state.txTypes,
      txPerLedger: state.txPerLedger,

      // stream
      latestLedger: state.latestLedger,
    });

    window.dispatchEvent(new CustomEvent("xrpl-ledger", { detail: snapshot }));
  }

  function updateNavStatusBadge() {
    const dot = document.getElementById("statusDot");
    const txt = document.getElementById("connectionStatus");
    if (!dot || !txt) return;

    if (state.connected) {
      dot.classList.add("active");
      txt.textContent = "Connected";
    } else if (state.mode === "connecting") {
      dot.classList.remove("active");
      txt.textContent = "Connecting...";
    } else {
      dot.classList.remove("active");
      txt.textContent = "Disconnected";
    }
  }

  /* =========================
     TX TYPE NORMALIZATION
  ========================= */

  function normalizeTxType(txType) {
    const t = String(txType || "").toLowerCase();

    if (t === "payment") return "payment";
    if (t === "trustset") return "trust";

    // Offers
    if (t === "offercreate" || t === "offercancel") return "offer";

    // NFT family
    if (
      t === "nftokenmint" ||
      t === "nftokenburn" ||
      t === "nftokencreateoffer" ||
      t === "nftokencanceloffer" ||
      t === "nftokenacceptoffer"
    ) return "nft";

    return "other";
  }

  function emptyAgg(ledgerIndex) {
    return {
      ledgerIndex,
      closeTime: null,      // Date
      totalTx: 0,
      successCount: 0,
      feeSumXrp: 0,
      txTypes: { payment: 0, offer: 0, nft: 0, trust: 0, other: 0 },
      _seenTx: 0,
    };
  }

  function getAgg(ledgerIndex) {
    if (!state._agg.has(ledgerIndex)) {
      state._agg.set(ledgerIndex, emptyAgg(ledgerIndex));
      // prune oldest
      if (state._agg.size > MAX_LEDGER_WINDOW) {
        const keys = Array.from(state._agg.keys()).sort((a, b) => a - b);
        while (state._agg.size > MAX_LEDGER_WINDOW) {
          const k = keys.shift();
          state._agg.delete(k);
          const tid = state._finalizeTimers.get(k);
          if (tid) {
            clearTimeout(tid);
            state._finalizeTimers.delete(k);
          }
          state._readySummaries.delete(k);
        }
      }
    }
    return state._agg.get(ledgerIndex);
  }

  /* =========================
     ORDERED EMIT PIPELINE
  ========================= */

  function queueFinalizeLedger(ledgerIndex, closeTimeDate, txnCountFromLedgerStream) {
    const agg = getAgg(ledgerIndex);
    if (closeTimeDate) agg.closeTime = closeTimeDate;

    // If we have txn_count but haven't seen tx stream (or missed), keep totalTx at least that
    if (typeof txnCountFromLedgerStream === "number" && txnCountFromLedgerStream >= 0) {
      agg.totalTx = Math.max(agg.totalTx, txnCountFromLedgerStream);
    }

    // debounce finalize
    if (state._finalizeTimers.has(ledgerIndex)) return;

    const timerId = setTimeout(() => {
      state._finalizeTimers.delete(ledgerIndex);
      finalizeLedger(ledgerIndex);
    }, LEDGER_FINALIZE_DELAY_MS);

    state._finalizeTimers.set(ledgerIndex, timerId);
  }

  function finalizeLedger(ledgerIndex) {
    const agg = state._agg.get(ledgerIndex);
    if (!agg) return;

    const total = agg.totalTx || 0;
    const successRate = total > 0 ? (agg.successCount / total) * 100 : 100;
    const avgFee = total > 0 ? (agg.feeSumXrp / total) : 0;

    const summary = {
      ledgerIndex: agg.ledgerIndex,
      closeTime: agg.closeTime ? agg.closeTime.toISOString() : null,
      totalTx: total,
      successRate: clamp(successRate, 0, 100),
      avgFee,
      txTypes: agg.txTypes,
    };

    state._readySummaries.set(ledgerIndex, summary);
    flushOrderedSummaries();
  }

  function flushOrderedSummaries() {
    // Decide next ledger to emit
    const readyKeys = Array.from(state._readySummaries.keys()).sort((a, b) => a - b);
    if (!readyKeys.length) return;

    const emitOne = (ledgerIndex) => {
      const summary = state._readySummaries.get(ledgerIndex);
      if (!summary) return;

      state._readySummaries.delete(ledgerIndex);

      state.latestLedger = summary;
      state.ledgerIndex = summary.ledgerIndex;
      state.ledgerTime = summary.closeTime;

      state.totalTx = summary.totalTx;
      state.successRate = summary.successRate;
      state.avgFee = summary.avgFee;
      state.txTypes = summary.txTypes;
      state.txPerLedger = summary.totalTx;

      state._lastEmittedLedger = summary.ledgerIndex;
      state._blockedSince = null;

      emitState();
    };

    // First emit: pick smallest key
    if (state._lastEmittedLedger == null) {
      emitOne(readyKeys[0]);
      return;
    }

    // If we have the immediate next ledger, emit it (and continue)
    let expected = state._lastEmittedLedger + 1;
    while (state._readySummaries.has(expected)) {
      emitOne(expected);
      expected = state._lastEmittedLedger + 1;
    }

    // If blocked by a gap, tolerate after ORDER_GAP_TOLERANCE_MS
    const smallest = readyKeys[0];
    if (smallest > expected) {
      if (!state._blockedSince) state._blockedSince = nowMs();
      const blockedFor = nowMs() - state._blockedSince;

      if (blockedFor >= ORDER_GAP_TOLERANCE_MS) {
        // Skip the missing ledger(s) to keep conveyor moving, but preserve local order.
        emitOne(smallest);
      }
    }
  }

  /* =========================
     CONNECTION MANAGEMENT
  ========================= */

  async function connect(networkKey = state.network) {
    state.network = NETWORKS[networkKey] ? networkKey : DEFAULT_NETWORK;

    const cfg = NETWORKS[state.network];
    const endpoints = cfg.endpoints;

    clearTimers();

    // prevent parallel connects
    if (state.mode === "connecting") return;
    state.mode = "connecting";
    state.connected = false;
    state.lastError = null;
    updateNavStatusBadge();
    emitState();

    // dispose previous client
    if (state._client) {
      try { state._client.removeAllListeners(); } catch (_) {}
      try { await state._client.disconnect(); } catch (_) {}
      state._client = null;
    }

    // Try endpoints in order, starting from current index
    const startIndex = state._endpointIndex % endpoints.length;

    for (let i = 0; i < endpoints.length; i++) {
      const idx = (startIndex + i) % endpoints.length;
      const endpoint = endpoints[idx];

      state.endpoint = endpoint;
      state._endpointIndex = idx;
      state.lastError = null;
      updateNavStatusBadge();
      emitState();

      const client = new xrpl.Client(endpoint);

      try {
        await withTimeout(client.connect(), CONNECT_TIMEOUT_MS, "connect_timeout");
      } catch (err) {
        state.lastError = `Connect failed: ${err && err.message ? err.message : String(err)}`;
        try { await client.disconnect(); } catch (_) {}
        continue;
      }

      // Connected: install handlers
      state._client = client;
      state.connected = true;
      state.mode = "live";
      state.lastError = null;
      updateNavStatusBadge();

      attachClientHandlers(client);

      try {
        await subscribeStreams(client);
      } catch (err) {
        console.warn("⚠️ Subscribe failed; will continue without tx stream.", err);
      }

      startKeepalive();

      console.log("[SUCCESS] ✅ Connected to XRPL:", cfg.label, "via", endpoint);
      emitState();
      return;
    }

    // Failed all endpoints
    state.connected = false;
    state.mode = "offline";
    state.lastError = "All XRPL endpoints failed";
    updateNavStatusBadge();
    emitState();

    scheduleReconnect();
  }

  function attachClientHandlers(client) {
    // Hardened disconnect handling
    client.on("disconnected", (code) => {
      console.warn("🔌 XRPL disconnected:", code);
      handleDisconnect(`disconnected:${code}`);
    });

    // XRPL.js exposes "error" events
    client.on("error", (err) => {
      console.warn("❌ XRPL client error:", err);
      // don't immediately disconnect unless we are already offline
    });

    // Ledger closed (from "ledger" stream)
    client.on("ledgerClosed", (msg) => {
      // msg shape: { ledger_index, ledger_time, txn_count, ... }
      const ledgerIndex = Number(msg.ledger_index);
      if (!Number.isFinite(ledgerIndex)) return;

      const rippleSeconds = (typeof msg.ledger_time === "number") ? msg.ledger_time : null;
      const closeDate = rippleSeconds != null ? rippleTimeToDate(rippleSeconds) : null;

      // Update the current ledger index for UI, even before finalization
      state.ledgerIndex = ledgerIndex;
      state.ledgerTime = closeDate ? closeDate.toISOString() : null;

      // Queue a finalize for this ledger
      const txnCount = typeof msg.txn_count === "number" ? msg.txn_count : null;
      queueFinalizeLedger(ledgerIndex, closeDate, txnCount);
    });

    // Validated transaction stream
    client.on("transaction", (ev) => {
      if (!ev || ev.validated !== true) return;

      const ledgerIndex = Number(ev.ledger_index);
      if (!Number.isFinite(ledgerIndex)) return;

      state._supportsTxStream = true;

      const tx = ev.transaction || {};
      const meta = ev.meta || {};

      const agg = getAgg(ledgerIndex);

      // Total tx count: if we only see tx stream, totalTx increments from seen
      agg._seenTx += 1;
      agg.totalTx = Math.max(agg.totalTx, agg._seenTx);

      // Fee
      agg.feeSumXrp += dropsToXrp(tx.Fee);

      // Success
      const result = meta.TransactionResult;
      if (result === "tesSUCCESS") agg.successCount += 1;

      // Type
      const bucket = normalizeTxType(tx.TransactionType);
      agg.txTypes[bucket] = (agg.txTypes[bucket] || 0) + 1;
    });
  }

  async function subscribeStreams(client) {
    // Subscribe to ledger AND transactions
    await requestOnClient(client, { command: "subscribe", streams: ["ledger", "transactions"] });
  }

  function handleDisconnect(reason) {
    clearTimers();

    state.connected = false;
    state.mode = "offline";
    state.lastError = reason || "disconnected";
    updateNavStatusBadge();
    emitState();

    // Attempt reconnect with failover
    scheduleReconnect();
  }

  function clearTimers() {
    if (state._reconnectTimer) {
      clearTimeout(state._reconnectTimer);
      state._reconnectTimer = null;
    }
    if (state._keepaliveTimer) {
      clearInterval(state._keepaliveTimer);
      state._keepaliveTimer = null;
    }
  }

  function scheduleReconnect() {
    if (state._reconnectTimer) return;

    const jitter = Math.floor(Math.random() * 300);
    const attemptMs = clamp(RECONNECT_BASE_MS + jitter, 600, RECONNECT_MAX_MS);
    state._reconnectTimer = setTimeout(async () => {
      state._reconnectTimer = null;

      // Rotate to next endpoint on each reconnect attempt
      const endpoints = NETWORKS[state.network]?.endpoints || NETWORKS[DEFAULT_NETWORK].endpoints;
      state._endpointIndex = (state._endpointIndex + 1) % endpoints.length;

      try {
        await connect(state.network);
      } catch (e) {
        console.warn("Reconnect failed:", e);
      }
    }, attemptMs);
  }

  function startKeepalive() {
    if (state._keepaliveTimer) return;
    state._keepaliveTimer = setInterval(async () => {
      if (!state._client || !state.connected) return;
      try {
        await requestOnClient(state._client, { command: "ping" }, 6000);
      } catch (err) {
        console.warn("Keepalive failed; reconnecting:", err && err.message ? err.message : err);
        try { await state._client.disconnect(); } catch (_) {}
        handleDisconnect("keepalive_failed");
      }
    }, KEEPALIVE_MS);
  }

  /* =========================
     REQUEST WRAPPER
  ========================= */

  async function requestOnClient(client, cmdObj, timeoutMs = REQUEST_TIMEOUT_MS) {
    const payload = (typeof cmdObj === "string") ? { command: cmdObj } : cmdObj;
    if (!payload || !payload.command) throw new Error("Invalid XRPL request payload");

    const req = client.request(payload);
    const res = await withTimeout(req, timeoutMs, "request_timeout");
    return res && res.result ? res.result : res;
  }

  async function requestXrpl(cmdObj, opts = {}) {
    const timeoutMs = typeof opts.timeoutMs === "number" ? opts.timeoutMs : REQUEST_TIMEOUT_MS;

    if (state._client && state.connected) {
      try {
        return await requestOnClient(state._client, cmdObj, timeoutMs);
      } catch (err) {
        // If request fails, try reconnect once
        console.warn("requestXrpl failed; attempting reconnect:", err);
        try { await state._client.disconnect(); } catch (_) {}
        handleDisconnect("request_failed");
      }
    }

    // Not connected: attempt connect and retry once
    await connect(state.network);
    if (state._client && state.connected) {
      return await requestOnClient(state._client, cmdObj, timeoutMs);
    }

    throw new Error("XRPL not connected");
  }

  /* =========================
     PUBLIC API (window.*)
     - Keep both old names and new names
  ========================= */

  // Shared request wrapper used by multiple modules
  window.requestXrpl = requestXrpl;

  // Common aliases used elsewhere in NaluXrp
  window.connectXRPL = () => connect(state.network);
  window.reconnectXRPL = () => {
    const endpoints = NETWORKS[state.network]?.endpoints || NETWORKS[DEFAULT_NETWORK].endpoints;
    state._endpointIndex = (state._endpointIndex + 1) % endpoints.length;
    return connect(state.network);
  };

  window.setXRPLNetwork = (networkKey) => connect(networkKey);
  window.setXrplNetwork = window.setXRPLNetwork;

  window.getXRPLState = () => safeClone({
    network: state.network,
    endpoint: state.endpoint,
    connected: state.connected,
    mode: state.mode,
    lastError: state.lastError,
    ledgerIndex: state.ledgerIndex,
    ledgerTime: state.ledgerTime,
    totalTx: state.totalTx,
    successRate: state.successRate,
    avgFee: state.avgFee,
    txTypes: state.txTypes,
    txPerLedger: state.txPerLedger,
    latestLedger: state.latestLedger,
  });

  window.getXrplState = window.getXRPLState;

  window.isXRPLConnected = () => !!state.connected;

  // Also attach a small method set on the legacy container
  LEGACY.requestXrpl = requestXrpl;
  LEGACY.connect = window.connectXRPL;
  LEGACY.reconnect = window.reconnectXRPL;
  LEGACY.setNetwork = window.setXRPLNetwork;

  /* =========================
     BOOT
  ========================= */

  // Auto-connect on load
  (async () => {
    try {
      await connect(DEFAULT_NETWORK);

      setTimeout(() => {
        if (!state._supportsTxStream) {
          console.warn("⚠️ No validated transaction stream observed yet. If your ledger cards show 0 types, ensure streams include 'transactions'.");
        }
      }, 30000);
    } catch (e) {
      console.error("XRPL initial connect failed:", e);
    }
  })();

  console.log("🌊 XRPL Connection module loaded (ordered ledger stream + low-load tx aggregation)");
})();
