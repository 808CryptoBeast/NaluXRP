/* =========================================
   NaluXrp 🌊 – XRPL Connection Module (Deep)
   Always Connected + Raw Transaction Streaming
   (patched — consumer-aware + ledgerClosed fixes)
   ========================================= */

window.XRPL = {
  client: null,
  connected: false,
  connecting: false,
  server: null,
  reconnectAttempts: 0,
  maxReconnectAttempts: 999, // Never give up!
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

    // 🔥 Deep analytics extras
    recentTransactions: [],   // normalized per-tx window
    recentLedgers: []         // small ledger summary history
  },
  mode: "connecting",
  modeReason: "Initializing",
  network: "xrpl-mainnet",

  // Pause control: set of reasons that requested pause
  _pauseReasons: new Set(),
  processingPaused: false,
  processingPauseReason: null,

  // Consumer registry (pages/modules that want full processing)
  _consumers: new Set(),

  // Global overload marker
  _overloadedUntil: 0
};

/* ---------- CONSTANTS ---------- */

const RAW_TX_WINDOW_SIZE = 800;   // how many recent tx we keep for analytics
const MAX_LEDGER_HISTORY = 60;    // how many recent ledger summaries we keep

/* ---------- NETWORK PROFILES ---------- */

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

/* ---------- UTILITIES ---------- */

function getCurrentServerList() {
  const list = XRPL_SERVER_PROFILES[window.XRPL.network];
  return Array.isArray(list) && list.length
    ? list
    : XRPL_SERVER_PROFILES["xrpl-mainnet"];
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

/* ---------- CONSUMER API (pages/modules register to receive full processing) ---------- */

window.registerXRPLConsumer = function (name) {
  try {
    if (!name) return;
    window.XRPL._consumers.add(String(name));
    console.log("XRPL consumer registered:", name, "count:", window.XRPL._consumers.size);
    // resume processing when consumers exist
    if (window.XRPL._consumers.size > 0) {
      window.resumeXRPLProcessing("__no_consumers__");
      // ensure polling is running
      if (window.XRPL.connected) startActivePolling();
    }
  } catch (e) {
    console.warn("registerXRPLConsumer error", e);
  }
};

window.unregisterXRPLConsumer = function (name) {
  try {
    if (!name) return;
    window.XRPL._consumers.delete(String(name));
    console.log("XRPL consumer unregistered:", name, "count:", window.XRPL._consumers.size);
    if (window.XRPL._consumers.size === 0) {
      // pause heavy processing to save resources (but still emit lightweight ledgerClosed)
      window.pauseXRPLProcessing("__no_consumers__");
    }
  } catch (e) {
    console.warn("unregisterXRPLConsumer error", e);
  }
};

window.getXRPLConsumerCount = function () {
  return window.XRPL._consumers ? window.XRPL._consumers.size : 0;
};

/* ---------- TX EXTRACTION / NORMALIZATION ---------- */

/**
 * Normalize any possible XRPL tx entry shape into { tx, meta }
 */
function extractTxAndMeta(entry) {
  if (!entry || typeof entry !== "object") {
    return { tx: null, meta: null };
  }

  // (1) Standard XRPL "tx_json + meta"
  if (entry.tx_json && typeof entry.tx_json === "object") {
    return {
      tx: entry.tx_json,
      meta: entry.meta || entry.metaData || null
    };
  }

  // (2) Already a transaction-like object
  if (entry.TransactionType) {
    return {
      tx: entry,
      meta: entry.meta || entry.metaData || null
    };
  }

  // (3) Embedded in `tx`
  if (entry.tx && typeof entry.tx === "object" && entry.tx.TransactionType) {
    return {
      tx: entry.tx,
      meta: entry.meta || entry.metaData || null
    };
  }

  // (4) Embedded in `transaction`
  if (
    entry.transaction &&
    typeof entry.transaction === "object" &&
    entry.transaction.TransactionType
  ) {
    return {
      tx: entry.transaction,
      meta: entry.meta || entry.metaData || null
    };
  }

  return { tx: null, meta: null };
}

/**
 * Normalized transaction structure used by analytics + flow detection
 */
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
  const destinationTag =
    tx.DestinationTag != null ? tx.DestinationTag : tx.Destination_Tag;

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
    result:
      meta && typeof meta.TransactionResult === "string"
        ? meta.TransactionResult
        : null,
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

  cleanupConnection().then(function () {
    connectXRPL();
  });
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
      timeout: 10000,
      connectionTimeout: 15000
    });

    // wrap listeners and resume if necessary
    setupConnectionListeners();

    await Promise.race([
      window.XRPL.client.connect(),
      new Promise(function (_, reject) {
        setTimeout(function () {
          reject(new Error("Timeout"));
        }, 15000);
      })
    ]);

    const info = await verifyConnectionAndSubscribe();
    if (!info) throw new Error("Failed to verify connection");

    window.XRPL.connected = true;
    window.XRPL.server = server;
    window.XRPL.reconnectAttempts = 0;

    updateInitialState(info);
    updateConnectionStatus(true, server.name);

    // only start active polling if consumers exist
    if (getXRPLConsumerCount() > 0) startActivePolling();

    setMode("live", "Connected");
    safeNotify("✅ Connected to " + server.name, "success");
    dispatchConnectionEvent();

    console.log("✅ Connected to", server.name);
    return true;
  } catch (err) {
    console.warn("❌", server.name, "failed:", err && err.message ? err.message : err);
    await cleanupConnection();
    return false;
  }
}

