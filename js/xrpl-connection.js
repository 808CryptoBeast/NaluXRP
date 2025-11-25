/* =========================================
   NaluXrp 🌊 – XRPL Connection Module
   Always Connected - Automatic Reconnection
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
    txCountHistory: []
  },
  mode: "connecting",
  modeReason: "Initializing",
  network: "xrpl-mainnet"
};

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

  cleanupConnection().then(() => {
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
  
  console.log(`🌊 Connecting to ${window.XRPL.network}...`);
  updateConnectionStatus(false, "Connecting...");

  for (const server of servers) {
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
    console.log(`🔌 Trying ${server.name}...`);
    await cleanupConnection();

    window.XRPL.client = new xrpl.Client(server.url, {
      timeout: 10000,
      connectionTimeout: 15000
    });

    setupConnectionListeners();

    await Promise.race([
      window.XRPL.client.connect(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Timeout")), 15000)
      )
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
    safeNotify(`✅ Connected to ${server.name}`, "success");
    dispatchConnectionEvent();

    console.log(`✅ Connected to ${server.name}`);
    return true;
  } catch (err) {
    console.warn(`❌ ${server.name} failed: ${err.message}`);
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

  console.log(`📊 Initial: Ledger #${s.ledgerIndex}, ${s.txPerLedger} tx`);

  // Send initial state to dashboard
  sendStateToDashboard();
}

/* ---------- ACTIVE POLLING ---------- */
function startActivePolling() {
  if (window.XRPL.ledgerPollInterval) {
    clearInterval(window.XRPL.ledgerPollInterval);
  }

  window.XRPL.ledgerPollInterval = setInterval(async () => {
    if (!window.XRPL.connected || !window.XRPL.client) return;
    try {
      await checkForNewLedger();
    } catch (e) {
      console.warn("Polling error:", e.message);
    }
  }, 4000);

  setTimeout(() => checkForNewLedger(), 1000);
}

/* ---------- CHECK FOR NEW LEDGER ---------- */
async function checkForNewLedger() {
  if (!window.XRPL.connected || !window.XRPL.client) return;

  try {
    const resp = await window.XRPL.client.request({
      command: "server_info",
      timeout: 8000
    });

    const info = resp.result.info;
    const currentLedger = info.validated_ledger?.seq;

    if (!currentLedger) return;

    if (currentLedger > window.XRPL.lastLedgerIndex) {
      console.log(`🆕 New ledger: #${currentLedger}`);
      await fetchAndProcessLedger(currentLedger, info);
    } else {
      window.XRPL.lastLedgerTime = Date.now();
    }
  } catch (error) {
    console.warn("Check ledger error:", error.message);
    if (error.message.includes("timeout") || error.message.includes("closed")) {
      handleDisconnection();
    }
  }
}

/* ---------- FETCH & PROCESS LEDGER ---------- */
async function fetchAndProcessLedger(ledgerIndex, serverInfoHint = null) {
  if (!window.XRPL.client) return;

  try {
    console.log(`🔍 Fetching ledger #${ledgerIndex} with transactions...`);
    
    const ledgerResp = await window.XRPL.client.request({
      command: "ledger",
      ledger_index: ledgerIndex,
      transactions: true,
      expand: true,
      binary: false
    });

    console.log("📦 Raw ledger response:", ledgerResp);

    const ledgerData = ledgerResp.result.ledger;
    if (!ledgerData) {
      console.warn("⚠️ No ledger data in response");
      return;
    }

    console.log("📊 Ledger data structure:", {
      ledger_index: ledgerData.ledger_index,
      has_transactions: !!ledgerData.transactions,
      transactions_type: typeof ledgerData.transactions,
      transactions_length: Array.isArray(ledgerData.transactions) ? ledgerData.transactions.length : 'not an array',
      transaction_hash: ledgerData.transaction_hash,
      sample_transaction: ledgerData.transactions ? ledgerData.transactions[0] : null
    });

    const closeDate = ledgerData.close_time
      ? rippleTimeToDate(ledgerData.close_time)
      : new Date();

    const closeTimeSec = Math.floor(closeDate.getTime() / 1000);
    let durationSec = 4.0;
    if (window.XRPL.lastCloseTimeSec != null) {
      durationSec = Math.max(1, closeTimeSec - window.XRPL.lastCloseTimeSec);
    }
    window.XRPL.lastCloseTimeSec = closeTimeSec;

    const txMetrics = analyzeLedgerTransactions(ledgerData);
    const totalTx = txMetrics.totalTx;
    const tps = totalTx > 0 ? totalTx / durationSec : 0;

    console.log(`✅ Processed ledger #${ledgerIndex}: ${totalTx} transactions, ${tps.toFixed(2)} TPS`);

    const s = window.XRPL.state;
    s.ledgerIndex = Number(ledgerData.ledger_index || ledgerIndex);
    s.ledgerTime = closeDate;
    s.txPerLedger = totalTx;
    s.txnPerSec = tps;
    s.transactionTypes = { ...txMetrics.aggregatedTypes };

    if (txMetrics.avgFeeXRP > 0) {
      s.feeAvg = txMetrics.avgFeeXRP;
    }

    updateHistory("tpsHistory", tps);
    updateHistory("feeHistory", s.feeAvg);
    updateHistory("ledgerHistory", s.ledgerIndex);
    updateHistory("txCountHistory", totalTx);

    if (!Array.isArray(s.closeTimes)) s.closeTimes = [];
    s.closeTimes.push({
      label: `#${s.ledgerIndex}`,
      value: durationSec
    });
    if (s.closeTimes.length > 25) s.closeTimes.shift();

    window.XRPL.lastLedgerIndex = s.ledgerIndex;
    window.XRPL.lastLedgerTime = Date.now();

    let info = serverInfoHint;
    if (!info) {
      try {
        const resp = await window.XRPL.client.request({
          command: "server_info",
          timeout: 8000
        });
        info = resp.result.info;
      } catch {
        info = null;
      }
    }

    if (info) {
      s.feeAvg = info.validated_ledger?.base_fee_xrp || s.feeAvg;
      s.loadFee = (info.load_factor || 1000000) / 1000000;
      s.validators = info.peers || s.validators;
    }

    console.log(`📊 Ledger #${s.ledgerIndex} | ${totalTx} tx | ${durationSec.toFixed(2)}s | TPS ${tps.toFixed(2)}`);
    console.log("📈 Transaction types:", s.transactionTypes);

    // Send updated state to dashboard
    sendStateToDashboard();

  } catch (error) {
    console.warn("Fetch ledger error:", error.message);
  }
}

