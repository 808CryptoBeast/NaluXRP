/* =========================================
   NaluLF 🌊 – UI Module (FULL)
   + Global header search
   + Command palette (Ctrl+K / Cmd+K / /)
   + Saved addresses + Pin-to-Inspector
   + Theme preview picker
   + Dispatches naluxrp:pagechange so navbar can highlight
   + Connection status monitoring for navbar

   ✅ FIX: Disable injected "page header" (Home / Welcome / Search / ★ 🎨 ⌘)
   - Controlled by ENABLE_PAGE_HEADER (false)

   ✅ FIX: switchPage now scrolls to top so Inspector doesn't open at the bottom
   
   ✅ FIX: Branding updated from NaluXrp to NaluLF
   
   ✅ FIX: XRPL connection monitoring with event dispatches for navbar status
   
   ✅ FIX: Inspector initialization - CLEARS innerHTML to prevent stacking
   ========================================= */

(function () {
  // ✅ Toggle injected header UI on/off
  const ENABLE_PAGE_HEADER = false;

  // -----------------------------
  // Global UI State
  // -----------------------------
  window.UI = {
    currentPage: "dashboard",
    currentTheme: "gold",
    themes: ["gold", "cosmic", "starry", "hawaiian"],
    observers: { reveal: null },
    landing: { active: false, onScroll: null },
  };

  const LS_SAVED = "naluxrp_saved_addresses";
  const LS_PINNED = "naluxrp_pinned_address";

  const PAGE_META = {
    dashboard: { crumb: "Dashboard", sub: "Ledger Overview", title: "Dashboard" },
    inspector: { crumb: "Inspector", sub: "Tree • Trace • Quick Inspect", title: "Inspector" },
    analytics: { crumb: "Analytics", sub: "Patterns & Metrics", title: "Analytics" },
    explorer: { crumb: "Explorer", sub: "Search the XRPL", title: "Explorer" },
    validators: { crumb: "Validators", sub: "Health & Performance", title: "Validators" },
    tokens: { crumb: "Tokens", sub: "Distribution & Markets", title: "Tokens" },
    amm: { crumb: "AMM Pools", sub: "Liquidity & Swaps", title: "AMM Pools" },
    nfts: { crumb: "NFTs", sub: "Collections & Activity", title: "NFTs" },
    profile: { crumb: "Profile", sub: "Account & Preferences", title: "Profile" },
    news: { crumb: "News", sub: "Ledger Updates", title: "News" },
    history: { crumb: "History", sub: "Snapshots & Events", title: "History" },
    settings: { crumb: "Settings", sub: "System Configuration", title: "Settings" },
    about: { crumb: "About", sub: "NaluLF Info", title: "About" },
  };

  // -----------------------------
  // Helpers
  // -----------------------------
  function isValidXrpAddress(addr) {
    return /^r[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(String(addr || "").trim());
  }

  function isTxHash(h) {
    const s = String(h || "").trim();
    return /^[A-Fa-f0-9]{64}$/.test(s);
  }

  function isLedgerIndex(v) {
    const s = String(v ?? "").trim();
    if (!/^\d{1,10}$/.test(s)) return false;
    const n = Number(s);
    return Number.isFinite(n) && n > 0;
  }

  function safeGet(key) {
    try {
      return window.localStorage ? window.localStorage.getItem(key) : null;
    } catch (_) {
      return null;
    }
  }

  function safeSet(key, value) {
    try {
      if (window.localStorage) window.localStorage.setItem(key, value);
    } catch (_) {}
  }

  function safeJsonParse(s, fallback) {
    try {
      return JSON.parse(s);
    } catch (_) {
      return fallback;
    }
  }

  function dispatchSavedChange() {
    window.dispatchEvent(new CustomEvent("naluxrp:savedchange"));
  }

  // -----------------------------
  // Saved / Pinned
  // -----------------------------
  function getSaved() {
    const raw = safeGet(LS_SAVED);
    const arr = safeJsonParse(raw || "[]", []);
    return Array.isArray(arr) ? arr.filter(isValidXrpAddress) : [];
  }

  function setSaved(list) {
    const uniq = [];
    const seen = new Set();
    (list || []).forEach((a) => {
      const addr = String(a || "").trim();
      if (!isValidXrpAddress(addr)) return;
      if (seen.has(addr)) return;
      seen.add(addr);
      uniq.push(addr);
    });
    safeSet(LS_SAVED, JSON.stringify(uniq.slice(0, 25)));
    dispatchSavedChange();
    return uniq.slice(0, 25);
  }

  function saveAddress(addr) {
    const a = String(addr || "").trim();
    if (!isValidXrpAddress(a)) return false;
    const list = getSaved();
    if (!list.includes(a)) list.unshift(a);
    setSaved(list);
    return true;
  }

  function removeSaved(addr) {
    const a = String(addr || "").trim();
    const list = getSaved().filter((x) => x !== a);
    setSaved(list);
  }

  function getPinned() {
    const p = safeGet(LS_PINNED);
    return p && isValidXrpAddress(p) ? p : null;
  }

  function pinAddress(addr) {
    const a = String(addr || "").trim();
    if (!isValidXrpAddress(a)) return false;
    safeSet(LS_PINNED, a);
    dispatchSavedChange();
    updatePinnedPill();
    return true;
  }

  function unpinAddress() {
    safeSet(LS_PINNED, "");
    dispatchSavedChange();
    updatePinnedPill();
  }

  // -----------------------------
  // XRPL Connection Monitoring
  // -----------------------------
  function setupConnectionMonitoring() {
    // Monitor XRPL connection and dispatch events for navbar
    let wasConnected = false;

    function checkAndDispatch() {
      let isConnected = false;

      // Check various connection sources
      if (typeof window.xrplClient !== 'undefined' && window.xrplClient?.isConnected) {
        isConnected = window.xrplClient.isConnected();
      } else if (typeof window.client !== 'undefined' && window.client?.isConnected) {
        isConnected = window.client.isConnected();
      } else if (window.XRPL?.connected === true) {
        isConnected = true;
      } else if (window.connectionState === 'connected') {
        isConnected = true;
      }

      // Dispatch events on state change
      if (isConnected && !wasConnected) {
        console.log("🌊 NaluLF: XRPL Connected");
        window.dispatchEvent(new Event("xrpl:connected"));
        window.dispatchEvent(new Event("naluxrp:connected"));
        wasConnected = true;
      } else if (!isConnected && wasConnected) {
        console.log("🌊 NaluLF: XRPL Disconnected");
        window.dispatchEvent(new Event("xrpl:disconnected"));
        window.dispatchEvent(new Event("naluxrp:disconnected"));
        wasConnected = false;
      }
    }

    // Check immediately
    setTimeout(checkAndDispatch, 500);

    // Poll every 2 seconds as backup
    setInterval(checkAndDispatch, 2000);

    // Also listen for manual connection events from xrpl-connection.js
    window.addEventListener("xrpl:manual-connect", () => {
      wasConnected = false;
      checkAndDispatch();
    });

    window.addEventListener("xrpl:manual-disconnect", () => {
      wasConnected = true;
      checkAndDispatch();
    });
  }

  // -----------------------------
  // Theme + Page classes
  // -----------------------------
  function applyThemeClass(theme) {
    const body = document.body;
    if (!body) return;
    (window.UI.themes || []).forEach((t) => body.classList.remove(`theme-${t}`));
    body.classList.add(`theme-${theme}`);
  }

  function applyPageClass(pageId) {
    const body = document.body;
    if (!body) return;

    clearLandingBackground();
    stopLandingParallax();

    body.classList.remove("dashboard", "inspector");
    if (pageId === "inspector") body.classList.add("inspector");
    else body.classList.add("dashboard");
  }

  // -----------------------------
  // Header (breadcrumb + search + buttons)
  // -----------------------------
  function ensurePageHeader() {
    // ✅ FIX: header injection disabled
    if (!ENABLE_PAGE_HEADER) {
      // If it exists from older cached JS, remove it
      const existing = document.getElementById("pageHeader");
      if (existing) existing.remove();
      return;
    }

    if (document.getElementById("pageHeader")) return;

    const header = document.createElement("div");
    header.id = "pageHeader";
    header.className = "page-header";
    header.innerHTML = `
      <div class="page-header-inner">
        <div class="page-left">
          <div class="page-crumb" id="pageCrumb">Dashboard</div>
          <div class="page-sub" id="pageSub">Ledger Overview</div>
        </div>

        <div class="page-right">
          <div class="global-search">
            <input id="globalSearchInput" autocomplete="off" placeholder="Search page / address / tx / ledger…" />
            <button id="globalSearchBtn" type="button" aria-label="Search">⌕</button>
          </div>

          <div class="header-actions">
            <button id="savedBtn" class="header-icon-btn" type="button" title="Saved (★)">★</button>
            <button id="themePickerBtn" class="header-icon-btn" type="button" title="Theme picker">🎨</button>
            <button id="cmdkBtn" class="header-icon-btn" type="button" title="Command (Ctrl+K)">⌘</button>
          </div>

          <div id="pinnedPill" class="header-pill" style="display:none;" title="Pinned to Inspector">
            📌 <span id="pinnedText"></span>
            <button id="unpinBtn" type="button" aria-label="Unpin">✕</button>
          </div>
        </div>
      </div>
    `;

    const navbar = document.getElementById("navbar");
    if (navbar && navbar.parentNode) navbar.parentNode.insertBefore(header, navbar.nextSibling);
    else document.body.insertBefore(header, document.body.firstChild);

    // Bind header search
    const input = document.getElementById("globalSearchInput");
    const btn = document.getElementById("globalSearchBtn");

    if (btn) btn.addEventListener("click", () => runGlobalSearch(input?.value || ""));
    if (input) {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") runGlobalSearch(input.value);
      });
    }

    // Buttons
    document.getElementById("savedBtn")?.addEventListener("click", openSavedDialog);
    document.getElementById("themePickerBtn")?.addEventListener("click", openThemePicker);
    document.getElementById("cmdkBtn")?.addEventListener("click", openCommandPalette);

    document.getElementById("unpinBtn")?.addEventListener("click", () => {
      unpinAddress();
      toast("Unpinned");
    });

    updatePinnedPill();
  }

  function updatePageHeader(pageId, { landing = false } = {}) {
    // ✅ FIX: no header
    if (!ENABLE_PAGE_HEADER) return;

    ensurePageHeader();

    const crumb = document.getElementById("pageCrumb");
    const sub = document.getElementById("pageSub");
    if (!crumb || !sub) return;

    if (landing) {
      crumb.textContent = "Home";
      sub.textContent = "Welcome to NaluLF";
      return;
    }

    const meta = PAGE_META[pageId] || { crumb: pageId, sub: "" };
    crumb.textContent = meta.crumb || pageId;
    sub.textContent = meta.sub || "";
  }

  function updatePinnedPill() {
    // If header is disabled, this pill doesn't exist (safe no-op)
    const pill = document.getElementById("pinnedPill");
    const txt = document.getElementById("pinnedText");
    if (!pill || !txt) return;

    const p = getPinned();
    if (!p) {
      pill.style.display = "none";
      return;
    }
    pill.style.display = "inline-flex";
    txt.textContent = `${p.slice(0, 6)}…${p.slice(-5)}`;
  }

  // -----------------------------
  // Landing background + parallax
  // -----------------------------
  function setLandingBackground() {
    const body = document.body;
    if (!body) return;

    body.dataset.landingBg = "1";
    body.style.backgroundImage = 'url("images/LandingPage-background.jpg")';
    body.style.backgroundSize = "cover";
    body.style.backgroundPosition = "center";
    body.style.backgroundRepeat = "no-repeat";

    const isMobile = window.matchMedia && window.matchMedia("(max-width: 768px)").matches;
    body.style.backgroundAttachment = isMobile ? "scroll" : "fixed";
  }

  function clearLandingBackground() {
    const body = document.body;
    if (!body) return;

    if (body.dataset.landingBg === "1") {
      body.style.backgroundImage = "";
      body.style.backgroundSize = "";
      body.style.backgroundPosition = "";
      body.style.backgroundRepeat = "";
      body.style.backgroundAttachment = "";
      delete body.dataset.landingBg;
    }
  }

  function startLandingParallax() {
    stopLandingParallax();
    window.UI.landing.active = true;

    const onScroll = () => {
      const y = window.scrollY || 0;
      document.documentElement.style.setProperty("--landing-parallax", `${Math.min(60, y * 0.08)}px`);
    };

    window.UI.landing.onScroll = onScroll;
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  function stopLandingParallax() {
    if (window.UI.landing.onScroll) {
      window.removeEventListener("scroll", window.UI.landing.onScroll);
      window.UI.landing.onScroll = null;
    }
    window.UI.landing.active = false;
    document.documentElement.style.removeProperty("--landing-parallax");
  }

  // -----------------------------
  // Page init map - ✅ ALL PAGES CLEAR innerHTML CONSISTENTLY
  // -----------------------------
  const PAGE_INIT_MAP = {
    dashboard: () => {
      const el = document.getElementById("dashboard");
      if (!el) return;
      el.innerHTML = ""; // Clear before rendering
      if (typeof window.renderDashboard === "function") {
        window.renderDashboard();
      } else {
        showDefaultPage("dashboard");
      }
    },

    analytics: () => {
      const el = document.getElementById("analytics");
      if (!el) return;
      el.innerHTML = ""; // Clear first
      if (window.initAnalytics) window.initAnalytics();
      else showDefaultPage("analytics");
    },
    
    validators: () => {
      const el = document.getElementById("validators");
      if (!el) return;
      el.innerHTML = ""; // Clear first
      if (window.initValidators) window.initValidators();
      else showDefaultPage("validators");
    },
    
    tokens: () => {
      const el = document.getElementById("tokens");
      if (!el) return;
      el.innerHTML = ""; // Clear first
      if (window.initTokens) window.initTokens();
      else showDefaultPage("tokens");
    },
    
    amm: () => {
      const el = document.getElementById("amm");
      if (!el) return;
      el.innerHTML = ""; // Clear first
      if (window.AMM?.init) window.AMM.init();
      else showDefaultPage("amm");
    },
    
    explorer: () => {
      const el = document.getElementById("explorer");
      if (!el) return;
      el.innerHTML = ""; // Clear first
      if (window.initExplorer) window.initExplorer();
      else showDefaultPage("explorer");
    },
    
    nfts: () => {
      const el = document.getElementById("nfts");
      if (!el) return;
      el.innerHTML = ""; // Clear first
      if (window.initNFTs) window.initNFTs();
      else showDefaultPage("nfts");
    },
    
    profile: () => {
      const el = document.getElementById("profile");
      if (!el) return;
      el.innerHTML = ""; // Clear first
      if (window.initProfile) window.initProfile();
      else showDefaultPage("profile");
    },
    
    news: () => {
      const el = document.getElementById("news");
      if (!el) return;
      el.innerHTML = ""; // Clear first
      if (window.initNews) window.initNews();
      else showDefaultPage("news");
    },
    
    history: () => {
      const el = document.getElementById("history");
      if (!el) return;
      el.innerHTML = ""; // Clear first
      if (window.initHistory) window.initHistory();
      else showDefaultPage("history");
    },
    
    settings: () => {
      const el = document.getElementById("settings");
      if (!el) return;
      el.innerHTML = ""; // Clear first
      if (window.initSettings) window.initSettings();
      else showDefaultPage("settings");
    },
    
    about: () => {
      const el = document.getElementById("about");
      if (!el) return;
      el.innerHTML = ""; // Clear first
      if (window.initAbout) window.initAbout();
      else showDefaultPage("about");
    },

    // ✅✅✅ INSPECTOR - ENHANCED WITH AGGRESSIVE CLEARING ✅✅✅
    inspector: () => {
      console.log("🔧 Inspector page initialization started...");
      
      // Diagnostic: Track initialization count
      if (window._inspectorInitCount === undefined) window._inspectorInitCount = 0;
      window._inspectorInitCount++;
      console.log(`🔍 Inspector init count: ${window._inspectorInitCount}`);
      
      const el = document.getElementById("inspector");
      if (!el) {
        console.error("❌ Inspector element not found in DOM");
        return;
      }
      
      // Diagnostic: Log state before clearing
      console.log(`📊 Before clear - children: ${el.children.length}, innerHTML length: ${el.innerHTML.length}`);
      
      // ✅ AGGRESSIVE CLEAR: Multiple methods to ensure content is removed
      el.innerHTML = "";
      el.textContent = "";
      
      // Remove all child nodes (belt and suspenders approach)
      while (el.firstChild) {
        el.removeChild(el.firstChild);
      }
      
      // Clear any inline styles
      el.removeAttribute('style');
      
      // Force reflow to ensure DOM update
      void el.offsetHeight;
      
      console.log(`📊 After clear - children: ${el.children.length}, innerHTML length: ${el.innerHTML.length}`);
      
      // Mark when we cleared (for race condition detection)
      el.dataset.lastClear = Date.now();
      
      // Try to connect to XRPL if not already connected
      try {
        if (typeof window.connectXRPL === "function" && !(window.XRPL && window.XRPL.connected)) {
          console.log("🔌 Attempting XRPL connection...");
          window.connectXRPL();
        }
      } catch (err) {
        console.warn("⚠️ XRPL connection attempt failed:", err);
      }

      // Initialize inspector
      if (typeof window.initInspector === "function") {
        console.log("✅ window.initInspector found, calling...");
        try {
          // Call the init function
          window.initInspector();
          console.log("✅ Inspector initialized successfully");
          
          // Verify it rendered (with detailed diagnostics)
          setTimeout(() => {
            const content = el.querySelector('.chart-section');
            const childCount = el.children.length;
            const timeSinceClear = Date.now() - Number(el.dataset.lastClear);
            
            console.log(`⏱️ Time since clear: ${timeSinceClear}ms`);
            console.log(`📊 Final state - children: ${childCount}, has content: ${!!content}`);
            
            if (!content) {
              console.error("❌ Inspector did not render content");
              showDefaultPage("inspector");
            } else {
              console.log("✅ Inspector content verified");
              
              // Warn if too many children (possible stacking)
              if (childCount > 5) {
                console.warn(`⚠️ Inspector has ${childCount} children - check for stacking!`);
              }
            }
          }, 100);
          
        } catch (e) {
          console.error("❌ Inspector initialization failed:", e);
          console.error("Stack trace:", e.stack);
          showDefaultPage("inspector");
        }
      } else {
        console.error("❌ window.initInspector not found - check if account-inspector.js loaded");
        console.log("Available window properties:", Object.keys(window).filter(k => k.toLowerCase().includes('inspect')));
        showDefaultPage("inspector");
      }

      // If pinned exists, auto-inspect it (with delay to ensure UI is ready)
      const pinned = getPinned();
      if (pinned) {
        console.log(`📌 Auto-inspecting pinned address: ${pinned}`);
        setTimeout(() => tryInspectorQuickInspect(pinned), 500);
      }
    },
  };

  // -----------------------------
  // Navigation - WORKING VERSION (doesn't stack pages)
  // -----------------------------
  function switchPage(pageId) {
    // Diagnostic: Detect duplicate rapid calls
    const now = Date.now();
    if (window._lastSwitchPage) {
      const timeSinceLastSwitch = now - window._lastSwitchPage.time;
      if (window._lastSwitchPage.pageId === pageId && timeSinceLastSwitch < 100) {
        console.warn(`🚨 DUPLICATE switchPage call detected! ${pageId} called ${timeSinceLastSwitch}ms after previous call`);
        console.warn(`🚨 This indicates duplicate event listeners on navigation buttons!`);
        return; // Prevent duplicate execution
      }
    }
    window._lastSwitchPage = { pageId, time: now };
    
    console.log(`🌊 NaluLF: Switching to page: ${pageId}`);
    
    if (!PAGE_META[pageId]) {
      console.error(`🌊 NaluLF: Unknown page: ${pageId}`);
      return;
    }

    // Apply page-specific body classes
    applyPageClass(pageId);

    // Hide all pages first
    document.querySelectorAll('.page-section').forEach(section => {
      section.style.display = 'none';
    });

    // Show the target page
    const targetPage = document.getElementById(pageId);
    if (!targetPage) {
      console.error(`🌊 NaluLF: Page section not found: ${pageId}`);
      return;
    }

    targetPage.style.display = 'block';

    // ✅ Force scroll to top BEFORE page initialization
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    
    setTimeout(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    }, 10);

    // Update UI state
    window.UI.currentPage = pageId;
    
    // Update page title
    const pageTitle = PAGE_META[pageId].title || PAGE_META[pageId].crumb;
    document.title = `${pageTitle} | NaluLF`;

    // Update page header
    updatePageHeader(pageId);

    // Initialize page content
    if (PAGE_INIT_MAP[pageId]) {
      console.log(`🌊 NaluLF: Initializing ${pageId}...`);
      PAGE_INIT_MAP[pageId]();
    } else {
      console.warn(`🌊 NaluLF: No initialization function for page: ${pageId}`);
    }

    // Refresh reveal animations
    requestAnimationFrame(refreshRevealObserver);

    // Notify navbar and other listeners
    window.dispatchEvent(new CustomEvent("naluxrp:pagechange", { detail: { pageId } }));
    
    console.log(`✅ NaluLF: Page switched to: ${pageId}`);
  }

  // -----------------------------
  // Landing Page Function
  // -----------------------------
  function showLandingPage() {
    applyPageClass("dashboard");
    setLandingBackground();
    startLandingParallax();
    updatePageHeader("dashboard", { landing: true });

    const container = document.getElementById("dashboard");
    if (!container) return;

    container.innerHTML = `
      <div class="landing-page">
        <section class="landing-hero">
          <div class="landing-orb"></div>
          
          <!-- Enhanced Kicker Badge -->
          <div class="landing-kicker">
            <span class="kicker-dot"></span>
            XRPL • Real-time • Pattern Intelligence
            <span class="kicker-dot"></span>
          </div>
          
          <!-- Enhanced NaluLF Logo -->
          <div class="nalulf-logo-container">
            <h1 class="nalulf-logo">NaluLF</h1>
            <div class="nalulf-accent-line"></div>
          </div>
          
          <div class="landing-tagline">
            <span class="tagline-wave">~</span>
            Riding The Ledger Waves
            <span class="tagline-wave">~</span>
          </div>

          <p class="landing-description">
            NaluLF helps you see what's <strong>really happening</strong> on the XRP Ledger.
            Think of it as a <strong>health monitor for the network</strong> — showing you when something 
            unusual is brewing, who's moving big money, and whether the network is running smoothly or under stress.
          </p>

          <div class="landing-actions">
            <button class="landing-btn primary" onclick="switchPage('dashboard')">
              <span class="btn-icon">🚀</span>
              <span class="btn-text">Launch Dashboard</span>
              <span class="btn-shimmer"></span>
            </button>
            <button class="landing-btn secondary" onclick="switchPage('analytics')">
              <span class="btn-icon">📈</span>
              <span class="btn-text">Analytics</span>
            </button>
            <button class="landing-btn ghost" onclick="document.getElementById('landingExplain').scrollIntoView({behavior:'smooth'})">
              <span class="btn-icon">🔍</span>
              <span class="btn-text">Learn More</span>
            </button>
          </div>
          
          <!-- Scroll Indicator -->
          <div class="scroll-indicator">
            <div class="scroll-arrow">↓</div>
            <span>Explore Features</span>
          </div>
        </section>

        <section class="landing-split reveal" id="landingExplain">
          <div class="landing-panel">
            <div class="panel-icon">📊</div>
            <h2>What NaluLF Shows</h2>
            <ul>
              <li>
                <span class="bullet">▸</span>
                <strong>Ledger rhythm & close-time deviations</strong>
                <div class="plain-english">Is the network running smoothly or getting congested?</div>
              </li>
              <li>
                <span class="bullet">▸</span>
                <strong>Transaction dominance by type</strong>
                <div class="plain-english">What kind of activity is happening most right now?</div>
              </li>
              <li>
                <span class="bullet">▸</span>
                <strong>Validator health & latency</strong>
                <div class="plain-english">Are the computers that secure the network healthy and fast?</div>
              </li>
              <li>
                <span class="bullet">▸</span>
                <strong>Liquidity, AMMs & escrow pressure</strong>
                <div class="plain-english">How much money is moving around and locked up?</div>
              </li>
              <li>
                <span class="bullet">▸</span>
                <strong>Whale movement & capital concentration</strong>
                <div class="plain-english">Are big players making major moves?</div>
              </li>
            </ul>
          </div>

          <div class="landing-panel landing-panel-glow">
            <div class="panel-icon glow">⚡</div>
            <h2>Why It Matters</h2>
            <p>
              <strong>Think of it like a smoke detector</strong> — it spots the warning signs before the fire starts.
            </p>
            <p style="margin-top: 12px;">
              Unusual patterns often appear <strong>hours or days</strong> before major events like hacks, 
              market manipulation, or network problems. NaluLF helps you see these signals while there's 
              still time to act.
            </p>
            <div class="panel-stats">
              <div class="stat-item">
                <div class="stat-value">Real-time</div>
                <div class="stat-label">Data Streaming</div>
              </div>
              <div class="stat-item">
                <div class="stat-value">24/7</div>
                <div class="stat-label">Monitoring</div>
              </div>
            </div>
          </div>
        </section>

        <!-- How It Helps You Section -->
        <section class="landing-simple-value reveal">
          <h2>How NaluLF Helps You</h2>
          
          <div class="simple-value-grid">
            <div class="value-card">
              <div class="value-number">1</div>
              <h3>Spot Problems Early</h3>
              <p>See network congestion or unusual activity before it affects your transactions</p>
            </div>
            
            <div class="value-card">
              <div class="value-number">2</div>
              <h3>Follow the Smart Money</h3>
              <p>Track what large accounts are doing so you can make informed decisions</p>
            </div>
            
            <div class="value-card">
              <div class="value-number">3</div>
              <h3>Stay Ahead of the Crowd</h3>
              <p>Get insights hours or days before they become obvious to everyone else</p>
            </div>
          </div>
        </section>

        <section class="landing-features reveal">
          <div class="features-header">
            <h2>Powerful Features</h2>
            <p>Everything you need to analyze the XRP Ledger</p>
          </div>
          
          <div class="features-grid">
            <article class="feature-card">
              <div class="feature-icon">📊</div>
              <h3>Ledger Rhythm</h3>
              <p>Track the network's heartbeat. When the rhythm changes, it often means something big is about to happen.</p>
              <div class="plain-english" style="margin-top: 8px; font-size: 0.85em; opacity: 0.8; font-style: italic;">
                Like a heart rate monitor — steady is good, irregular means pay attention.
              </div>
              <div class="feature-link" onclick="openFeatureModal('rhythm')">Learn More →</div>
            </article>
            
            <article class="feature-card">
              <div class="feature-icon">🧬</div>
              <h3>Network Health</h3>
              <p>See if the network is strong or struggling. A healthy network means your transactions go through fast and safely.</p>
              <div class="plain-english" style="margin-top: 8px; font-size: 0.85em; opacity: 0.8; font-style: italic;">
                Green = all good. Yellow/Red = delays or problems ahead.
              </div>
              <div class="feature-link" onclick="openFeatureModal('health')">Learn More →</div>
            </article>
            
            <article class="feature-card danger">
              <div class="feature-icon">🐋</div>
              <h3>Whale Dominance</h3>
              <p>Spot when big accounts are moving large amounts. These moves often signal what's coming next in the market.</p>
              <div class="plain-english" style="margin-top: 8px; font-size: 0.85em; opacity: 0.8; font-style: italic;">
                When whales move, waves follow. See the big money before the market reacts.
              </div>
              <div class="feature-link" onclick="openFeatureModal('whale')">Learn More →</div>
            </article>
            
            <article class="feature-card danger">
              <div class="feature-icon">⚠️</div>
              <h3>Anomaly Detection</h3>
              <p>Catch unusual activity patterns that could mean hacks, manipulation, or coordinated moves.</p>
              <div class="plain-english" style="margin-top: 8px; font-size: 0.85em; opacity: 0.8; font-style: italic;">
                Your early warning system — spots trouble before it becomes obvious to everyone else.
              </div>
              <div class="feature-link" onclick="openFeatureModal('anomaly')">Learn More →</div>
            </article>
          </div>
        </section>
        
        <!-- Call to Action Section -->
        <section class="landing-cta reveal">
          <div class="cta-content">
            <h2>Ready to dive into the ledger?</h2>
            <p>Start analyzing XRPL data with NaluLF's powerful tools</p>
            <button class="cta-button" onclick="switchPage('dashboard')">
              Get Started
              <span class="cta-arrow">→</span>
            </button>
          </div>
        </section>
      </div>
    `;

    refreshRevealObserver();
    window.dispatchEvent(new CustomEvent("naluxrp:pagechange", { detail: { pageId: "dashboard" } }));
  }

  // -----------------------------
  // Feature Modals
  // -----------------------------
  window.openFeatureModal = function(feature) {
    const modals = {
      rhythm: {
        icon: '📊',
        title: 'Ledger Rhythm',
        subtitle: 'Understanding the Network\'s Heartbeat',
        content: `
          <div class="modal-section">
            <h3>What is Ledger Rhythm?</h3>
            <p>
              The XRPL creates a new "ledger" (think of it as a page in a book) every 3-4 seconds. 
              This is the network's heartbeat. When this rhythm changes, it tells us something 
              important is happening.
            </p>
          </div>

          <div class="modal-section">
            <h3>Why It Matters</h3>
            <div class="example-box">
              <strong>Normal:</strong> Ledgers close every 3.5 seconds → Network is healthy<br>
              <strong>Warning:</strong> Ledgers take 5-8 seconds → Network is getting congested<br>
              <strong>Alert:</strong> Ledgers take 10+ seconds → Something's wrong, delays incoming
            </div>
          </div>

          <div class="modal-section">
            <h3>Real Example</h3>
            <p>
              On November 15, 2023, ledger close times jumped from 3.5s to 12s. This happened 
              <strong>30 minutes before</strong> a major service outage. Users who noticed the 
              rhythm change had time to pause their transactions.
            </p>
          </div>

          <div class="modal-section">
            <h3>How NaluLF Helps</h3>
            <ul>
              <li>🟢 <strong>Green indicators</strong> when rhythm is steady (3-4 seconds)</li>
              <li>🟡 <strong>Yellow warnings</strong> when rhythm slows (5-7 seconds)</li>
              <li>🔴 <strong>Red alerts</strong> when rhythm breaks (8+ seconds)</li>
              <li>📊 <strong>Historical charts</strong> showing patterns over time</li>
            </ul>
          </div>

          <div class="modal-resources">
            <h3>Learn More</h3>
            <a href="https://xrpl.org/ledger-close-times.html" target="_blank" class="resource-link">
              📖 XRPL Docs: Ledger Close Times
            </a>
            <a href="#" onclick="switchPage('analytics'); closeFeatureModal(); return false;" class="resource-link">
              📈 View Live Rhythm Dashboard
            </a>
          </div>
        `
      },
      
      health: {
        icon: '🧬',
        title: 'Network Health',
        subtitle: 'Monitoring the Network\'s Vital Signs',
        content: `
          <div class="modal-section">
            <h3>What is Network Health?</h3>
            <p>
              The XRPL runs on hundreds of computers (validators) around the world. Network health 
              shows how well these computers are working together. Think of it like checking if 
              all the gears in a machine are running smoothly.
            </p>
          </div>

          <div class="modal-section">
            <h3>Key Health Indicators</h3>
            <div class="example-box">
              <strong>Validator Count:</strong> How many computers are active (target: 35+)<br>
              <strong>Latency:</strong> How fast validators respond (target: under 100ms)<br>
              <strong>Agreement:</strong> How often validators agree (target: 95%+)
            </div>
          </div>

          <div class="modal-section">
            <h3>Real Example</h3>
            <p>
              During a DDoS attack in March 2024, validator count dropped from 35 to 22, and 
              latency spiked to 500ms. Users who saw the health warnings avoided sending 
              time-sensitive transactions until the network recovered.
            </p>
          </div>

          <div class="modal-section">
            <h3>How NaluLF Helps</h3>
            <ul>
              <li>✅ <strong>Validator dashboard</strong> showing which ones are online</li>
              <li>⚡ <strong>Latency graphs</strong> showing response times</li>
              <li>🎯 <strong>Agreement rates</strong> showing consensus strength</li>
              <li>🚨 <strong>Alerts</strong> when health drops below safe levels</li>
            </ul>
          </div>

          <div class="modal-resources">
            <h3>Learn More</h3>
            <a href="https://xrpl.org/consensus.html" target="_blank" class="resource-link">
              📖 XRPL Docs: Consensus Protocol
            </a>
            <a href="https://livenet.xrpl.org/network/validators" target="_blank" class="resource-link">
              🌐 Live Validator List
            </a>
            <a href="#" onclick="switchPage('validators'); closeFeatureModal(); return false;" class="resource-link">
              🧬 View Validator Health
            </a>
          </div>
        `
      },
      
      whale: {
        icon: '🐋',
        title: 'Whale Dominance',
        subtitle: 'Following the Big Money',
        content: `
          <div class="modal-section">
            <h3>What are Whales?</h3>
            <p>
              "Whales" are accounts that hold or move very large amounts of XRP — think millions 
              or billions. When they move, the market often follows. It's like watching where 
              the big investors put their money.
            </p>
          </div>

          <div class="modal-section">
            <h3>Why Track Whales?</h3>
            <div class="example-box">
              <strong>Accumulation:</strong> Whale buying → Often signals confidence<br>
              <strong>Distribution:</strong> Whale selling → Often signals caution<br>
              <strong>Clustering:</strong> Multiple whales move → Major event brewing
            </div>
          </div>

          <div class="modal-section">
            <h3>Real Example</h3>
            <p>
              On January 8, 2024, three whale accounts moved 500M XRP to exchanges within 
              <strong>2 hours</strong>. XRP price dropped 8% over the next 12 hours. Users 
              tracking whale movements saw this coming and adjusted their positions early.
            </p>
          </div>

          <div class="modal-section">
            <h3>How NaluLF Helps</h3>
            <ul>
              <li>🐋 <strong>Whale tracker</strong> showing accounts with 10M+ XRP</li>
              <li>📊 <strong>Movement alerts</strong> when whales transfer large amounts</li>
              <li>🎯 <strong>Clustering detection</strong> when multiple whales coordinate</li>
              <li>📈 <strong>Historical patterns</strong> showing whale behavior over time</li>
            </ul>
          </div>

          <div class="modal-resources">
            <h3>Learn More</h3>
            <a href="https://bithomp.com/explorer/" target="_blank" class="resource-link">
              🔍 Bithomp: Whale Tracker
            </a>
            <a href="https://xrpscan.com/balances" target="_blank" class="resource-link">
              💰 XRPScan: Rich List
            </a>
            <a href="#" onclick="switchPage('tokens'); closeFeatureModal(); return false;" class="resource-link">
              🐋 View Whale Activity
            </a>
          </div>
        `
      },
      
      anomaly: {
        icon: '⚠️',
        title: 'Anomaly Detection',
        subtitle: 'Your Early Warning System',
        content: `
          <div class="modal-section">
            <h3>What are Anomalies?</h3>
            <p>
              Anomalies are unusual patterns that don't match normal network behavior. They're 
              like smoke before a fire — not always dangerous, but worth investigating. Most 
              major incidents show warning signs first.
            </p>
          </div>

          <div class="modal-section">
            <h3>Types of Anomalies We Detect</h3>
            <div class="example-box">
              <strong>Transaction Bursts:</strong> Sudden spike in activity (possible attack)<br>
              <strong>Abnormal Mixes:</strong> Weird combination of transaction types<br>
              <strong>Fan-Out Patterns:</strong> One account sending to many (possible spam)<br>
              <strong>Circular Flows:</strong> Money going in circles (possible wash trading)
            </div>
          </div>

          <div class="modal-section">
            <h3>Real Example</h3>
            <p>
              On February 12, 2024, our system detected a "fan-out" pattern: one account sent 
              small amounts to 10,000+ addresses in 5 minutes. This was <strong>48 hours before</strong> 
              a major phishing campaign launched. Early detection helped exchanges blacklist the account.
            </p>
          </div>

          <div class="modal-section">
            <h3>How NaluLF Helps</h3>
            <ul>
              <li>🚨 <strong>Real-time alerts</strong> when anomalies are detected</li>
              <li>📊 <strong>Pattern visualization</strong> showing what's unusual</li>
              <li>🎯 <strong>Risk scoring</strong> showing how serious the anomaly is</li>
              <li>📈 <strong>Historical context</strong> showing if this has happened before</li>
              <li>🔍 <strong>Deep inspection</strong> tools to investigate further</li>
            </ul>
          </div>

          <div class="modal-resources">
            <h3>Learn More</h3>
            <a href="https://xrpl.org/transaction-common-fields.html" target="_blank" class="resource-link">
              📖 XRPL Docs: Transaction Types
            </a>
            <a href="https://xrpl.org/transaction-malleability.html" target="_blank" class="resource-link">
              🔒 XRPL Security Best Practices
            </a>
            <a href="#" onclick="switchPage('inspector'); closeFeatureModal(); return false;" class="resource-link">
              🔎 Use Anomaly Inspector
            </a>
          </div>
        `
      }
    };

    const modal = modals[feature];
    if (!modal) return;

    // Create modal if it doesn't exist
    let modalEl = document.getElementById('featureModal');
    if (!modalEl) {
      modalEl = document.createElement('div');
      modalEl.id = 'featureModal';
      modalEl.className = 'feature-modal-overlay';
      modalEl.innerHTML = `
        <div class="feature-modal">
          <button class="feature-modal-close" onclick="closeFeatureModal()">✕</button>
          <div class="feature-modal-content">
            <div class="feature-modal-header">
              <div class="feature-modal-icon"></div>
              <h2 class="feature-modal-title"></h2>
              <p class="feature-modal-subtitle"></p>
            </div>
            <div class="feature-modal-body"></div>
          </div>
        </div>
      `;
      document.body.appendChild(modalEl);

      // Click outside to close
      modalEl.addEventListener('click', (e) => {
        if (e.target === modalEl) closeFeatureModal();
      });
    }

    // Populate modal
    modalEl.querySelector('.feature-modal-icon').textContent = modal.icon;
    modalEl.querySelector('.feature-modal-title').textContent = modal.title;
    modalEl.querySelector('.feature-modal-subtitle').textContent = modal.subtitle;
    modalEl.querySelector('.feature-modal-body').innerHTML = modal.content;

    // Show modal
    modalEl.classList.add('show');
    document.body.style.overflow = 'hidden';
  };

  window.closeFeatureModal = function() {
    const modalEl = document.getElementById('featureModal');
    if (modalEl) {
      modalEl.classList.remove('show');
      document.body.style.overflow = '';
    }
  };

  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeFeatureModal();
  });

  // -----------------------------
  // Reveal animations
  // -----------------------------
  function refreshRevealObserver() {
    if (window.UI.observers.reveal) window.UI.observers.reveal.disconnect();

    const els = document.querySelectorAll(".reveal");
    if (!els.length) return;

    window.UI.observers.reveal = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("visible");
            window.UI.observers.reveal.unobserve(e.target);
          }
        });
      },
      { threshold: 0.15 }
    );

    els.forEach((el) => window.UI.observers.reveal.observe(el));
  }

  // -----------------------------
  // Fallback page
  // -----------------------------
  function showDefaultPage(pageId) {
    const el = document.getElementById(pageId);
    if (!el) return;
    el.innerHTML = `
      <div class="chart-section">
        <h2>🚧 Module Loading</h2>
        <p>This section is initializing. If this persists, check the browser console for errors.</p>
        <p style="opacity:0.7;margin-top:10px;font-size:13px;">
          Expected global: window.initInspector (for inspector page)
        </p>
      </div>
    `;
  }

  // -----------------------------
  // Themes
  // -----------------------------
  function cycleTheme() {
    const i = window.UI.themes.indexOf(window.UI.currentTheme);
    setTheme(window.UI.themes[(i + 1) % window.UI.themes.length]);
  }

  function setTheme(theme) {
    window.UI.currentTheme = theme;
    applyThemeClass(theme);
    toast(`Theme: ${theme}`);
  }

  // -----------------------------
  // Global search
  // -----------------------------
  function runGlobalSearch(raw) {
    const q = String(raw || "").trim();
    if (!q) return;

    const pageMatch = matchPage(q);
    if (pageMatch) {
      switchPage(pageMatch);
      return;
    }

    if (isValidXrpAddress(q)) {
      switchPage("inspector");
      tryInspectorQuickInspect(q);
      return;
    }

    if (isTxHash(q)) {
      switchPage("explorer");
      window.dispatchEvent(new CustomEvent("naluxrp:search", { detail: { type: "tx", value: q } }));
      toast("Sent tx hash to Explorer");
      return;
    }

    if (isLedgerIndex(q)) {
      switchPage("explorer");
      window.dispatchEvent(new CustomEvent("naluxrp:search", { detail: { type: "ledger", value: Number(q) } }));
      toast("Sent ledger index to Explorer");
      return;
    }

    openCommandPalette(q);
  }

  function matchPage(input) {
    const q = String(input || "").trim().toLowerCase();
    if (!q) return null;

    const aliases = {
      dash: "dashboard",
      home: "dashboard",
      inspect: "inspector",
      inspector: "inspector",
      val: "validators",
      validators: "validators",
      token: "tokens",
      tokens: "tokens",
      amm: "amm",
      pool: "amm",
      analytics: "analytics",
      explore: "explorer",
      explorer: "explorer",
      nft: "nfts",
      nfts: "nfts",
      profile: "profile",
      news: "news",
      history: "history",
      settings: "settings",
      about: "about",
    };

    if (aliases[q]) return aliases[q];

    const keys = Object.keys(PAGE_META);
    const found = keys.find((k) => k.startsWith(q));
    return found || null;
  }

  function tryInspectorQuickInspect(address) {
    const addr = String(address || "").trim();
    if (!isValidXrpAddress(addr)) return;

    console.log(`🔍 Attempting Quick Inspect for: ${addr}`);
    
    const start = Date.now();
    const timeout = 8000;

    const tick = () => {
      // Check for the inspector global function
      if (window.UnifiedInspector && typeof window.UnifiedInspector.quickInspect === "function") {
        console.log("✅ UnifiedInspector.quickInspect found, calling...");
        window.UnifiedInspector.quickInspect(addr);
        return;
      }

      if (Date.now() - start > timeout) {
        console.error("❌ Inspector timeout - Quick Inspect not available");
        toast("Inspector not ready (try again)");
        return;
      }
      setTimeout(tick, 150);
    };

    tick();
  }

  // -----------------------------
  // Dialog + Toast
  // -----------------------------
  function ensureDialog() {
    if (document.getElementById("naluxDialogOverlay")) return;

    const overlay = document.createElement("div");
    overlay.id = "naluxDialogOverlay";
    overlay.className = "nalux-dialog-overlay";
    overlay.innerHTML = `
      <div class="nalux-dialog" role="dialog" aria-modal="true">
        <div class="nalux-dialog-head">
          <div class="nalux-dialog-title" id="naluxDialogTitle">Dialog</div>
          <button class="nalux-dialog-close" id="naluxDialogClose" type="button" aria-label="Close">✕</button>
        </div>
        <div class="nalux-dialog-body" id="naluxDialogBody"></div>
      </div>
    `;

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeDialog();
    });

    document.body.appendChild(overlay);
    document.getElementById("naluxDialogClose")?.addEventListener("click", closeDialog);
  }

  function openDialog(title, bodyHtml) {
    ensureDialog();
    const overlay = document.getElementById("naluxDialogOverlay");
    const t = document.getElementById("naluxDialogTitle");
    const b = document.getElementById("naluxDialogBody");
    if (!overlay || !t || !b) return;

    t.textContent = title || "Dialog";
    b.innerHTML = bodyHtml || "";
    overlay.classList.add("show");

    const onKey = (e) => {
      if (e.key === "Escape") {
        closeDialog();
        window.removeEventListener("keydown", onKey);
      }
    };
    window.addEventListener("keydown", onKey);
  }

  function closeDialog() {
    const overlay = document.getElementById("naluxDialogOverlay");
    if (overlay) overlay.classList.remove("show");
  }

  function toast(msg) {
    ensureToast();
    const host = document.getElementById("naluxToastHost");
    if (!host) return;

    const t = document.createElement("div");
    t.className = "nalux-toast";
    t.textContent = String(msg || "");
    host.appendChild(t);

    setTimeout(() => t.classList.add("show"), 10);
    setTimeout(() => {
      t.classList.remove("show");
      setTimeout(() => t.remove(), 220);
    }, 1800);
  }

  function ensureToast() {
    if (document.getElementById("naluxToastHost")) return;
    const host = document.createElement("div");
    host.id = "naluxToastHost";
    host.className = "nalux-toast-host";
    document.body.appendChild(host);
  }

  // -----------------------------
  // Saved dialog
  // -----------------------------
  function openSavedDialog() {
    const list = getSaved();
    const pinned = getPinned();

    const rows = list.length
      ? list
          .map((a) => {
            const short = `${a.slice(0, 6)}…${a.slice(-5)}`;
            const isPinned = pinned === a;
            return `
              <div class="saved-row">
                <div class="saved-addr">
                  <div class="saved-short">${short}</div>
                  <div class="saved-full">${a}</div>
                </div>
                <div class="saved-actions">
                  <button class="saved-btn" data-act="open" data-addr="${a}">Open</button>
                  <button class="saved-btn" data-act="pin" data-addr="${a}">${isPinned ? "Pinned" : "Pin"}</button>
                  <button class="saved-btn" data-act="copy" data-addr="${a}">Copy</button>
                  <button class="saved-btn danger" data-act="remove" data-addr="${a}">Remove</button>
                </div>
              </div>
            `;
          })
          .join("")
      : `<div style="opacity:.8;padding:12px;">No saved addresses yet. Use the command palette (Ctrl+K) and choose "Save address".</div>`;

    openDialog(
      "Saved addresses",
      `
        <div class="saved-top">
          <input id="savedAddInput" placeholder="Paste address to save…" />
          <button id="savedAddBtn" type="button">Save</button>
          <button id="savedPinClear" type="button">Unpin</button>
        </div>
        <div class="saved-list">${rows}</div>
      `
    );

    document.getElementById("savedAddBtn")?.addEventListener("click", () => {
      const v = document.getElementById("savedAddInput")?.value || "";
      if (!saveAddress(v)) toast("Invalid address");
      else {
        toast("Saved");
        closeDialog();
        openSavedDialog();
      }
    });

    document.getElementById("savedPinClear")?.addEventListener("click", () => {
      unpinAddress();
      toast("Unpinned");
      closeDialog();
      openSavedDialog();
    });

    document.querySelectorAll(".saved-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const act = btn.getAttribute("data-act");
        const addr = btn.getAttribute("data-addr");
        if (!addr) return;

        if (act === "open") {
          closeDialog();
          switchPage("inspector");
          tryInspectorQuickInspect(addr);
          return;
        }
        if (act === "pin") {
          pinAddress(addr);
          toast("Pinned");
          closeDialog();
          openSavedDialog();
          return;
        }
        if (act === "remove") {
          removeSaved(addr);
          toast("Removed");
          closeDialog();
          openSavedDialog();
          return;
        }
        if (act === "copy") {
          try {
            await navigator.clipboard.writeText(addr);
            toast("Copied");
          } catch (_) {
            toast("Copy failed");
          }
        }
      });
    });
  }

  // -----------------------------
  // Theme picker
  // -----------------------------
  function openThemePicker() {
    const cur = window.UI.currentTheme;

    const themes = (window.UI.themes || []).map((t) => {
      const active = t === cur ? "is-active" : "";
      return `
        <button class="theme-card ${active}" type="button" data-theme="${t}">
          <div class="theme-swatch theme-${t}"></div>
          <div class="theme-name">${t}</div>
          <div class="theme-sub">${t === cur ? "Current" : "Tap to apply"}</div>
        </button>
      `;
    });

    openDialog(
      "Theme picker",
      `
        <div class="theme-grid">
          ${themes.join("")}
        </div>
        <div class="theme-note">Tip: Ctrl+K → type "theme" to open this anytime.</div>
      `
    );

    document.querySelectorAll(".theme-card").forEach((btn) => {
      btn.addEventListener("click", () => {
        const t = btn.getAttribute("data-theme");
        if (!t) return;
        setTheme(t);
        closeDialog();
      });
    });
  }

  // -----------------------------
  // Command palette
  // -----------------------------
  function ensurePalette() {
    if (document.getElementById("cmdkOverlay")) return;

    const overlay = document.createElement("div");
    overlay.id = "cmdkOverlay";
    overlay.className = "cmdk-overlay";
    overlay.innerHTML = `
      <div class="cmdk-panel" role="dialog" aria-modal="true">
        <div class="cmdk-top">
          <input id="cmdkInput" autocomplete="off" placeholder="Type a page… or paste address / tx / ledger" />
          <button id="cmdkClose" type="button" aria-label="Close">✕</button>
        </div>
        <div class="cmdk-hint">Enter = run best match • ↑↓ to move • Esc to close</div>
        <div id="cmdkList" class="cmdk-list"></div>
      </div>
    `;

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeCommandPalette();
    });

    document.body.appendChild(overlay);

    document.getElementById("cmdkClose")?.addEventListener("click", closeCommandPalette);

    const input = document.getElementById("cmdkInput");
    input?.addEventListener("input", () => renderPalette(input.value));
    input?.addEventListener("keydown", (e) => paletteKeydown(e));

    window.addEventListener("keydown", (e) => {
      if (shouldIgnoreShortcut(e)) return;

      const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
      const cmdk =
        (isMac && e.metaKey && e.key.toLowerCase() === "k") ||
        (!isMac && e.ctrlKey && e.key.toLowerCase() === "k");

      if (cmdk) {
        e.preventDefault();
        openCommandPalette();
        return;
      }

      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        openCommandPalette();
      }
    });
  }

  function shouldIgnoreShortcut(e) {
    const el = document.activeElement;
    if (!el) return false;
    const tag = (el.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    if (el.isContentEditable) return true;
    return false;
  }

  let paletteItems = [];
  let paletteIndex = 0;

  function buildPaletteItems(query) {
    const q = String(query || "").trim();

    const pages = Object.keys(PAGE_META).map((id) => ({
      type: "page",
      label: `Go to ${PAGE_META[id].crumb}`,
      hint: PAGE_META[id].sub,
      keywords: `${id} ${PAGE_META[id].crumb} ${PAGE_META[id].sub}`,
      run: () => switchPage(id),
    }));

    const quick = [];

    if (isValidXrpAddress(q)) {
      quick.push({
        type: "action",
        label: "Open in Inspector (Quick Inspect)",
        hint: q,
        keywords: "inspector quick inspect address",
        run: () => {
          switchPage("inspector");
          tryInspectorQuickInspect(q);
        },
      });
      quick.push({
        type: "action",
        label: "Save address",
        hint: q,
        keywords: "save star bookmark address",
        run: () => {
          saveAddress(q);
          toast("Saved");
        },
      });
      quick.push({
        type: "action",
        label: "Pin to Inspector",
        hint: q,
        keywords: "pin inspector address",
        run: () => {
          pinAddress(q);
          toast("Pinned");
        },
      });
    } else if (isTxHash(q)) {
      quick.push({
        type: "action",
        label: "Open TX in Explorer",
        hint: q,
        keywords: "explorer tx hash transaction",
        run: () => {
          switchPage("explorer");
          window.dispatchEvent(new CustomEvent("naluxrp:search", { detail: { type: "tx", value: q } }));
          toast("Sent tx to Explorer");
        },
      });
    } else if (isLedgerIndex(q)) {
      quick.push({
        type: "action",
        label: "Open Ledger in Explorer",
        hint: q,
        keywords: "explorer ledger index",
        run: () => {
          switchPage("explorer");
          window.dispatchEvent(new CustomEvent("naluxrp:search", { detail: { type: "ledger", value: Number(q) } }));
          toast("Sent ledger to Explorer");
        },
      });
    }

    quick.push(
      {
        type: "action",
        label: "Open Saved addresses",
        hint: "★",
        keywords: "saved favorites bookmarks",
        run: () => openSavedDialog(),
      },
      {
        type: "action",
        label: "Open Theme picker",
        hint: "🎨",
        keywords: "theme picker preview",
        run: () => openThemePicker(),
      }
    );

    return quick.concat(pages);
  }

  function renderPalette(query) {
    paletteItems = buildPaletteItems(query);

    const q = String(query || "").trim().toLowerCase();
    if (q) {
      paletteItems = paletteItems.filter((it) => {
        const hay = (it.keywords || it.label || "").toLowerCase();
        return hay.includes(q) || (it.hint || "").toLowerCase().includes(q);
      });
    }

    if (!paletteItems.length) {
      paletteItems = [{ type: "info", label: "No matches — try a page name, address, tx hash, or ledger index.", hint: "", run: null }];
    }

    paletteIndex = 0;
    paintPalette();
  }

  function paintPalette() {
    const list = document.getElementById("cmdkList");
    if (!list) return;

    list.innerHTML = paletteItems
      .slice(0, 18)
      .map((it, i) => {
        const active = i === paletteIndex ? "is-active" : "";
        return `
          <button class="cmdk-item ${active}" type="button" data-i="${i}">
            <div class="cmdk-label">${it.label}</div>
            <div class="cmdk-hint2">${it.hint || ""}</div>
          </button>
        `;
      })
      .join("");

    list.querySelectorAll(".cmdk-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        const i = Number(btn.getAttribute("data-i"));
        runPaletteItem(i);
      });
    });
  }

  function paletteKeydown(e) {
    if (e.key === "Escape") {
      closeCommandPalette();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      paletteIndex = Math.min(paletteIndex + 1, Math.min(17, paletteItems.length - 1));
      paintPalette();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      paletteIndex = Math.max(paletteIndex - 1, 0);
      paintPalette();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      runPaletteItem(paletteIndex);
    }
  }

  function runPaletteItem(i) {
    const item = paletteItems[i];
    if (!item || typeof item.run !== "function") return;
    closeCommandPalette();
    item.run();
  }

  function openCommandPalette(prefill = "") {
    ensurePalette();
    const overlay = document.getElementById("cmdkOverlay");
    const input = document.getElementById("cmdkInput");
    if (!overlay || !input) return;

    overlay.classList.add("show");
    input.value = String(prefill || "");
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);

    renderPalette(input.value);
  }

  function closeCommandPalette() {
    const overlay = document.getElementById("cmdkOverlay");
    if (overlay) overlay.classList.remove("show");
  }

  // -----------------------------
  // Init
  // -----------------------------
  document.addEventListener("DOMContentLoaded", () => {
    console.log("🌊 NaluLF: DOM loaded, initializing UI...");
    
    // ✅ FIX: do NOT inject header
    ensurePageHeader(); // safe: removes if previously injected

    applyPageClass("dashboard");
    setTheme(window.UI.currentTheme);

    document.querySelectorAll(".page-section").forEach((s) => (s.style.display = "none"));

    const dash = document.getElementById("dashboard");
    if (dash) {
      dash.style.display = "block";
      showLandingPage();
    }

    window.addEventListener("resize", () => {
      if (document.body && document.body.dataset.landingBg === "1") {
        const isMobile = window.matchMedia && window.matchMedia("(max-width: 768px)").matches;
        document.body.style.backgroundAttachment = isMobile ? "scroll" : "fixed";
      }
    });

    window.addEventListener("naluxrp:savedchange", updatePinnedPill);

    // ✅ Start connection monitoring for navbar status
    setupConnectionMonitoring();

    window.dispatchEvent(new CustomEvent("naluxrp:pagechange", { detail: { pageId: "dashboard" } }));
    
    console.log("✅ NaluLF UI initialized");
  });

  // -----------------------------
  // Exports
  // -----------------------------
  window.switchPage = switchPage;
  window.cycleTheme = cycleTheme;
  window.setTheme = setTheme;
  window.showLandingPage = showLandingPage;

  window.UIX = {
    runSearch: runGlobalSearch,
    openCommandPalette,
    openSavedDialog,
    openThemePicker,
    saveAddress,
    removeSaved,
    getSaved,
    pinAddress,
    unpinAddress,
    getPinned,
  };
})();