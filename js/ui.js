/* =========================================
   NaluXrp 🌊 – UI Module (FULL)
   Navigation, Landing, Themes, Navbar, Analytics wiring
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
     PAGE INIT MAP
     (Single source of truth)
     NOTE: 'inspector' handler added — loads/initializes the full-page inspector
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
      // If inspector module already loaded, initialize it
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

      // Ensure an inspector container exists in the DOM
      let el = document.getElementById("inspector");
      if (!el) {
        el = document.createElement("section");
        el.id = "inspector";
        el.className = "page-section";
        // insert into main container if present, else append to body
        const main = document.getElementById("main") || document.getElementById("dashboard")?.parentElement || document.body;
        main.appendChild(el);
      }

      // Show a loading placeholder while we fetch the module
      el.innerHTML = `<div class="chart-section"><h2>Account Inspector</h2><p>Loading module…</p></div>`;

      // Lazy-load the inspector script (relative path works with GitHub Pages repo subpaths)
      const scriptSrcCandidates = [
        "js/account-inspector.js",
        "/js/account-inspector.js",
        `${window.location.origin}/js/account-inspector.js`,
        `https://raw.githubusercontent.com/808CryptoBeast/NaluXRP/main/js/account-inspector.js`
      ];

      // attempt to load candidates in order until one succeeds
      (async function tryLoadInspector() {
        for (const src of scriptSrcCandidates) {
          try {
            await loadScriptOnce(src);
            // give the module a moment to register its init function
            if (typeof window.initInspector === "function") {
              try {
                window.initInspector();
                return;
              } catch (err) {
                console.error("Inspector init after load failed:", err);
                break;
              }
            } else {
              // small pause to allow script to run
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
            // try next candidate
            console.warn("Failed to load inspector script from", src, e && e.message ? e.message : e);
            continue;
          }
        }
        // if we reach here, loading failed
        console.error("Failed to load account-inspector.js from any candidate");
        el.innerHTML = `<div class="chart-section"><h2>Account Inspector</h2><p>Failed to load module. Please ensure <code>js/account-inspector.js</code> is deployed.</p></div>`;
      })();
    }
  };

  /* -----------------------------
     NAVIGATION
  ----------------------------- */
  function switchPage(pageId) {
    // If the section doesn't exist, create a stub so handler can attach
    if (!document.getElementById(pageId)) {
      const stub = document.createElement("section");
      stub.id = pageId;
      stub.className = "page-section";
      // try to insert into main container if present, before footer
      const main = document.getElementById("main") || document.getElementById("dashboard")?.parentElement || document.body;
      main.appendChild(stub);
    }

    document.querySelectorAll(".page-section").forEach((sec) => {
      sec.style.display = "none";
      sec.classList.remove("active");
    });

    const target = document.getElementById(pageId);
    if (!target) {
      console.error("Page not found after stub creation:", pageId);
      return;
    }

    target.style.display = "block";
    target.classList.add("active");
    window.UI.currentPage = pageId;

    PAGE_INIT_MAP[pageId]?.();
    requestAnimationFrame(refreshRevealObserver);
  }

  /* -----------------------------
     LANDING PAGE
  ----------------------------- */
  function showLandingPage() {
    const container = document.getElementById("dashboard");
    if (!container) return;

    container.innerHTML = `
      <div class="landing-page">

        <!-- HERO -->
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

        <!-- EXPLANATION -->
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

        <!-- FEATURE CARDS -->
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

        <!-- FOOTER -->
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
    document.body.className = `theme-${theme}`;
  }

  /* -----------------------------
     SCRIPT LOADER (used by PAGE_INIT_MAP inspector)
     Attempts to load a script once (resolves when loaded)
  ----------------------------- */
  function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
      // already present?
      const already = Array.from(document.scripts).find(s => s.src && (s.src.indexOf(src) !== -1 || s.getAttribute('data-src') === src));
      if (already) {
        if (already.getAttribute('data-loaded') === 'true') return resolve();
        already.addEventListener('load', () => resolve());
        already.addEventListener('error', (e) => reject(e));
        return;
      }
      const s = document.createElement('script');
      s.setAttribute('data-src', src);
      s.src = src;
      s.async = true;
      s.onload = () => { s.setAttribute('data-loaded', 'true'); resolve(); };
      s.onerror = (e) => { s.remove(); reject(new Error('Failed to load ' + src)); };
      document.head.appendChild(s);
    });
  }

  /* -----------------------------
     INIT
  ----------------------------- */
  document.addEventListener("DOMContentLoaded", () => {
    setTheme(window.UI.currentTheme);
    initNavbar();

    document.querySelectorAll(".page-section").forEach((s) => {
      s.style.display = "none";
    });

    const dash = document.getElementById("dashboard");
    if (dash) {
      dash.style.display = "block";
      showLandingPage();
    }

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
