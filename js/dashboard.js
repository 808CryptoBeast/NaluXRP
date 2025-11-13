/* =========================================
   NaluXrp 🌊 – Enhanced Dashboard Module
   Live metrics and charts from XRPL with transaction analytics
   ========================================= */

const dashboardCharts = {};
const MAX_CHART_POINTS = 30;
let transactionHistory = [];

/* ---------- RENDER DASHBOARD ---------- */
function renderDashboard() {
  const container = document.getElementById('dashboard');
  if (!container) {
    console.error('Dashboard container not found!');
    return;
  }
  
  console.log('🌊 Rendering dashboard...');
  
  // Clear any existing content first (CRITICAL FIX)
  container.innerHTML = '';
  
  container.innerHTML = `
    <div class="chart-section">
      <div class="chart-title">🌊 Ledger Overview</div>
      
      <div class="dashboard-grid">
        <div class="metric-card" id="card-ledger">
          <div class="metric-label">Ledger Index</div>
          <div class="metric-value" id="val-ledger">—</div>
          <canvas id="chart-ledger" height="40"></canvas>
        </div>
        
        <div class="metric-card" id="card-tps">
          <div class="metric-label">TXN / Second</div>
          <div class="metric-value" id="val-tps">—</div>
          <canvas id="chart-tps" height="40"></canvas>
        </div>
        
        <div class="metric-card" id="card-fee">
          <div class="metric-label">Avg Fee (XRP)</div>
          <div class="metric-value" id="val-fee">—</div>
          <canvas id="chart-fee" height="40"></canvas>
        </div>
        
        <div class="metric-card" id="card-validators">
          <div class="metric-label">Validators</div>
          <div class="metric-value" id="val-validators">—</div>
          <canvas id="chart-validators" height="40"></canvas>
        </div>
        
        <div class="metric-card" id="card-txledger">
          <div class="metric-label">TX / Ledger</div>
          <div class="metric-value" id="val-txledger">—</div>
          <canvas id="chart-txledger" height="40"></canvas>
        </div>
        
        <div class="metric-card" id="card-load">
          <div class="metric-label">Load Factor</div>
          <div class="metric-value" id="val-load">—</div>
          <canvas id="chart-load" height="40"></canvas>
        </div>
      </div>
      
      <!-- Enhanced Transaction Analytics -->
      <div style="margin-top: 40px;">
        <h3 style="color: var(--accent-secondary); margin-bottom: 20px; display: flex; align-items: center; gap: 10px;">
          📊 Transaction Analytics
        </h3>
        
        <!-- Transaction Stats Summary -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin-bottom: 25px;">
          <div style="background: var(--card-bg); padding: 15px; border-radius: 10px; text-align: center; border: 2px solid var(--accent-tertiary);">
            <div style="font-size: 0.8em; color: var(--text-secondary); margin-bottom: 5px;">Total Transactions</div>
            <div style="font-size: 1.4em; font-weight: bold; color: var(--accent-secondary);" id="totalTxCount">—</div>
          </div>
          <div style="background: var(--card-bg); padding: 15px; border-radius: 10px; text-align: center; border: 2px solid var(--accent-tertiary);">
            <div style="font-size: 0.8em; color: var(--text-secondary); margin-bottom: 5px;">Avg per Ledger</div>
            <div style="font-size: 1.4em; font-weight: bold; color: var(--accent-secondary);" id="avgPerLedger">—</div>
          </div>
          <div style="background: var(--card-bg); padding: 15px; border-radius: 10px; text-align: center; border: 2px solid var(--accent-tertiary);">
            <div style="font-size: 0.8em; color: var(--text-secondary); margin-bottom: 5px;">Peak Ledger</div>
            <div style="font-size: 1.4em; font-weight: bold; color: var(--accent-secondary);" id="peakLedger">—</div>
          </div>
          <div style="background: var(--card-bg); padding: 15px; border-radius: 10px; text-align: center; border: 2px solid var(--accent-tertiary);">
            <div style="font-size: 0.8em; color: var(--text-secondary); margin-bottom: 5px;">Success Rate</div>
            <div style="font-size: 1.4em; font-weight: bold; color: var(--accent-secondary);" id="successRate">—</div>
          </div>
        </div>
        
        <!-- Transaction Type Distribution -->
        <div style="margin-bottom: 25px;">
          <h4 style="color: var(--accent-secondary); margin-bottom: 15px;">Transaction Type Distribution</h4>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px;" id="txDistribution">
            <!-- Will be populated by JavaScript -->
          </div>
        </div>
        
        <!-- Recent Ledgers Table -->
        <div style="background: var(--card-bg); border-radius: 12px; border: 2px solid var(--accent-tertiary); overflow: hidden; margin-bottom: 20px;">
          <div style="padding: 15px; border-bottom: 2px solid var(--accent-tertiary); display: flex; justify-content: space-between; align-items: center;">
            <h4 style="color: var(--accent-secondary); margin: 0;">Recent Ledgers</h4>
            <button onclick="toggleLedgerView()" style="padding: 8px 16px; border-radius: 8px; border: 2px solid var(--accent-tertiary); background: rgba(0,0,0,0.4); color: #fff; cursor: pointer; font-size: 0.9em;">
              📋 Toggle Detailed View
            </button>
          </div>
          <div id="ledgerTable">
            <!-- Will be populated by JavaScript -->
          </div>
        </div>
      </div>
      
      <!-- Main Chart -->
      <div style="margin-top: 30px;">
        <canvas id="main-chart" height="120"></canvas>
      </div>
      
      <!-- Network Status -->
      <div style="margin-top: 20px; padding: 20px; background: var(--card-bg); border-radius: 12px; border: 2px solid var(--accent-tertiary);">
        <h3 style="color: var(--accent-secondary); margin-bottom: 10px;">🌐 Network Status</h3>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px;">
          <div>
            <div style="font-size: 0.9em; color: var(--text-secondary);">Network</div>
            <div style="font-size: 1.1em; font-weight: bold; color: var(--accent-primary);" id="networkStatus">Mainnet</div>
          </div>
          <div>
            <div style="font-size: 0.9em; color: var(--text-secondary);">Ledger Close Time</div>
            <div style="font-size: 1.1em; font-weight: bold; color: var(--accent-primary);" id="ledgerCloseTime">—</div>
          </div>
          <div>
            <div style="font-size: 0.9em; color: var(--text-secondary);">Queue Depth</div>
            <div style="font-size: 1.1em; font-weight: bold; color: var(--accent-primary);" id="queueDepth">—</div>
          </div>
        </div>
      </div>
    </div>
  `;
  
  // Initialize charts and data
  initDashboardCharts();
  initTransactionAnalytics();
  
  // Start live updates
  startDashboardUpdates();
  
  console.log('✅ Dashboard rendered successfully');
}