/* ---------- TRANSACTION ANALYSIS ---------- */
function analyzeLedgerTransactions(ledger) {
  const txs = ledger.transactions || [];
  
  console.log("🔍 Analyzing ledger transactions:", {
    ledgerIndex: ledger.ledger_index,
    transactionsLength: txs.length,
    firstTransaction: txs[0],
    firstTransactionKeys: txs[0] ? Object.keys(txs[0]) : []
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

  const classify = (txType) => {
    if (!txType) return "Other";
    if (txType === "Payment") return "Payment";
    if (txType === "OfferCreate" || txType === "OfferCancel" || txType.startsWith("AMM")) {
      return "Offer";
    }
    if (txType.startsWith("NFToken") || txType.startsWith("NFT")) {
      return "NFT";
    }
    if (txType === "TrustSet") return "TrustSet";
    return "Other";
  };

  for (let i = 0; i < txs.length; i++) {
    const entry = txs[i];
    
    if (!entry || typeof entry !== "object") {
      console.warn(`⚠️ Transaction ${i}: not an object`, entry);
      continue;
    }

    // The transaction data can be in different places depending on the response format
    let tx = null;
    let meta = null;

    // Check if it's in tx_json (this is the actual format!)
    if (entry.tx_json && typeof entry.tx_json === 'object') {
      tx = entry.tx_json;
      meta = entry.meta || entry.metaData || null;
      if (i < 2) console.log(`✅ Transaction ${i}: Found in entry.tx_json`, tx.TransactionType);
    }
    // Check if it's already a transaction object (has TransactionType at top level)
    else if (entry.TransactionType) {
      tx = entry;
      meta = entry.meta || entry.metaData || null;
      if (i < 2) console.log(`✅ Transaction ${i}: Found TransactionType at top level`);
    }
    // Check if transaction is nested in 'tx' property
    else if (entry.tx && typeof entry.tx === 'object' && entry.tx.TransactionType) {
      tx = entry.tx;
      meta = entry.meta || entry.metaData || null;
      if (i < 2) console.log(`✅ Transaction ${i}: Found in entry.tx`);
    }
    // Check if it's in the transaction property
    else if (entry.transaction && typeof entry.transaction === 'object' && entry.transaction.TransactionType) {
      tx = entry.transaction;
      meta = entry.meta || entry.metaData || null;
      if (i < 2) console.log(`✅ Transaction ${i}: Found in entry.transaction`);
    }
    else {
      if (i < 2) {
        console.warn(`⚠️ Transaction ${i}: Cannot find transaction data. Keys:`, Object.keys(entry), entry);
      }
      continue;
    }

    if (!tx || !tx.TransactionType) {
      if (i < 2) {
        console.warn(`⚠️ Transaction ${i}: No valid TransactionType found`, tx);
      }
      continue;
    }

    totalTx++;

    const cat = classify(tx.TransactionType);
    if (!aggregatedTypes[cat]) aggregatedTypes[cat] = 0;
    aggregatedTypes[cat]++;

    if (meta && typeof meta.TransactionResult === "string") {
      if (meta.TransactionResult.startsWith("tes")) successCount++;
    } else {
      successCount++;
    }

    if (tx.Fee != null) {
      const feeDrops = Number(tx.Fee);
      if (!Number.isNaN(feeDrops)) {
        totalFeeDrops += feeDrops;
      }
    }
  }

  const avgFeeXRP =
    totalTx > 0 && totalFeeDrops > 0
      ? totalFeeDrops / 1_000_000 / totalTx
      : 0;

  const successRate =
    totalTx > 0 ? (successCount / totalTx) * 100 : 100;

  const result = {
    totalTx,
    aggregatedTypes,
    avgFeeXRP,
    successRate
  };

  console.log("📊 Transaction analysis result:", result);

  return result;
}

/* ---------- SEND STATE TO DASHBOARD ---------- */
function sendStateToDashboard() {
  const s = window.XRPL.state;
  
  console.log("📨 Sending XRPL state to dashboard:", {
    ledgerIndex: s.ledgerIndex,
    txPerLedger: s.txPerLedger,
    transactionTypes: s.transactionTypes
  });

  // Ensure transactionTypes is properly formatted
  const txTypes = {
    Payment: s.transactionTypes.Payment || 0,
    Offer: s.transactionTypes.Offer || 0,
    OfferCreate: 0, // These are already aggregated into Offer
    OfferCancel: 0,
    NFT: s.transactionTypes.NFT || 0,
    NFTokenMint: 0, // These are already aggregated into NFT
    NFTokenBurn: 0,
    TrustSet: s.transactionTypes.TrustSet || 0,
    Other: s.transactionTypes.Other || 0
  };

  console.log("🎯 Formatted txTypes for dashboard:", txTypes);

  // Build dashboard state
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
      geoDiversity: "—",
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
    latency: {
      avgMs: 0,
      fastShare: 0.7,
      mediumShare: 0.2,
      slowShare: 0.1,
    },
    orderbook: [],
    gateways: [],
    latestLedger: {
      ledgerIndex: s.ledgerIndex,
      closeTime: s.ledgerTime || new Date(),
      totalTx: s.txPerLedger,
      txTypes: { ...txTypes }, // Use the formatted txTypes
      avgFee: s.feeAvg,
      successRate: 99.9,
    },
  };

  console.log("📦 Complete dashboard state:", dashboardState);
  console.log("🎴 Latest ledger card data:", dashboardState.latestLedger);

  // Send to dashboard
  if (window.NaluDashboard && typeof window.NaluDashboard.applyXRPLState === "function") {
    console.log("🔄 Calling NaluDashboard.applyXRPLState");
    window.NaluDashboard.applyXRPLState(dashboardState);
  }

  // Also dispatch event for other listeners
  window.dispatchEvent(
    new CustomEvent("xrpl-ledger", {
      detail: { ...window.XRPL.state }
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
      if (!idx || idx <= window.XRPL.lastLedgerIndex) return;
      console.log("📨 Ledger closed:", idx);
      fetchAndProcessLedger(idx, null);
    } catch (e) {
      console.warn("Ledger closed handler error:", e.message);
    }
  });

  client.on("error", (error) => {
    console.warn("🔌 WebSocket error:", error.message);
  });

  client.on("disconnected", (code) => {
    console.warn(`🔌 Disconnected (code ${code})`);
    handleDisconnection();
  });
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
  window.XRPL.reconnectAttempts++;
  const delay = Math.min(3000 * window.XRPL.reconnectAttempts, 10000);

  console.log(`🔄 Reconnecting in ${delay}ms (attempt ${window.XRPL.reconnectAttempts})`);
  
  if (window.XRPL.reconnectTimeout) {
    clearTimeout(window.XRPL.reconnectTimeout);
  }

  window.XRPL.reconnectTimeout = setTimeout(() => {
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
  
  // Retry after delay
  const delay = Math.min(5000 * (window.XRPL.reconnectAttempts + 1), 30000);
  console.log(`🔄 Retrying all servers in ${delay}ms`);
  
  if (window.XRPL.reconnectTimeout) {
    clearTimeout(window.XRPL.reconnectTimeout);
  }

  window.XRPL.reconnectTimeout = setTimeout(() => {
    window.XRPL.reconnectAttempts++;
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
function updateConnectionStatus(connected, serverName = "") {
  const dot = document.getElementById("connDot");
  const text = document.getElementById("connText");

  if (!dot || !text) return;

  if (connected) {
    dot.classList.add("live");
    text.textContent = `LIVE — ${serverName || "XRPL"}`;
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
  return await connectXRPL();
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
  return window.XRPL.connected && Date.now() - window.XRPL.lastLedgerTime < 60000;
}

/* ---------- INITIALIZATION ---------- */
document.addEventListener("DOMContentLoaded", () => {
  console.log("🌊 Initializing XRPL connection on:", window.XRPL.network);

  if (typeof xrpl === "undefined") {
    console.error("❌ xrpl.js library not loaded!");
    updateConnectionStatus(false, "Library not loaded");
    return;
  }

  // Start connection immediately
  setTimeout(() => connectXRPL(), 500);
});

/* ---------- KEEP ALIVE ---------- */
setInterval(() => {
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

console.log("🌊 XRPL Connection module loaded (Auto-reconnect enabled)");