/* =========================================
   NaluXrp 🌊 – Active XRPL Connection Module
   Handles missing ledger events with active polling
   ========================================= */

// Global XRPL State
window.XRPL = {
  client: null,
  connected: false,
  server: null,
  reconnectAttempts: 0,
  maxReconnectAttempts: 2,
  lastLedgerTime: Date.now(),
  lastLedgerIndex: 0,
  ledgerPollInterval: null,
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
      Payment: 0, OfferCreate: 0, OfferCancel: 0, TrustSet: 0, AccountSet: 0, Other: 0
    },
    tpsHistory: [], feeHistory: [], ledgerHistory: [], txCountHistory: []
  }
};

// Server list with notes about reliability
const XRPL_SERVERS = [
  { url: 'wss://xrplcluster.com', name: 'XRPL Cluster' },
  { url: 'wss://s2.ripple.com', name: 'Ripple S2' },
  { url: 'wss://s1.ripple.com', name: 'Ripple S1' },
  { url: 'wss://xrpl.link', name: 'XRPL Link' }
];

/* ---------- CONNECTION WITH ACTIVE POLLING ---------- */
async function connectXRPL() {
  if (window.XRPL.connecting) return;
  window.XRPL.connecting = true;
  
  for (const server of XRPL_SERVERS) {
    if (await attemptConnection(server)) {
      window.XRPL.connecting = false;
      return true;
    }
  }
  
  window.XRPL.connecting = false;
  handleConnectionFailure();
  return false;
}

/* ---------- IMPROVED CONNECTION ATTEMPT ---------- */
async function attemptConnection(server) {
  try {
    console.log(`🌊 Connecting to ${server.name} (${server.url})...`);
    
    await cleanupConnection();
    
    window.XRPL.client = new xrpl.Client(server.url, {
      timeout: 10000,
      connectionTimeout: 15000
    });
    
    setupConnectionListeners();
    
    // Connect with timeout
    await Promise.race([
      window.XRPL.client.connect(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Connection timeout')), 15000)
      )
    ]);
    
    // Verify connection and get initial state
    const serverInfo = await verifyConnectionAndSubscribe();
    
    if (!serverInfo) {
      throw new Error('Failed to get initial server state');
    }
    
    window.XRPL.connected = true;
    window.XRPL.server = server;
    window.XRPL.reconnectAttempts = 0;
    
    // Set initial state from server info
    updateInitialState(serverInfo);
    
    updateConnectionStatus(true, server.name);
    
    // Start active polling for ledger updates
    startActivePolling();
    
    console.log(`✅ Connected to ${server.name}, starting active monitoring`);
    showNotification(`Connected to ${server.name}`, 'success');
    
    return true;
    
  } catch (err) {
    console.warn(`❌ Failed to connect to ${server.name}:`, err.message);
    await cleanupConnection();
    updateConnectionStatus(false);
    return false;
  }
}

/* ---------- VERIFY CONNECTION AND SUBSCRIBE ---------- */
async function verifyConnectionAndSubscribe() {
  try {
    // Get server info to verify connection and get current ledger
    const response = await window.XRPL.client.request({
      command: 'server_info',
      timeout: 10000
    });
    
    if (!response.result.info) {
      throw new Error('Invalid server response');
    }
    
    const info = response.result.info;
    
    // Try to subscribe to ledger stream
    try {
      const subscribeResponse = await window.XRPL.client.request({
        command: 'subscribe',
        streams: ['ledger']
      });
      
      if (subscribeResponse.result.status === 'success') {
        console.log('✅ Subscribed to ledger stream');
      }
    } catch (subscribeError) {
      console.warn('⚠️ Could not subscribe to ledger stream, using polling:', subscribeError.message);
    }
    
    return info;
    
  } catch (error) {
    throw new Error('Connection verification failed: ' + error.message);
  }
}

