/* =========================================
   NaluXrp 🌊 – Settings Module
   Application settings and preferences
   ========================================= */

function initSettings() {
  const container = document.getElementById('settings');
  if (!container) return;
  
  container.innerHTML = `
    <div class="chart-section">
      <div class="chart-title">⚙️ Settings</div>
      
      <div style="max-width: 800px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <p style="font-size: 1.1em; color: var(--text-secondary);">
            Customize your NaluXrp experience
          </p>
        </div>
        
        <!-- Theme Settings -->
        <div style="background: var(--card-bg); border-radius: 15px; padding: 25px; margin-bottom: 25px; border: 2px solid var(--accent-tertiary);">
          <h3 style="color: var(--accent-primary); margin-bottom: 15px;">🎨 Theme Selection</h3>
          <p style="color: var(--text-secondary); margin-bottom: 20px;">
            Choose your preferred visual theme
          </p>
          
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px;">
            ${generateThemeButtons()}
          </div>
        </div>
        
        <!-- Network Settings -->
        <div style="background: var(--card-bg); border-radius: 15px; padding: 25px; margin-bottom: 25px; border: 2px solid var(--accent-tertiary);">
          <h3 style="color: var(--accent-primary); margin-bottom: 15px;">🌐 Network Settings</h3>
          <p style="color: var(--text-secondary); margin-bottom: 20px;">
            Configure XRPL connection preferences
          </p>
          
          <div style="margin-bottom: 15px;">
            <label style="display: block; color: var(--text-primary); margin-bottom: 8px; font-weight: 600;">
              XRPL Node
            </label>
            <select 
              id="xrpl-node-select"
              style="width: 100%; padding: 12px; border-radius: 10px; border: 2px solid var(--accent-tertiary); background: rgba(0,0,0,0.4); color: #fff; font-size: 1em;">
              <option value="wss://xrplcluster.com">xrplcluster.com (Default)</option>
              <option value="wss://s1.ripple.com">s1.ripple.com</option>
              <option value="wss://s2.ripple.com">s2.ripple.com</option>
              <option value="custom">Custom Node</option>
            </select>
          </div>
          
          <div id="custom-node-input" style="display: none; margin-top: 15px;">
            <label style="display: block; color: var(--text-primary); margin-bottom: 8px; font-weight: 600;">
              Custom Node URL
            </label>
            <input 
              type="text" 
              placeholder="wss://your-node.com"
              style="width: 100%; padding: 12px; border-radius: 10px; border: 2px solid var(--accent-tertiary); background: rgba(0,0,0,0.4); color: #fff; font-size: 1em;"
            />
          </div>
        </div>
        
        <!-- Display Settings -->
        <div style="background: var(--card-bg); border-radius: 15px; padding: 25px; margin-bottom: 25px; border: 2px solid var(--accent-tertiary);">
          <h3 style="color: var(--accent-primary); margin-bottom: 15px;">📊 Display Settings</h3>
          
          <div style="margin-bottom: 20px;">
            <label style="display: flex; align-items: center; cursor: pointer;">
              <input type="checkbox" id="auto-refresh" checked style="margin-right: 10px; width: 18px; height: 18px;">
              <span style="color: var(--text-primary);">Auto-refresh dashboard data</span>
            </label>
          </div>
          
          <div style="margin-bottom: 20px;">
            <label style="display: flex; align-items: center; cursor: pointer;">
              <input type="checkbox" id="show-animations" checked style="margin-right: 10px; width: 18px; height: 18px;">
              <span style="color: var(--text-primary);">Enable animations</span>
            </label>
          </div>
          
          <div style="margin-bottom: 20px;">
            <label style="display: flex; align-items: center; cursor: pointer;">
              <input type="checkbox" id="compact-mode" style="margin-right: 10px; width: 18px; height: 18px;">
              <span style="color: var(--text-primary);">Compact view mode</span>
            </label>
          </div>
        </div>
        
        <!-- Data Settings -->
        <div style="background: var(--card-bg); border-radius: 15px; padding: 25px; border: 2px solid var(--accent-tertiary);">
          <h3 style="color: var(--accent-primary); margin-bottom: 15px;">💾 Data Management</h3>
          
          <div style="margin-bottom: 20px;">
            <button 
              onclick="clearLocalCache()"
              style="padding: 12px 24px; border-radius: 10px; border: none; background: rgba(255,85,85,0.2); color: #ff5555; font-weight: 600; cursor: pointer; transition: all 0.3s;"
              onmouseover="this.style.background='rgba(255,85,85,0.3)'"
              onmouseout="this.style.background='rgba(255,85,85,0.2)'">
              🗑️ Clear Local Cache
            </button>
            <p style="color: var(--text-secondary); font-size: 0.9em; margin-top: 8px;">
              Clear cached data and preferences
            </p>
          </div>
        </div>
      </div>
    </div>
  `;
  
  setupSettingsListeners();
}

