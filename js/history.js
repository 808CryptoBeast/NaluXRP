/* =========================================
   NaluXrp 🌊 – History Module
   Historical ledger and account data
   ========================================= */

function initHistory() {
  const container = document.getElementById('history');
  if (!container) return;
  
  container.innerHTML = `
    <div class="chart-section">
      <div class="chart-title">📜 Ledger History</div>
      
      <div style="max-width: 900px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <p style="font-size: 1.1em; color: var(--text-secondary);">
            View historical ledger data and account transaction history
          </p>
        </div>
        
        <!-- Account History Lookup -->
        <div style="background: var(--card-bg); border-radius: 15px; padding: 25px; margin-bottom: 25px; border: 2px solid var(--accent-tertiary);">
          <h3 style="color: var(--accent-primary); margin-bottom: 15px;">🔍 Account History Lookup</h3>
          <div style="display: flex; gap: 10px; margin-bottom: 15px;">
            <input 
              id="history-account-input" 
              type="text" 
              placeholder="Enter XRP Ledger address (e.g., rN7n7otQDd6FczFgLdlqtyMVrn3eDczxvT)"
              style="flex: 1; padding: 12px; border-radius: 10px; border: 2px solid var(--accent-tertiary); background: rgba(0,0,0,0.4); color: #fff; font-size: 1em;"
            />
            <button 
              onclick="searchAccountHistory()"
              style="padding: 12px 24px; border-radius: 10px; border: none; background: var(--accent-primary); color: #000; font-weight: 600; cursor: pointer; transition: all 0.3s;"
              onmouseover="this.style.transform='scale(1.05)'"
              onmouseout="this.style.transform='scale(1)'">
              Search
            </button>
          </div>
          <div id="history-results" style="margin-top: 20px;"></div>
        </div>
        
        <!-- Recent Ledgers -->
        <div style="background: var(--card-bg); border-radius: 15px; padding: 25px; border: 2px solid var(--accent-tertiary);">
          <h3 style="color: var(--accent-primary); margin-bottom: 15px;">📊 Recent Ledger Activity</h3>
          <div id="recent-ledgers">
            ${generateRecentLedgersPlaceholder()}
          </div>
        </div>
        
        <!-- Historical Stats -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-top: 25px;">
          ${generateHistoricalStats()}
        </div>
      </div>
    </div>
  `;
  
  displayRecentLedgers();
}

function generateRecentLedgersPlaceholder() {
  return `
    <div style="color: var(--text-secondary); text-align: center; padding: 20px;">
      <div style="font-size: 1.5em; margin-bottom: 10px;">⏳</div>
      <div>Loading recent ledger history...</div>
    </div>
  `;
}

function generateHistoricalStats() {
  const stats = [
    { label: 'Total Ledgers', value: '85M+', icon: '📚' },
    { label: 'Average Close Time', value: '~3-4s', icon: '⏱️' },
    { label: 'Total Accounts', value: '5M+', icon: '👥' },
    { label: 'Network Age', value: '10+ years', icon: '🎂' }
  ];
  
  return stats.map(stat => `
    <div style="background: var(--card-bg); border-radius: 12px; padding: 20px; text-align: center; border: 2px solid var(--accent-tertiary);">
      <div style="font-size: 2em; margin-bottom: 8px;">${stat.icon}</div>
      <div style="font-size: 1.5em; font-weight: 700; color: var(--accent-primary); margin-bottom: 5px;">
        ${stat.value}
      </div>
      <div style="font-size: 0.9em; color: var(--text-secondary);">
        ${stat.label}
      </div>
    </div>
  `).join('');
}

function displayRecentLedgers() {
  const container = document.getElementById('recent-ledgers');
  if (!container) return;
  
  // Check if connected to XRPL
  if (!window.XRPL?.connected) {
    container.innerHTML = `
      <div style="color: var(--text-secondary); text-align: center; padding: 20px;">
        <div style="font-size: 1.5em; margin-bottom: 10px;">🔌</div>
        <div>Not connected to XRPL. Recent ledger data will appear when connected.</div>
      </div>
    `;
    return;
  }
  
  container.innerHTML = `
    <div style="color: var(--text-secondary); text-align: center; padding: 20px;">
      <div style="font-size: 1.5em; margin-bottom: 10px;">📊</div>
      <div>Fetching recent ledger history...</div>
    </div>
  `;
}

function searchAccountHistory() {
  const input = document.getElementById('history-account-input');
  const results = document.getElementById('history-results');
  
  if (!input || !results) return;
  
  const address = input.value.trim();
  
  if (!address) {
    results.innerHTML = `
      <div style="color: #ff5555; padding: 15px; background: rgba(255,85,85,0.1); border-radius: 8px; border: 1px solid #ff5555;">
        ⚠️ Please enter an XRP Ledger address
      </div>
    `;
    return;
  }
  
  if (!window.XRPL?.connected) {
    results.innerHTML = `
      <div style="color: #ff5555; padding: 15px; background: rgba(255,85,85,0.1); border-radius: 8px; border: 1px solid #ff5555;">
        ⚠️ Not connected to XRPL. Please wait for connection to be established.
      </div>
    `;
    return;
  }
  
  results.innerHTML = `
    <div style="color: var(--text-secondary); text-align: center; padding: 20px;">
      <div style="font-size: 1.5em; margin-bottom: 10px;">⏳</div>
      <div>Searching account history for ${address}...</div>
    </div>
  `;
  
  // This would connect to actual XRPL API in a full implementation
  setTimeout(() => {
    results.innerHTML = `
      <div style="color: var(--text-secondary); padding: 15px; background: rgba(255,215,0,0.1); border-radius: 8px; border: 1px solid var(--accent-primary);">
        💡 Account history lookup functionality would fetch transaction history from XRPL here.
        <br/><br/>
        For full implementation, integrate with XRPL account_tx method.
      </div>
    `;
  }, 1000);
}

// Export for global use
window.initHistory = initHistory;
window.searchAccountHistory = searchAccountHistory;

console.log('✅ History module loaded');