/* ---------- VERIFY & SUBSCRIBE ---------- */

async function verifyConnectionAndSubscribe() {
  const client = window.XRPL.client;
  if (!client) return null;

  const response = await client.request({
    command: "server_info",
    timeout: 10000
  });

  if (!response.result || !response.result.info) {
    throw new Error("Invalid server_info");
  }

  try {
    await client.request({
      command: "subscribe",
      streams: ["ledger"]
    });
    console.log("✅ Subscribed to ledger stream");
  } catch (e) {
    console.warn("⚠️ Subscription failed, using polling:", e && e.message ? e.message : e);
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

  console.log(
    "📊 Initial: Ledger #",
    s.ledgerIndex,
    ",",
    s.txPerLedger,
    "tx"
  );

  // Send initial state to dashboard + analytics
  sendStateToDashboard();
}

/* ---------- PAUSE / RESUME PROCESSING API ---------- */
/*
  Multiple callers can request pause with distinct reasons; processing resumes when all reasons removed.
  Pausing stops polling and processing of incoming ledger events (without closing WS).
*/
(function () {
  function updateProcessingPausedState() {
    const paused = window.XRPL._pauseReasons && window.XRPL._pauseReasons.size > 0;
    window.XRPL.processingPaused = !!paused;
    window.XRPL.processingPauseReason = paused ? Array.from(window.XRPL._pauseReasons).join(",") : null;

    if (window.XRPL.processingPaused) {
      // stop polling loop if running
      if (window.XRPL.ledgerPollInterval) {
        clearInterval(window.XRPL.ledgerPollInterval);
        window.XRPL.ledgerPollInterval = null;
      }
      setMode("paused", `processing paused (${window.XRPL.processingPauseReason})`);
      dispatchConnectionEvent();
      console.log("⏸️ XRPL processing paused:", window.XRPL.processingPauseReason);
    } else {
      // resume polling only if consumers exist
      if (getXRPLConsumerCount() > 0) startActivePolling();
      setMode("live", "processing active");
      dispatchConnectionEvent();
      console.log("▶️ XRPL processing resumed");
      // Try a quick ledger check to catch up
      try { checkForNewLedger(); } catch (_) {}
    }
  }

  window.pauseXRPLProcessing = function (reason) {
    try {
      if (!reason) reason = "manual";
      if (!window.XRPL._pauseReasons) window.XRPL._pauseReasons = new Set();
      window.XRPL._pauseReasons.add(String(reason));
      updateProcessingPausedState();
    } catch (e) {
      console.warn("pauseXRPLProcessing error", e);
    }
  };

  window.resumeXRPLProcessing = function (reason) {
    try {
      if (!window.XRPL._pauseReasons) window.XRPL._pauseReasons = new Set();
      if (reason == null) {
        // clear all
        window.XRPL._pauseReasons.clear();
      } else {
        window.XRPL._pauseReasons.delete(String(reason));
      }
      updateProcessingPausedState();
    } catch (e) {
      console.warn("resumeXRPLProcessing error", e);
    }
  };

  window.isXRPLProcessingPaused = function () {
    return !!(window.XRPL && window.XRPL.processingPaused);
  };

  // Auto-pause on visibility hidden, resume on visible (add visibility reason)
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

/* ---------- ACTIVE POLLING ---------- */

function startActivePolling() {
  if (window.XRPL.ledgerPollInterval) {
    clearInterval(window.XRPL.ledgerPollInterval);
  }

  // don't poll if paused or no consumers
  if (window.XRPL.processingPaused || getXRPLConsumerCount() === 0) {
    if (getXRPLConsumerCount() === 0) console.log("No consumers registered — skipping ledger polling");
    return;
  }

  window.XRPL.ledgerPollInterval = setInterval(async function () {
    if (!window.XRPL.connected || !window.XRPL.client) return;
    if (window.XRPL.processingPaused) return; // respect explicit pause
    try {
      await checkForNewLedger();
    } catch (e) {
      console.warn("Polling error:", e && e.message ? e.message : e);
    }
  }, 4000);

  setTimeout(function () {
    checkForNewLedger();
  }, 1000);
}

/* ---------- CHECK FOR NEW LEDGER ---------- */

async function checkForNewLedger() {
  if (!window.XRPL.connected || !window.XRPL.client) return;
  if (window.XRPL.processingPaused) return; // respect explicit pause

  try {
    const resp = await window.XRPL.client.request({
      command: "server_info",
      timeout: 8000
    });

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
    console.warn("Check ledger error:", error && error.message ? error.message : error);
    if (
      String(error && (error.message || "")).toLowerCase().includes("timeout") ||
      String(error && (error.message || "")).toLowerCase().includes("closed")
    ) {
      handleDisconnection();
    }
  }
}

/* ---------- FETCH & PROCESS LEDGER ---------- */

async function fetchAndProcessLedger(ledgerIndex, serverInfoHint) {
  if (!window.XRPL.client) return;
  if (window.XRPL.processingPaused) {
    console.log("Skipping fetchAndProcessLedger because processing is paused:", ledgerIndex);
    // still update lastLedgerTime/Index minimally so dashboard can show progress
    if (ledgerIndex > window.XRPL.lastLedgerIndex) {
      window.XRPL.lastLedgerIndex = ledgerIndex;
      window.XRPL.lastLedgerTime = Date.now();
      window.XRPL.state.ledgerIndex = ledgerIndex;
      window.XRPL.state.ledgerTime = new Date();
      // emit light event
      window.dispatchEvent(new CustomEvent("xrpl-ledger-closed", { detail: { ledgerIndex, timestamp: window.XRPL.lastLedgerTime } }));
    }
    return;
  }

  try {
    console.log(
      "🔍 Fetching ledger #",
      ledgerIndex,
      "with transactions..."
    );

    const ledgerResp = await window.XRPL.client.request({
      command: "ledger",
      ledger_index: ledgerIndex,
      transactions: true,
      expand: true,
      binary: false
    });

    const ledgerData = ledgerResp.result.ledger;
    if (!ledgerData) {
      console.warn("⚠️ No ledger data in response");
      return;
    }

    console.log("📊 Ledger data structure:", {
      ledger_index: ledgerData.ledger_index,
      has_transactions: !!ledgerData.transactions,
      transactions_type: typeof ledgerData.transactions,
      transactions_length: Array.isArray(ledgerData.transactions)
        ? ledgerData.transactions.length
        : "not an array",
      transaction_hash: ledgerData.transaction_hash
    });

    const closeDate = ledgerData.close_time
      ? rippleTimeToDate(ledgerData.close_time)
      : new Date();

    const closeTimeSec = Math.floor(closeDate.getTime() / 1000);
    let durationSec = 4.0;
    if (window.XRPL.lastCloseTimeSec != null) {
      durationSec = Math.max(
        1,
        closeTimeSec - window.XRPL.lastCloseTimeSec
      );
    }
    window.XRPL.lastCloseTimeSec = closeTimeSec;

    const txMetrics = analyzeLedgerTransactions(ledgerData);
    const totalTx = txMetrics.totalTx;
    const tps = totalTx > 0 ? totalTx / durationSec : 0;

    console.log(
      "✅ Processed ledger #",
      ledgerIndex,
      ":",
      totalTx,
      "transactions,",
      tps.toFixed(2),
      "TPS"
    );

    const s = window.XRPL.state;
    s.ledgerIndex = Number(ledgerData.ledger_index || ledgerIndex);
    s.ledgerTime = closeDate;
    s.txPerLedger = totalTx;
    s.txnPerSec = tps;
    s.transactionTypes = { ...txMetrics.aggregatedTypes };

    if (txMetrics.avgFeeXRP > 0) {
      s.feeAvg = txMetrics.avgFeeXRP;
    }

    // ---- History arrays for charts ----
    updateHistory("tpsHistory", tps);
    updateHistory("feeHistory", s.feeAvg);
    updateHistory("ledgerHistory", s.ledgerIndex);
    updateHistory("txCountHistory", totalTx);

    // ---- Close time history for orb / timing analytics ----
    if (!Array.isArray(s.closeTimes)) s.closeTimes = [];
    s.closeTimes.push({
      label: "#" + s.ledgerIndex,
      value: durationSec
    });
    if (s.closeTimes.length > 25) s.closeTimes.shift();

    // ---- Deep analytics: recent ledger summary ----
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
      s.recentLedgers.splice(
        0,
        s.recentLedgers.length - MAX_LEDGER_HISTORY
      );
    }

    // ---- Deep analytics: append normalized per-transaction data ----
    const normalizedBatch = txMetrics.normalized || [];
    if (!Array.isArray(s.recentTransactions)) {
      s.recentTransactions = [];
    }
    if (normalizedBatch.length) {
      Array.prototype.push.apply(s.recentTransactions, normalizedBatch);
      if (s.recentTransactions.length > RAW_TX_WINDOW_SIZE) {
        s.recentTransactions.splice(
          0,
          s.recentTransactions.length - RAW_TX_WINDOW_SIZE
        );
      }
    }

    window.XRPL.lastLedgerIndex = s.ledgerIndex;
    window.XRPL.lastLedgerTime = Date.now();

    // ---- Optionally refresh server info for load / fee / validators ----
    let info = serverInfoHint || null;
    if (!info) {
      try {
        const resp = await window.XRPL.client.request({
          command: "server_info",
          timeout: 8000
        });
        info = resp.result.info;
      } catch (e) {
        info = null;
      }
    }

    if (info) {
      s.feeAvg =
        (info.validated_ledger &&
          info.validated_ledger.base_fee_xrp) ||
        s.feeAvg;
      s.loadFee = (info.load_factor || 1000000) / 1000000;
      s.validators = info.peers || s.validators;
    }

    console.log(
      "📊 Ledger #",
      s.ledgerIndex,
      "|",
      totalTx,
      "tx |",
      durationSec.toFixed(2),
      "s | TPS",
      tps.toFixed(2)
    );
    console.log("📈 Transaction types:", s.transactionTypes);

    // ---- Emit raw tx batch event for advanced consumers ----
    window.dispatchEvent(
      new CustomEvent("xrpl-tx-batch", {
        detail: {
          ledgerIndex: s.ledgerIndex,
          closeTime: closeDate,
          transactions: normalizedBatch
        }
      })
    );

    // ---- Push updated state to dashboard + analytics ----
    sendStateToDashboard();
  } catch (error) {
    console.warn("Fetch ledger error:", error && error.message ? error.message : error);
  }
}

/* ---------- TRANSACTION ANALYSIS ---------- */

function analyzeLedgerTransactions(ledger) {
  const txs = ledger.transactions || [];

  console.log("🔍 Analyzing ledger transactions:", {
    ledgerIndex: ledger.ledger_index,
    transactionsLength: txs.length
  });

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

  // Keep normalized txs here for deep analytics
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
    if (
      typeof txType === "string" &&
      (txType.indexOf("NFToken") === 0 ||
        txType.indexOf("NFT") === 0)
    ) {
      return "NFT";
    }
    if (txType === "TrustSet") return "TrustSet";
    return "Other";
  }

  for (let i = 0; i < txs.length; i++) {
    const entry = txs[i];
    const extracted = extractTxAndMeta(entry);
    const tx = extracted.tx;
    const meta = extracted.meta;

    if (!tx || !tx.TransactionType) {
      if (i < 2) {
        console.warn(
          "⚠️ Transaction",
          i,
          "has no valid TransactionType",
          entry
        );
      }
      continue;
    }

    totalTx += 1;

    const cat = classify(tx.TransactionType);
    if (!aggregatedTypes[cat]) aggregatedTypes[cat] = 0;
    aggregatedTypes[cat] += 1;

    if (meta && typeof meta.TransactionResult === "string") {
      if (meta.TransactionResult.indexOf("tes") === 0) {
        successCount += 1;
      }
    } else {
      // if we don't have meta, assume success (common in some responses)
      successCount += 1;
    }

    if (tx.Fee != null) {
      const feeDrops = Number(tx.Fee);
      if (!Number.isNaN(feeDrops)) {
        totalFeeDrops += feeDrops;
      }
    }

    const n = normalizeTransaction(
      entry,
      ledger.ledger_index,
      ledger.close_time
        ? rippleTimeToDate(ledger.close_time)
        : null
    );
    if (n) {
      normalized.push(n);
    }
  }

  const avgFeeXRP =
    totalTx > 0 && totalFeeDrops > 0
      ? totalFeeDrops / 1_000_000 / totalTx
      : 0;

  const successRate =
    totalTx > 0 ? (successCount / totalTx) * 100 : 100;

  const result = {
    totalTx: totalTx,
    aggregatedTypes: aggregatedTypes,
    avgFeeXRP: avgFeeXRP,
    successRate: successRate,
    normalized: normalized
  };

  console.log("📊 Transaction analysis result:", {
    totalTx: totalTx,
    avgFeeXRP: avgFeeXRP,
    successRate: successRate,
    byType: aggregatedTypes
  });

  return result;
}

/* ---------- SEND STATE TO DASHBOARD + ANALYTICS ---------- */

function sendStateToDashboard() {
  const s = window.XRPL.state;

  console.log("📨 Sending XRPL state to dashboard:", {
    ledgerIndex: s.ledgerIndex,
    txPerLedger: s.txPerLedger,
    transactionTypes: s.transactionTypes,
    recentTxCount: Array.isArray(s.recentTransactions)
      ? s.recentTransactions.length
      : 0
  });

  // Ensure transactionTypes is properly formatted for Dashboard
  const txTypes = {
    Payment: s.transactionTypes.Payment || 0,
    Offer: s.transactionTypes.Offer || 0,
    OfferCreate: 0, // aggregated into Offer already
    OfferCancel: 0,
    NFT: s.transactionTypes.NFT || 0,
    NFTokenMint: 0,
    NFTokenBurn: 0,
    TrustSet: s.transactionTypes.TrustSet || 0,
    Other: s.transactionTypes.Other || 0
  };

  // Build dashboard view model (for NaluDashboard)
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
    amm: {},          // can be filled by future modules
    trustlines: {},
    nfts: {},
    whales: [],
    latency: {
      avgMs: 0,
      fastShare: 0.7,
      mediumShare: 0.2,
      slowShare: 0.1
    },
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

    // optional: deep analytics helpers (dashboard may ignore)
    recentTransactions: s.recentTransactions || [],
    recentLedgers: s.recentLedgers || []
  };

  console.log("📦 Complete dashboard state:", dashboardState);

  // Direct call into Dashboard module
  if (
    window.NaluDashboard &&
    typeof window.NaluDashboard.applyXRPLState === "function"
  ) {
    try {
      window.NaluDashboard.applyXRPLState(dashboardState);
    } catch (e) {
      console.warn(
        "Dashboard applyXRPLState error:",
        e && e.message ? e.message : e
      );
    }
  }

  // Broadcast full raw XRPL.state snapshot for analytics & others
  window.dispatchEvent(
    new CustomEvent("xrpl-ledger", {
      detail: {
        ...window.XRPL.state,
        // also include formatted txTypes & ledger summary for convenience
        txTypes: txTypes,
        latestLedger: dashboardState.latestLedger
      }
    })
  );
}

