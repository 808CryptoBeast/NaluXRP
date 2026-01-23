/* =========================================
   NaluXrp 🌊 – XRPL Connection Module (FULL)
   Always Connected + Raw Transaction Streaming
   - Sequential ledger queue to reduce skipping
   - Safer retries/backoff on ledgerNotFound / load errors
   - Prefers Ripple public servers before xrplcluster
   - Graceful global backoff when server is overloaded
   - Shared request wrapper (window.requestXrpl) with concurrency, inflight dedupe, backoff
   ========================================= */

window.XRPL = {
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

  // Internal queue controls
  _ledgerQueue: [],                 // sorted ascending unique
  _processingQueue: false,
  _retryMap: new Map(),             // ledgerIndex -> attempts
  _lastServerInfoAt: 0,
  _overloadedUntil: 0,              // ms timestamp when overload pause expires

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
  network: "xrpl-mainnet"
};

/* ---------- CONSTANTS ---------- */

const RAW_TX_WINDOW_SIZE = 800;
const MAX_LEDGER_HISTORY = 60;

const POLL_MS = 4000;
const SERVER_INFO_TIMEOUT = 9000;
const LEDGER_FETCH_TIMEOUT = 15000;

// queue/backfill behavior
const MAX_BACKFILL_ENQUEUE = 6;       // if we're behind, only enqueue a few at a time
const MAX_QUEUE_SIZE = 20;
const MAX_LEDGER_FETCH_RETRIES = 5;

/* ---------- NETWORK PROFILES ---------- */

const XRPL_SERVER_PROFILES = {
  "xrpl-mainnet": [
    // Prefer Ripple public endpoints first
    { url: "wss://s2.ripple.com", name: "Ripple S2" },
    { url: "wss://s1.ripple.com", name: "Ripple S1" },

    // Fallbacks
    { url: "wss://xrplcluster.com", name: "XRPL Cluster" },
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

/* ---------- UTILITIES ---------- */

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
        lastUpdate: window.XRPL.lastLedgerTime
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
  return new Date((rippleTime + 946684800) * 1000);
}

function updateHistory(key, value, maxLength = 50) {
  const numValue = parseFloat(value) || 0;
  const s = window.XRPL.state;
  if (!Array.isArray(s[key])) return;
  s[key].push(numValue);
  if (s[key].length > maxLength) s[key].shift();
}

/* ---------- AMOUNT HELPERS ---------- */

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

/* ---------- TX EXTRACTION / NORMALIZATION ---------- */

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
    meta && meta.delivered_amount != null
      ? meta.delivered_amount
      : amount != null
      ? amount
      : null;

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

/* ---------- NETWORK SWITCHING ---------- */

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

  // reset queue
  window.XRPL._ledgerQueue = [];
  window.XRPL._retryMap.clear();

  cleanupConnection().then(() => connectXRPL());
}

/* ---------- QUEUE HELPERS (SEQUENTIAL) ---------- */

function enqueueLedger(index, reason = "") {
  const n = Number(index);
  if (!Number.isFinite(n) || n <= 0) return;

  // prevent queue explosion
  if (window.XRPL._ledgerQueue.length >= MAX_QUEUE_SIZE) {
    // keep only expected next + newest
    const expected = window.XRPL.lastLedgerIndex + 1;
    window.XRPL._ledgerQueue = window.XRPL._ledgerQueue.filter((x) => x === expected);
  }

  if (!window.XRPL._ledgerQueue.includes(n)) {
    window.XRPL._ledgerQueue.push(n);
    window.XRPL._ledgerQueue.sort((a, b) => a - b);
  }

  if (reason) {
    console.log(`🧾 Queue ledger ${n} (${reason}) → q=[${window.XRPL._ledgerQueue.slice(0, 8).join(", ")}${window.XRPL._ledgerQueue.length > 8 ? "…" : ""}]`);
  }

  processLedgerQueue();
}

function enqueueBackfillRange(from, to, reason = "backfill") {
  if (to <= from) return;

  const diff = to - from;
  if (diff <= MAX_BACKFILL_ENQUEUE) {
    for (let i = from; i <= to; i++) enqueueLedger(i, reason);
    return;
  }

  // enqueue a small sequential chunk + the newest, so we don’t spam
  for (let i = from; i < from + MAX_BACKFILL_ENQUEUE; i++) enqueueLedger(i, reason);
  enqueueLedger(to, reason + ":latest");
}

function nowMs() {
  return Date.now();
}