/* ---------- UPDATE INITIAL STATE ---------- */
function updateInitialState(serverInfo) {
  const info = serverInfo;
  
  if (info.validated_ledger) {
    window.XRPL.state.ledgerIndex = info.validated_ledger.seq;
    window.XRPL.lastLedgerIndex = info.validated_ledger.seq;
    window.XRPL.state.ledgerTime = new Date();
  }
  
  window.XRPL.state.feeAvg = info.validated_ledger?.base_fee_xrp || 0.00001;
  window.XRPL.state.loadFee = (info.load_factor || 1000000) / 1000000;
  window.XRPL.state.validators = info.peers || 0;
  window.XRPL.state.quorum = info.validation_quorum || 0.8;
  
  // Initialize with realistic data
  window.XRPL.state.txPerLedger = info.validated_ledger?.txn_count || 45;
  window.XRPL.state.txnPerSec = (window.XRPL.state.txPerLedger / 3.5).toFixed(1);
  estimateTransactionTypes(window.XRPL.state.txPerLedger);
  
  console.log(`📊 Initial state: Ledger #${window.XRPL.state.ledgerIndex}, ${window.XRPL.state.txPerLedger} transactions`);
}

/* ---------- ACTIVE LEDGER POLLING ---------- */
function startActivePolling() {
  // Clear any existing interval
  if (window.XRPL.ledgerPollInterval) {
    clearInterval(window.XRPL.ledgerPollInterval);
  }
  
  // Poll for new ledgers every 4 seconds (slightly faster than ledger close)
  window.XRPL.ledgerPollInterval = setInterval(async () => {
    if (!window.XRPL.connected || !window.XRPL.client) return;
    
    try {
      await checkForNewLedger();
    } catch (error) {
      console.warn('Polling error:', error.message);
    }
  }, 4000);
  
  // Also do an immediate check
  setTimeout(() => checkForNewLedger(), 1000);
}

/* ---------- CHECK FOR NEW LEDGER ---------- */
async function checkForNewLedger() {
  if (!window.XRPL.connected || !window.XRPL.client) return;
  
  try {
    const response = await window.XRPL.client.request({
      command: 'server_info',
      timeout: 8000
    });
    
    const info = response.result.info;
    const currentLedger = info.validated_ledger?.seq;
    
    if (!currentLedger) return;
    
    // Check if we have a new ledger
    if (currentLedger > window.XRPL.lastLedgerIndex) {
      console.log(`🆕 New ledger detected: #${currentLedger} (was #${window.XRPL.lastLedgerIndex})`);
      
      // Simulate ledger closed event
      const simulatedLedger = {
        ledger_index: currentLedger,
        ledger_time: Math.floor(Date.now() / 1000),
        txn_count: info.validated_ledger?.txn_count || window.XRPL.state.txPerLedger
      };
      
      handleLedger(simulatedLedger);
      
    } else if (currentLedger === window.XRPL.lastLedgerIndex) {
      // Same ledger, update timestamp
      window.XRPL.lastLedgerTime = Date.now();
    }
    
    // Update server info periodically
    updateServerInfo(info);
    
  } catch (error) {
    console.warn('Error checking for new ledger:', error.message);
    // If we can't get server_info, connection might be broken
    if (error.message.includes('timeout') || error.message.includes('closed')) {
      handleDisconnection();
    }
  }
}

/* ---------- UPDATE SERVER INFO ---------- */
function updateServerInfo(info) {
  if (info.validated_ledger) {
    window.XRPL.state.feeAvg = info.validated_ledger.base_fee_xrp || 0.00001;
    window.XRPL.state.loadFee = (info.load_factor || 1000000) / 1000000;
    window.XRPL.state.validators = info.peers || 0;
    
    updateHistory('feeHistory', window.XRPL.state.feeAvg);
  }
}

