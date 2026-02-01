/* =========================================
   NaluXrp 🌊 – UI Module (FULL)
   Navigation, Landing, Themes, Navbar, Analytics wiring

   FIXES (IMPORTANT):
   ✅ Hard-hide/show page sections using inline !important
      (prevents landing/dashboard content leaking into inspector)
   ✅ Preserve theme-* classes while using body.dashboard / body.inspector
   ✅ Landing background handled inline (as you designed)
   ========================================= */

(function () {
  /* -----------------------------
     GLOBAL UI STATE
  ----------------------------- */
  window.UI = {
    currentPage: "dashboard",
    currentTheme: "gold",
    themes: ["gold", "cosmic", "starry", "hawaiian"],
    navbarLocked: false,
    lastScrollY: 0,
    observers: {
      reveal: null,
    },
  };

  /* -----------------------------
     ✅ BODY CLASS / BACKGROUND HELPERS
  ----------------------------- */
  function applyThemeClass(theme) {
    const body = document.body;
    if (!body) return;

    // Remove existing theme-* classes safely
    (window.UI.themes || []).forEach((t) => body.classList.remove(`theme-${t}`));

    // Add current theme class
    body.classList.add(`theme-${theme}`);
  }

  function applyPageClass(pageId) {
    const body = document.body;
    if (!body) return;

    // Clear landing inline background whenever we switch "real pages"
    clearLandingBackground();

    // Ensure only one of these page classes is active
    body.classList.remove("dashboard", "inspector");

    // Inspector uses its own background class; everything else uses dashboard background
    if (pageId === "inspector") body.classList.add("inspector");
    else body.classList.add("dashboard");
  }

  function setLandingBackground() {
    const body = document.body;
    if (!body) return;

    body.dataset.landingBg = "1";

    // ✅ Path relative to index.html
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

  /* -----------------------------
     ✅ HARD SHOW/HIDE HELPERS (NEW)
     This prevents CSS !important rules from overriding page switching.
  ----------------------------- */
  function hardHideSection(el) {
    if (!el) return;
    el.style.setProperty("display", "none", "important");
    el.classList.remove("active");
    el.setAttribute("aria-hidden", "true");
  }

  function hardShowSection(el) {
    if (!el) return;
    el.style.setProperty("display", "block", "important");
    el.classList.add("active");
    el.setAttribute("aria-hidden", "false");
  }

  function hardHideAllSections() {
    document.querySelectorAll(".page-section").forEach(hardHideSection);
  }

  /* -----------------------------
     PAGE INIT MAP
  ----------------------------- */
  const PAGE_INIT_MAP = {
    dashboard: () => {
      const el = document.getElementById("dashboard");
      if (el) el.innerHTML = "";
      if (typeof window.renderDashboard === "function") {
        window.renderDashboard();
      } else {
        showDefaultPage("dashboard");
      }
    },

    analytics: () => {
      if (typeof window.initAnalytics === "function") {
        window.initAnalytics();
      } else {
        showDefaultPage("analytics");
      }
    },

    validators: () =>
      window.initValidators ? window.initValidators() : showDefaultPage("validators"),

    tokens: () =>
      window.initTokens ? window.initTokens() : showDefaultPage("tokens"),

    amm: () =>
      window.AMM?.init ? window.AMM.init() : showDefaultPage("amm"),

    explorer: () =>
      window.initExplorer ? window.initExplorer() : showDefaultPage("explorer"),

    nfts: () =>
      window.initNFTs ? window.initNFTs() : showDefaultPage("nfts"),

    profile: () =>
      window.initProfile ? window.initProfile() : showDefaultPage("profile"),

    news: () =>
      window.initNews ? window.initNews() : showDefaultPage("news"),

    history: () =>
      window.initHistory ? window.initHistory() : showDefaultPage("history"),

    settings: () =>
      window.initSettings ? window.initSettings() : showDefaultPage("settings"),

    about: () =>
      window.initAbout ? window.initAbout() : showDefaultPage("about"),

    // Inspector page: full-page account inspector
    inspector: () => {
      try {
        if (typeof window.connectXRPL === "function" && !(window.XRPL && window.XRPL.connected)) {
          window.connectXRPL();
        }
      } catch (_) {}

      if (typeof window.initInspector === "function") {
        try {
          window.initInspector();
          return;
        } catch (e) {
          console.error("Inspector init failed:", e);
          showDefaultPage("inspector");
          return;
        }
      }

      let el = document.getElementById("inspector");
      if (!el) {
        el = document.createElement("section");
        el.id = "inspector";
        el.className = "page-section";
        const main = document.getElementById("main") || document.getElementById("dashboard")?.parentElement || document.body;
        main.appendChild(el);
      }

      el.innerHTML = `<div class="chart-section"><h2>Account Inspector</h2><p>Loading module…</p></div>`;

      const basePath = (function () {
        const p = window.location.pathname || "/";
        return p.endsWith("/") ? p : p.replace(/\/[^\/]*$/, "/");
      })();

      const scriptSrcCandidates = [
        "js/account-inspector.js",
        `${window.location.origin}${basePath}js/account-inspector.js`,
        "https://cdn.jsdelivr.net/gh/808CryptoBeast/NaluXRP@main/js/account-inspector.js",
      ];

      (async function tryLoadInspector() {
        for (const src of scriptSrcCandidates) {
          try {
            await loadScriptOnce(src);

            if (typeof window.initInspector === "function") {
              try {
                window.initInspector();
                return;
              } catch (err) {
                console.error("Inspector init after load failed:", err);
                break;
              }
            } else {
              await new Promise((r) => setTimeout(r, 120));
              if (typeof window.initInspector === "function") {
                try {
                  window.initInspector();
                  return;
                } catch (err) {
                  console.error("Inspector init after load failed:", err);
                  break;
                }
              }
            }
          } catch (e) {
            console.warn("Failed to load inspector script from", src, e && e.message ? e.message : e);
            continue;
          }
        }

        console.error("Failed to load account-inspector.js from any candidate");
        el.innerHTML = `<div class="chart-section"><h2>Account Inspector</h2><p>Failed to load module. Please ensure <code>js/account-inspector.js</code> is deployed.</p></div>`;
      })();
    },
  };

  /* -----------------------------
     NAVIGATION
  ----------------------------- */
  function closeMobileNavIfOpen() {
    try {
      const hamburger = document.getElementById("hamburger");
      const navLinks = document.getElementById("navLinks");
      const navbar = document.getElementById("navbar");

      if (hamburger) hamburger.classList.remove("active");
      if (navLinks) navLinks.classList.remove("show");
      if (navbar) navbar.classList.remove("open");

      if (hamburger) hamburger.setAttribute("aria-expanded", "false");
      document.body.classList.remove("no-scroll");
    } catch (_) {}
  }

  function switchPage(pageId) {
    // ✅ Apply background class for page (dashboard vs inspector)
    applyPageClass(pageId);

    // If the section doesn't exist, create a stub so handler can attach
    if (!document.getElementById(pageId)) {
      const stub = document.createElement("section");
      stub.id = pageId;
      stub.className = "page-section";
      const main = document.getElementById("main") || document.getElementById("dashboard")?.parentElement || document.body;
      main.appendChild(stub);
    }

    // ✅ HARD HIDE EVERYTHING (prevents landing leakage)
    hardHideAllSections();

    const target = document.getElementById(pageId);
    if (!target) {
      console.error("Page not found after stub creation:", pageId);
      return;
    }

    // ✅ HARD SHOW TARGET
    hardShowSection(target);

    window.UI.currentPage = pageId;

    PAGE_INIT_MAP[pageId]?.();
    requestAnimationFrame(refreshRevealObserver);

    // Close mobile nav after selection
    closeMobileNavIfOpen();
  }

  /* -----------------------------
     LANDING PAGE
  ----------------------------- */
  function showLandingPage() {
    // landing uses dashboard base class + inline bg image
    applyPageClass("dashboard");
    setLandingBackground();

    const container = document.getElementById("dashboard");
    if (!container) return;

    container.innerHTML = `
      <div class="landing-page">
        <section class="landing-hero">
          <div class="landing-orb"></div>

          <div class="landing-kicker">XRPL • Real-time • Pattern Intelligence</div>

          <h1 class="landing-title">🌊 NaluXrp</h1>
          <div class="landing-tagline">Riding the Ledger Waves</div>

          <p class="landing-description">
            NaluXrp is a deep-inspection platform for the XRP Ledger.
            It goes beyond surface metrics to expose <strong>patterns, dominance,
            stress signals, and anomalous behavior</strong> — helping analysts,
            builders, and investigators understand what’s really happening on-chain.
          </p>

          <div class="landing-actions">
            <button class="landing-btn primary" onclick="switchPage('dashboard')">
              🚀 Launch Dashboard
            </button>
            <button class="landing-btn secondary" onclick="switchPage('analytics')">
              📈 Analytics
            </button>
            <button class="landing-btn ghost" onclick="document.getElementById('landingExplain').scrollIntoView({behavior:'smooth'})">
              🔍 Learn More
            </button>
          </div>
        </section>

        <section class="landing-split reveal" id="landingExplain">
          <div class="landing-panel">
            <h2>What NaluXrp Shows</h2>
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
              Many exploits, drains, and manipulative events do not appear
              immediately obvious. They emerge as <strong>patterns</strong> —
              cadence changes, abnormal mixes, or entity concentration.
              NaluXrp is built to surface those signals early.
            </p>
          </div>
        </section>

        <section class="landing-features reveal">
          <article class="feature-card">
            <h3>📊 Ledger Rhythm</h3>
            <p>
              Visualize cadence shifts and timing instability that often precede
              congestion or abnormal activity.
            </p>
          </article>

          <article class="feature-card">
            <h3>🧬 Network Health</h3>
            <p>
              Monitor validator participation, latency distribution,
              and resilience under load.
            </p>
          </article>

          <article class="feature-card danger">
            <h3>🐋 Whale Dominance</h3>
            <p>
              Identify large actors, capital clustering, and sudden influence shifts
              across the ledger.
            </p>
          </article>

          <article class="feature-card danger">
            <h3>⚠️ Anomaly Detection</h3>
            <p>
              Detect bursts, abnormal mixes, and behavior consistent with
              fund drains or manipulation.
            </p>
          </article>
        </section>

        <footer class="landing-footer reveal">
          <div class="footer-grid">
            <div>
              <strong>NaluXrp</strong>
              <p>XRPL intelligence & pattern recognition.</p>
            </div>

            <div>
              <strong>Explore</strong>
              <a onclick="switchPage('dashboard')">Dashboard</a>
              <a onclick="switchPage('analytics')">Analytics</a>
              <a onclick="switchPage('explorer')">Explorer</a>
            </div>

            <div>
              <strong>Resources</strong>
              <a onclick="switchPage('about')">About</a>
              <a onclick="switchPage('history')">History</a>
              <a onclick="switchPage('news')">News</a>
            </div>

            <div>
              <strong>Status</strong>
              <div class="footer-status">
                <span class="status-dot" id="landingStatusDot"></span>
                <span id="landingConnectionText">Connecting…</span>
              </div>
            </div>
          </div>
        </footer>
      </div>
    `;

    refreshRevealObserver();
    updateLandingConnectionStatus();
  }

  /* -----------------------------
     REVEAL ANIMATIONS
  ----------------------------- */
  function refreshRevealObserver() {
    if (window.UI.observers.reveal) {
      window.UI.observers.reveal.disconnect();
    }

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

  /* -----------------------------
     CONNECTION STATUS
  ----------------------------- */
  function updateLandingConnectionStatus() {
    const dot = document.getElementById("landingStatusDot");
    const text = document.getElementById("landingConnectionText");
    if (!dot || !text) return;

    if (window.XRPL?.connected) {
      dot.classList.add("active");
      text.textContent = "Connected";
    } else {
      dot.classList.remove("active");
      text.textContent = "Connecting…";
    }
  }

  /* -----------------------------
     FALLBACK PAGE
  ----------------------------- */
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

  /* -----------------------------
     NAVBAR + THEME
  ----------------------------- */
  function initNavbar() {
    const navbar = document.getElementById("navbar");
    const hamburger = document.getElementById("hamburger");
    const navLinks = document.getElementById("navLinks");

    if (hamburger && navLinks) {
      hamburger.onclick = () => {
        hamburger.classList.toggle("active");
        navLinks.classList.toggle("show");
      };
    }

    window.addEventListener("scroll", () => {
      if (window.scrollY > window.UI.lastScrollY && window.scrollY > 120) {
        navbar?.classList.add("hide");
      } else {
        navbar?.classList.remove("hide");
      }
      window.UI.lastScrollY = window.scrollY;
    });
  }

  function cycleTheme() {
    const i = window.UI.themes.indexOf(window.UI.currentTheme);
    setTheme(window.UI.themes[(i + 1) % window.UI.themes.length]);
  }

  function setTheme(theme) {
    window.UI.currentTheme = theme;
    applyThemeClass(theme);
  }

  /* -----------------------------
     SCRIPT LOADER
  ----------------------------- */
  function canonicalUrl(src) {
    try {
      return new URL(src, document.baseURI).href;
    } catch (_) {
      return src;
    }
  }

  function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
      const canon = canonicalUrl(src);

      const already = Array.from(document.scripts).find((s) => s.src && canonicalUrl(s.src) === canon);
      if (already) {
        if (already.getAttribute("data-loaded") === "true") return resolve();

        const onLoad = () => {
          already.setAttribute("data-loaded", "true");
          cleanup();
          resolve();
        };
        const onErr = (e) => {
          cleanup();
          reject(e instanceof Error ? e : new Error("Failed to load " + src));
        };
        const cleanup = () => {
          already.removeEventListener("load", onLoad);
          already.removeEventListener("error", onErr);
        };

        already.addEventListener("load", onLoad);
        already.addEventListener("error", onErr);
        return;
      }

      const s = document.createElement("script");
      s.src = canon;
      s.async = true;
      s.onload = () => {
        s.setAttribute("data-loaded", "true");
        resolve();
      };
      s.onerror = () => {
        s.remove();
        reject(new Error("Failed to load " + src));
      };
      document.head.appendChild(s);
    });
  }

  /* -----------------------------
     INIT
  ----------------------------- */
  document.addEventListener("DOMContentLoaded", () => {
    applyPageClass("dashboard");
    setTheme(window.UI.currentTheme);
    initNavbar();

    // ✅ Hard hide everything first
    hardHideAllSections();

    // Show dashboard section to host landing page
    const dash = document.getElementById("dashboard");
    if (dash) {
      hardShowSection(dash);
      showLandingPage();
    }

    // Keep landing bg attachment responsive on resize/rotate
    window.addEventListener("resize", () => {
      if (document.body && document.body.dataset.landingBg === "1") {
        const isMobile = window.matchMedia && window.matchMedia("(max-width: 768px)").matches;
        document.body.style.backgroundAttachment = isMobile ? "scroll" : "fixed";
      }
    });

    setInterval(updateLandingConnectionStatus, 1500);
  });

  /* -----------------------------
     EXPORTS
  ----------------------------- */
  window.switchPage = switchPage;
  window.cycleTheme = cycleTheme;
  window.setTheme = setTheme;
  window.showLandingPage = showLandingPage;
})();