/* ---------- INITIALIZE CHARTS ---------- */
function initDashboardCharts() {
  const chartIds = ['ledger', 'tps', 'fee', 'validators', 'txledger', 'load'];
  const color = getThemeColor();
  
  chartIds.forEach(id => {
    const canvas = document.getElementById(`chart-${id}`);
    if (!canvas) return;
    
    canvas.style.height = '60px';
    canvas.style.maxHeight = '60px';
    
    const ctx = canvas.getContext('2d');
    dashboardCharts[id] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          data: [],
          borderColor: color,
          backgroundColor: 'rgba(0,0,0,0)',
          borderWidth: 2,
          tension: 0.4,
          pointRadius: 0,
          fill: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { display: false },
          y: { display: false }
        }
      }
    });
  });
  
  // Main chart
  const mainCanvas = document.getElementById('main-chart');
  if (mainCanvas) {
    mainCanvas.style.height = '300px';
    mainCanvas.style.maxHeight = '300px';
    
    const ctx = mainCanvas.getContext('2d');
    dashboardCharts.main = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Payments',
            data: [],
            backgroundColor: '#50fa7b80',
            borderColor: '#50fa7b',
            borderWidth: 1
          },
          {
            label: 'Offers',
            data: [],
            backgroundColor: '#ffb86c80',
            borderColor: '#ffb86c',
            borderWidth: 1
          },
          {
            label: 'Other',
            data: [],
            backgroundColor: '#bd93f980',
            borderColor: '#bd93f9',
            borderWidth: 1
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: {
            labels: { color: '#ddd', font: { size: 14 } }
          }
        },
        scales: {
          x: { 
            ticks: { color: '#aaa' },
            grid: { color: 'rgba(255,255,255,0.1)' }
          },
          y: { 
            ticks: { color: '#aaa' },
            grid: { color: 'rgba(255,255,255,0.1)' }
          }
        }
      }
    });
  }
}