function isOverloaded() {
  return window.XRPL._overloadedUntil && nowMs() < window.XRPL._overloadedUntil;
}

function setOverloaded(ms, reason = "server overload") {
  const until = nowMs() + Math.max(0, Number(ms) || 0);
  window.XRPL._overloadedUntil = until;
  setMode("throttled", `${reason} until ${new Date(until).toISOString()}`);
  safeNotify(`Server overloaded — pausing requests for ${Math.round(ms)}ms`, "warn", 6000);
  console.warn(`⏸️ XRPL overloaded: pausing requests for ${ms}ms`);
}

/* ---------- MAIN CONNECTION ---------- */

async function connectXRPL() {
  if (window.XRPL.connecting) {
    console.log("⏳ Already connecting...");
    return;
  }

  window.XRPL.connecting = true;
  const servers = getCurrentServerList();

  console.log("🌊 Connecting to", window.XRPL.network, "...");
  updateConnectionStatus(false, "Connecting...");

  for (let i = 0; i < servers.length; i++) {
    const server = servers[i];
    const success = await attemptConnection(server);
    if (success) {
      window.XRPL.connecting = false;
      return true;
    }
  }

  window.XRPL.connecting = false;
  handleConnectionFailure();
  return false;
}

/* ---------- ATTEMPT CONNECTION TO SERVER ---------- */

async function attemptConnection(server) {
  try {
    console.log("🔌 Trying", server.name, "...");
    await cleanupConnection();

    window.XRPL.client = new xrpl.Client(server.url, {
      timeout: SERVER_INFO_TIMEOUT,
      connectionTimeout: SERVER_INFO_TIMEOUT + 6000
    });

    setupConnectionListeners();

    await Promise.race([
      window.XRPL.client.connect(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), SERVER_INFO_TIMEOUT + 6000))
    ]);

    const info = await verifyConnectionAndSubscribe();
    if (!info) throw new Error("Failed to verify connection");

    window.XRPL.connected = true;
    window.XRPL.server = server;
    window.XRPL.reconnectAttempts = 0;

    updateInitialState(info);
    updateConnectionStatus(true, server.name);
    startActivePolling();

    setMode("live", "Connected");
    safeNotify("✅ Connected to " + server.name, "success");
    dispatchConnectionEvent();

    console.log("✅ Connected to", server.name);

    // After connect, enqueue current ledger to ensure stream starts
    try {
      const seq = info.validated_ledger?.seq;
      if (seq && seq > window.XRPL.lastLedgerIndex) {
        enqueueBackfillRange(window.XRPL.lastLedgerIndex + 1, seq, "post-connect");
      }
    } catch (_) {}

    return true;
  } catch (err) {
    console.warn("❌", server.name, "failed:", err.message);
    await cleanupConnection();
    return false;
  }
}

/* ---------- VERIFY & SUBSCRIBE ---------- */

async function verifyConnectionAndSubscribe() {
  const client = window.XRPL.client;
  if (!client) return null;

  const response = await client.request({ command: "server_info", timeout: SERVER_INFO_TIMEOUT });
  if (!response.result || !response.result.info) throw new Error("Invalid server_info");

  try {
    await client.request({ command: "subscribe", streams: ["ledger"] });
    console.log("✅ Subscribed to ledger stream");
  } catch (e) {
    console.warn("⚠️ Subscription failed, using polling:", e.message);
  }

  return response.result.info;
}

/* ---------- INITIAL STATE ---------- */

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

  console.log("📊 Initial: Ledger #", s.ledgerIndex, ",", s.txPerLedger, "tx");
  sendStateToDashboard();
}

/* ---------- ACTIVE POLLING ---------- */

function startActivePolling() {
  if (window.XRPL.ledgerPollInterval) clearInterval(window.XRPL.ledgerPollInterval);

  window.XRPL.ledgerPollInterval = setInterval(async () => {
    if (!window.XRPL.connected || !window.XRPL.client) return;
    try {
      await checkForNewLedger();
    } catch (e) {
      console.warn("Polling error:", e.message);
    }
  }, POLL_MS);

  setTimeout(() => checkForNewLedger(), 1000);
}

/* ---------- CHECK FOR NEW LEDGER ---------- */

