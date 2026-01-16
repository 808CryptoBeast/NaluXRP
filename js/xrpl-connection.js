/* =========================================
   FILE: js/xrpl-connection.js
   NaluXrp 🌊 – XRPL Connection (LedgerClosed-driven + Load Safe)

   FIXES:
   - No more fetching every ledger by ledger_index immediately (stops ledgerNotFound spam)
   - Uses ledgerClosed stream to update state cheaply
   - Samples ledger/tx data (delay + retry) using ledger_hash first
   - Hardened reconnect + avoids sending when WS closing/closed
   - HTTP JSON-RPC fallback available through requestXrpl()

   NOTE:
   - If you still see logs like "Fetching ledger # ... with transactions..."
     you are NOT running this file (cache/wrong path/old bundle).
   ========================================= */

(function () {
  "use strict";

  // -------------------- GLOBAL --------------------
  window.XRPL = window.XRPL || {
    client: null,
    connected: false,
    connecting: false,
    server: null,
    network: "xrpl-mainnet",

    reconnectAttempts: 0,
    serverIndex: 0,

    lastLedgerIndex: 0,
    lastLedgerHash: null,
    lastLedgerEventAt: 0,

    mode: "connecting",
    modeReason: "init",

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
    }
  };

  // -------------------- CONFIG --------------------
  const WS_CONNECT_TIMEOUT_MS = 15000;
  const WS_REQUEST_TIMEOUT_MS = 12000;

  const KEEPALIVE_INTERVAL_MS = 30000;

  // Sampling: keep dashboard rich without melting nodes
  const SAMPLE_EVERY_N_LEDGERS = 3;      // sample every 3 ledgers
  const SAMPLE_TX_PER_LEDGER = 50;       // sample tx details
  const SAMPLE_CONCURRENCY = 6;

  // Delay before sampling a just-closed ledger (reduces ledgerNotFound)
  const SAMPLE_DELAY_MS = 900;

  // Retry behavior when ledger not ready on server
  const LEDGER_RETRY_DELAYS_MS = [650, 1400, 2600];

  // Overload cooldown
  const TOO_BUSY_COOLDOWN_MS = 45000;
  let cooldownUntil = 0;

  // -------------------- SERVER LIST --------------------
  const XRPL_SERVER_PROFILES = {
    "xrpl-mainnet": [
      { url: "wss://xrplcluster.com", name: "XRPL Cluster" },
      { url: "wss://xrpl.ws", name: "XRPL.ws" },
      { url: "wss://xrpl.link", name: "XRPL Link" },
      { url: "wss://s2.ripple.com", name: "Ripple S2" },
      { url: "wss://s1.ripple.com", name: "Ripple S1" }
    ],
    "xrpl-testnet": [{ url: "wss://s.altnet.rippletest.net:51233", name: "XRPL Testnet" }]
  };

  // HTTP JSON-RPC fallback endpoints (used by requestXrpl if WS down)
  const DISABLE_HTTP_FALLBACK = !!window.NALU_DISABLE_HTTP_FALLBACK;
  const HTTP_RPC_ENDPOINTS = [
    typeof window.NALU_RPC_HTTP === "string" && window.NALU_RPC_HTTP.startsWith("http") ? window.NALU_RPC_HTTP : null,
    "https://xrplcluster.com/",
    "https://xrpl.ws/"
  ].filter(Boolean);

  // -------------------- INTERNAL --------------------
  let subscribedLedgerStream = false;

  // Only one sample at a time; always keep the latest requested sample
  let sampleInFlight = false;
  let pendingSample = null; // { ledgerIndex, ledgerHash }

  // -------------------- HELPERS --------------------
  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function setMode(mode, reason) {
    if (window.XRPL.mode === mode && window.XRPL.modeReason === reason) return;
    window.XRPL.mode = mode;
    window.XRPL.modeReason = reason || "";
    console.log(`🌊 XRPL Mode: ${mode} - ${reason || ""}`);
  }

  function updateHistory(key, value, maxLength = 50) {
    const s = window.XRPL.state;
    if (!Array.isArray(s[key])) s[key] = [];
    s[key].push(Number(value) || 0);
    if (s[key].length > maxLength) s[key].shift();
  }

  function isOverloadError(msg) {
    const m = String(msg || "").toLowerCase();
    return m.includes("placing too much load") || m.includes("toobusy") || m.includes("too busy") || m.includes("rate");
  }

  function isLedgerNotFound(msg) {
    return String(msg || "").toLowerCase().includes("ledgernotfound");
  }

  function isTransportError(msg) {
    const m = String(msg || "").toLowerCase();
    return m.includes("timeout") || m.includes("websocket") || m.includes("closed") || m.includes("disconnected");
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
          lastLedgerIndex: window.XRPL.lastLedgerIndex
        }
      })
    );
  }

  // -------------------- XRPL AMOUNT --------------------
  function parseXrpAmount(amount) {
    if (amount == null) return 0;
    if (typeof amount === "string") {
      const drops = Number(amount);
      return Number.isFinite(drops) ? drops / 1_000_000 : 0;
    }
    if (typeof amount === "object" && amount.value != null) {
      const v = Number(amount.value);
      return Number.isFinite(v) ? v : 0;
    }
    return 0;
  }

  function classify(txType) {
    if (!txType) return "Other";
    if (txType === "Payment") return "Payment";
    if (txType === "TrustSet") return "TrustSet";
    if (txType === "OfferCreate" || txType === "OfferCancel" || String(txType).startsWith("AMM")) return "Offer";
    if (String(txType).startsWith("NFToken") || String(txType).startsWith("NFT")) return "NFT";
    return "Other";
  }

  // -------------------- DASHBOARD EMIT --------------------
  function sendStateToDashboard() {
    const s = window.XRPL.state;

    window.dispatchEvent(
      new CustomEvent("xrpl-ledger", {
        detail: { ...s }
      })
    );

    // If you have a dashboard consumer:
    if (window.NaluDashboard && typeof window.NaluDashboard.applyXRPLState === "function") {
      try {
        window.NaluDashboard.applyXRPLState({
          ledgerIndex: s.ledgerIndex,
          tps: s.txnPerSec,
          avgFee: s.feeAvg,
          txPerLedger: s.txPerLedger,
          loadFactor: s.loadFee,
          txTypes: s.transactionTypes,
          recentTransactions: s.recentTransactions,
          recentLedgers: s.recentLedgers,
          closeTimes: s.closeTimes
        });
      } catch (e) {
        console.warn("Dashboard applyXRPLState error:", e?.message || e);
      }
    }
  }

  // -------------------- SERVER ROTATION --------------------
  function getServers() {
    const list = XRPL_SERVER_PROFILES[window.XRPL.network];
    return Array.isArray(list) && list.length ? list : XRPL_SERVER_PROFILES["xrpl-mainnet"];
  }

  function nextServer() {
    const servers = getServers();
    const idx = window.XRPL.serverIndex % servers.length;
    window.XRPL.serverIndex = (window.XRPL.serverIndex + 1) % servers.length;
    return servers[idx];
  }

  // -------------------- SAFE REQUEST (WS) --------------------
  async function wsRequest(payload, timeoutMs = WS_REQUEST_TIMEOUT_MS) {
    const c = window.XRPL.client;
    if (!c) throw new Error("XRPL client missing");
    // xrpl.js will throw if send is called while closing/closed; guard it:
    if (typeof c.isConnected === "function" && !c.isConnected()) {
      throw new Error("WebSocket not connected");
    }

    const clean = { ...(payload || {}) };
    if (clean.api_version != null) delete clean.api_version;

    const ms = clamp(Number(timeoutMs) || WS_REQUEST_TIMEOUT_MS, 500, 60000);
    let t;
    const timeout = new Promise((_, rej) => {
      t = setTimeout(() => rej(new Error(`TimeoutError: ${clean.command} (${ms}ms)`)), ms);
    });

    try {
      return await Promise.race([c.request(clean), timeout]);
    } finally {
      clearTimeout(t);
    }
  }

  // -------------------- HTTP JSON-RPC FALLBACK --------------------
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
    if (r.error) return null;
    if (r.status === "success" && r.result && typeof r.result === "object") return r.result;
    return r;
  }

  async function httpRpcRequest(payload, timeoutMs = 15000) {
    if (DISABLE_HTTP_FALLBACK) throw new Error("HTTP fallback disabled");

    const p = { ...(payload || {}) };
    if (p.api_version != null) delete p.api_version;

    const body = { method: p.command, params: [p] };

    for (const base of HTTP_RPC_ENDPOINTS) {
      const url = base.endsWith("/") ? base : base + "/";
      const j = await tryFetchJson(url, body, timeoutMs);
      const out = unwrapRpcResult(j);
      if (out) return out;
    }
    throw new Error("HTTP JSON-RPC failed (all endpoints)");
  }

  // -------------------- SHARED REQUEST API --------------------
  window.requestXrpl = async function (payload, { timeoutMs = WS_REQUEST_TIMEOUT_MS } = {}) {
    // Prefer WS if live
    if (window.XRPL.connected && window.XRPL.client) {
      try {
        return await wsRequest(payload, timeoutMs);
      } catch (e) {
        // if WS is borked, fall back
        if (!DISABLE_HTTP_FALLBACK) {
          const r = await httpRpcRequest(payload, timeoutMs).catch(() => null);
          if (r) return { result: r };
        }
        throw e;
      }
    }

    // No WS: HTTP fallback
    if (!DISABLE_HTTP_FALLBACK) {
      const r = await httpRpcRequest(payload, timeoutMs);
      return { result: r };
    }

    throw new Error("No XRPL transport available");
  };

  // -------------------- CONNECTION --------------------
  async function cleanupConnection() {
    subscribedLedgerStream = false;
    pendingSample = null;
    sampleInFlight = false;

    if (window.XRPL.client) {
      try {
        window.XRPL.client.removeAllListeners();
      } catch (_) {}
      try {
        await window.XRPL.client.disconnect();
      } catch (_) {}
      window.XRPL.client = null;
    }

    window.XRPL.connected = false;
  }

  function handleDisconnection(reason) {
    window.XRPL.connected = false;
    setMode("connecting", `Disconnected: ${reason || "unknown"}`);
    dispatchConnectionEvent();
    scheduleReconnect(reason || "disconnect");
  }

  function scheduleReconnect(reason) {
    window.XRPL.reconnectAttempts += 1;
    const delay = clamp(1200 * Math.pow(1.45, window.XRPL.reconnectAttempts), 1200, 20000) + Math.floor(Math.random() * 400);
    console.log("🔄 Reconnecting in", delay, "ms (attempt", window.XRPL.reconnectAttempts, ")", reason || "");
    setTimeout(() => connectXRPL(), delay);
  }

  function setupListeners() {
    const c = window.XRPL.client;
    if (!c) return;

    c.removeAllListeners();

    c.on("ledgerClosed", (ev) => {
      try {
        const idx = Number(ev?.ledger_index || 0);
        const hash = ev?.ledger_hash || null;
        if (!idx) return;

        // record event time
        const now = Date.now();
        const prevAt = window.XRPL.lastLedgerEventAt || now;
        const dtSec = Math.max(1, Math.round((now - prevAt) / 1000));
        window.XRPL.lastLedgerEventAt = now;

        // ignore duplicates/backwards
        if (idx <= window.XRPL.lastLedgerIndex) return;

        window.XRPL.lastLedgerIndex = idx;
        window.XRPL.lastLedgerHash = hash;

        // Update state cheaply from event
        const s = window.XRPL.state;
        const prevClose = s.ledgerTime ? new Date(s.ledgerTime).getTime() : now;
        s.ledgerIndex = idx;
        s.ledgerTime = new Date(now).toISOString();

        const txCount = Number(ev?.txn_count || 0);
        s.txPerLedger = txCount;

        const tps = txCount > 0 ? txCount / dtSec : 0;
        s.txnPerSec = tps;

        updateHistory("tpsHistory", tps);
        updateHistory("ledgerHistory", idx);
        updateHistory("txCountHistory", txCount);

        s.closeTimes.push({ label: "#" + idx, value: dtSec });
        if (s.closeTimes.length > 25) s.closeTimes.shift();

        s.recentLedgers.push({
          ledgerIndex: idx,
          closeTime: s.ledgerTime,
          totalTx: txCount,
          tps
        });
        if (s.recentLedgers.length > 60) s.recentLedgers.shift();

        sendStateToDashboard();

        // Decide if we should sample this ledger for tx types/fees
        if (Date.now() < cooldownUntil) return;
        if (idx % SAMPLE_EVERY_N_LEDGERS !== 0) return;

        // queue the latest sample only
        pendingSample = { ledgerIndex: idx, ledgerHash: hash };
        void drainSampleQueue();
      } catch (e) {
        console.warn("ledgerClosed handler error:", e?.message || e);
      }
    });

    c.on("error", (e) => {
      console.warn("🔌 WebSocket error:", e?.message || e);
    });

    c.on("disconnected", (code) => {
      console.warn("🔌 Disconnected (code " + code + ")");
      handleDisconnection("ws_disconnected");
    });
  }

  async function connectXRPL() {
    if (window.XRPL.connecting) return false;
    if (typeof xrpl === "undefined" || !xrpl.Client) {
      console.error("❌ xrpl.js not loaded");
      setMode("offline", "xrpl.js missing");
      return false;
    }

    window.XRPL.connecting = true;
    setMode("connecting", "Connecting...");
    dispatchConnectionEvent();

    const server = nextServer();

    try {
      await cleanupConnection();

      const c = new xrpl.Client(server.url, {
        timeout: WS_REQUEST_TIMEOUT_MS,
        connectionTimeout: WS_CONNECT_TIMEOUT_MS
      });

      window.XRPL.client = c;
      setupListeners();

      await c.connect();

      // server_info (best effort)
      try {
        await wsRequest({ command: "server_info" }, 12000);
      } catch (e) {
        console.warn("server_info failed (non-fatal):", e?.message || e);
      }

      // subscribe (best effort)
      subscribedLedgerStream = false;
      try {
        await wsRequest({ command: "subscribe", streams: ["ledger"] }, 10000);
        subscribedLedgerStream = true;
      } catch (e) {
        console.warn("subscribe failed (non-fatal):", e?.message || e);
      }

      window.XRPL.connected = true;
      window.XRPL.server = server;
      window.XRPL.reconnectAttempts = 0;

      setMode("live", "Connected");
      dispatchConnectionEvent();

      console.log("✅ Connected to", server.name, server.url);
      return true;
    } catch (e) {
      console.warn("❌ Connect failed:", server.name, e?.message || e);
      await cleanupConnection();
      handleDisconnection("connect_failed");
      return false;
    } finally {
      window.XRPL.connecting = false;
    }
  }

  // -------------------- SAMPLING PIPELINE --------------------
  async function drainSampleQueue() {
    if (sampleInFlight) return;
    if (!pendingSample) return;
    if (!window.XRPL.connected) return;

    sampleInFlight = true;
    try {
      // keep newest
      const job = pendingSample;
      pendingSample = null;

      await sleep(SAMPLE_DELAY_MS);

      // If disconnected mid-delay, abort
      if (!window.XRPL.connected) return;

      await sampleLedger(job.ledgerIndex, job.ledgerHash);
    } finally {
      sampleInFlight = false;
      if (pendingSample) void drainSampleQueue();
    }
  }

  async function sampleLedger(ledgerIndex, ledgerHash) {
    // Prefer ledger_hash (prevents ledgerNotFound on lagging servers)
    const payloadByHash = ledgerHash
      ? { command: "ledger", ledger_hash: ledgerHash, transactions: true, expand: false, binary: false }
      : null;

    const payloadValidated = { command: "ledger", ledger_index: "validated", transactions: true, expand: false, binary: false };

    let ledgerResp = null;

    for (let i = 0; i <= LEDGER_RETRY_DELAYS_MS.length; i++) {
      try {
        ledgerResp = await wsRequest(payloadByHash || payloadValidated, 12000);
        break;
      } catch (e) {
        const msg = e?.message || String(e);

        if (isOverloadError(msg)) {
          cooldownUntil = Date.now() + TOO_BUSY_COOLDOWN_MS;
          console.warn("🧯 Overload cooldown engaged:", TOO_BUSY_COOLDOWN_MS, "ms");
          return;
        }

        if (isLedgerNotFound(msg) && i < LEDGER_RETRY_DELAYS_MS.length) {
          await sleep(LEDGER_RETRY_DELAYS_MS[i]);
          continue;
        }

        // Transport issue: fall back to HTTP once (if enabled)
        if (isTransportError(msg) && !DISABLE_HTTP_FALLBACK) {
          const http = await httpRpcRequest(payloadByHash || payloadValidated, 15000).catch(() => null);
          if (http) {
            ledgerResp = { result: http };
            break;
          }
        }

        // otherwise give up quietly
        console.warn("sampleLedger failed:", msg);
        return;
      }
    }

    const ledger = ledgerResp?.result?.ledger;
    if (!ledger) return;

    const hashes = Array.isArray(ledger.transactions) ? ledger.transactions : [];
    if (!hashes.length) return;

    // sample tx details
    const sample = hashes.slice(0, Math.min(SAMPLE_TX_PER_LEDGER, hashes.length));
    const results = await mapLimit(sample, SAMPLE_CONCURRENCY, async (h) => {
      try {
        const r = await wsRequest({ command: "tx", transaction: String(h), binary: false }, 12000);
        const rr = r?.result || r;
        const tx = rr?.tx_json || rr;
        const meta = rr?.meta || rr?.metaData || null;
        if (!tx || !tx.TransactionType) return null;
        return { tx, meta };
      } catch (_) {
        return null;
      }
    });

    // aggregate
    const agg = { Payment: 0, Offer: 0, NFT: 0, TrustSet: 0, Other: 0 };
    let feeDropsSum = 0;
    let feeCount = 0;

    const normalized = [];

    for (const item of results) {
      if (!item) continue;
      const tx = item.tx;
      agg[classify(tx.TransactionType)]++;

      if (tx.Fee != null) {
        const d = Number(tx.Fee);
        if (Number.isFinite(d)) {
          feeDropsSum += d;
          feeCount++;
        }
      }

      // lightweight normalized tx window (for your explorer widgets)
      normalized.push({
        hash: tx.hash || null,
        ledgerIndex: ledgerIndex || ledger.ledger_index || null,
        type: tx.TransactionType,
        account: tx.Account || null,
        destination: tx.Destination || null,
        amount: tx.Amount || null,
        amountXRP: parseXrpAmount(tx.Amount),
        feeXRP: Number.isFinite(Number(tx.Fee)) ? Number(tx.Fee) / 1_000_000 : 0
      });
    }

    const s = window.XRPL.state;
    s.transactionTypes = agg;

    if (feeCount > 0) s.feeAvg = (feeDropsSum / feeCount) / 1_000_000;

    if (!Array.isArray(s.recentTransactions)) s.recentTransactions = [];
    s.recentTransactions.push(...normalized);
    if (s.recentTransactions.length > 800) s.recentTransactions.splice(0, s.recentTransactions.length - 800);

    updateHistory("feeHistory", s.feeAvg);

    // push update
    sendStateToDashboard();
  }

  async function mapLimit(items, limit, worker) {
    const out = new Array(items.length);
    let i = 0;
    let inFlight = 0;

    return new Promise((resolve) => {
      const pump = () => {
        while (inFlight < limit && i < items.length) {
          const idx = i++;
          inFlight++;
          Promise.resolve(worker(items[idx], idx))
            .then((r) => (out[idx] = r))
            .catch(() => (out[idx] = null))
            .finally(() => {
              inFlight--;
              if (i >= items.length && inFlight === 0) return resolve(out);
              pump();
            });
        }
      };
      pump();
    });
  }

  // -------------------- PUBLIC API --------------------
  window.connectXRPL = connectXRPL;
  window.reconnectXRPL = function () {
    window.XRPL.reconnectAttempts = 0;
    return connectXRPL();
  };
  window.setXRPLNetwork = function (networkId) {
    if (!XRPL_SERVER_PROFILES[networkId]) return;
    if (window.XRPL.network === networkId) return;
    window.XRPL.network = networkId;
    window.XRPL.serverIndex = 0;
    window.XRPL.reconnectAttempts = 0;
    connectXRPL();
  };

  // -------------------- INIT --------------------
  document.addEventListener("DOMContentLoaded", () => {
    console.log("🌊 XRPL Connection module loaded (ledgerClosed-driven + sampled)");
    connectXRPL();
  });

  setInterval(() => {
    if (!window.XRPL.connected && !window.XRPL.connecting) {
      console.log("💓 Keep-alive: reconnecting…");
      connectXRPL();
    }
  }, KEEPALIVE_INTERVAL_MS);
})();
