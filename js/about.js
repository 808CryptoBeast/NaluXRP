/* =========================================
   NaluXrp 🌊 – About Module
   Information about the application
   ========================================= */

function initAbout() {
  const container = document.getElementById('about');
  if (!container) return;
  
  container.innerHTML = `
    <div class="chart-section">
      <div class="chart-title">ℹ️ About NaluXrp</div>
      
      <div style="max-width: 800px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 40px;">
          <h1 style="font-size: 3em; margin-bottom: 10px;">🌊 NaluXrp</h1>
          <p style="font-size: 1.5em; color: var(--accent-primary); margin-bottom: 10px;">
            Riding The Ledger Waves
          </p>
          <p style="color: var(--text-secondary); font-size: 1.1em;">
            A comprehensive, real-time analytics dashboard for the XRP Ledger (XRPL)
          </p>
        </div>
        
        <div style="background: var(--card-bg); border-radius: 15px; padding: 30px; margin-bottom: 30px; border: 2px solid var(--accent-tertiary);">
          <h2 style="color: var(--accent-primary); margin-bottom: 15px;">🎯 What is NaluXrp?</h2>
          <p style="line-height: 1.8; color: var(--text-primary); margin-bottom: 15px;">
            NaluXrp is a deep-inspection platform for the XRP Ledger. It goes beyond surface metrics 
            to expose patterns, dominance, stress signals, and anomalous behavior — helping analysts, 
            builders, and investigators understand what's really happening on-chain.
          </p>
          <p style="line-height: 1.8; color: var(--text-primary);">
            "Nalu" is the Hawaiian word for "wave" or "surf". Just as surfers ride ocean waves, 
            NaluXrp helps you ride the waves of the XRP Ledger! 🏄‍♂️
          </p>
        </div>
        
        <div style="background: var(--card-bg); border-radius: 15px; padding: 30px; margin-bottom: 30px; border: 2px solid var(--accent-tertiary);">
          <h2 style="color: var(--accent-primary); margin-bottom: 15px;">✨ Key Features</h2>
          <ul style="list-style: none; padding: 0;">
            <li style="padding: 10px 0; border-bottom: 1px solid var(--accent-tertiary);">
              📊 <strong>Live Dashboard</strong> - Real-time XRPL network metrics and monitoring
            </li>
            <li style="padding: 10px 0; border-bottom: 1px solid var(--accent-tertiary);">
              🛡️ <strong>Validator Monitor</strong> - Track network validator performance and consensus
            </li>
            <li style="padding: 10px 0; border-bottom: 1px solid var(--accent-tertiary);">
              🪙 <strong>Token Explorer</strong> - Discover and analyze XRPL tokens
            </li>
            <li style="padding: 10px 0; border-bottom: 1px solid var(--accent-tertiary);">
              💧 <strong>AMM Pools</strong> - Explore Automated Market Maker liquidity pools
            </li>
            <li style="padding: 10px 0; border-bottom: 1px solid var(--accent-tertiary);">
              🎨 <strong>NFT Browser</strong> - Browse and explore XRP Ledger NFTs
            </li>
            <li style="padding: 10px 0; border-bottom: 1px solid var(--accent-tertiary);">
              📈 <strong>Advanced Analytics</strong> - Deep forensics and pattern analysis
            </li>
            <li style="padding: 10px 0;">
              🔍 <strong>Explorer</strong> - Search transactions and accounts
            </li>
          </ul>
        </div>
        
        <div style="background: var(--card-bg); border-radius: 15px; padding: 30px; margin-bottom: 30px; border: 2px solid var(--accent-tertiary);">
          <h2 style="color: var(--accent-primary); margin-bottom: 15px;">🛠️ Technology Stack</h2>
          <ul style="list-style: none; padding: 0;">
            <li style="padding: 8px 0;">📦 <strong>Frontend:</strong> HTML5, CSS3, JavaScript (ES6+)</li>
            <li style="padding: 8px 0;">📊 <strong>Charts:</strong> Chart.js</li>
            <li style="padding: 8px 0;">🔗 <strong>XRPL Integration:</strong> xrpl.js library</li>
            <li style="padding: 8px 0;">🎨 <strong>Styling:</strong> Custom CSS with CSS Variables</li>
            <li style="padding: 8px 0;">📱 <strong>Design:</strong> Responsive, mobile-first approach</li>
          </ul>
        </div>
        
        <div style="background: var(--card-bg); border-radius: 15px; padding: 30px; border: 2px solid var(--accent-tertiary);">
          <h2 style="color: var(--accent-primary); margin-bottom: 15px;">🙏 Acknowledgments</h2>
          <p style="line-height: 1.8; color: var(--text-primary); margin-bottom: 10px;">
            Special thanks to:
          </p>
          <ul style="list-style: none; padding: 0;">
            <li style="padding: 8px 0;">🔗 <strong>XRPL.js</strong> - XRP Ledger JavaScript library</li>
            <li style="padding: 8px 0;">📊 <strong>Chart.js</strong> - Beautiful data visualization</li>
            <li style="padding: 8px 0;">🏛️ <strong>XRPL Foundation</strong> - Comprehensive documentation</li>
            <li style="padding: 8px 0;">🏄‍♂️ <strong>Hawaiian surf culture</strong> - For the "Nalu" inspiration</li>
          </ul>
        </div>
        
        <div style="text-align: center; margin-top: 40px; padding: 30px; background: linear-gradient(135deg, rgba(255,215,0,0.1), rgba(0,149,255,0.1)); border-radius: 15px;">
          <p style="font-size: 1.3em; font-weight: 600; color: var(--accent-primary); margin-bottom: 10px;">
            Made with 💙 for the XRPL community
          </p>
          <p style="font-size: 1.2em; color: var(--accent-secondary);">
            Ride the ledger waves! 🌊
          </p>
        </div>
      </div>
    </div>
  `;
}

// Export for global use
window.initAbout = initAbout;

console.log('✅ About module loaded');
