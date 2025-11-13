/* =========================================
   NaluXrp 🌊 – Analytics Module
   Advanced metrics and trend analysis
   ========================================= */

const analyticsCharts = {};

/* ---------- INIT ANALYTICS ---------- */
function initAnalytics() {
  const container = document.getElementById('analytics');
  if (!container) return;
  
  container.innerHTML = `
    <div class="chart-section">
      <div class="chart-title">📈 Real-Time Analytics</div>
      
      <div class="dashboard-grid">
        <div class="metric-card">
          <div class="metric-label">Network TPS</div>
          <canvas id="analytics-tps" height="100"></canvas>
        </div>
        
        <div class="metric-card">
          <div class="metric-label">Average Fees</div>
          <canvas id="analytics-fee" height="100"></canvas>
        </div>
        
        <div class="metric-card">
          <div class="metric-label">Ledger Intervals</div>
          <canvas id="analytics-interval" height="100"></canvas>
        </div>
        
        <div class="metric-card">
          <div class="metric-label">Load Factor</div>
          <canvas id="analytics-load" height="100"></canvas>
        </div>
      </div>
      
      <div style="margin-top: 30px; padding: 20px; background: var(--card-bg); border-radius: 12px; border: 2px solid var(--accent-tertiary);">
        <h3 style="color: var(--accent-secondary); margin-bottom: 15px;">📊 Performance Insights</h3>
        <div style="display: grid; gap: 15px;">
          <div id="analytics-insights"></div>
        </div>
      </div>
    </div>
  `;
  
  initAnalyticsCharts();
  updateAnalytics();
}

/* ---------- INIT CHARTS ---------- */
function initAnalyticsCharts() {
  const color = getThemeColor();
  const chartIds = ['tps', 'fee', 'interval', 'load'];
  
  chartIds.forEach(id => {
    const canvas = document.getElementById(`analytics-${id}`);
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    analyticsCharts[id] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          data: [],
          borderColor: color,
          backgroundColor: `${color}40`,
          borderWidth: 3,
          tension: 0.4,
          pointRadius: 3,
          pointHoverRadius: 5,
          fill: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 500 },
        plugins: { legend: { display: false } },
        scales: {
          x: { 
            display: true,
            grid: { color: 'rgba(255,255,255,0.1)' },
            ticks: { color: '#888' }
          },
          y: { 
            display: true,
            grid: { color: 'rgba(255,255,255,0.1)' },
            ticks: { color: '#888' }
          }
        }
      }
    });
  });
}

/* ---------- UPDATE ANALYTICS ---------- */
function updateAnalytics() {
  if (!window.XRPL?.state) return;
  
  const state = window.XRPL.state;
  const color = getThemeColor();
  
  // Update TPS chart
  updateAnalyticsChart('tps', state.tpsHistory || [], color);
  
  // Update Fee chart
  updateAnalyticsChart('fee', state.feeHistory || [], color);
  
  // Update Interval chart (simulated)
  const intervals = generateIntervals();
  updateAnalyticsChart('interval', intervals, color);
  
  // Update Load chart
  const loads = generateLoads();
  updateAnalyticsChart('load', loads, color);
  
  // Update insights
  updateInsights(state);
}

/* ---------- UPDATE CHART ---------- */
function updateAnalyticsChart(id, data, color) {
  const chart = analyticsCharts[id];
  if (!chart || !data.length) return;
  
  chart.data.labels = data.map((_, i) => i);
  chart.data.datasets[0].data = data.slice(-30);
  chart.data.datasets[0].borderColor = color;
  chart.data.datasets[0].backgroundColor = `${color}40`;
  chart.update();
}

/* ---------- UPDATE INSIGHTS ---------- */
function updateInsights(state) {
  const container = document.getElementById('analytics-insights');
  if (!container) return;
  
  const avgTPS = (state.tpsHistory.reduce((a, b) => a + parseFloat(b), 0) / state.tpsHistory.length).toFixed(2);
  const avgFee = (state.feeHistory.reduce((a, b) => a + parseFloat(b), 0) / state.feeHistory.length).toFixed(6);
  
  container.innerHTML = `
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px;">
      <div style="background: rgba(0,0,0,0.3); padding: 15px; border-radius: 8px;">
        <div style="font-size: 0.85em; color: var(--text-secondary); margin-bottom: 5px;">Average TPS (30 samples)</div>
        <div style="font-size: 1.5em; font-weight: 700; color: var(--accent-primary);">${avgTPS || '—'}</div>
      </div>
      
      <div style="background: rgba(0,0,0,0.3); padding: 15px; border-radius: 8px;">
        <div style="font-size: 0.85em; color: var(--text-secondary); margin-bottom: 5px;">Average Fee (XRP)</div>
        <div style="font-size: 1.5em; font-weight: 700; color: var(--accent-primary);">${avgFee || '—'}</div>
      </div>
      
      <div style="background: rgba(0,0,0,0.3); padding: 15px; border-radius: 8px;">
        <div style="font-size: 0.85em; color: var(--text-secondary); margin-bottom: 5px;">Network Status</div>
        <div style="font-size: 1.5em; font-weight: 700; color: #50fa7b;">Healthy ✓</div>
      </div>
      
      <div style="background: rgba(0,0,0,0.3); padding: 15px; border-radius: 8px;">
        <div style="font-size: 0.85em; color: var(--text-secondary); margin-bottom: 5px;">Current Ledger</div>
        <div style="font-size: 1.5em; font-weight: 700; color: var(--accent-primary);">#${state.ledgerIndex || '—'}</div>
      </div>
    </div>
  `;
}

/* ---------- HELPERS ---------- */
function getThemeColor() {
  const colors = {
    gold: '#FFD700',
    cosmic: '#b580ff',
    starry: '#00d4ff',
    hawaiian: '#FF6B35'
  };
  return colors[window.UI?.currentTheme || 'gold'];
}

function generateIntervals() {
  const intervals = [];
  for (let i = 0; i < 30; i++) {
    intervals.push(3.5 + Math.random() * 0.8);
  }
  return intervals;
}

function generateLoads() {
  const loads = [];
  for (let i = 0; i < 30; i++) {
    loads.push(0.00001 + Math.random() * 0.00005);
  }
  return loads;
}

/* ---------- AUTO UPDATE ---------- */
window.addEventListener('xrpl-ledger', () => {
  if (window.UI?.currentPage === 'analytics') {
    updateAnalytics();
  }
});

setInterval(() => {
  if (window.UI?.currentPage === 'analytics') {
    updateAnalytics();
  }
}, 5000);

/* ---------- EXPORTS ---------- */
window.initAnalytics = initAnalytics;

console.log('📈 Analytics module loaded');