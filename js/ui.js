/* =========================================
   NaluXrp 🌊 – UI Module
   Handles navigation, themes, navbar behavior
   ========================================= */

// Global UI State
window.UI = {
  currentPage: 'dashboard',
  currentTheme: 'gold',
  themes: ['gold', 'cosmic', 'starry', 'hawaiian'],
  navbarLocked: false,
  lastScrollY: 0,
  scrollTimeout: null
};

/* ---------- NAVIGATION ---------- */
function switchPage(pageId) {
  console.log(`🔄 Switching to page: ${pageId}`);
  
  // Update active page section
  document.querySelectorAll('.page-section').forEach(sec => sec.classList.remove('active'));
  const target = document.getElementById(pageId);
  if (target) {
    target.classList.add('active');
    window.UI.currentPage = pageId;
    
    // Call page-specific init functions
    loadPageContent(pageId);
  } else {
    console.error(`❌ Page section not found: ${pageId}`);
  }
}

function loadPageContent(pageId) {
  try {
    console.log(`📄 Loading page: ${pageId}`);
    
    switch(pageId) {
      case 'dashboard':
        const dashContainer = document.getElementById('dashboard');
        if (dashContainer) {
          console.log('🧹 Clearing dashboard container');
          dashContainer.innerHTML = ''; // Clear landing page
        }
        
        if (typeof renderDashboard === 'function') {
          console.log('🚀 Calling renderDashboard()');
          renderDashboard();
        } else {
          console.warn('⚠️ Dashboard module not loaded');
          showDefaultPage('dashboard');
        }
        break;
      case 'validators':
        if (typeof initValidators === 'function') initValidators();
        else showDefaultPage('validators');
        break;
      case 'tokens':
        if (typeof initTokens === 'function') initTokens();
        else showDefaultPage('tokens');
        break;
      case 'amm':
        if (typeof initAMM === 'function') initAMM();
        else showDefaultPage('amm');
        break;
      case 'analytics':
        if (typeof initAnalytics === 'function') initAnalytics();
        else showDefaultPage('analytics');
        break;
      case 'explorer':
        if (typeof initExplorer === 'function') initExplorer();
        else showDefaultPage('explorer');
        break;
      case 'nfts':
        if (typeof initNFTs === 'function') initNFTs();
        else showDefaultPage('nfts');
        break;
      case 'profile':
        if (typeof initProfile === 'function') initProfile();
        else showDefaultPage('profile');
        break;
      case 'news':
        if (typeof initNews === 'function') initNews();
        else showDefaultPage('news');
        break;
      case 'history':
        if (typeof initHistory === 'function') initHistory();
        else showDefaultPage('history');
        break;
      case 'settings':
        if (typeof initSettings === 'function') initSettings();
        else showDefaultPage('settings');
        break;
      case 'about':
        if (typeof initAbout === 'function') initAbout();
        else showDefaultPage('about');
        break;
      default:
        showDefaultPage('dashboard');
    }
  } catch (error) {
    console.error(`❌ Error loading ${pageId}:`, error);
    showDefaultPage(pageId);
  }
}

/* ---------- DEFAULT PAGE FALLBACK ---------- */
function showDefaultPage(pageId) {
  const container = document.getElementById(pageId);
  if (!container) return;
  
  const pageTitles = {
    dashboard: '🌊 Dashboard',
    validators: '🛡️ Validators',
    tokens: '🪙 Tokens',
    amm: '💧 AMM Pools',
    analytics: '📈 Analytics',
    explorer: '🔍 Explorer',
    nfts: '🎨 NFTs',
    profile: '👤 Profile',
    news: '📰 News',
    history: '📜 History',
    settings: '⚙️ Settings',
    about: 'ℹ️ About'
  };
  
  container.innerHTML = `
    <div class="chart-section">
      <div class="chart-title">${pageTitles[pageId] || 'Page'}</div>
      <div style="text-align: center; padding: 60px 20px;">
        <div style="font-size: 4em; margin-bottom: 20px;">🚧</div>
        <h2 style="color: var(--accent-secondary); margin-bottom: 15px;">Page Under Construction</h2>
        <p style="color: var(--text-secondary); font-size: 1.1em; line-height: 1.6;">
          The ${pageTitles[pageId] || 'page'} is currently being developed.<br>
          Check back soon for amazing features and real-time data!
        </p>
        <button onclick="switchPage('dashboard')" style="
          margin-top: 30px;
          padding: 12px 24px;
          background: var(--accent-primary);
          color: #000;
          border: none;
          border-radius: 10px;
          font-weight: bold;
          cursor: pointer;
          font-size: 1.1em;
        ">
          🏠 Return to Dashboard
        </button>
      </div>
    </div>
  `;
}