async function checkForNewLedger() {
  if (!window.XRPL.connected || !window.XRPL.client) return;

  // Respect global overload pause
  if (isOverloaded()) {
    const wait = window.XRPL._overloadedUntil - nowMs();
    console.warn(`⏸️ checkForNewLedger paused due to overload for ${Math.round(wait)}ms`);
    return;
  }

  try {
    const resp = await window.XRPL.client.request({ command: "server_info", timeout: SERVER_INFO_TIMEOUT });
    const info = resp.result.info;
    if (!info) return;

    window.XRPL._lastServerInfoAt = Date.now();

    const currentLedger = info.validated_ledger?.seq;
    if (!currentLedger) return;

    if (currentLedger > window.XRPL.lastLedgerIndex) {
      console.log("🆕 New ledger:", "#" + currentLedger);

      // Enqueue missing ledgers sequentially (but don’t spam)
      enqueueBackfillRange(window.XRPL.lastLedgerIndex + 1, currentLedger, "server_info");
      processLedgerQueue();
    } else {
      window.XRPL.lastLedgerTime = Date.now();
    }
  } catch (error) {
    const msg = String(error?.message || error || "").toLowerCase();
    console.warn("Check ledger error:", msg);

    // If server_info contains overload signals, set global backoff
    if (msg.includes("placing too much load") || msg.includes("too much load") || msg.includes("too_many_requests") || msg.includes("rate limit") || msg.includes("load")) {
      const jitter = Math.round(Math.random() * 3000);
      const pb = 8000 + jitter;
      setOverloaded(pb, "server_info reported high load");
      return;
    }

    if (msg.includes("timeout") || msg.includes("closed")) {
      handleDisconnection("ws_disconnected");
    }
  }
}

/* ---------- FETCH & PROCESS LEDGER ---------- */

async function fetchAndProcessLedger(ledgerIndex, serverInfoHint) {
  if (!window.XRPL.client) return;

  const idx = Number(ledgerIndex);
  if (!Number.isFinite(idx) || idx <= 0) return;

  const attempt = (window.XRPL._retryMap.get(idx) || 0) + 1;
  window.XRPL._retryMap.set(idx, attempt);

  console.log(`🔍 Fetching ledger # ${idx} with transactions... (attempt ${attempt})`);

  // If server is overloaded globally, skip processing now
  if (isOverloaded()) {
    console.warn(`⏸️ Skipping fetch for ledger ${idx} due to overload until ${new Date(window.XRPL._overloadedUntil).toISOString()}`);
    return false;
  }

  try {
    const ledgerResp = await window.XRPL.client.request({
      command: "ledger",
      ledger_index: idx,
      transactions: true,
      expand: true,
      binary: false,
      timeout: LEDGER_FETCH_TIMEOUT
    });

    const ledgerData = ledgerResp.result.ledger;
    if (!ledgerData) throw new Error("No ledger data in response");

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
    s.ledgerIndex = Number(ledgerData.ledger_index || idx);
    s.ledgerTime = closeDate;
    s.txPerLedger = totalTx;
    s.txnPerSec = tps;

    // IMPORTANT: always overwrite transaction types for this ledger
    s.transactionTypes = {
      Payment: txMetrics.aggregatedTypes.Payment || 0,
      Offer: txMetrics.aggregatedTypes.Offer || 0,
      NFT: txMetrics.aggregatedTypes.NFT || 0,
      TrustSet: txMetrics.aggregatedTypes.TrustSet || 0,
      Other: txMetrics.aggregatedTypes.Other || 0
    };

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

    // only after successful processing:
    window.XRPL.lastLedgerIndex = s.ledgerIndex;
    window.XRPL.lastLedgerTime = Date.now();

    // Refresh server info occasionally (don’t spam)
    let info = serverInfoHint || null;
    const shouldRefresh = Date.now() - (window.XRPL._lastServerInfoAt || 0) > 12000;
    if (!info && shouldRefresh) {
      try {
        const resp = await window.XRPL.client.request({ command: "server_info", timeout: SERVER_INFO_TIMEOUT });
        info = resp.result.info;
      } catch (_) {}
    }

    if (info) {
      s.feeAvg = (info.validated_ledger && info.validated_ledger.base_fee_xrp) || s.feeAvg;
      s.loadFee = (info.load_factor || 1000000) / 1000000;
      s.validators = info.peers || s.validators;
    }

    // Emit batch event for consumers
    window.dispatchEvent(
      new CustomEvent("xrpl-tx-batch", {
        detail: { ledgerIndex: s.ledgerIndex, closeTime: closeDate, transactions: normalizedBatch }
      })
    );

    // Push updated state
    sendStateToDashboard();
    // cleanup retry count for successful ledger
    window.XRPL._retryMap.delete(idx);
    return true;
  } catch (error) {
    const msg = String(error?.message || error || "");
    console.warn("Fetch ledger error:", msg);

    // Retry logic
    const lower = msg.toLowerCase();
    const isNotFound = lower.includes("ledgernotfound");
    const isLoad = lower.includes("placing too much load") || lower.includes("too much load") || lower.includes("too_many_requests") || lower.includes("rate limit") || lower.includes("load");
    const isClosed = lower.includes("websocket was closed") || lower.includes("disconnected") || lower.includes("notconnected");

    if (isClosed) {
      handleDisconnection("ws_disconnected");
      return false;
    }

    // If the server indicates it's overloaded, set a global backoff pause
    if (isLoad) {
      // compute backoff with attempt-based exponential + jitter
      const backoffBase = Math.min(1200 * attempt, 7000);
      const jitter = Math.round(Math.random() * 2000);
      let backoff = backoffBase + jitter;

      // attempt to read server_info briefly to add penalty if load_factor elevated
      try {
        const infoResp = await window.XRPL.client.request({ command: "server_info", timeout: 1200 });
        const info = infoResp?.result?.info;
        if (info && info.load_factor) {
          const lf = Number(info.load_factor) || 1;
          if (lf > 1) backoff += Math.round((lf - 1) * 1500);
        }
      } catch (_) {
        // ignore
      }

      // Set a global pause so all modules back off for a bit
      const pauseMs = Math.min(Math.max(backoff, 3000), 20000);
      setOverloaded(pauseMs, "ledger fetch reported overloaded");
      // keep ledger in queue (we will try again later after pause)
      return false;
    }

    if ((isNotFound || isLoad) && attempt <= MAX_LEDGER_FETCH_RETRIES) {
      const backoff = Math.min(1200 * attempt, 7000);
      await new Promise((r) => setTimeout(r, backoff));
      // keep ledger in queue; don’t advance
      return false;
    }

    // Give up after max retries: remove it from queue so we don’t freeze forever.
    window.XRPL._ledgerQueue = window.XRPL._ledgerQueue.filter((x) => x !== idx);
    window.XRPL._retryMap.delete(idx);
    return false;
  }
}