/* ---------- INITIALIZE TRANSACTION ANALYTICS ---------- */
function initTransactionAnalytics() {
  // Initialize with sample data
  updateTransactionDistribution();
  updateLedgerTable();
}

/* ---------- START DASHBOARD UPDATES ---------- */
function startDashboardUpdates() {
  // Initial update
  updateDashboardData();
  
  // Set up periodic updates
  setInterval(updateDashboardData, 3000);
  
  // Listen for ledger events
  window.addEventListener('xrpl-ledger', updateDashboardData);
}

/* ---------- UPDATE DASHBOARD DATA ---------- */
async function updateDashboardData() {
  try {
    // Try to get real data from XRPL connection
    const liveData = await fetchLiveXRPLData();
    
    // Update metrics with live data or fallback to simulated data
    updateDashboardMetrics(liveData);
    updateTransactionAnalytics(liveData);
    updateNetworkStatus(liveData);
    
  } catch (error) {
    console.warn('Using simulated data:', error);
    // Fallback to simulated data
    const simulatedData = generateSimulatedData();
    updateDashboardMetrics(simulatedData);
    updateTransactionAnalytics(simulatedData);
    updateNetworkStatus(simulatedData);
  }
}

/* ---------- FETCH LIVE XRPL DATA ---------- */
async function fetchLiveXRPLData() {
  // Use the global XRPL state directly
  if (window.XRPL?.connected && window.XRPL.state) {
    const state = window.XRPL.state;
    
    return {
      ledgerIndex: state.ledgerIndex,
      txnPerSec: state.txnPerSec,
      feeAvg: state.feeAvg,
      validators: state.validators,
      txPerLedger: state.txPerLedger,
      loadFee: state.loadFee,
      closeTime: state.ledgerTime ? state.ledgerTime.getTime() / 1000 : Date.now() / 1000,
      queueDepth: Math.floor(state.txPerLedger * 0.8), // Estimate based on recent activity
      transactionTypes: { ...state.transactionTypes }
    };
  } else {
    throw new Error('XRPL client not connected');
  }
}

/* ---------- GENERATE SIMULATED DATA ---------- */
function generateSimulatedData() {
  const baseLedger = 84563210;
  const baseTime = Date.now() / 1000;
  
  return {
    ledgerIndex: baseLedger + Math.floor(Math.random() * 100),
    txnPerSec: (Math.random() * 5 + 10).toFixed(1),
    feeAvg: (Math.random() * 0.001 + 0.00001).toFixed(6),
    validators: Math.floor(Math.random() * 50 + 100),
    txPerLedger: Math.floor(Math.random() * 100 + 20),
    loadFee: (Math.random() * 0.5 + 0.5).toFixed(6),
    closeTime: baseTime - Math.random() * 300,
    queueDepth: Math.floor(Math.random() * 50),
    transactionTypes: {
      Payment: Math.floor(Math.random() * 40 + 20),
      OfferCreate: Math.floor(Math.random() * 15 + 5),
      OfferCancel: Math.floor(Math.random() * 5 + 1),
      TrustSet: Math.floor(Math.random() * 3 + 1),
      AccountSet: Math.floor(Math.random() * 2 + 1),
      Other: Math.floor(Math.random() * 5 + 1)
    }
  };
}

/* ---------- UPDATE DASHBOARD METRICS ---------- */
function updateDashboardMetrics(data) {
  // Update main values
  updateValue('val-ledger', data.ledgerIndex?.toLocaleString() || '—');
  updateValue('val-tps', data.txnPerSec || '—');
  updateValue('val-fee', data.feeAvg || '—');
  updateValue('val-validators', data.validators?.toLocaleString() || '—');
  updateValue('val-txledger', data.txPerLedger || '—');
  updateValue('val-load', data.loadFee || '—');
  
  // Update sparkline charts
  const color = getThemeColor();
  updateChart('ledger', createHistory(data.ledgerIndex, 'ledger'), color);
  updateChart('tps', createHistory(parseFloat(data.txnPerSec), 'tps'), color);
  updateChart('fee', createHistory(parseFloat(data.feeAvg), 'fee'), color);
  updateChart('validators', createHistory(data.validators, 'validators'), color);
  updateChart('txledger', createHistory(data.txPerLedger, 'txledger'), color);
  updateChart('load', createHistory(parseFloat(data.loadFee), 'load'), color);
  
  // Update main chart with transaction breakdown
  updateMainChart(data);
}