/* ---------- INITIAL LANDING PAGE ---------- */
function showLandingPage() {
  const dashboardContainer = document.getElementById('dashboard');
  if (!dashboardContainer) return;
  
  dashboardContainer.innerHTML = `
    <div style="max-width: 1000px; margin: 0 auto; padding: 40px 20px;">
      <!-- Hero Section -->
      <div style="text-align: center; margin-bottom: 60px;">
        <div style="font-size: 5em; margin-bottom: 20px;">🌊</div>
        <h1 style="font-size: 3.5em; color: var(--accent-secondary); margin-bottom: 20px; text-shadow: 0 0 20px var(--glow-color);">
          NaluXrp
        </h1>
        <p style="font-size: 1.4em; color: var(--text-secondary); margin-bottom: 30px;">
          Riding The Ledger Waves
        </p>
        <p style="font-size: 1.1em; color: var(--text-primary); line-height: 1.6; max-width: 600px; margin: 0 auto 40px;">
          Your comprehensive dashboard for the XRP Ledger. Monitor network activity, 
          analyze transactions, explore tokens and NFTs, and ride the waves of decentralized finance.
        </p>
        
        <button onclick="switchPage('dashboard')" style="
          padding: 16px 32px;
          background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
          color: #000;
          border: none;
          border-radius: 12px;
          font-weight: bold;
          cursor: pointer;
          font-size: 1.2em;
          margin: 10px;
          transition: all 0.3s ease;
        " onmouseover="this.style.transform='scale(1.05)'; this.style.boxShadow='0 10px 30px var(--glow-color)'" 
        onmouseout="this.style.transform='scale(1)'; this.style.boxShadow='none'">
          🚀 Launch Dashboard
        </button>
      </div>

      <!-- Features Grid -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 30px; margin-bottom: 60px;">
        <div style="background: var(--card-bg); padding: 30px; border-radius: 15px; border: 2px solid var(--accent-tertiary); text-align: center;">
          <div style="font-size: 3em; margin-bottom: 15px;">📊</div>
          <h3 style="color: var(--accent-secondary); margin-bottom: 15px;">Live Analytics</h3>
          <p style="color: var(--text-secondary); line-height: 1.6;">
            Real-time monitoring of XRPL network metrics, transaction volumes, and validator performance.
          </p>
        </div>
        
        <div style="background: var(--card-bg); padding: 30px; border-radius: 15px; border: 2px solid var(--accent-tertiary); text-align: center;">
          <div style="font-size: 3em; margin-bottom: 15px;">💧</div>
          <h3 style="color: var(--accent-secondary); margin-bottom: 15px;">AMM Pools</h3>
          <p style="color: var(--text-secondary); line-height: 1.6;">
            Explore Automated Market Maker pools, liquidity, and trading opportunities on the XRPL DEX.
          </p>
        </div>
        
        <div style="background: var(--card-bg); padding: 30px; border-radius: 15px; border: 2px solid var(--accent-tertiary); text-align: center;">
          <div style="font-size: 3em; margin-bottom: 15px;">🎨</div>
          <h3 style="color: var(--accent-secondary); margin-bottom: 15px;">NFT Explorer</h3>
          <p style="color: var(--text-secondary); line-height: 1.6;">
            Discover and analyze NFTs on the XRP Ledger with advanced filtering and metadata viewing.
          </p>
        </div>
      </div>

      <!-- Connection Status -->
      <div style="background: var(--bg-secondary); padding: 30px; border-radius: 15px; border: 2px solid var(--accent-primary); text-align: center;">
        <h3 style="color: var(--accent-secondary); margin-bottom: 20px;">🌐 Network Status</h3>
        <div id="landingConnectionStatus" style="display: inline-flex; align-items: center; gap: 15px; padding: 15px 25px; background: var(--card-bg); border-radius: 10px; border: 2px solid var(--accent-tertiary);">
          <div class="status-dot" id="landingStatusDot"></div>
          <span id="landingConnectionText" style="font-weight: bold; font-size: 1.1em;">
            Connecting to XRPL Network...
          </span>
        </div>
        <p style="color: var(--text-secondary); margin-top: 20px;">
          Establishing secure connection to the XRP Ledger for real-time data...
        </p>
      </div>
    </div>
  `;
  
  // Update connection status on landing page
  updateLandingConnectionStatus();
}

/* ---------- UPDATE LANDING CONNECTION STATUS ---------- */
function updateLandingConnectionStatus() {
  const dot = document.getElementById('landingStatusDot');
  const text = document.getElementById('landingConnectionText');
  
  if (!dot || !text) return;
  
  if (window.XRPL?.connected) {
    dot.classList.add('active');
    text.textContent = `Connected to ${window.XRPL.server?.name || 'XRPL'}`;
    text.style.color = '#50fa7b';
  } else {
    dot.classList.remove('active');
    text.textContent = 'Connecting to XRPL...';
    text.style.color = '#ffb86c';
  }
}