/* ---------- TRANSACTION ANALYSIS ---------- */

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
    if (txType === "OfferCreate" || txType === "OfferCancel" || (typeof txType === "string" && txType.indexOf("AMM") === 0)) {
      return "Offer";
    }
    if (typeof txType === "string" && (txType.indexOf("NFToken") === 0 || txType.indexOf("NFT") === 0)) {
      return "NFT";
    }
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
      if (!Number.isNaN(feeDrops)) totalFeeDrops += feeDrops;
    }

    const n = normalizeTransaction(
      entry,
      ledger.ledger_index,
      ledger.close_time ? rippleTimeToDate(ledger.close_time) : null
    );
    if (n) normalized.push(n);
  }

  const avgFeeXRP = totalTx > 0 && totalFeeDrops > 0 ? totalFeeDrops / 1_000_000 / totalTx : 0;
  const successRate = totalTx > 0 ? (successCount / totalTx) * 100 : 100;

  return { totalTx, aggregatedTypes, avgFeeXRP, successRate, normalized };
}

/* ---------- SEND STATE TO DASHBOARD + ANALYTICS ---------- */

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
    txTypes,
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
        txTypes,
        latestLedger: dashboardState.latestLedger
      }
    })
  );
}

/* ---------- CONNECTION LISTENERS ---------- */

function setupConnectionListeners() {
  const client = window.XRPL.client;
  if (!client) return;

  client.removeAllListeners();

  client.on("ledgerClosed", (ledger) => {
    try {
      const idx = Number(ledger.ledger_index);
      if (!idx) return;

      // enqueue sequentially, don’t process out-of-order
      if (idx > window.XRPL.lastLedgerIndex) {
        console.log("📨 ledgerClosed event:", idx, "→ queue", idx);
        enqueueLedger(idx, "ledgerClosed");
      }
    } catch (e) {
      console.warn("Ledger closed handler error:", e.message);
    }
  });

  client.on("error", (error) => {
    console.warn("🔌 WebSocket error:", error.message);
  });

  client.on("disconnected", (code) => {
    console.warn("🔌 Disconnected (code " + code + ")");
    handleDisconnection("ws_disconnected");
  });
}

/* ---------- DISCONNECTION HANDLING ---------- */