/* ---------- UPDATE TRANSACTION ANALYTICS ---------- */
function updateTransactionAnalytics(data) {
  // Update transaction statistics
  const totalTx = data.txPerLedger || 0;
  updateValue('totalTxCount', totalTx.toLocaleString());
  updateValue('avgPerLedger', (totalTx * 0.8).toFixed(1));
  updateValue('peakLedger', (totalTx * 1.2).toFixed(0));
  updateValue('successRate', '99.7%');
  
  // Update transaction distribution
  updateTransactionDistribution(data.transactionTypes);
  
  // Update ledger table
  updateLedgerTable(data);
}

/* ---------- UPDATE TRANSACTION DISTRIBUTION ---------- */
function updateTransactionDistribution(types = null) {
  const defaultTypes = {
    Payment: 65,
    OfferCreate: 18,
    OfferCancel: 5,
    TrustSet: 4,
    AccountSet: 3,
    Other: 5
  };
  
  const distribution = types || defaultTypes;
  const container = document.getElementById('txDistribution');
  if (!container) return;
  
  const colors = {
    Payment: '#50fa7b',
    OfferCreate: '#ffb86c',
    OfferCancel: '#ff5555',
    TrustSet: '#8be9fd',
    AccountSet: '#bd93f9',
    Other: '#f1fa8c'
  };
  
  container.innerHTML = Object.entries(distribution).map(([type, percent]) => `
    <div style="background: var(--card-bg); padding: 15px; border-radius: 10px; border: 2px solid ${colors[type] || colors.Other};">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <span style="color: ${colors[type] || colors.Other}; font-weight: bold;">${type}</span>
        <span style="color: var(--text-secondary);">${percent}%</span>
      </div>
      <div style="height: 8px; background: ${colors[type] || colors.Other}30; border-radius: 4px; overflow: hidden;">
        <div style="height: 100%; width: ${percent}%; background: ${colors[type] || colors.Other}; border-radius: 4px;"></div>
      </div>
    </div>
  `).join('');
}

/* ---------- UPDATE LEDGER TABLE ---------- */
function updateLedgerTable(data = null) {
  const container = document.getElementById('ledgerTable');
  if (!container) return;
  
  // Add new ledger to history
  if (data) {
    transactionHistory.unshift({
      ledger: data.ledgerIndex,
      time: new Date().toLocaleTimeString(),
      total: data.txPerLedger,
      ...(data.transactionTypes || {
        Payment: Math.floor(data.txPerLedger * 0.65),
        OfferCreate: Math.floor(data.txPerLedger * 0.18),
        Other: Math.floor(data.txPerLedger * 0.17)
      })
    });
    
    // Keep only last 10 entries
    if (transactionHistory.length > 10) {
      transactionHistory.pop();
    }
  }
  
  // Generate table
  container.innerHTML = `
    <div style="display: grid; grid-template-columns: 100px 1fr repeat(4, 1fr); gap: 1px; background: var(--accent-tertiary);">
      <div style="background: var(--bg-tertiary); padding: 12px; font-weight: bold; color: var(--accent-secondary); text-align: center;">Ledger</div>
      <div style="background: var(--bg-tertiary); padding: 12px; font-weight: bold; color: var(--accent-secondary);">Time</div>
      <div style="background: var(--bg-tertiary); padding: 12px; font-weight: bold; color: var(--accent-secondary); text-align: center;">Total</div>
      <div style="background: var(--bg-tertiary); padding: 12px; font-weight: bold; color: var(--accent-secondary); text-align: center;">Payments</div>
      <div style="background: var(--bg-tertiary); padding: 12px; font-weight: bold; color: var(--accent-secondary); text-align: center;">Offers</div>
      <div style="background: var(--bg-tertiary); padding: 12px; font-weight: bold; color: var(--accent-secondary); text-align: center;">Other</div>
      
      ${transactionHistory.map(ledger => `
        <div style="background: var(--card-bg); padding: 10px; text-align: center; border-bottom: 1px solid var(--accent-tertiary);">${ledger.ledger?.toLocaleString() || '—'}</div>
        <div style="background: var(--card-bg); padding: 10px; border-bottom: 1px solid var(--accent-tertiary);">${ledger.time}</div>
        <div style="background: var(--card-bg); padding: 10px; text-align: center; border-bottom: 1px solid var(--accent-tertiary);">${ledger.total}</div>
        <div style="background: var(--card-bg); padding: 10px; text-align: center; border-bottom: 1px solid var(--accent-tertiary); color: #50fa7b;">${ledger.Payment || 0}</div>
        <div style="background: var(--card-bg); padding: 10px; text-align: center; border-bottom: 1px solid var(--accent-tertiary); color: #ffb86c;">${ledger.OfferCreate || 0}</div>
        <div style="background: var(--card-bg); padding: 10px; text-align: center; border-bottom: 1px solid var(--accent-tertiary); color: #bd93f9;">${ledger.Other || 0}</div>
      `).join('')}
    </div>
  `;
}

