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
    dashboard: { crumb: "Dashboard", sub: "Ledger Overview" },
    inspector: { crumb: "Inspector", sub: "Tree • Trace • Quick Inspect" },
    analytics: { crumb: "Analytics", sub: "Patterns & Metrics" },
    explorer: { crumb: "Explorer", sub: "Search the XRPL" },
    validators: { crumb: "Validators", sub: "Health & Performance" },
    tokens: { crumb: "Tokens", sub: "Distribution & Markets" },
    amm: { crumb: "AMM Pools", sub: "Liquidity & Swaps" },
    nfts: { crumb: "NFTs", sub: "Collections & Activity" },
    profile: { crumb: "Profile", sub: "Account & Preferences" },
    news: { crumb: "News", sub: "Ledger Updates" },
    history: { crumb: "History", sub: "Snapshots & Events" },
    settings: { crumb: "Settings", sub: "System Configuration" },
    about: { crumb: "About", sub: "NaluLF Info" },
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
    body.style.backgroundImage = 'url("images/Landingpage-background.jpg")';
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
  // Page init map - Clears innerHTML in each function (working approach)
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

    inspector: () => {
      const el = document.getElementById("inspector");
      if (!el) return;
      
      // Try to connect to XRPL if not already connected
      try {
        if (typeof window.connectXRPL === "function" && !(window.XRPL && window.XRPL.connected)) {
          window.connectXRPL();
        }
      } catch (_) {}

      // Initialize inspector
      if (typeof window.initInspector === "function") {
        try {
          window.initInspector();
        } catch (e) {
          console.error("Inspector init failed:", e);
          showDefaultPage("inspector");
        }
      } else {
        showDefaultPage("inspector");
      }

      // If pinned exists, auto-inspect it
      const pinned = getPinned();
      if (pinned) tryInspectorQuickInspect(pinned);
    },
  };

  // -----------------------------
  // Navigation - WORKING VERSION (doesn't stack pages)
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

    // ✅ Force scroll to top BEFORE page initialization
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    
    setTimeout(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    }, 10);

    // Update UI state
    window.UI.currentPage = pageId;
    
    // Update page title
    document.title = `${PAGE_META[pageId].title || PAGE_META[pageId].crumb} | NaluLF`;

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
          
          <!-- Enhanced NaluLF Logo - NO WAVE EMOJI, THICKER LETTERS -->
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
            NaluLF is a <strong>deep-inspection platform</strong> for the XRP Ledger.
            It goes beyond surface metrics to expose <strong>patterns, dominance,
            stress signals, and anomalous behavior</strong> in real-time.
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
              <li><span class="bullet">▸</span>Ledger rhythm & close-time deviations</li>
              <li><span class="bullet">▸</span>Transaction dominance by type</li>
              <li><span class="bullet">▸</span>Validator health & latency</li>
              <li><span class="bullet">▸</span>Liquidity, AMMs & escrow pressure</li>
              <li><span class="bullet">▸</span>Whale movement & capital concentration</li>
            </ul>
          </div>

          <div class="landing-panel landing-panel-glow">
            <div class="panel-icon glow">⚡</div>
            <h2>Why It Matters</h2>
            <p>
              Many exploits, drains, and manipulative events emerge as <strong>patterns</strong>.
              NaluLF surfaces those signals early, giving you the edge to react before the market does.
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

        <section class="landing-features reveal">
          <div class="features-header">
            <h2>Powerful Features</h2>
            <p>Everything you need to analyze the XRP Ledger</p>
          </div>
          
          <div class="features-grid">
            <article class="feature-card">
              <div class="feature-icon">📊</div>
              <h3>Ledger Rhythm</h3>
              <p>Visualize cadence shifts and timing instability that often precede congestion.</p>
              <div class="feature-link" onclick="switchPage('analytics')">Explore →</div>
            </article>
            
            <article class="feature-card">
              <div class="feature-icon">🧬</div>
              <h3>Network Health</h3>
              <p>Monitor validator participation, latency distribution, and resilience under load.</p>
              <div class="feature-link" onclick="switchPage('validators')">Explore →</div>
            </article>
            
            <article class="feature-card danger">
              <div class="feature-icon">🐋</div>
              <h3>Whale Dominance</h3>
              <p>Identify large actors, capital clustering, and sudden influence shifts.</p>
              <div class="feature-link" onclick="switchPage('tokens')">Explore →</div>
            </article>
            
            <article class="feature-card danger">
              <div class="feature-icon">⚠️</div>
              <h3>Anomaly Detection</h3>
              <p>Detect bursts, abnormal mixes, and behavior consistent with manipulation.</p>
              <div class="feature-link" onclick="switchPage('inspector')">Explore →</div>
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

