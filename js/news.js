/* =========================================
   NaluXrp 🌊 – News Module
   XRPL ecosystem news and updates
   ========================================= */

function initNews() {
  const container = document.getElementById('news');
  if (!container) return;
  
  container.innerHTML = `
    <div class="chart-section">
      <div class="chart-title">📰 XRPL News & Updates</div>
      
      <div style="max-width: 900px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <p style="font-size: 1.1em; color: var(--text-secondary);">
            Stay updated with the latest news and developments in the XRP Ledger ecosystem
          </p>
        </div>
        
        <div style="display: grid; gap: 20px;">
          ${generateNewsItems()}
        </div>
        
        <div style="text-align: center; margin-top: 30px; padding: 20px; background: var(--card-bg); border-radius: 12px; border: 2px solid var(--accent-tertiary);">
          <p style="color: var(--text-secondary);">
            For the latest updates, visit 
            <a href="https://xrpl.org/" target="_blank" style="color: var(--accent-primary); text-decoration: none; font-weight: 600;">xrpl.org</a>
          </p>
        </div>
      </div>
    </div>
  `;
}

function generateNewsItems() {
  const newsItems = [
    {
      title: 'XRP Ledger Development Updates',
      date: '2024',
      description: 'Ongoing improvements to the XRP Ledger protocol, including enhanced AMM functionality and new features.',
      category: 'Development',
      icon: '🔧'
    },
    {
      title: 'AMM (Automated Market Maker) Integration',
      date: '2024',
      description: 'Native AMM functionality on the XRP Ledger enabling decentralized token swaps and liquidity provision.',
      category: 'DeFi',
      icon: '💧'
    },
    {
      title: 'NFT Support on XRPL',
      date: '2023',
      description: 'Native NFT support added to the XRP Ledger, enabling efficient NFT minting, trading, and management.',
      category: 'NFTs',
      icon: '🎨'
    },
    {
      title: 'XRPL Community Growth',
      date: 'Ongoing',
      description: 'The XRP Ledger community continues to expand with new developers, projects, and ecosystem participants.',
      category: 'Community',
      icon: '🌍'
    },
    {
      title: 'Validator Network Expansion',
      date: 'Ongoing',
      description: 'Growing network of validators ensuring the security and decentralization of the XRP Ledger.',
      category: 'Network',
      icon: '🛡️'
    }
  ];
  
  return newsItems.map(item => `
    <div style="background: var(--card-bg); border-radius: 15px; padding: 25px; border: 2px solid var(--accent-tertiary); transition: all 0.3s ease;"
         onmouseover="this.style.borderColor='var(--accent-primary)'; this.style.transform='translateX(5px)'"
         onmouseout="this.style.borderColor='var(--accent-tertiary)'; this.style.transform='translateX(0)'">
      
      <div style="display: flex; align-items: start; gap: 15px; margin-bottom: 15px;">
        <div style="font-size: 2.5em; flex-shrink: 0;">${item.icon}</div>
        <div style="flex: 1;">
          <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 10px;">
            <h3 style="font-size: 1.3em; color: var(--accent-primary); margin: 0;">${item.title}</h3>
            <span style="background: var(--accent-primary); color: #000; padding: 4px 12px; border-radius: 20px; font-size: 0.75em; font-weight: 600; white-space: nowrap; margin-left: 10px;">
              ${item.category}
            </span>
          </div>
          <div style="color: var(--text-secondary); font-size: 0.85em; margin-bottom: 12px;">
            📅 ${item.date}
          </div>
          <p style="color: var(--text-primary); line-height: 1.6; margin: 0;">
            ${item.description}
          </p>
        </div>
      </div>
    </div>
  `).join('');
}

// Export for global use
window.initNews = initNews;

console.log('✅ News module loaded');