/* ---------- UPDATE NETWORK STATUS ---------- */
function updateNetworkStatus(data) {
  updateValue('networkStatus', window.XRPL?.connected ? 'Mainnet ✅' : 'Simulated 🔄');
  updateValue('ledgerCloseTime', data.closeTime ? new Date(data.closeTime * 1000).toLocaleTimeString() : '—');
  updateValue('queueDepth', data.queueDepth?.toString() || '—');
}

/* ---------- UPDATE MAIN CHART ---------- */
function updateMainChart(data) {
  const chart = dashboardCharts.main;
  if (!chart) return;
  
  const ledgerLabel = `#${data.ledgerIndex || '—'}`;
  
  // Add new data point
  chart.data.labels.push(ledgerLabel);
  chart.data.datasets[0].data.push(data.transactionTypes?.Payment || Math.floor(data.txPerLedger * 0.65));
  chart.data.datasets[1].data.push(data.transactionTypes?.OfferCreate || Math.floor(data.txPerLedger * 0.18));
  chart.data.datasets[2].data.push(data.transactionTypes?.Other || Math.floor(data.txPerLedger * 0.17));
  
  // Keep only last 15 data points
  if (chart.data.labels.length > 15) {
    chart.data.labels.shift();
    chart.data.datasets.forEach(dataset => dataset.data.shift());
  }
  
  chart.update();
}

/* ---------- HELPER FUNCTIONS ---------- */
function updateValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function updateChart(id, data, color) {
  const chart = dashboardCharts[id];
  if (!chart || !data.length) return;
  
  chart.data.labels = new Array(data.length).fill('');
  chart.data.datasets[0].data = data.slice(-MAX_CHART_POINTS);
  chart.data.datasets[0].borderColor = color;
  chart.update();
}

function getThemeColor() {
  const themeColors = {
    gold: '#FFD700',
    cosmic: '#b580ff',
    starry: '#00d4ff',
    hawaiian: '#FF6B35'
  };
  return themeColors[window.UI?.currentTheme || 'gold'] || '#FFD700';
}

const historyCache = {};
function createHistory(value, key = 'default') {
  if (!historyCache[key]) historyCache[key] = [];
  const numValue = parseFloat(value) || 0;
  historyCache[key].push(numValue);
  if (historyCache[key].length > MAX_CHART_POINTS) {
    historyCache[key].shift();
  }
  return historyCache[key];
}

/* ---------- UI INTERACTIONS ---------- */
function toggleLedgerView() {
  const table = document.getElementById('ledgerTable');
  if (table) {
    const isDetailed = table.style.display !== 'none';
    table.style.display = isDetailed ? 'none' : 'block';
    event.target.textContent = isDetailed ? '📋 Show Detailed View' : '📋 Hide Detailed View';
  }
}

/* ---------- EXPORTS ---------- */
window.renderDashboard = renderDashboard;
window.updateDashboard = updateDashboardData;

console.log('📊 Enhanced Dashboard module loaded');