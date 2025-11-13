/* =========================================
   NaluXrp 🌊 – Explorer Module
   Search transactions and accounts
   ========================================= */

function initExplorer() {
  const container = document.getElementById('explorer');
  if (!container) return;
  
  container.innerHTML = `
    <div class="chart-section">
      <div class="chart-title">🔍 XRPL Explorer</div>
      
      <div style="margin-bottom: 25px;">
        <div style="display: flex; gap: 10px; flex-wrap: wrap;">
          <input 
            id="explorer-input" 
            type="text" 
            placeholder="Enter transaction hash or account address..." 
            style="flex: 1; min-width: 300px; padding: 12px; border-radius: 10px; border: 2px solid var(--accent-tertiary); background: rgba(0,0,0,0.4); color: #fff; font-size: 1em;"
          />
          <button 
            onclick="searchExplorer()" 
            style="padding: 12px 24px; background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary)); border: none; border-radius: 10px; color: #000; font-weight: 700; cursor: pointer;"
          >
            🔍 Search
          </button>
        </div>
      </div>
      
      <div id="explorer-results">
        <div style="color: #888; text-align: center; padding: 60px 20px;">
          <div style="font-size: 4em; margin-bottom: 20px;">🔍</div>
          <div style="font-size: 1.3em; font-weight: 600; margin-bottom: 10px;">XRPL Explorer</div>
          <div style="font-size: 1em; opacity: 0.8;">Search for transactions or account information</div>
        </div>
      </div>
    </div>
  `;
  
  document.getElementById('explorer-input')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') searchExplorer();
  });
}

async function searchExplorer() {
  const input = document.getElementById('explorer-input');
  const query = input?.value.trim();
  const container = document.getElementById('explorer-results');
  
  if (!query) {
    showNotification('Please enter a search query', 'error');
    return;
  }
  
  if (!container) return;
  container.innerHTML = '<div class="loading">Searching...</div>';
  
  try {
    if (!window.XRPL?.client || !window.XRPL.connected) {
      throw new Error('Not connected to XRPL');
    }
    
    // Check if it's an account address
    if (isValidXRPAddress(query)) {
      const response = await window.XRPL.client.request({
        command: 'account_info',
        account: query
      });
      displayAccountInfo(response.result);
    } else {
      // Try as transaction hash
      const response = await window.XRPL.client.request({
        command: 'tx',
        transaction: query
      });
      displayTransactionInfo(response.result);
    }
  } catch (err) {
    console.error('❌ Explorer error:', err);
    container.innerHTML = `
      <div style="color: #ff5555; text-align: center; padding: 40px;">
        <div style="font-size: 2em; margin-bottom: 10px;">⚠️</div>
        <div style="font-size: 1.2em; font-weight: 600;">Not Found</div>
        <div style="margin-top: 10px;">Could not find transaction or account</div>
      </div>
    `;
  }
}

function displayAccountInfo(data) {
  const container = document.getElementById('explorer-results');
  if (!container) return;
  
  const account = data.account_data;
  const balance = (parseInt(account.Balance) / 1_000_000).toFixed(2);
  
  container.innerHTML = `
    <div style="background: var(--card-bg); border-radius: 15px; padding: 25px; border: 2px solid var(--accent-primary);">
      <h3 style="color: var(--accent-secondary); margin-bottom: 20px;">💼 Account Information</h3>
      
      <div style="display: grid; gap: 15px;">
        <div style="background: rgba(0,0,0,0.3); padding: 15px; border-radius: 8px;">
          <div style="font-size: 0.85em; color: var(--text-secondary); margin-bottom: 5px;">Address</div>
          <div style="font-family: monospace; font-size: 0.95em; color: var(--accent-primary); word-break: break-all;">${account.Account}</div>
        </div>
        
        <div style="background: rgba(0,0,0,0.3); padding: 15px; border-radius: 8px;">
          <div style="font-size: 0.85em; color: var(--text-secondary); margin-bottom: 5px;">Balance</div>
          <div style="font-size: 1.5em; font-weight: 700; color: var(--accent-secondary);">${balance} XRP</div>
        </div>
        
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px;">
          <div style="background: rgba(0,0,0,0.3); padding: 15px; border-radius: 8px;">
            <div style="font-size: 0.85em; color: var(--text-secondary); margin-bottom: 5px;">Sequence</div>
            <div style="font-weight: 700; color: var(--accent-primary);">${account.Sequence}</div>
          </div>
          
          <div style="background: rgba(0,0,0,0.3); padding: 15px; border-radius: 8px;">
            <div style="font-size: 0.85em; color: var(--text-secondary); margin-bottom: 5px;">Owner Count</div>
            <div style="font-weight: 700; color: var(--accent-primary);">${account.OwnerCount}</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function displayTransactionInfo(data) {
  const container = document.getElementById('explorer-results');
  if (!container) return;
  
  container.innerHTML = `
    <div style="background: var(--card-bg); border-radius: 15px; padding: 25px; border: 2px solid var(--accent-primary);">
      <h3 style="color: var(--accent-secondary); margin-bottom: 20px;">📄 Transaction Details</h3>
      
      <div style="display: grid; gap: 15px;">
        <div style="background: rgba(0,0,0,0.3); padding: 15px; border-radius: 8px;">
          <div style="font-size: 0.85em; color: var(--text-secondary); margin-bottom: 5px;">Hash</div>
          <div style="font-family: monospace; font-size: 0.9em; color: var(--accent-primary); word-break: break-all;">${data.hash}</div>
        </div>
        
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px;">
          <div style="background: rgba(0,0,0,0.3); padding: 15px; border-radius: 8px;">
            <div style="font-size: 0.85em; color: var(--text-secondary); margin-bottom: 5px;">Type</div>
            <div style="font-weight: 700; color: var(--accent-primary);">${data.TransactionType}</div>
          </div>
          
          <div style="background: rgba(0,0,0,0.3); padding: 15px; border-radius: 8px;">
            <div style="font-size: 0.85em; color: var(--text-secondary); margin-bottom: 5px;">Status</div>
            <div style="font-weight: 700; color: ${data.meta?.TransactionResult === 'tesSUCCESS' ? '#50fa7b' : '#ff5555'};">
              ${data.meta?.TransactionResult || 'Unknown'}
            </div>
          </div>
          
          <div style="background: rgba(0,0,0,0.3); padding: 15px; border-radius: 8px;">
            <div style="font-size: 0.85em; color: var(--text-secondary); margin-bottom: 5px;">Ledger Index</div>
            <div style="font-weight: 700; color: var(--accent-primary);">${data.ledger_index || '—'}</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

window.initExplorer = initExplorer;
window.searchExplorer = searchExplorer;

console.log('🔍 Explorer module loaded');