function handleDisconnection(reason = "ws_disconnected") {
  if (!window.XRPL.connected) return;

  console.warn("🔌 Handling disconnection...", reason);
  window.XRPL.connected = false;

  if (window.XRPL.ledgerPollInterval) {
    clearInterval(window.XRPL.ledgerPollInterval);
    window.XRPL.ledgerPollInterval = null;
  }

  updateConnectionStatus(false, "Disconnected");
  setMode("connecting", "Disconnected: " + reason);
  dispatchConnectionEvent();

  window.XRPL.reconnectAttempts += 1;
  const delay = Math.min(3000 * window.XRPL.reconnectAttempts, 10000);

  console.log("🔄 Reconnecting in", delay, "ms (attempt", window.XRPL.reconnectAttempts, ")");

  if (window.XRPL.reconnectTimeout) clearTimeout(window.XRPL.reconnectTimeout);

  window.XRPL.reconnectTimeout = setTimeout(() => {
    if (!window.XRPL.connected) connectXRPL();
  }, delay);
}

/* ---------- CONNECTION FAILURE (TRY AGAIN) ---------- */

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

/* ---------- CLEANUP ---------- */

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
      await window.XRPL.client.disconnect();
    } catch (_) {}
    window.XRPL.client = null;
  }

  window.XRPL.connected = false;
}

/* ---------- CONNECTION STATUS UI ---------- */

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

/* ---------- MANUAL RECONNECT ---------- */

async function reconnectXRPL() {
  console.log("🔄 Manual reconnect");
  safeNotify("Reconnecting to XRPL...", "info");
  window.XRPL.reconnectAttempts = 0;
  return connectXRPL();
}

/* ---------- SHARED REQUEST WRAPPER: window.requestXrpl ----------
   Single shared entrypoint for other modules (inspector, trace tab).
   - concurrency limiter
   - inflight dedupe
   - backoff + jitter + server_info hint
   - HTTP fallback to public RPC endpoints
-------------------------------------------------------------- */

