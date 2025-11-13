/* =========================================
   NaluXrp 🌊 – AMM Pools Module
   Display Automated Market Maker pools
   ========================================= */

let ammCache = [];

/* ---------- INIT AMM ---------- */
function initAMM() {
  const container = document.getElementById('amm');
  if (!container) return;
  
  container.innerHTML = `
    <div class="chart-section">
      <div class="chart-title">💧 AMM Liquidity Pools</div>
      
      <div style="margin-bottom: 20px;">
        <input 
          id="amm-search" 
          type="text" 
          placeholder="🔍 Search pools (e.g., XRP/USD)..." 
          style="width: 100%; max-width: 500px; padding: 12px; border-radius: 10px; border: 2px solid var(--accent-tertiary); background: rgba(0,0,0,0.4); color: #fff; font-size: 1em;"
        />
      </div>
      
      <div id="amm-list">
        <div class="loading">Loading AMM pools...</div>
      </div>
    </div>
  `;
  
  fetchAMMPools();
  setupAMMSearch();
}

/* ---------- FETCH AMM POOLS ---------- */
async function fetchAMMPools() {
  const container = document.getElementById('amm-list');
  if (!container) return;
  
  try {
    if (!window.XRPL?.client || !window.XRPL.connected) {
      throw new Error('Not connected to XRPL');
    }
    
    // Note: This is a simplified version - actual AMM data requires more complex queries
    // For demo purposes, we'll show sample data
    ammCache = createSampleAMMData();
    
    displayAMMPools(ammCache);
  } catch (err) {
    console.error('❌ Error fetching AMM pools:', err);
    container.innerHTML = `
      <div style="color: #ff5555; text-align: center; padding: 40px; background: rgba(255,85,85,0.1); border-radius: 12px; border: 2px solid #ff5555;">
        <div style="font-size: 2em; margin-bottom: 10px;">⚠️</div>
        <div style="font-size: 1.2em; font-weight: 600;">Error Loading AMM Pools</div>
        <div style="margin-top: 10px; font-size: 0.9em; opacity: 0.8;">
          ${err.message}
        </div>
      </div>
    `;
  }
}

/* ---------- DISPLAY AMM POOLS ---------- */
function displayAMMPools(pools) {
  const container = document.getElementById('amm-list');
  if (!container) return;
  
  if (!pools.length) {
    container.innerHTML = `
      <div style="color: #888; text-align: center; padding: 40px;">
        No AMM pools found
      </div>
    `;
    return;
  }
  
  container.innerHTML = `
    <div style="display: grid; gap: 15px;">
      ${pools.map(pool => createAMMCard(pool)).join('')}
    </div>
  `;
}

/* ---------- CREATE AMM CARD ---------- */
function createAMMCard(pool) {
  return `
    <div style="
      background: var(--card-bg);
      border-radius: 15px;
      padding: 20px;
      border: 2px solid var(--accent-tertiary);
      transition: all 0.3s ease;
      cursor: pointer;
    "
    onmouseover="this.style.borderColor='var(--accent-primary)'; this.style.transform='translateX(5px)'"
    onmouseout="this.style.borderColor='var(--accent-tertiary)'; this.style.transform='translateX(0)'">
      
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; padding-bottom: 15px; border-bottom: 2px solid var(--accent-tertiary);">
        <div style="font-size: 1.5em; font-weight: 700; color: var(--accent-secondary);">
          ${pool.asset1}/${pool.asset2}
        </div>
        <div style="font-size: 1.3em; font-weight: 700; color: var(--accent-primary);">
          ${pool.apy}% APY
        </div>
      </div>
      
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px;">
        <div style="background: rgba(0,0,0,0.3); padding: 12px; border-radius: 8px; text-align: center;">
          <div style="font-size: 0.75em; color: var(--text-secondary); margin-bottom: 5px; text-transform: uppercase; letter-spacing: 1px;">TVL</div>
          <div style="font-size: 1.1em; font-weight: 700; color: var(--accent-primary);">${formatNumber(pool.tvl)}</div>
        </div>
        
        <div style="background: rgba(0,0,0,0.3); padding: 12px; border-radius: 8px; text-align: center;">
          <div style="font-size: 0.75em; color: var(--text-secondary); margin-bottom: 5px; text-transform: uppercase; letter-spacing: 1px;">24h Volume</div>
          <div style="font-size: 1.1em; font-weight: 700; color: var(--accent-primary);">${formatNumber(pool.volume24h)}</div>
        </div>
        
        <div style="background: rgba(0,0,0,0.3); padding: 12px; border-radius: 8px; text-align: center;">
          <div style="font-size: 0.75em; color: var(--text-secondary); margin-bottom: 5px; text-transform: uppercase; letter-spacing: 1px;">Fee</div>
          <div style="font-size: 1.1em; font-weight: 700; color: var(--accent-primary);">${pool.fee}%</div>
        </div>
        
        <div style="background: rgba(0,0,0,0.3); padding: 12px; border-radius: 8px; text-align: center;">
          <div style="font-size: 0.75em; color: var(--text-secondary); margin-bottom: 5px; text-transform: uppercase; letter-spacing: 1px;">LP Tokens</div>
          <div style="font-size: 1.1em; font-weight: 700; color: var(--accent-primary);">${formatNumber(pool.lpTokens)}</div>
        </div>
      </div>
    </div>
  `;
}

/* ---------- SAMPLE DATA ---------- */
function createSampleAMMData() {
  return [
    { asset1: 'XRP', asset2: 'USD', tvl: 15000000, volume24h: 2500000, fee: 0.3, apy: 12.5, lpTokens: 500000 },
    { asset1: 'XRP', asset2: 'BTC', tvl: 8500000, volume24h: 1800000, fee: 0.5, apy: 15.2, lpTokens: 320000 },
    { asset1: 'XRP', asset2: 'ETH', tvl: 6200000, volume24h: 980000, fee: 0.3, apy: 9.8, lpTokens: 280000 },
    { asset1: 'USD', asset2: 'EUR', tvl: 12000000, volume24h: 3200000, fee: 0.1, apy: 5.5, lpTokens: 680000 },
    { asset1: 'SOLO', asset2: 'XRP', tvl: 3500000, volume24h: 520000, fee: 0.5, apy: 18.3, lpTokens: 145000 },
    { asset1: 'CSC', asset2: 'XRP', tvl: 2800000, volume24h: 380000, fee: 0.5, apy: 22.1, lpTokens: 98000 }
  ];
}

/* ---------- SEARCH SETUP ---------- */
function setupAMMSearch() {
  const input = document.getElementById('amm-search');
  if (!input) return;
  
  input.addEventListener('input', debounce((e) => {
    const query = e.target.value.toLowerCase().trim();
    
    if (!query) {
      displayAMMPools(ammCache);
      return;
    }
    
    const filtered = ammCache.filter(pool =>
      pool.asset1.toLowerCase().includes(query) ||
      pool.asset2.toLowerCase().includes(query)
    );
    
    displayAMMPools(filtered);
  }, 300));
}

/* ---------- EXPORTS ---------- */
window.initAMM = initAMM;

console.log('💧 AMM module loaded');