/* ---------- CONNECTION LISTENERS (ledgerClosed updated) ---------- */

function setupConnectionListeners() {
  const client = window.XRPL.client;
  if (!client) return;

  try {
    if (typeof client.removeAllListeners === "function") client.removeAllListeners();
  } catch (_) {}

  client.on("ledgerClosed", function (ledger) {
    try {
      const idx = Number(ledger.ledger_index);
      if (!idx) return;

      // Always update lastLedgerIndex/time minimally so dashboard UI can show progress.
      if (idx > window.XRPL.lastLedgerIndex) {
        window.XRPL.lastLedgerIndex = idx;
        window.XRPL.lastLedgerTime = Date.now();
        // minimal state update
        window.XRPL.state.ledgerIndex = idx;
        window.XRPL.state.ledgerTime = new Date();
        updateHistory("ledgerHistory", idx);

        // Emit a lightweight event for immediate UI updates
        window.dispatchEvent(new CustomEvent("xrpl-ledger-closed", {
          detail: {
            ledgerIndex: idx,
            timestamp: window.XRPL.lastLedgerTime,
            server: window.XRPL.server?.name || null,
            network: window.XRPL.network
          }
        }));
      }

      // If processing paused or no consumers, skip heavy fetch (but still emitted lightweight event above)
      if (window.XRPL.processingPaused || getXRPLConsumerCount() === 0) {
        console.log("Skipping heavy ledger processing (paused or no consumers):", idx);
        return;
      }

      // Only fetch/process if it's newer than what we have
      if (idx <= window.XRPL.state.ledgerIndex) return;

      console.log("📨 ledgerClosed event (processing):", idx);
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
    handleDisconnection();
  });

  if (typeof client.on === "function") {
    client.on("close", (hadError) => { console.warn("WS close event", hadError); handleDisconnection(); });
  }
}

/* ---------- DISCONNECTION HANDLING ---------- */

function handleDisconnection() {
  if (!window.XRPL.connected) return;

  console.warn("🔌 Handling disconnection...");
  window.XRPL.connected = false;

  if (window.XRPL.ledgerPollInterval) {
    clearInterval(window.XRPL.ledgerPollInterval);
    window.XRPL.ledgerPollInterval = null;
  }

  updateConnectionStatus(false, "Disconnected");
  dispatchConnectionEvent();

  // Always reconnect
  window.XRPL.reconnectAttempts += 1;
  const delay = Math.min(
    3000 * window.XRPL.reconnectAttempts,
    10000
  );

  console.log(
    "🔄 Reconnecting in",
    delay,
    "ms (attempt",
    window.XRPL.reconnectAttempts,
    ")"
  );

  if (window.XRPL.reconnectTimeout) {
    clearTimeout(window.XRPL.reconnectTimeout);
  }

  window.XRPL.reconnectTimeout = setTimeout(function () {
    if (!window.XRPL.connected) {
      connectXRPL();
    }
  }, delay);
}

/* ---------- CONNECTION FAILURE (TRY AGAIN) ---------- */

function handleConnectionFailure() {
  console.warn("❌ All servers failed, retrying...");
  updateConnectionStatus(false, "Retrying...");
  setMode("connecting", "All servers failed, retrying");

  const delay = Math.min(
    5000 * (window.XRPL.reconnectAttempts + 1),
    30000
  );
  console.log("🔄 Retrying all servers in", delay, "ms");

  if (window.XRPL.reconnectTimeout) {
    clearTimeout(window.XRPL.reconnectTimeout);
  }

  window.XRPL.reconnectTimeout = setTimeout(function () {
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
      if (typeof window.XRPL.client.removeAllListeners === "function") window.XRPL.client.removeAllListeners();
      await window.XRPL.client.disconnect();
    } catch (e) {
      /* ignore */
    }
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

/* ---------- PUBLIC API ---------- */

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
  return (
    window.XRPL.connected &&
    Date.now() - window.XRPL.lastLedgerTime < 60000
  );
}

/* ---------- SHARED REQUEST WRAPPER (NEW) ---------- */
/*
  window.requestXrpl(payload, { timeoutMs })
  - Uses shared WS client when connected; attempts reconnect if needed.
  - Adds a timeout guard so callers don't hang forever.
*/
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

      const t = setTimeout(() => {
        window.removeEventListener("xrpl-connection", onConn);
        resolve(false);
      }, timeoutMs);
    } catch (_) {
      resolve(false);
    }
  });
}

