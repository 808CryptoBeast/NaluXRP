/* =========================================================
   NaluLF - Page Navigation System
   
   Handles page switching and ensures proper content loading
   
   ✅ FIX: Landing page persists until user clicks away
   ========================================================= */

(function() {
  'use strict';
  
  console.log('🌊 NaluLF: Page Navigation System Loading...');
  
  // Track if we're on landing page
  let isOnLandingPage = true;
  
  // Wait for DOM to be ready
  function init() {
    console.log('🔧 Initializing page navigation system...');
    
    // STEP 1: Force hide all pages
    function hideAllPages() {
      document.querySelectorAll('.page-section').forEach(page => {
        page.classList.remove('active');
        page.style.cssText = `
          display: none !important;
          visibility: hidden !important;
          opacity: 0 !important;
          position: absolute !important;
          left: -9999px !important;
          top: -9999px !important;
          pointer-events: none !important;
        `;
      });
    }
    
    // STEP 2: Force show one page
    function showPage(pageId) {
      const page = document.getElementById(pageId);
      if (!page) {
        console.error(`❌ Page not found: ${pageId}`);
        return false;
      }
      
      page.classList.add('active');
      page.style.cssText = `
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
        position: relative !important;
        left: 0 !important;
        top: 0 !important;
        pointer-events: auto !important;
      `;
      
      return true;
    }
    
    // STEP 3: Override switchPage function
    window.switchPage = function(pageId) {
      console.log(`🌊 Switching to: ${pageId}`);
      
      // Mark that we're leaving landing page
      if (isOnLandingPage && pageId !== 'landing') {
        console.log('👋 Leaving landing page...');
        isOnLandingPage = false;
        
        // Clear landing background if needed
        if (window.UI) {
          window.UI.isLandingPage = false;
        }
      }
      
      // Hide all first
      hideAllPages();
      
      // Show target
      if (!showPage(pageId)) return;
      
      // Get the page element
      const page = document.getElementById(pageId);
      
      // ✅ FIX: Don't clear content if returning to landing page
      if (pageId === 'landing' || (pageId === 'dashboard' && isOnLandingPage)) {
        console.log('🏠 Staying on/returning to landing page');
        isOnLandingPage = true;
        if (window.UI) {
          window.UI.isLandingPage = true;
        }
        // Don't clear or re-render
        return;
      }
      
      // Clear content for non-landing pages
      page.innerHTML = '';
      
      // Initialize based on page type
      console.log(`🔧 Initializing ${pageId}...`);
      
      switch(pageId) {
        case 'dashboard':
          if (typeof window.renderDashboard === 'function') {
            window.renderDashboard();
          } else {
            page.innerHTML = '<div class="chart-section"><h2>Dashboard</h2><p>Loading...</p></div>';
          }
          break;
          
        case 'inspector':
          if (typeof window.initInspector === 'function') {
            window.initInspector();
          } else {
            page.innerHTML = '<div class="chart-section"><h2>Inspector</h2><p>Loading...</p></div>';
          }
          break;
          
        case 'analytics':
          if (typeof window.initAnalytics === 'function') {
            window.initAnalytics();
          } else {
            page.innerHTML = '<div class="chart-section"><h2>Analytics</h2><p>Loading...</p></div>';
          }
          break;
          
        case 'validators':
          if (typeof window.initValidators === 'function') {
            window.initValidators();
          } else {
            page.innerHTML = '<div class="chart-section"><h2>Validators</h2><p>Loading...</p></div>';
          }
          break;
          
        case 'tokens':
          if (typeof window.initTokens === 'function') {
            window.initTokens();
          } else {
            page.innerHTML = '<div class="chart-section"><h2>Tokens</h2><p>Loading...</p></div>';
          }
          break;
          
        case 'amm':
          if (typeof window.AMM && typeof window.AMM.init === 'function') {
            window.AMM.init();
          } else {
            page.innerHTML = '<div class="chart-section"><h2>AMM Pools</h2><p>Loading...</p></div>';
          }
          break;
          
        case 'explorer':
          if (typeof window.initExplorer === 'function') {
            window.initExplorer();
          } else {
            page.innerHTML = '<div class="chart-section"><h2>Explorer</h2><p>Loading...</p></div>';
          }
          break;
          
        case 'nfts':
          if (typeof window.initNFTs === 'function') {
            window.initNFTs();
          } else {
            page.innerHTML = '<div class="chart-section"><h2>NFTs</h2><p>Loading...</p></div>';
          }
          break;
          
        case 'profile':
          if (typeof window.initProfile === 'function') {
            window.initProfile();
          } else {
            page.innerHTML = '<div class="chart-section"><h2>Profile</h2><p>Loading...</p></div>';
          }
          break;
          
        case 'news':
          if (typeof window.initNews === 'function') {
            window.initNews();
          } else {
            page.innerHTML = '<div class="chart-section"><h2>News</h2><p>Loading...</p></div>';
          }
          break;
          
        case 'history':
          if (typeof window.initHistory === 'function') {
            window.initHistory();
          } else {
            page.innerHTML = '<div class="chart-section"><h2>History</h2><p>Loading...</p></div>';
          }
          break;
          
        case 'settings':
          if (typeof window.initSettings === 'function') {
            window.initSettings();
          } else {
            page.innerHTML = '<div class="chart-section"><h2>Settings</h2><p>Loading...</p></div>';
          }
          break;
          
        case 'about':
          if (typeof window.initAbout === 'function') {
            window.initAbout();
          } else {
            page.innerHTML = '<div class="chart-section"><h2>About</h2><p>Loading...</p></div>';
          }
          break;
          
        default:
          page.innerHTML = `<div class="chart-section"><h2>${pageId}</h2><p>Page not configured</p></div>`;
      }
      
      // Update UI
      if (window.UI) {
        window.UI.currentPage = pageId;
      }
      
      // Scroll to top
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      
      // Dispatch event
      window.dispatchEvent(new CustomEvent("naluxrp:pagechange", { detail: { pageId } }));
      
      // Verify (silent - only log if there's a problem)
      setTimeout(() => {
        const visible = Array.from(document.querySelectorAll('.page-section')).filter(p => {
          const style = window.getComputedStyle(p);
          return style.display !== 'none';
        });
        
        if (visible.length !== 1) {
          console.warn(`⚠️ Page navigation issue: ${visible.length} pages visible`, visible.map(p => p.id));
        }
      }, 100);
    };
    
    // STEP 4: Fix initial state - don't auto-render dashboard
    hideAllPages();
    showPage('dashboard');
    
    // ✅ FIX: Don't automatically call renderDashboard - let ui.js handle landing page
    console.log('✅ Page Navigation System Active');
    console.log('🏠 Landing page will be shown by ui.js');
  }
  
  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  
  // ✅ Prevent XRPL events from triggering dashboard render on landing page
  window.addEventListener('xrpl-ledger', (ev) => {
    // Only apply dashboard updates if we're NOT on landing page
    if (isOnLandingPage) {
      console.log('🏠 On landing page - skipping dashboard auto-update');
      return;
    }
    
    // Let the normal dashboard handler continue
  });
  
})();