/* ---------- ENHANCED CONNECTION LISTENERS ---------- */
function setupConnectionListeners() {
  if (!window.XRPL.client) return;
  
  window.XRPL.client.removeAllListeners();
  
  // Still listen for ledger events in case they work
  window.XRPL.client.on('ledgerClosed', (ledger) => {
    console.log('📨 Received ledger event via WebSocket');
    window.XRPL.lastLedgerTime = Date.now();
    handleLedger(ledger);
  });
  
  window.XRPL.client.on('error', (error) => {
    console.warn('🔌 WebSocket error:', error.message);
  });
  
  window.XRPL.client.on('disconnected', (code) => {
    console.warn(`🔌 WebSocket disconnected with code: ${code}`);
    handleDisconnection();
  });
}

/* ---------- HANDLE LEDGER UPDATE ---------- */
function handleLedger(ledger) {
  if (!window.XRPL.connected) return;
  
  try {
    // Update state
    window.XRPL.state.ledgerIndex = ledger.ledger_index;
    window.XRPL.lastLedgerIndex = ledger.ledger_index;
    window.XRPL.state.ledgerTime = new Date();
    window.XRPL.state.txPerLedger = ledger.txn_count;
    window.XRPL.state.txnPerSec = (ledger.txn_count / 3.5).toFixed(1);
    
    // Update transaction types
    estimateTransactionTypes(ledger.txn_count);
    
    // Update histories
    updateHistory('tpsHistory', window.XRPL.state.txnPerSec);
    updateHistory('ledgerHistory', ledger.ledger_index);
    updateHistory('txCountHistory', ledger.txn_count);
    
    window.XRPL.lastLedgerTime = Date.now();
    
    console.log(`📊 Ledger #${ledger.ledger_index} with ${ledger.txn_count} tx`);
    
    // Dispatch event for dashboard
    window.dispatchEvent(new CustomEvent('xrpl-ledger', {
      detail: { ...window.XRPL.state }
    }));
    
  } catch (error) {
    console.error('Error in ledger handler:', error);
  }
}

/* ---------- REALISTIC TRANSACTION ESTIMATION ---------- */
function estimateTransactionTypes(totalTransactions) {
  if (!totalTransactions || totalTransactions === 0) {
    Object.keys(window.XRPL.state.transactionTypes).forEach(key => {
      window.XRPL.state.transactionTypes[key] = 0;
    });
    return;
  }
  
  // Updated distribution based on recent XRPL mainnet patterns
  const distribution = {
    Payment: Math.max(1, Math.round(totalTransactions * 0.70)),
    OfferCreate: Math.max(0, Math.round(totalTransactions * 0.12)),
    OfferCancel: Math.max(0, Math.round(totalTransactions * 0.04)),
    TrustSet: Math.max(0, Math.round(totalTransactions * 0.03)),
    AccountSet: Math.max(0, Math.round(totalTransactions * 0.02)),
    Other: Math.max(0, Math.round(totalTransactions * 0.09))
  };
  
  // Update state
  Object.keys(distribution).forEach(type => {
    if (window.XRPL.state.transactionTypes.hasOwnProperty(type)) {
      window.XRPL.state.transactionTypes[type] = distribution[type];
    }
  });
  
  // Ensure total matches
  const currentTotal = Object.values(window.XRPL.state.transactionTypes).reduce((a, b) => a + b, 0);
  if (currentTotal !== totalTransactions) {
    const diff = totalTransactions - currentTotal;
    window.XRPL.state.transactionTypes.Other = Math.max(0, window.XRPL.state.transactionTypes.Other + diff);
  }
}

/* ---------- DISCONNECTION HANDLING ---------- */
function handleDisconnection() {
  if (!window.XRPL.connected) return;
  
  console.warn('🔌 Handling disconnection...');
  window.XRPL.connected = false;
  
  // Stop polling
  if (window.XRPL.ledgerPollInterval) {
    clearInterval(window.XRPL.ledgerPollInterval);
    window.XRPL.ledgerPollInterval = null;
  }
  
  updateConnectionStatus(false);
  
  // Attempt reconnection
  if (window.XRPL.reconnectAttempts < window.XRPL.maxReconnectAttempts) {
    window.XRPL.reconnectAttempts++;
    const delay = Math.min(3000 * window.XRPL.reconnectAttempts, 10000);
    
    console.log(`🔄 Reconnecting in ${delay}ms (attempt ${window.XRPL.reconnectAttempts})`);
    
    setTimeout(() => {
      if (!window.XRPL.connected) {
        connectXRPL();
      }
    }, delay);
  } else {
    console.log('💤 Max reconnection attempts reached');
    showNotification('Disconnected from XRPL. Click status to reconnect.', 'warning', 0);
  }
}