(function () {
  const RPC_HTTP_ENDPOINTS = ["https://xrplcluster.com/", "https://xrpl.ws/"];
  const XRPL_REQUEST_CONCURRENCY = 3; // default concurrency (adjustable by consumers if needed)
  const XRPL_MAX_RETRIES = 5;
  const XRPL_BACKOFF_BASE_MS = 500;
  const XRPL_MAX_BACKOFF_MS = 10000;

  let __xrpl_active = 0;
  const __xrpl_queue = [];
  const __inflight = new Map(); // key -> Promise

  function acquireSlot() {
    return new Promise((resolve) => {
      if (__xrpl_active < XRPL_REQUEST_CONCURRENCY) {
        __xrpl_active++;
        return resolve();
      }
      __xrpl_queue.push(resolve);
    });
  }
  function releaseSlot() {
    __xrpl_active = Math.max(0, __xrpl_active - 1);
    if (__xrpl_queue.length > 0 && __xrpl_active < XRPL_REQUEST_CONCURRENCY) {
      __xrpl_active++;
      const r = __xrpl_queue.shift();
      if (typeof r === "function") r();
    }
  }

  async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  function isTransientError(err) {
    if (!err) return false;
    const msg = String(err.message || err || "").toLowerCase();
    if (!msg) return false;
    if (msg.includes("placing too much load") || msg.includes("too much load") || msg.includes("too_many_requests") || msg.includes("rate limit")) return true;
    if (msg.includes("timeout") || msg.includes("ecanceled") || msg.includes("econnreset") || msg.includes("disconnected") || msg.includes("closed")) return true;
    return false;
  }

  async function fetchServerLoadHint(timeout = 1200) {
    try {
      if (window.XRPL?.client?.request) {
        const resp = await window.XRPL.client.request({ command: "server_info", timeout });
        return resp?.result?.info || null;
      }
    } catch (_) {}
    // No further fallback here; callers can use HTTP endpoints if needed
    return null;
  }

  async function attemptHttpRpc(payload, { timeoutMs = 15000, retries = 1 } = {}) {
    // Try a list of HTTP RPC endpoints (POST JSON-RPC style payload)
    const body = { method: payload.command || payload.method || "unknown", params: [payload] };
    for (const base of RPC_HTTP_ENDPOINTS) {
      const url = base.endsWith("/") ? base : base + "/";
      let attempt = 0;
      while (attempt <= retries) {
        attempt++;
        try {
          const controller = new AbortController();
          const id = setTimeout(() => controller.abort(), timeoutMs);
          const resp = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal
          });
          clearTimeout(id);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const j = await resp.json();
          // unwrap shapes like account-inspector expects
          const out = j?.result?.result ?? j?.result ?? j;
          return out;
        } catch (e) {
          if (attempt > retries) break;
          await sleep(200 * attempt);
        }
      }
    }
    return null;
  }

  async function _requestXrplInternal(payload, { timeoutMs = 20000, allowHttpFallback = true } = {}) {
    // Preferred: direct ws client
    if (window.XRPL?.client?.request) {
      try {
        const out = await window.XRPL.client.request({ ...(payload || {}), timeout: timeoutMs });
        return out?.result || out;
      } catch (e) {
        throw e;
      }
    }

    // Fallback: HTTP RPC endpoints
    if (allowHttpFallback) {
      const out = await attemptHttpRpc(payload, { timeoutMs, retries: 1 });
      if (out) return out;
    }

    throw new Error("No XRPL transport available");
  }

  async function requestXrpl(payload, { timeoutMs = 20000, retries = 3, allowHttpFallback = true } = {}) {
    const key = JSON.stringify({ payload, timeoutMs, allowHttpFallback });
    if (__inflight.has(key)) return __inflight.get(key);

    const p = (async () => {
      // Respect global overloaded pause
      try {
        if (window.XRPL && window.XRPL._overloadedUntil && Date.now() < window.XRPL._overloadedUntil) {
          const wait = window.XRPL._overloadedUntil - Date.now();
          await sleep(wait + 150);
        }
      } catch (_) {}

      await acquireSlot();
      try {
        let attempt = 0;
        let lastErr = null;
        const maxAttempts = Math.max(1, Math.min(XRPL_MAX_RETRIES, retries + 1));

        while (attempt < maxAttempts) {
          attempt++;
          try {
            const out = await _requestXrplInternal(payload, { timeoutMs, allowHttpFallback });
            // success
            return out;
          } catch (err) {
            lastErr = err;
            if (!isTransientError(err)) throw err;

            const msg = String(err.message || "").toLowerCase();
            if ((msg.includes("placing too much load") || msg.includes("too much load") || msg.includes("too_many_requests") || msg.includes("rate limit")) && typeof setOverloaded === "function") {
              const jitter = Math.round(Math.random() * 2000);
              const base = Math.min(XRPL_BACKOFF_BASE_MS * attempt, XRPL_MAX_BACKOFF_MS);
              const pauseMs = Math.min(Math.max(base + jitter, 3000), 30000);
              try { setOverloaded(pauseMs, "request wrapper triggered overload"); } catch (_) {}
            }

            if (attempt >= maxAttempts) break;

            let penalty = 0;
            try {
              const info = await fetchServerLoadHint(1000);
              const lf = info && (info.load_factor || info.state?.load_factor) ? Number(info.load_factor || info.state?.load_factor) : null;
              if (lf && lf > 1) penalty = Math.round((lf - 1) * 1000);
            } catch (_) {}

            const backoff = Math.min(XRPL_BACKOFF_BASE_MS * attempt + Math.round(Math.random() * 400) + penalty, XRPL_MAX_BACKOFF_MS);
            await sleep(backoff);
          }
        }

        throw lastErr || new Error("XRPL request failed");
      } finally {
        releaseSlot();
      }
    })();

    __inflight.set(key, p);
    p.finally(() => __inflight.delete(key));
    return p;
  }

  if (typeof window !== "undefined") {
    window.requestXrpl = requestXrpl;
    // optional helper to let callers adjust concurrency (not persisted)
    window.setXrplRequestConcurrency = function (n) {
      // Note: concurrency here is internal constant; to change, modify XRPL_REQUEST_CONCURRENCY above.
      // We provide a no-op shim to avoid errors if callers call it.
      console.warn("setXrplRequestConcurrency is a shim in this build. To change concurrency, restart with adjusted constant in js/xrpl-connection.js.");
    };
  }
})();

/* ---------- KEEP ALIVE ---------- */

setInterval(() => {
  if (!window.XRPL.connected && !window.XRPL.connecting) {
    console.log("💓 Keep-alive: Reconnecting...");
    connectXRPL();
  }
}, 30000);

/* ---------- EXPORTS ---------- */

window.connectXRPL = connectXRPL;
window.reconnectXRPL = reconnectXRPL;
window.getXRPLState = getXRPLState;
window.isXRPLConnected = isXRPLConnected;
window.setXRPLNetwork = setXRPLNetwork;

console.log("🌊 XRPL Connection module loaded (sequential queue + overload backoff + shared request wrapper)");
