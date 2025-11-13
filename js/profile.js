/* =========================================
   NaluXrp 🌊 – Profile Module
   User wallet and profile management
   ========================================= */

function initProfile() {
  const container = document.getElementById('profile');
  if (!container) return;
  
  container.innerHTML = `
    <div class="chart-section">
      <div class="chart-title">👤 My Profile</div>
      
      <div style="display: grid; gap: 25px;">
        
        <!-- Wallet Section -->
        <div style="background: var(--card-bg); border-radius: 15px; padding: 25px; border: 2px solid var(--accent-primary);">
          <h3 style="color: var(--accent-secondary); margin-bottom: 20px;">💼 Wallet</h3>
          
          <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 20px;">
            <button onclick="generateNewWallet()" class="nav-btn">🌀 Generate Wallet</button>
            <button onclick="importWallet()" class="nav-btn">📥 Import Wallet</button>
            <button onclick="clearWallet()" class="nav-btn">🗑️ Clear</button>
          </div>
          
          <div id="wallet-info">
            <div style="color: #888; text-align: center; padding: 20px;">
              No wallet connected
            </div>
          </div>
        </div>
        
        <!-- Bio Section -->
        <div style="background: var(--card-bg); border-radius: 15px; padding: 25px; border: 2px solid var(--accent-tertiary);">
          <h3 style="color: var(--accent-secondary); margin-bottom: 15px;">📝 Bio</h3>
          <textarea 
            id="profile-bio" 
            placeholder="Write something about yourself..."
            style="width: 100%; min-height: 100px; padding: 12px; border-radius: 10px; border: 2px solid var(--accent-tertiary); background: rgba(0,0,0,0.4); color: #fff; font-family: inherit; resize: vertical;"
          ></textarea>
          <button onclick="saveBio()" class="nav-btn" style="margin-top: 10px;">💾 Save Bio</button>
        </div>
        
      </div>
    </div>
  `;
  
  loadProfile();
}

function generateNewWallet() {
  const wallet = xrpl.Wallet.generate();
  displayWalletInfo(wallet);
  localStorage.setItem('nalu_wallet_seed', wallet.seed);
  showNotification('New wallet generated!', 'success');
}

function importWallet() {
  const seed = prompt('Enter your wallet seed:');
  if (!seed) return;
  
  try {
    const wallet = xrpl.Wallet.fromSeed(seed.trim());
    displayWalletInfo(wallet);
    localStorage.setItem('nalu_wallet_seed', seed.trim());
    showNotification('Wallet imported!', 'success');
  } catch (err) {
    showNotification('Invalid seed', 'error');
  }
}

function clearWallet() {
  if (confirm('Are you sure you want to clear your wallet?')) {
    localStorage.removeItem('nalu_wallet_seed');
    document.getElementById('wallet-info').innerHTML = `
      <div style="color: #888; text-align: center; padding: 20px;">
        No wallet connected
      </div>
    `;
    showNotification('Wallet cleared', 'success');
  }
}

async function displayWalletInfo(wallet) {
  const container = document.getElementById('wallet-info');
  if (!container) return;
  
  container.innerHTML = `
    <div style="background: rgba(0,0,0,0.3); padding: 20px; border-radius: 12px;">
      <div style="margin-bottom: 15px;">
        <div style="font-size: 0.85em; color: var(--text-secondary); margin-bottom: 5px;">Address</div>
        <div style="font-family: monospace; font-size: 0.95em; color: var(--accent-primary); word-break: break-all;">
          ${wallet.address}
        </div>
      </div>
      
      <div>
        <div style="font-size: 0.85em; color: var(--text-secondary); margin-bottom: 5px;">Seed (Keep Secret!)</div>
        <div style="font-family: monospace; font-size: 0.9em; color: #ff5555; word-break: break-all;">
          ${wallet.seed}
        </div>
      </div>
      
      <div id="balance-info" style="margin-top: 15px;">
        <div class="loading" style="padding: 10px;">Loading balance...</div>
      </div>
    </div>
  `;
  
  // Try to fetch balance
  try {
    if (window.XRPL?.client && window.XRPL.connected) {
      const response = await window.XRPL.client.request({
        command: 'account_info',
        account: wallet.address
      });
      const balance = (parseInt(response.result.account_data.Balance) / 1_000_000).toFixed(2);
      document.getElementById('balance-info').innerHTML = `
        <div style="background: rgba(0,0,0,0.3); padding: 12px; border-radius: 8px;">
          <div style="font-size: 0.85em; color: var(--text-secondary); margin-bottom: 5px;">Balance</div>
          <div style="font-size: 1.5em; font-weight: 700; color: var(--accent-secondary);">${balance} XRP</div>
        </div>
      `;
    }
  } catch (err) {
    document.getElementById('balance-info').innerHTML = `
      <div style="color: #888; font-size: 0.9em;">Account not yet funded on mainnet</div>
    `;
  }
}

function saveBio() {
  const bio = document.getElementById('profile-bio')?.value;
  localStorage.setItem('nalu_profile_bio', bio);
  showNotification('Bio saved!', 'success');
}

function loadProfile() {
  // Load wallet if exists
  const seed = localStorage.getItem('nalu_wallet_seed');
  if (seed) {
    try {
      const wallet = xrpl.Wallet.fromSeed(seed);
      displayWalletInfo(wallet);
    } catch (err) {
      console.error('Error loading wallet:', err);
    }
  }
  
  // Load bio
  const bio = localStorage.getItem('nalu_profile_bio');
  if (bio) {
    const bioInput = document.getElementById('profile-bio');
    if (bioInput) bioInput.value = bio;
  }
}

window.initProfile = initProfile;
window.generateNewWallet = generateNewWallet;
window.importWallet = importWallet;
window.clearWallet = clearWallet;
window.saveBio = saveBio;

console.log('👤 Profile module loaded');