/* ---------- CLEANUP ---------- */
async function cleanupConnection() {
  // Stop polling
  if (window.XRPL.ledgerPollInterval) {
    clearInterval(window.XRPL.ledgerPollInterval);
    window.XRPL.ledgerPollInterval = null;
  }
  
  // Disconnect client
  if (window.XRPL.client) {
    try {
      window.XRPL.client.removeAllListeners();
      await window.XRPL.client.disconnect();
    } catch (e) {
      // Ignore errors during cleanup
    }
    window.XRPL.client = null;
  }
  
  window.XRPL.connected = false;
}

/* ---------- CONNECTION STATUS ---------- */
function updateConnectionStatus(connected, serverName = '') {
  const dot = document.getElementById('statusDot');
  const text = document.getElementById('connectionStatus');
  
  if (!dot || !text) return;
  
  if (connected) {
    dot.classList.add('active');
    text.textContent = `LIVE – ${serverName}`;
    text.style.color = '#50fa7b';
    text.style.cursor = 'default';
    text.onclick = null;
  } else {
    dot.classList.remove('active');
    text.textContent = 'DISCONNECTED';
    text.style.color = '#ff5555';
    text.style.cursor = 'pointer';
    text.title = 'Click to reconnect to XRPL';
    text.onclick = reconnectXRPL;
  }
}

/* ---------- MANUAL RECONNECTION ---------- */
async function reconnectXRPL() {
  console.log('🔄 Manual reconnection initiated');
  showNotification('Reconnecting to XRPL...', 'info');
  
  window.XRPL.reconnectAttempts = 0;
  return await connectXRPL();
}

/* ---------- HELPER FUNCTIONS ---------- */
function updateHistory(key, value, maxLength = 25) {
  const numValue = parseFloat(value) || 0;
  window.XRPL.state[key].push(numValue);
  if (window.XRPL.state[key].length > maxLength) {
    window.XRPL.state[key].shift();
  }
}

/* ---------- PUBLIC API ---------- */
function getXRPLState() {
  return {
    ...window.XRPL.state,
    connected: window.XRPL.connected,
    server: window.XRPL.server?.name || 'Unknown',
    lastUpdate: window.XRPL.lastLedgerTime
  };
}

function isXRPLConnected() {
  // Consider connected if we've had an update in the last 60 seconds
  return window.XRPL.connected && (Date.now() - window.XRPL.lastLedgerTime) < 60000;
}

/* ---------- INITIALIZATION ---------- */
document.addEventListener('DOMContentLoaded', async () => {
  console.log('🌊 Initializing XRPL connection with active polling...');
  
  if (typeof xrpl === 'undefined') {
    console.error('❌ xrpl.js library not loaded');
    updateConnectionStatus(false);
    initializeSimulatedData();
    return;
  }
  
  // Start connection after short delay
  setTimeout(() => connectXRPL(), 1500);
});

/* ---------- SIMULATED DATA FALLBACK ---------- */
function initializeSimulatedData() {
  console.log('🔧 Initializing with simulated data');
  window.XRPL.state.ledgerIndex = 84563210;
  window.XRPL.state.txPerLedger = 45;
  window.XRPL.state.txnPerSec = '12.8';
  estimateTransactionTypes(45);
}

/* ---------- EXPORTS ---------- */
window.connectXRPL = connectXRPL;
window.reconnectXRPL = reconnectXRPL;
window.getXRPLState = getXRPLState;
window.isXRPLConnected = isXRPLConnected;

console.log('🌊 Active XRPL Connection module loaded');