window.requestXrpl = async function requestXrpl(payload, opts) {
  const options = opts || {};
  const timeoutMs = Number(options.timeoutMs || 20000);

  // ensure connection if possible
  if (!window.XRPL.client || !window.XRPL.connected) {
    try {
      connectXRPL();
      await waitForXRPLConnection(Math.min(15000, timeoutMs));
    } catch (_) {}
  }

  if (!window.XRPL.client) {
    throw new Error("XRPL client unavailable");
  }

  // Guard request with timeout
  const req = window.XRPL.client.request(payload);
  const timed = Promise.race([
    req,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Timeout")), timeoutMs)
    )
  ]);

  return timed;
};

/* ---------- INITIALIZATION ---------- */

document.addEventListener("DOMContentLoaded", function () {
  console.log(
    "🌊 Initializing XRPL connection on:",
    window.XRPL.network
  );

  if (typeof xrpl === "undefined") {
    console.error("❌ xrpl.js library not loaded!");
    updateConnectionStatus(false, "Library not loaded");
    return;
  }

  // Start connection shortly after load
  setTimeout(function () {
    connectXRPL();
  }, 500);
});

/* ---------- KEEP ALIVE ---------- */

setInterval(function () {
  if (!window.XRPL.connected && !window.XRPL.connecting) {
    console.log("💓 Keep-alive: Reconnecting...");
    connectXRPL();
  }
}, 30000); // Check every 30 seconds

/* ---------- EXPORTS ---------- */

window.connectXRPL = connectXRPL;
window.reconnectXRPL = reconnectXRPL;
window.getXRPLState = getXRPLState;
window.isXRPLConnected = isXRPLConnected;
window.setXRPLNetwork = setXRPLNetwork;

console.log(
  "🌊 XRPL Connection module loaded (Auto-reconnect + raw tx streaming enabled)"
);
