/* =========================================
   NaluLF 🌊 – UI Module (FULL)
   + Global header search
   + Command palette (Ctrl+K / Cmd+K / /)
   + Saved addresses + Pin-to-Inspector
   + Theme preview picker
   + Dispatches nalulf:pagechange so navbar can highlight
   + Connection status monitoring for navbar

   ✅ FIX: Disable injected "page header" (Home / Welcome / Search / ★ 🎨 ⌘)
   - Controlled by ENABLE_PAGE_HEADER (false)

   ✅ FIX: switchPage now scrolls to top so Inspector doesn't open at the bottom
   
   ✅ FIX: Branding updated from NaluXrp to NaluLF (Old English Style)
   
   ✅ FIX: XRPL connection monitoring with event dispatches for navbar status
   
   ✅ FIX: Proper page switching with individual page sections
   ✅ FIX: Landing page with Old English main title
   ✅ FIX: Added footer to all pages
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

  const LS_SAVED = "nalulf_saved_addresses";
  const LS_PINNED = "nalulf_pinned_address";

  const PAGE_META = {
    dashboard: { crumb: "Dashboard", sub: "Ledger Overview", title: "🌊 NaluLF Dashboard" },
    inspector: { crumb: "Inspector", sub: "Tree • Trace • Quick Inspect", title: "Account Inspector" },
    analytics: { crumb: "Analytics", sub: "Patterns & Metrics", title: "Network Analytics" },
    explorer: { crumb: "Explorer", sub: "Search the XRPL", title: "Ledger Explorer" },
    validators: { crumb: "Validators", sub: "Health & Performance", title: "Validator Network" },
    tokens: { crumb: "Tokens", sub: "Distribution & Markets", title: "Token Analysis" },
    amm: { crumb: "AMM Pools", sub: "Liquidity & Swaps", title: "AMM Pool Analysis" },
    nfts: { crumb: "NFTs", sub: "Collections & Activity", title: "NFT Marketplace" },
    profile: { crumb: "Profile", sub: "Account & Preferences", title: "User Profile" },
    news: { crumb: "News", sub: "Ledger Updates", title: "XRPL News" },
    history: { crumb: "History", sub: "Snapshots & Events", title: "Transaction History" },
    settings: { crumb: "Settings", sub: "System Configuration", title: "Settings" },
    about: { crumb: "About", sub: "NaluLF 🌊 Riding The Ledger Waves", title: "About NaluLF" },
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
    window.dispatchEvent(new CustomEvent("nalulf:savedchange"));
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
    let wasConnected = false;

    function checkAndDispatch() {
      let isConnected = false;

      if (typeof window.xrplClient !== 'undefined' && window.xrplClient?.isConnected) {
        isConnected = window.xrplClient.isConnected();
      } else if (typeof window.client !== 'undefined' && window.client?.isConnected) {
        isConnected = window.client.isConnected();
      } else if (window.XRPL?.connected === true) {
        isConnected = true;
      } else if (window.connectionState === 'connected') {
        isConnected = true;
      }

      if (isConnected && !wasConnected) {
        console.log("🌊 NaluLF: XRPL Connected");
        window.dispatchEvent(new Event("xrpl:connected"));
        window.dispatchEvent(new Event("nalulf:connected"));
        wasConnected = true;
      } else if (!isConnected && wasConnected) {
        console.log("🌊 NaluLF: XRPL Disconnected");
        window.dispatchEvent(new Event("xrpl:disconnected"));
        window.dispatchEvent(new Event("nalulf:disconnected"));
        wasConnected = false;
      }
    }

    setTimeout(checkAndDispatch, 500);
    setInterval(checkAndDispatch, 2000);

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
    else if (pageId === "dashboard") body.classList.add("dashboard");
  }

  // -----------------------------
  // Header (breadcrumb + search + buttons)
  // -----------------------------
  function ensurePageHeader() {
    if (!ENABLE_PAGE_HEADER) {
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

    const input = document.getElementById("globalSearchInput");
    const btn = document.getElementById("globalSearchBtn");

    if (btn) btn.addEventListener("click", () => runGlobalSearch(input?.value || ""));
    if (input) {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") runGlobalSearch(input.value);
      });
    }

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
  // Page init map - UPDATED FOR SEPARATE PAGES
  // -----------------------------
  const PAGE_INIT_MAP = {
    dashboard: () => {
      const el = document.getElementById("dashboard");
      if (!el) return;
      el.innerHTML = "";
      if (typeof window.renderDashboard === "function") {
        window.renderDashboard();
      } else {
        showDashboardPage();
      }
      showFooter();
    },

    analytics: () => {
      const el = document.getElementById("analytics");
      if (!el) return;
      el.innerHTML = '<h2 class="page-title">📈 Analytics</h2><p>Network patterns and metrics will appear here.</p>';
      if (window.initAnalytics) window.initAnalytics();
      showFooter();
    },

    validators: () => {
      const el = document.getElementById("validators");
      if (!el) return;
      el.innerHTML = '<h2 class="page-title">🛡️ Validators</h2><p>Validator network health and performance.</p>';
      if (window.initValidators) window.initValidators();
      showFooter();
    },

    tokens: () => {
      const el = document.getElementById("tokens");
      if (!el) return;
      el.innerHTML = '<h2 class="page-title">🪙 Tokens</h2><p>Token distribution and market analysis.</p>';
      if (window.initTokens) window.initTokens();
      showFooter();
    },

    amm: () => {
      const el = document.getElementById("amm");
      if (!el) return;
      el.innerHTML = '<h2 class="page-title">💧 AMM Pools</h2><p>Liquidity pools and swap analysis.</p>';
      if (window.AMM?.init) window.AMM.init();
      else if (window.initAMM) window.initAMM();
      showFooter();
    },

    explorer: () => {
      const el = document.getElementById("explorer");
      if (!el) return;
      el.innerHTML = '<h2 class="page-title">🔍 Explorer</h2><p>Search the XRP Ledger.</p>';
      if (window.initExplorer) window.initExplorer();
      showFooter();
    },

    nfts: () => {
      const el = document.getElementById("nfts");
      if (!el) return;
      el.innerHTML = '<h2 class="page-title">🎨 NFTs</h2><p>NFT collections and activity analysis.</p>';
      if (window.initNFTs) window.initNFTs();
      showFooter();
    },

    profile: () => {
      const el = document.getElementById("profile");
      if (!el) return;
      el.innerHTML = '<h2 class="page-title">👤 Profile</h2><p>Account settings and preferences.</p>';
      if (window.initProfile) window.initProfile();
      showFooter();
    },

    news: () => {
      const el = document.getElementById("news");
      if (!el) return;
      el.innerHTML = '<h2 class="page-title">📰 News</h2><p>Latest XRPL updates and announcements.</p>';
      if (window.initNews) window.initNews();
      showFooter();
    },

    history: () => {
      const el = document.getElementById("history");
      if (!el) return;
      el.innerHTML = '<h2 class="page-title">📜 History</h2><p>Transaction history and snapshots.</p>';
      if (window.initHistory) window.initHistory();
      showFooter();
    },

    settings: () => {
      const el = document.getElementById("settings");
      if (!el) return;
      el.innerHTML = '<h2 class="page-title">⚙️ Settings</h2><p>System configuration and preferences.</p>';
      if (window.initSettings) window.initSettings();
      showFooter();
    },

    about: () => {
      const el = document.getElementById("about");
      if (!el) return;
      el.innerHTML = '<h2 class="page-title">ℹ️ About NaluLF</h2><p>Information about the NaluLF platform.</p>';
      if (window.initAbout) window.initAbout();
      showFooter();
    },

    inspector: () => {
      try {
        if (typeof window.connectXRPL === "function" && !(window.XRPL && window.XRPL.connected)) {
          window.connectXRPL();
        }
      } catch (_) {}

      const el = document.getElementById("inspector");
      if (!el) return;

      if (typeof window.initInspector === "function") {
        try {
          window.initInspector();
        } catch (e) {
          console.error("Inspector init failed:", e);
          el.innerHTML = '<h2 class="page-title">🔎 Inspector</h2><p>Account and transaction inspector.</p>';
        }
      } else {
        el.innerHTML = '<h2 class="page-title">🔎 Inspector</h2><p>Account and transaction inspector.</p>';
      }

      const pinned = getPinned();
      if (pinned) tryInspectorQuickInspect(pinned);
      showFooter();
    },
  };

  // -----------------------------
  // Page Creation and Management
  // -----------------------------
  function createPageContainer() {
    const container = document.querySelector('.container') || document.body;
    
    // Create all page sections if they don't exist
    Object.keys(PAGE_META).forEach(pageId => {
      if (!document.getElementById(pageId)) {
        const pageSection = document.createElement('section');
        pageSection.id = pageId;
        pageSection.className = 'page-section';
        pageSection.style.display = 'none';
        container.appendChild(pageSection);
      }
    });
  }

  // -----------------------------
  // Navigation - UPDATED FOR PROPER PAGE SWITCHING
  // -----------------------------
  function switchPage(pageId) {
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

    // ✅ FIX: Force scroll to top BEFORE page initialization
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    
    setTimeout(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    }, 10);

    // Update UI state
    window.UI.currentPage = pageId;
    
    // Update page title
    document.title = `${PAGE_META[pageId].title} | NaluLF`;

    // Initialize page content
    if (PAGE_INIT_MAP[pageId]) {
      console.log(`🌊 NaluLF: Initializing ${pageId}...`);
      PAGE_INIT_MAP[pageId]();
    } else {
      console.warn(`🌊 NaluLF: No initialization function for page: ${pageId}`);
    }

    // Notify navbar and other listeners
    window.dispatchEvent(new CustomEvent("nalulf:pagechange", { detail: { pageId } }));
    
    console.log(`✅ NaluLF: Page switched to: ${pageId}`);
  }

  // -----------------------------
  // Dashboard Page (Separate from Landing)
  // -----------------------------
  function showDashboardPage() {
    const dashboard = document.getElementById("dashboard");
    if (!dashboard) return;

    dashboard.innerHTML = `
      <div class="dashboard-page">
        <h1 class="page-title">🌊 NaluLF Dashboard</h1>
        <p class="page-subtitle">Real-time XRPL analytics and monitoring</p>
        
        <div class="dashboard-grid">
          <div class="dashboard-card">
            <h3>📊 Network Health</h3>
            <p>Monitor ledger close times, validator participation, and network stability.</p>
            <button class="card-btn" onclick="switchPage('analytics')">View Analytics</button>
          </div>
          
          <div class="dashboard-card">
            <h3>🔎 Quick Inspector</h3>
            <p>Inspect any XRPL account, transaction, or ledger in detail.</p>
            <button class="card-btn" onclick="switchPage('inspector')">Open Inspector</button>
          </div>
          
          <div class="dashboard-card">
            <h3>🛡️ Validators</h3>
            <p>Track validator performance, voting patterns, and consensus.</p>
            <button class="card-btn" onclick="switchPage('validators')">View Validators</button>
          </div>
          
          <div class="dashboard-card">
            <h3>💰 DeFi Overview</h3>
            <p>Monitor AMM pools, token distribution, and liquidity trends.</p>
            <button class="card-btn" onclick="switchPage('tokens')">View DeFi</button>
          </div>
        </div>
        
        <div class="dashboard-recent">
          <h3>Recent Activity</h3>
          <p>Dashboard content will be loaded here...</p>
        </div>
      </div>
    `;
    
    showFooter();
  }

  // -----------------------------
  // Landing Page with Old English Style
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
          <div class="landing-kicker">XRPL • Real-time • Pattern Intelligence</div>
          
          <!-- Old English Styled NaluLF -->
          <div class="nalulf-logo-container">
            <h1 class="nalulf-logo">🌊 <span class="nalulf-text">NaluLF</span></h1>
            <div class="nalulf-subtitle">Riding The Ledger Waves</div>
          </div>

          <p class="landing-description">
            NaluLF is a deep-inspection platform for the XRP Ledger.
            It goes beyond surface metrics to expose <strong>patterns, dominance,
            stress signals, and anomalous behavior</strong>.
          </p>

          <div class="landing-actions">
            <button class="landing-btn primary" onclick="switchPage('dashboard')">🚀 Launch Dashboard</button>
            <button class="landing-btn secondary" onclick="switchPage('analytics')">📈 Analytics</button>
            <button class="landing-btn ghost" onclick="document.getElementById('landingExplain').scrollIntoView({behavior:'smooth'})">🔍 Learn More</button>
          </div>
        </section>

        <section class="landing-split reveal" id="landingExplain">
          <div class="landing-panel">
            <h2>What NaluLF Shows</h2>
            <ul>
              <li>Ledger rhythm & close-time deviations</li>
              <li>Transaction dominance by type</li>
              <li>Validator health & latency</li>
              <li>Liquidity, AMMs & escrow pressure</li>
              <li>Whale movement & capital concentration</li>
            </ul>
          </div>

          <div class="landing-panel landing-panel-glow">
            <h2>Why It Matters</h2>
            <p>
              Many exploits, drains, and manipulative events emerge as <strong>patterns</strong>.
              NaluLF surfaces those signals early.
            </p>
          </div>
        </section>

        <section class="landing-features reveal">
          <article class="feature-card"><h3>📊 Ledger Rhythm</h3><p>Visualize cadence shifts and timing instability that often precede congestion.</p></article>
          <article class="feature-card"><h3>🧬 Network Health</h3><p>Monitor validator participation, latency distribution, and resilience under load.</p></article>
          <article class="feature-card danger"><h3>🐋 Whale Dominance</h3><p>Identify large actors, capital clustering, and sudden influence shifts.</p></article>
          <article class="feature-card danger"><h3>⚠️ Anomaly Detection</h3><p>Detect bursts, abnormal mixes, and behavior consistent with manipulation.</p></article>
        </section>
      </div>
    `;

    // Add Old English font styles
    const style = document.createElement('style');
    style.textContent = `
      .nalulf-logo-container {
        text-align: center;
        margin: 2rem 0;
      }
      
      .nalulf-logo {
        font-family: 'UnifrakturMaguntia', 'Uncial Antiqua', 'MedievalSharp', 'Old English Text MT', 'Engravers MT', 'Blackletter', serif;
        font-size: 4.5rem;
        font-weight: 400;
        letter-spacing: 3px;
        color: transparent;
        background: linear-gradient(135deg, #00fff0, #05d9e8, #01c5c4);
        -webkit-background-clip: text;
        background-clip: text;
        margin: 0;
        text-shadow: 0 0 40px rgba(0, 255, 240, 0.7), 0 0 80px rgba(5, 217, 232, 0.4);
        position: relative;
        display: inline-block;
      }
      
      .nalulf-logo::before {
        content: '';
        position: absolute;
        bottom: -8px;
        left: 0;
        width: 100%;
        height: 3px;
        background: linear-gradient(90deg, transparent 10%, #00fff0 25%, #05d9e8 50%, #00fff0 75%, transparent 90%);
        opacity: 0.8;
        border-radius: 2px;
        box-shadow: 0 0 20px rgba(0, 255, 240, 0.6);
      }
      
      .nalulf-text {
        display: inline-block;
        letter-spacing: 5px;
        text-transform: uppercase;
      }
      
      .nalulf-subtitle {
        font-family: 'Eagle Lake', 'Uncial Antiqua', 'MedievalSharp', cursive;
        font-size: 1.2rem;
        letter-spacing: 3px;
        color: #d4f1f4;
        opacity: 0.9;
        text-transform: uppercase;
        margin-top: 0.5rem;
        text-shadow: 0 0 10px rgba(212, 241, 244, 0.5);
      }
      
      @media (max-width: 768px) {
        .nalulf-logo {
          font-size: 3.5rem;
          letter-spacing: 2px;
        }
        
        .nalulf-subtitle {
          font-size: 1rem;
          letter-spacing: 2px;
        }
      }
    `;
    document.head.appendChild(style);

    refreshRevealObserver();
    showFooter();
    window.dispatchEvent(new CustomEvent("nalulf:pagechange", { detail: { pageId: "dashboard" } }));
  }

  // -----------------------------
  // Footer Component
  // -----------------------------
  function showFooter() {
    // Remove existing footer if present
    const existingFooter = document.getElementById('main-footer');
    if (existingFooter) existingFooter.remove();

    const footer = document.createElement('footer');
    footer.id = 'main-footer';
    footer.className = 'main-footer';
    footer.innerHTML = `
      <div class="footer-content">
        <div class="footer-section">
          <div class="footer-logo">🌊 <strong>NaluLF</strong></div>
          <div class="footer-slogan">Riding The Ledger Waves</div>
        </div>
        
        <div class="footer-section">
          <h4>Navigation</h4>
          <a href="javascript:void(0)" onclick="switchPage('dashboard')">Dashboard</a>
          <a href="javascript:void(0)" onclick="switchPage('analytics')">Analytics</a>
          <a href="javascript:void(0)" onclick="switchPage('inspector')">Inspector</a>
          <a href="javascript:void(0)" onclick="switchPage('explorer')">Explorer</a>
        </div>
        
        <div class="footer-section">
          <h4>DeFi</h4>
          <a href="javascript:void(0)" onclick="switchPage('tokens')">Tokens</a>
          <a href="javascript:void(0)" onclick="switchPage('amm')">AMM Pools</a>
          <a href="javascript:void(0)" onclick="switchPage('nfts')">NFTs</a>
        </div>
        
        <div class="footer-section">
          <h4>Resources</h4>
          <a href="javascript:void(0)" onclick="switchPage('news')">News</a>
          <a href="javascript:void(0)" onclick="switchPage('history')">History</a>
          <a href="javascript:void(0)" onclick="switchPage('about')">About</a>
          <a href="javascript:void(0)" onclick="switchPage('settings')">Settings</a>
        </div>
      </div>
      
      <div class="footer-bottom">
        <p>© ${new Date().getFullYear()} NaluLF. All rights reserved. | XRPL Analytics Platform</p>
        <div class="footer-links">
          <a href="javascript:void(0)" onclick="openCommandPalette()">Command (Ctrl+K)</a>
          <a href="javascript:void(0)" onclick="openThemePicker()">Theme Picker</a>
          <a href="javascript:void(0)" onclick="switchPage('profile')">Profile</a>
        </div>
      </div>
    `;

    document.body.appendChild(footer);

    // Add footer styles
    const footerStyle = document.createElement('style');
    footerStyle.textContent = `
      .main-footer {
        background: linear-gradient(180deg, 
          rgba(0, 21, 36, 0.95) 0%,
          rgba(0, 10, 18, 0.98) 100%
        );
        border-top: 1.5px solid rgba(0, 255, 240, 0.15);
        color: #d4f1f4;
        padding: 2rem 0 0;
        margin-top: 3rem;
      }
      
      .footer-content {
        max-width: 1200px;
        margin: 0 auto;
        padding: 0 2rem;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 2rem;
      }
      
      .footer-section {
        display: flex;
        flex-direction: column;
      }
      
      .footer-logo {
        font-family: 'UnifrakturMaguntia', 'Uncial Antiqua', 'MedievalSharp', serif;
        font-size: 1.8rem;
        letter-spacing: 2px;
        color: #00fff0;
        margin-bottom: 0.5rem;
      }
      
      .footer-slogan {
        font-family: 'JetBrains Mono', monospace;
        font-size: 0.8rem;
        letter-spacing: 2px;
        opacity: 0.7;
        text-transform: uppercase;
      }
      
      .footer-section h4 {
        color: #05d9e8;
        margin-bottom: 1rem;
        font-size: 1rem;
        text-transform: uppercase;
        letter-spacing: 1px;
      }
      
      .footer-section a {
        color: #d4f1f4;
        text-decoration: none;
        margin-bottom: 0.5rem;
        transition: color 0.3s ease;
      }
      
      .footer-section a:hover {
        color: #00fff0;
      }
      
      .footer-bottom {
        max-width: 1200px;
        margin: 2rem auto 0;
        padding: 1.5rem 2rem;
        border-top: 1px solid rgba(0, 255, 240, 0.1);
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
      }
      
      .footer-bottom p {
        opacity: 0.7;
        font-size: 0.9rem;
      }
      
      .footer-links {
        display: flex;
        gap: 1rem;
      }
      
      .footer-links a {
        color: #d4f1f4;
        text-decoration: none;
        font-size: 0.9rem;
        opacity: 0.8;
        transition: opacity 0.3s ease;
      }
      
      .footer-links a:hover {
        opacity: 1;
        color: #00fff0;
      }
      
      @media (max-width: 768px) {
        .footer-content {
          grid-template-columns: 1fr;
          gap: 1.5rem;
        }
        
        .footer-bottom {
          flex-direction: column;
          gap: 1rem;
          text-align: center;
        }
      }
    `;
    document.head.appendChild(footerStyle);
  }

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
        <p>This section is initializing.</p>
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
      window.dispatchEvent(new CustomEvent("nalulf:search", { detail: { type: "tx", value: q } }));
      toast("Sent tx hash to Explorer");
      return;
    }

    if (isLedgerIndex(q)) {
      switchPage("explorer");
      window.dispatchEvent(new CustomEvent("nalulf:search", { detail: { type: "ledger", value: Number(q) } }));
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

    const start = Date.now();
    const timeout = 8000;

    const tick = () => {
      if (window.UnifiedInspector && typeof window.UnifiedInspector.quickInspect === "function") {
        window.UnifiedInspector.quickInspect(addr);
        return;
      }

      if (Date.now() - start > timeout) {
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
    if (document.getElementById("nalulfDialogOverlay")) return;

    const overlay = document.createElement("div");
    overlay.id = "nalulfDialogOverlay";
    overlay.className = "nalulf-dialog-overlay";
    overlay.innerHTML = `
      <div class="nalulf-dialog" role="dialog" aria-modal="true">
        <div class="nalulf-dialog-head">
          <div class="nalulf-dialog-title" id="nalulfDialogTitle">Dialog</div>
          <button class="nalulf-dialog-close" id="nalulfDialogClose" type="button" aria-label="Close">✕</button>
        </div>
        <div class="nalulf-dialog-body" id="nalulfDialogBody"></div>
      </div>
    `;

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeDialog();
    });

    document.body.appendChild(overlay);
    document.getElementById("nalulfDialogClose")?.addEventListener("click", closeDialog);
  }

  function openDialog(title, bodyHtml) {
    ensureDialog();
    const overlay = document.getElementById("nalulfDialogOverlay");
    const t = document.getElementById("nalulfDialogTitle");
    const b = document.getElementById("nalulfDialogBody");
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
    const overlay = document.getElementById("nalulfDialogOverlay");
    if (overlay) overlay.classList.remove("show");
  }

  function toast(msg) {
    ensureToast();
    const host = document.getElementById("nalulfToastHost");
    if (!host) return;

    const t = document.createElement("div");
    t.className = "nalulf-toast";
    t.textContent = String(msg || "");
    host.appendChild(t);

    setTimeout(() => t.classList.add("show"), 10);
    setTimeout(() => {
      t.classList.remove("show");
      setTimeout(() => t.remove(), 220);
    }, 1800);
  }

  function ensureToast() {
    if (document.getElementById("nalulfToastHost")) return;
    const host = document.createElement("div");
    host.id = "nalulfToastHost";
    host.className = "nalulf-toast-host";
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
          window.dispatchEvent(new CustomEvent("nalulf:search", { detail: { type: "tx", value: q } }));
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
          window.dispatchEvent(new CustomEvent("nalulf:search", { detail: { type: "ledger", value: Number(q) } }));
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
    ensurePageHeader();

    applyPageClass("dashboard");
    setTheme(window.UI.currentTheme);

    // Create all page sections
    createPageContainer();

    // Hide all pages initially
    document.querySelectorAll(".page-section").forEach((s) => (s.style.display = "none"));

    // Show landing page in dashboard section
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

    window.addEventListener("nalulf:savedchange", updatePinnedPill);

    setupConnectionMonitoring();

    window.dispatchEvent(new CustomEvent("nalulf:pagechange", { detail: { pageId: "dashboard" } }));
    
    console.log("🌊 NaluLF UI initialized");
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