function generateThemeButtons() {
  const themes = [
    { id: 'gold', name: 'Gold', icon: '🏆', color: '#FFD700' },
    { id: 'cosmic', name: 'Cosmic', icon: '🌌', color: '#9D4EDD' },
    { id: 'starry', name: 'Starry', icon: '✨', color: '#0095FF' },
    { id: 'hawaiian', name: 'Hawaiian', icon: '🌺', color: '#00D9FF' }
  ];
  
  return themes.map(theme => `
    <button 
      onclick="applyTheme('${theme.id}')"
      style="padding: 20px; border-radius: 12px; border: 2px solid var(--accent-tertiary); background: rgba(0,0,0,0.3); cursor: pointer; transition: all 0.3s; text-align: center;"
      onmouseover="this.style.borderColor='${theme.color}'; this.style.transform='scale(1.05)'"
      onmouseout="this.style.borderColor='var(--accent-tertiary)'; this.style.transform='scale(1)'">
      <div style="font-size: 2em; margin-bottom: 8px;">${theme.icon}</div>
      <div style="color: var(--text-primary); font-weight: 600;">${theme.name}</div>
    </button>
  `).join('');
}

function setupSettingsListeners() {
  // Node select listener
  const nodeSelect = document.getElementById('xrpl-node-select');
  const customInput = document.getElementById('custom-node-input');
  
  if (nodeSelect && customInput) {
    nodeSelect.addEventListener('change', (e) => {
      if (e.target.value === 'custom') {
        customInput.style.display = 'block';
      } else {
        customInput.style.display = 'none';
      }
    });
  }
}

function applyTheme(themeId) {
  if (typeof window.setTheme === 'function') {
    window.setTheme(themeId);
    showNotification(`✅ Theme changed to ${themeId}`);
  }
}

function clearLocalCache() {
  try {
    localStorage.clear();
    sessionStorage.clear();
    showNotification('✅ Local cache cleared successfully');
  } catch (err) {
    console.error('Error clearing cache:', err);
    showNotification('⚠️ Error clearing cache');
  }
}

function showNotification(message) {
  // Simple notification system
  const notif = document.createElement('div');
  notif.textContent = message;
  notif.style.cssText = `
    position: fixed;
    top: 80px;
    right: 20px;
    background: var(--card-bg);
    color: var(--text-primary);
    padding: 15px 25px;
    border-radius: 10px;
    border: 2px solid var(--accent-primary);
    z-index: 10000;
    animation: slideIn 0.3s ease;
  `;
  
  document.body.appendChild(notif);
  
  setTimeout(() => {
    notif.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => notif.remove(), 300);
  }, 3000);
}

// Export for global use
window.initSettings = initSettings;
window.applyTheme = applyTheme;
window.clearLocalCache = clearLocalCache;

console.log('✅ Settings module loaded');
