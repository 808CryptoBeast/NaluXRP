/* =========================================
   NaluXrp 🌊 — XRPL Connection (ORDERED STREAM RESTORE)
   Goals:
   ✅ Preserve ledger stream order (strict increasing)
   ✅ Stop "too much load" + ledgerNotFound spam
   ✅ No concurrent ledger fetch storms
   ✅ Derive tx-type mix from validated transaction stream (ledger-first, low-load)
   ✅ Hardened failover + backoff reconnect
   ✅ Keep same public API/events your UI expects:
      - window.XRPL
      - window.setXRPLNetwork(networkId)
      - window.requestXrpl(payload, opts)
      - window.XRPL.connected
      - window.dispatchEvent('xrpl-connection', detail)
      - window.dispatchEvent('xrpl-ledger', detail)
   ========================================= */

(function () {
  "use strict";

  // ---------------------------
  // Network endpoint sets
  // ---------------------------
  const NETWORKS = {
    "xrpl-mainnet": {
      label: "XRPL Mainnet",
      endpoints: [
        "wss://xrplcluster.com/",
        "wss://s1.ripple.com/",
        "wss://s2.ripple.com/",
      ],
    },
    "xrpl-testnet": {
      label: "XRPL Testnet",
      endpoints: [
        "wss://s.altnet.rippletest.net:51233/",
      ],
    },
    // Keep Xahau here, but you should confirm your preferred endpoint(s)
    "xahau-mainnet": {
      label: "Xahau Mainnet",
      endpoints: [
        // If you have a working Xahau WS endpoint, place it first.
        // "wss://xahau.network/",
      ],
    },
  };

  const DEFAULT_NETWORK = "xrpl-mainnet";

  // ---------------------------
  // Tuning
  // ---------------------------
  const KEEPALIVE_MS = 20000;
  const SERVERINFO_MS = 15000;

  const RECONNECT_BASE_MS = 1200;
  const RECONNECT_MAX_MS = 15000;

  // We don’t fetch full ledgers each close (that causes load errors).
  // If we ever need a fallback fetch, we rate limit it hard.
  const FALLBACK_LEDGER_FETCH_MIN_GAP_MS = 2500;

  // How long we keep per-ledger aggregates (by ledgerIndex)
  const AGG_RETENTION = 120; // ledgers

  // ---------------------------
  // Internal state
  // ---------------------------
  const State = {
    networkId: DEFAULT_NETWORK,
    endpoint: null,

    client: null,
    connected: false,
    connecting: false,

    reconnectAttempt: 0,
    reconnectTimer: null,

    keepAliveTimer: null,
    serverInfoTimer: null,

    lastServerInfo: null,
    lastServerInfoAt: 0,

    // Ledger sequencing
    lastEmittedLedger: null, // number
    closedQueue: [],         // ledger indexes (numbers), pending emission in order
    closedQueueSet: new Set(),

    // Per-ledger aggregation from validated transaction stream
    // ledgerIndex -> { total, success, feeDropsTotal, types: {TxType:count}, closedAtMs }
    agg: new Map(),

    // Recent ledger close times (ms) for TPS estimate
    lastClosedAtMs: 0,
    avgLedgerIntervalSec: 3.8, // rolling estimate

    // Fallback fetch throttling
    lastFallbackFetchAt: 0,
  };

  // ---------------------------
  // Helpers
  // ---------------------------
  const log = (...a) => console.log("%c🌊", "color:#00d4ff;font-weight:700", ...a);
  const warn = (...a) => console.warn("%c⚠️", "color:#ffb86c;font-weight:700", ...a);
  const err = (...a) => console.error("%c❌", "color:#ff5555;font-weight:700", ...a);

  function now() { return Date.now(); }

  function safeNumber(x) {
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  }

  function dropsToXrp(drops) {
    const n = safeNumber(drops);
    if (n == null) return 0;
    return n / 1_000_000;
  }

  function normalizeTxType(tx) {
    // XRPL tx object has TransactionType
    const t = tx && (tx.TransactionType || tx.transaction?.TransactionType);
    if (!t) return "Other";

    // Collapse into the buckets your dashboard expects
    if (t === "Payment") return "Payment";
    if (t === "TrustSet") return "TrustSet";

    // Offer families
    if (t === "OfferCreate" || t === "OfferCancel") return "Offer";

    // NFT families
    if (t === "NFTokenMint" || t === "NFTokenBurn" || t === "NFTokenCreateOffer" || t === "NFTokenCancelOffer") return "NFT";

    return "Other";
  }

  function dominantBucket(bucketCounts) {
    const keys = ["Payment", "Offer", "NFT", "TrustSet", "Other"];
    let best = "Other";
    let bestV = -1;
    for (const k of keys) {
      const v = safeNumber(bucketCounts[k]) || 0;
      if (v > bestV) { bestV = v; best = k; }
    }
    return best;
  }

  function computeBackoffMs(attempt) {
    const jitter = 0.75 + Math.random() * 0.6;
    const ms = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * Math.pow(1.6, attempt)) * jitter;
    return Math.floor(ms);
  }

  function emitConnection(detail) {
    window.dispatchEvent(new CustomEvent("xrpl-connection", { detail }));
  }

  function emitLedger(detail) {
    window.dispatchEvent(new CustomEvent("xrpl-ledger", { detail }));
  }

  function updateGlobalXRPL() {
    window.XRPL = window.XRPL || {};
    window.XRPL.connected = State.connected;
    window.XRPL.networkId = State.networkId;
    window.XRPL.endpoint = State.endpoint;
    window.XRPL.mode = State.connected ? "live" : (State.connecting ? "connecting" : "disconnected");
  }

  // ---------------------------
  // Aggregation
  // ---------------------------
  function ensureAgg(ledgerIndex) {
    if (!State.agg.has(ledgerIndex)) {
      State.agg.set(ledgerIndex, {
        total: 0,
        success: 0,
        feeDropsTotal: 0,
        // bucketed counts your dashboard uses
        buckets: { Payment: 0, Offer: 0, NFT: 0, TrustSet: 0, Other: 0 },
        // raw type counts (optional, kept small)
        rawTypes: Object.create(null),
        closedAtMs: 0,
      });
    }
    return State.agg.get(ledgerIndex);
  }

  function pruneAgg() {
    // Keep only last AGG_RETENTION ledgers by index
    if (State.agg.size <= AGG_RETENTION) return;
    const keys = Array.from(State.agg.keys()).sort((a, b) => b - a); // newest-first
    const keep = new Set(keys.slice(0, AGG_RETENTION));
    for (const k of State.agg.keys()) {
      if (!keep.has(k)) State.agg.delete(k);
    }
  }

  // ---------------------------
  // Queue emission in strict order
  // ---------------------------
  function queueClosedLedger(li, closedAtMs) {
    if (!Number.isFinite(li)) return;
    if (State.closedQueueSet.has(li)) return;
    State.closedQueueSet.add(li);
    State.closedQueue.push({ li, t: closedAtMs || now() });
    // Keep queue sorted by ledger index
    State.closedQueue.sort((a, b) => a.li - b.li);
  }

  function canEmitNext() {
    if (State.closedQueue.length === 0) return false;
    const next = State.closedQueue[0].li;

    // If first emission, emit the smallest we have (start point)
    if (State.lastEmittedLedger == null) return true;

    // Normal strict sequence: must be next = last + 1
    if (next === State.lastEmittedLedger + 1) return true;

    // If there is a gap (missed some ledger events), don’t stall forever:
    // after a short grace window, emit anyway but keep the gap visible in UI.
    const oldestAgeMs = now() - State.closedQueue[0].t;
    if (oldestAgeMs > 2500) return true;

    return false;
  }

  function drainClosedQueue() {
    while (canEmitNext()) {
      const item = State.closedQueue.shift();
      if (!item) break;
      State.closedQueueSet.delete(item.li);

      const li = item.li;
      State.lastEmittedLedger = li;

      const agg = ensureAgg(li);

      // Build a ledger summary compatible with your dashboard
      const total = agg.total || 0;
      const successRate = total ? (agg.success / total) * 100 : 100.0;
      const avgFeeXrp = total ? dropsToXrp(agg.feeDropsTotal / total) : 0;

      const dom = dominantBucket(agg.buckets);

      const closeTime = new Date(item.t);

      // TPS: estimate from rolling ledger interval
      const interval = Math.max(0.5, State.avgLedgerIntervalSec || 3.8);
      const tps = total / interval;

      // Load factor / validators from lastServerInfo (if available)
      const si = State.lastServerInfo || {};
      const loadFactor =
        safeNumber(si?.info?.load_factor) ??
        safeNumber(si?.info?.load_factor_server) ??
        safeNumber(si?.info?.load_factor_cluster) ??
        null;

      const validatorsTotal =
        safeNumber(si?.info?.validation_quorum) ??
        safeNumber(si?.info?.validated_ledger?.validation_quorum) ??
        null;

      const detail = {
        // Top-level legacy fields your dashboard checks
        ledgerIndex: li,
        ledgerTime: closeTime,
        txPerLedger: total,
        txTypes: { ...agg.buckets }, // already bucketed into Payment/Offer/NFT/TrustSet/Other
        avgFee: avgFeeXrp,

        // Some optional UX fields used in your dashboard.js
        tps: tps,
        tpsTrend: "Live",
        ledgerAge: "0s",
        validators: validatorsTotal != null ? { total: validatorsTotal, healthy: validatorsTotal } : null,
        loadFactor: loadFactor != null ? loadFactor : 1.0,

        // The "latestLedger" object your dashboard prefers (see your dashboard listener)  :contentReference[oaicite:1]{index=1}
        latestLedger: {
          ledgerIndex: li,
          closeTime,
          totalTx: total,
          txTypes: { ...agg.buckets },
          avgFee: avgFeeXrp,
          successRate,
          dominantType: dom,
        },
      };

      emitLedger(detail);
    }
  }

  // ---------------------------
  // XRPL client lifecycle
  // ---------------------------
  async function disconnect(reason) {
    if (State.reconnectTimer) {
      clearTimeout(State.reconnectTimer);
      State.reconnectTimer = null;
    }
    if (State.keepAliveTimer) {
      clearInterval(State.keepAliveTimer);
      State.keepAliveTimer = null;
    }
    if (State.serverInfoTimer) {
      clearInterval(State.serverInfoTimer);
      State.serverInfoTimer = null;
    }

    const c = State.client;
    State.client = null;
    State.connected = false;
    State.connecting = false;
    updateGlobalXRPL();

    emitConnection({
      connected: false,
      server: State.endpoint || "unknown",
      modeReason: reason || "disconnected",
    });

    try {
      if (c) {
        c.removeAllListeners?.();
        if (c.isConnected?.()) await c.disconnect();
      }
    } catch (e) {
      // ignore
    }
  }

  function scheduleReconnect(reason) {
    if (State.reconnectTimer) return;

    State.reconnectAttempt += 1;
    const waitMs = computeBackoffMs(State.reconnectAttempt);
    warn("Reconnecting in", waitMs, "ms", reason || "");

    emitConnection({
      connected: false,
      server: State.endpoint || "unknown",
      modeReason: reason || "reconnecting",
    });

    State.reconnectTimer = setTimeout(() => {
      State.reconnectTimer = null;
      connect().catch((e) => err("Reconnect failed:", e));
    }, waitMs);
  }

  function attachClientHandlers(client) {
    // Ledger close events: drive strict ordering
    client.on("ledgerClosed", (evt) => {
      try {
        const li = safeNumber(evt?.ledger_index ?? evt?.ledgerIndex);
        if (!Number.isFinite(li)) return;

        const t = now();
        // rolling interval estimate
        if (State.lastClosedAtMs) {
          const dtSec = Math.max(0.5, (t - State.lastClosedAtMs) / 1000);
          // gentle EMA
          State.avgLedgerIntervalSec = 0.85 * State.avgLedgerIntervalSec + 0.15 * dtSec;
        }
        State.lastClosedAtMs = t;

        // mark closed time in agg
        const agg = ensureAgg(li);
        agg.closedAtMs = t;

        queueClosedLedger(li, t);
        drainClosedQueue();
        pruneAgg();
      } catch (e) {
        err("ledgerClosed handler error:", e);
      }
    });

    // Validated tx stream: build per-ledger aggregates without fetching entire ledgers
    client.on("transaction", (evt) => {
      try {
        // evt.transaction + evt.validated (xrpl.js)
        const validated = evt?.validated === true || evt?.transaction?.validated === true;
        if (!validated) return;

        const li = safeNumber(evt?.ledger_index ?? evt?.ledgerIndex ?? evt?.transaction?.ledger_index);
        if (!Number.isFinite(li)) return;

        const tx = evt?.transaction || evt;
        const agg = ensureAgg(li);

        agg.total += 1;

        // success
        const result =
          evt?.meta?.TransactionResult ||
          evt?.transaction?.meta?.TransactionResult ||
          evt?.engine_result;

        if (result === "tesSUCCESS") agg.success += 1;

        // fee
        const feeDrops =
          safeNumber(tx?.Fee) ??
          safeNumber(evt?.transaction?.Fee) ??
          0;

        agg.feeDropsTotal += feeDrops;

        // bucket + raw type
        const raw = tx?.TransactionType || "Other";
        agg.rawTypes[raw] = (agg.rawTypes[raw] || 0) + 1;

        const bucket = normalizeTxType({ TransactionType: raw });
        agg.buckets[bucket] = (agg.buckets[bucket] || 0) + 1;
      } catch (e) {
        // don’t spam console
      }
    });

    client.on("disconnected", (code) => {
      warn("WebSocket disconnected (code)", code);
      State.connected = false;
      State.connecting = false;
      updateGlobalXRPL();
      scheduleReconnect("ws_disconnected");
    });

    client.on("error", (e) => {
      warn("Client error:", e?.message || e);
      // If we’re connected, let keepalive decide. If not connected, reconnect.
      if (!State.connected) scheduleReconnect("client_error");
    });
  }

  async function connect() {
    if (State.connecting || State.connected) return;

    const net = NETWORKS[State.networkId] || NETWORKS[DEFAULT_NETWORK];
    const endpoints = (net.endpoints || []).filter(Boolean);

    if (!endpoints.length) {
      err("No endpoints configured for network:", State.networkId);
      return;
    }

    State.connecting = true;
    updateGlobalXRPL();

    emitConnection({
      connected: false,
      server: net.label,
      modeReason: "connecting",
    });

    // Try endpoints in order
    for (const ep of endpoints) {
      try {
        log("Connecting to", ep);
        State.endpoint = ep;

        const client = new window.xrpl.Client(ep, {
          connectionTimeout: 9000,
        });

        // Important: set client before connecting so handlers can reference it
        State.client = client;
        attachClientHandlers(client);

        await client.connect();

        // Subscribe: ledger + validated transactions
        await client.request({
          command: "subscribe",
          streams: ["ledger", "transactions"],
        });

        State.connected = true;
        State.connecting = false;
        State.reconnectAttempt = 0;
        updateGlobalXRPL();

        emitConnection({
          connected: true,
          server: ep,
          modeReason: "connected",
        });

        log("Connected ✅", ep);

        startKeepAlive();
        startServerInfoPoll();

        // Prime server_info once
        fetchServerInfo().catch(() => {});

        return; // stop after first success
      } catch (e) {
        warn("Endpoint failed:", ep, e?.message || e);
        // clean up failed client
        try { await disconnect("endpoint_failed"); } catch (_) {}
        continue;
      }
    }

    // All failed
    State.connecting = false;
    State.connected = false;
    updateGlobalXRPL();
    scheduleReconnect("all_endpoints_failed");
  }

  // ---------------------------
  // Requests + keepalive
  // ---------------------------
  async function requestXrpl(payload, opts) {
    const timeoutMs = (opts && opts.timeoutMs) || 10000;

    const c = State.client;
    if (!c || !State.connected || !c.isConnected?.()) {
      throw new Error("XRPL not connected");
    }

    // xrpl.js will throw if socket is closing; guard here
    try {
      const p = c.request(payload);
      const t = new Promise((_, rej) => setTimeout(() => rej(new Error("request_timeout")), timeoutMs));
      return await Promise.race([p, t]);
    } catch (e) {
      // If request fails due to WS closing, reconnect
      const msg = (e && e.message) ? e.message : String(e);
      if (/CLOSING|CLOSED|websocket/i.test(msg)) {
        scheduleReconnect("request_failed_ws");
      }
      throw e;
    }
  }

  async function fetchServerInfo() {
    // throttle
    if (!State.connected) return;
    const t = now();
    if (t - State.lastServerInfoAt < 2500) return;

    State.lastServerInfoAt = t;

    try {
      const res = await requestXrpl({ command: "server_info" }, { timeoutMs: 9000 });
      State.lastServerInfo = res;
      return res;
    } catch (e) {
      // don’t spam; keepalive will handle
    }
  }

  function startKeepAlive() {
    if (State.keepAliveTimer) clearInterval(State.keepAliveTimer);
    State.keepAliveTimer = setInterval(async () => {
      if (!State.connected) return;
      try {
        await requestXrpl({ command: "ping" }, { timeoutMs: 7000 });
      } catch (e) {
        warn("Keep-alive failed, reconnecting…");
        scheduleReconnect("keepalive_failed");
      }
    }, KEEPALIVE_MS);
  }

  function startServerInfoPoll() {
    if (State.serverInfoTimer) clearInterval(State.serverInfoTimer);
    State.serverInfoTimer = setInterval(() => {
      fetchServerInfo().catch(() => {});
    }, SERVERINFO_MS);
  }

  // ---------------------------
  // Public API
  // ---------------------------
  async function setXRPLNetwork(networkId) {
    if (!NETWORKS[networkId]) {
      warn("Unknown network:", networkId, "— keeping", State.networkId);
      return;
    }

    if (State.networkId === networkId) return;

    log("Switching network:", State.networkId, "→", networkId);

    State.networkId = networkId;

    // Reset sequencing + agg so UI doesn’t mix networks
    State.lastEmittedLedger = null;
    State.closedQueue = [];
    State.closedQueueSet = new Set();
    State.agg = new Map();

    await disconnect("Network switched");
    await connect();
  }

  // expose globals
  window.XRPL = window.XRPL || {};
  window.XRPL.connected = false;

  window.setXRPLNetwork = setXRPLNetwork;
  window.requestXrpl = requestXrpl;

  // Boot
  updateGlobalXRPL();
  log("XRPL Connection module loaded (ordered stream restore)");
  connect().catch((e) => err("Initial connect failed:", e));
})();