/* ---------- THEME SYSTEM ---------- */
function cycleTheme() {
  const currentIndex = window.UI.themes.indexOf(window.UI.currentTheme);
  const nextIndex = (currentIndex + 1) % window.UI.themes.length;
  window.UI.currentTheme = window.UI.themes[nextIndex];
  setTheme(window.UI.currentTheme);
}

function setTheme(theme) {
  window.UI.currentTheme = theme;
  document.body.className = `theme-${theme}`;
  
  // Update background effects
  if (theme === 'starry' || theme === 'cosmic') {
    createStars();
  } else {
    const container = document.getElementById('starsContainer');
    if (container) container.innerHTML = '';
  }
  
  if (typeof showNotification === 'function') {
    showNotification(`Theme: ${theme}`, 'success');
  }
}

function createStars() {
  const container = document.getElementById('starsContainer');
  if (!container) return;
  
  container.innerHTML = '';
  const starCount = window.UI.currentTheme === 'starry' ? 500 : 300;
  
  for (let i = 0; i < starCount; i++) {
    const star = document.createElement('div');
    const size = Math.random();
    star.className = size < 0.6 ? 'star small' : size < 0.9 ? 'star medium' : 'star large';
    star.style.left = Math.random() * 100 + '%';
    star.style.top = Math.random() * 100 + '%';
    star.style.animation = `twinkle ${Math.random() * 3 + 2}s ease-in-out infinite`;
    star.style.animationDelay = Math.random() * 3 + 's';
    container.appendChild(star);
  }
}

/* ---------- NAVBAR BEHAVIOR ---------- */
function initNavbar() {
  const navbar = document.getElementById('navbar');
  const toggleBtn = document.getElementById('navbarToggle');
  const hamburger = document.getElementById('hamburger');
  const navLinks = document.getElementById('navLinks');
  
  if (!navbar) return;
  
  // Scroll behavior
  window.addEventListener('scroll', () => {
    const currentScroll = window.scrollY;
    
    if (currentScroll > 100) {
      document.body.classList.add('scrolled');
    } else {
      document.body.classList.remove('scrolled');
    }
    
    if (window.UI.navbarLocked) {
      window.UI.lastScrollY = currentScroll;
      return;
    }
    
    clearTimeout(window.UI.scrollTimeout);
    
    if (currentScroll <= 50) {
      navbar.classList.remove('hide');
      window.UI.lastScrollY = currentScroll;
      return;
    }
    
    if (currentScroll > window.UI.lastScrollY && currentScroll > 100) {
      navbar.classList.add('hide');
    } else if (currentScroll < window.UI.lastScrollY) {
      navbar.classList.remove('hide');
    }
    
    if (currentScroll > 150) {
      window.UI.scrollTimeout = setTimeout(() => {
        if (window.scrollY > 150 && !window.UI.navbarLocked) {
          navbar.classList.add('hide');
        }
      }, 3000);
    }
    
    window.UI.lastScrollY = currentScroll;
  });
  
  // Toggle button
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      navbar.classList.toggle('hide');
      window.UI.navbarLocked = !navbar.classList.contains('hide');
    });
  }
  
  // Keyboard shortcut (N key)
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    
    if (e.key.toLowerCase() === 'n') {
      navbar.classList.toggle('hide');
      window.UI.navbarLocked = !navbar.classList.contains('hide');
    }
  });
  
  // Hamburger menu
  if (hamburger && navLinks) {
    hamburger.addEventListener('click', () => {
      hamburger.classList.toggle('active');
      navLinks.classList.toggle('show');
    });
    
    // Close menu when clicking a navigation button
    navLinks.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (window.innerWidth <= 992) {
          hamburger.classList.remove('active');
          navLinks.classList.remove('show');
        }
      });
    });
  }
}

/* ---------- INITIALIZATION ---------- */
document.addEventListener('DOMContentLoaded', () => {
  console.log('🌊 NaluXrp UI initializing...');
  
  // Set initial theme
  setTheme(window.UI.currentTheme);
  
  // Initialize navbar behavior
  initNavbar();
  
  // Show landing page initially
  showLandingPage();
  
  // Set up connection status updates
  setInterval(updateLandingConnectionStatus, 2000);
  
  // Listen for XRPL connection events
  window.addEventListener('xrpl-connected', updateLandingConnectionStatus);
  window.addEventListener('xrpl-disconnected', updateLandingConnectionStatus);
  
  // Smooth fade-in
  document.body.style.opacity = '0';
  setTimeout(() => {
    document.body.style.transition = 'opacity 1s';
    document.body.style.opacity = '1';
  }, 100);
  
  console.log('✅ UI ready!');
});

/* ---------- EXPORTS ---------- */
window.switchPage = switchPage;
window.cycleTheme = cycleTheme;
window.setTheme = setTheme;
window.showLandingPage = showLandingPage;

console.log('🎨 UI module loaded');