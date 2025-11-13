/* =========================================
   NaluXrp 🌊 – NFTs Module
   View and explore XRPL NFTs
   ========================================= */

let nftCache = [];

function initNFTs() {
  const container = document.getElementById('nfts');
  if (!container) return;
  
  container.innerHTML = `
    <div class="chart-section">
      <div class="chart-title">🎨 XRPL NFTs</div>
      
      <div style="margin-bottom: 25px;">
        <div style="display: flex; gap: 10px; flex-wrap: wrap;">
          <input 
            id="nft-address-input" 
            type="text" 
            placeholder="Enter XRPL address to view NFTs..." 
            style="flex: 1; min-width: 300px; padding: 12px; border-radius: 10px; border: 2px solid var(--accent-tertiary); background: rgba(0,0,0,0.4); color: #fff; font-size: 1em;"
          />
          <button 
            onclick="searchNFTs()" 
            style="padding: 12px 24px; background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary)); border: none; border-radius: 10px; color: #000; font-weight: 700; cursor: pointer;"
          >
            🔍 Search
          </button>
        </div>
      </div>
      
      <div id="nfts-grid">
        <div style="color: #888; text-align: center; padding: 60px 20px;">
          <div style="font-size: 4em; margin-bottom: 20px;">🎨</div>
          <div style="font-size: 1.3em; font-weight: 600; margin-bottom: 10px;">NFT Explorer</div>
          <div style="font-size: 1em; opacity: 0.8;">Enter an address to view its NFT collection</div>
        </div>
      </div>
    </div>
  `;
  
  document.getElementById('nft-address-input')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') searchNFTs();
  });
}

async function searchNFTs() {
  const input = document.getElementById('nft-address-input');
  const address = input?.value.trim();
  const container = document.getElementById('nfts-grid');
  
  if (!address) {
    showNotification('Please enter an address', 'error');
    return;
  }
  
  if (!isValidXRPAddress(address)) {
    showNotification('Invalid XRPL address', 'error');
    return;
  }
  
  if (!container) return;
  container.innerHTML = '<div class="loading">Loading NFTs...</div>';
  
  try {
    if (!window.XRPL?.client || !window.XRPL.connected) {
      throw new Error('Not connected to XRPL');
    }
    
    const response = await window.XRPL.client.request({
      command: 'account_nfts',
      account: address
    });
    
    nftCache = response.result.account_nfts || [];
    
    if (!nftCache.length) {
      container.innerHTML = `
        <div style="color: #888; text-align: center; padding: 40px;">
          <div style="font-size: 2.5em; margin-bottom: 15px;">📭</div>
          <div style="font-size: 1.1em;">No NFTs found for this address</div>
        </div>
      `;
      return;
    }
    
    displayNFTs(nftCache);
    showNotification(`Found ${nftCache.length} NFTs`, 'success');
  } catch (err) {
    console.error('❌ Error fetching NFTs:', err);
    container.innerHTML = `
      <div style="color: #ff5555; text-align: center; padding: 40px;">
        <div style="font-size: 2em; margin-bottom: 10px;">⚠️</div>
        <div>Error fetching NFTs</div>
      </div>
    `;
    showNotification('Error fetching NFTs', 'error');
  }
}

function displayNFTs(nfts) {
  const container = document.getElementById('nfts-grid');
  if (!container) return;
  
  container.innerHTML = `
    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 20px;">
      ${nfts.map(nft => createNFTCard(nft)).join('')}
    </div>
  `;
}

function createNFTCard(nft) {
  const tokenId = nft.NFTokenID.slice(0, 12);
  const issuer = shortenAddress(nft.Issuer, 8, 6);
  const uri = nft.URI ? xrpl.convertHexToString(nft.URI) : '';
  const hasImage = uri.match(/\.(jpg|jpeg|png|gif|webp)$/i);
  
  return `
    <div style="
      background: var(--card-bg);
      border-radius: 15px;
      overflow: hidden;
      border: 2px solid var(--accent-tertiary);
      transition: all 0.3s ease;
      cursor: pointer;
    "
    onmouseover="this.style.borderColor='var(--accent-primary)'; this.style.transform='translateY(-5px)'"
    onmouseout="this.style.borderColor='var(--accent-tertiary)'; this.style.transform='translateY(0)'"
    onclick="viewNFTDetails('${nft.NFTokenID}')">
      
      <div style="
        width: 100%;
        height: 200px;
        background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 4em;
      ">
        ${hasImage ? `<img src="${uri}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none'"/>` : '🎨'}
      </div>
      
      <div style="padding: 15px;">
        <div style="font-weight: 700; font-size: 1.1em; color: var(--accent-secondary); margin-bottom: 5px;">
          ${tokenId}...
        </div>
        <div style="font-size: 0.85em; color: var(--text-secondary);">
          Issuer: ${issuer}
        </div>
        <div style="margin-top: 10px; font-size: 0.8em; color: var(--accent-tertiary);">
          Flags: ${nft.Flags || 0}
        </div>
      </div>
    </div>
  `;
}

function viewNFTDetails(tokenId) {
  const nft = nftCache.find(n => n.NFTokenID === tokenId);
  if (!nft) return;
  
  showNotification(`NFT: ${tokenId.slice(0, 12)}...`, 'info');
}

window.initNFTs = initNFTs;
window.searchNFTs = searchNFTs;

console.log('🎨 NFTs module loaded');