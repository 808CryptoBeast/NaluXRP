// =======================================================
// navbar.js – COMPLETE REDESIGN
// "Riding The Ledger Waves"
// 
// Features:
// - Animated particle system
// - Wave physics simulation
// - Liquid morphing interactions
// - Advanced gesture controls
// - Immersive sound feedback (optional)
// =======================================================

(function () {
  if (window.__NALU_NAVBAR_REDESIGN__) return;
  window.__NALU_NAVBAR_REDESIGN__ = true;

  const ICON_BP = 1150;
  const BOTTOM_BP = 520;
  const PARTICLE_COUNT = 15;

  const PRIMARY_BOTTOM = [
    { id: "dashboard", label: "Dashboard", icon: "📊" },
    { id: "inspector", label: "Inspector", icon: "🔎" },
    { id: "analytics", label: "Analytics", icon: "📈" },
    { id: "explorer", label: "Explorer", icon: "🔍" },
  ];

  const SHEET_GROUPS = [
    {
      title: "Network",
      items: [
        { id: "validators", label: "Validators", icon: "🛡️" },
        { id: "analytics", label: "Analytics", icon: "📈" },
        { id: "explorer", label: "Explorer", icon: "🔍" },
      ],
    },
    {
      title: "DeFi",
      items: [
        { id: "tokens", label: "Tokens", icon: "🪙" },
        { id: "amm", label: "AMM Pools", icon: "💧" },
        { id: "nfts", label: "NFTs", icon: "🎨" },
      ],
    },
    {
      title: "Resources",
      items: [
        { id: "news", label: "News", icon: "📰" },
        { id: "history", label: "History", icon: "📜" },
        { id: "about", label: "About", icon: "ℹ️" },
      ],
    },
    {
      title: "Account",
      items: [
        { id: "profile", label: "Profile", icon: "👤" },
        { id: "settings", label: "Settings", icon: "⚙️" },
      ],
    },
  ];

  let lastActivePage = "dashboard";
  let particles = [];
  let animationFrame = null;

  function mode() {
    if (window.innerWidth <= BOTTOM_BP) return "bottom";
    if (window.innerWidth <= ICON_BP) return "icons";
    return "desktop";
  }

  // Debounce utility
  function debounce(func, wait) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), wait);
    };
  }

  document.addEventListener("DOMContentLoaded", () => {
    const navbar = document.getElementById("navbar");
    if (!navbar) return;

    initParticleSystem(navbar);
    ensureBottomNav();
    ensureBottomSheet();
    setupHamburgerInteraction();
    setupNavbarVisibility();
    setupKeyboardShortcuts();
    setupConnectionMonitoring();

    window.addEventListener("resize", debounce(normalizeState, 150));
    normalizeState();

    window.addEventListener("naluxrp:pagechange", (ev) => {
      const pageId = ev?.detail?.pageId;
      if (!pageId) return;
      lastActivePage = pageId;
      setActiveNav(pageId);
      syncBottomActive(pageId);
    });

    window.addEventListener("naluxrp:savedchange", renderSavedInSheet);

    injectSafetyStyles();
    
    console.log("🌊 Wave navbar initialized");
  });

  function normalizeState() {
    const m = mode();
    if (m === "bottom") {
      showBottomNav(true);
      closeBottomSheet();
    } else {
      showBottomNav(false);
      closeBottomSheet();
    }
  }

  // ========================================= 
  // PARTICLE SYSTEM
  // ========================================= 
  function initParticleSystem(navbar) {
    const container = document.createElement("div");
    container.className = "nav-particles";
    navbar.appendChild(container);

    // Create particles
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const particle = document.createElement("div");
      particle.className = "nav-particle";
      
      // Random positioning
      const x = Math.random() * 100;
      const delay = Math.random() * 8;
      const duration = 8 + Math.random() * 4;
      
      particle.style.left = `${x}%`;
      particle.style.animationDelay = `${delay}s`;
      particle.style.animationDuration = `${duration}s`;
      
      container.appendChild(particle);
      particles.push(particle);
    }

    // Mouse interaction with particles
    navbar.addEventListener("mousemove", (e) => {
      const rect = navbar.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      
      particles.forEach((p, i) => {
        const particleX = parseFloat(p.style.left);
        const distance = Math.abs(particleX - x);
        
        if (distance < 20) {
          p.style.transform = `translateX(${(particleX - x) * 2}px) scale(1.5)`;
          p.style.opacity = '1';
        } else {
          p.style.transform = '';
          p.style.opacity = '';
        }
      });
    });

    navbar.addEventListener("mouseleave", () => {
      particles.forEach(p => {
        p.style.transform = '';
        p.style.opacity = '';
      });
    });
  }

  // ========================================= 
  // HAMBURGER - Holographic Effect
  // ========================================= 
  function setupHamburgerInteraction() {
    const hamburger = document.getElementById("hamburger");
    if (!hamburger) return;

    hamburger.addEventListener("click", (e) => {
      if (mode() !== "icons") return;
      e.preventDefault();
      e.stopPropagation();

      // Create liquid ripple
      createLiquidRipple(e, hamburger);
      
      // Haptic feedback
      if (navigator.vibrate) {
        navigator.vibrate([10, 5, 10]);
      }

      openBottomSheet();
    });

    // 3D tilt effect
    hamburger.addEventListener("mousemove", (e) => {
      const rect = hamburger.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const percentX = (x - centerX) / centerX;
      const percentY = (y - centerY) / centerY;

      hamburger.style.transform = `
        perspective(1000px)
        rotateY(${percentX * 10}deg)
        rotateX(${-percentY * 10}deg)
        translateY(-4px)
        scale(1.05)
      `;
    });

    hamburger.addEventListener("mouseleave", () => {
      hamburger.style.transform = "";
    });
  }

  // Create liquid ripple effect
  function createLiquidRipple(event, element) {
    const ripple = document.createElement("span");
    const rect = element.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 2;
    const x = event.clientX - rect.left - size / 2;
    const y = event.clientY - rect.top - size / 2;

    ripple.style.cssText = `
      position: absolute;
      width: ${size}px;
      height: ${size}px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(0, 255, 240, 0.6), transparent 60%);
      left: ${x}px;
      top: ${y}px;
      pointer-events: none;
      animation: liquidRipple 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
      z-index: 10;
    `;

    const style = document.createElement("style");
    style.textContent = `
      @keyframes liquidRipple {
        0% {
          transform: scale(0);
          opacity: 0.8;
        }
        100% {
          transform: scale(1);
          opacity: 0;
        }
      }
    `;
    document.head.appendChild(style);

    element.style.position = "relative";
    element.appendChild(ripple);

    setTimeout(() => {
      ripple.remove();
      style.remove();
    }, 800);
  }

  // ========================================= 
  // NAVBAR VISIBILITY
  // ========================================= 
  function setupNavbarVisibility() {
    const navbar = document.getElementById("navbar");
    let lastScrollY = 0;
    let ticking = false;

    function updateNavbar() {
      const currentScrollY = window.scrollY;
      
      // Only hide on desktop
      if (mode() === "desktop") {
        if (currentScrollY > lastScrollY && currentScrollY > 100) {
          navbar.style.transform = "translateY(-100%)";
        } else {
          navbar.style.transform = "";
        }
      } else {
        navbar.style.transform = "";
      }

      lastScrollY = currentScrollY;
      ticking = false;
    }

    window.addEventListener("scroll", () => {
      if (!ticking) {
        window.requestAnimationFrame(updateNavbar);
        ticking = true;
      }
    });
  }

  // ========================================= 
  // CONNECTION STATUS MONITORING
  // ========================================= 
  function setupConnectionMonitoring() {
    const statusDot = document.getElementById("statusDot");
    const statusText = document.getElementById("connectionStatus");
    
    if (!statusDot || !statusText) {
      console.warn("Connection status elements not found");
      return;
    }

    // Check for XRPL client in global scope
    function checkConnection() {
      // Check if xrpl client exists and is connected
      if (typeof window.xrplClient !== 'undefined') {
        const isConnected = window.xrplClient?.isConnected?.() || false;
        updateStatus(isConnected);
      } else if (typeof window.client !== 'undefined') {
        const isConnected = window.client?.isConnected?.() || false;
        updateStatus(isConnected);
      } else {
        // Check for connection state in other possible locations
        const connState = window.connectionState || window.xrplConnectionState;
        if (connState) {
          updateStatus(connState === 'connected');
        }
      }
    }

    function updateStatus(isConnected) {
      if (isConnected) {
        statusDot.classList.add("connected");
        statusText.textContent = "Connected";
        statusDot.style.background = "#50fa7b";
        statusDot.style.boxShadow = "0 0 10px #50fa7b, 0 0 20px #50fa7b";
      } else {
        statusDot.classList.remove("connected");
        statusText.textContent = "Connecting...";
        statusDot.style.background = "rgba(255, 255, 255, 0.35)";
        statusDot.style.boxShadow = "";
      }
    }

    // Listen for custom connection events
    window.addEventListener("xrpl:connected", () => {
      updateStatus(true);
    });

    window.addEventListener("xrpl:disconnected", () => {
      updateStatus(false);
    });

    // Also listen for generic connection events
    window.addEventListener("naluxrp:connected", () => {
      updateStatus(true);
    });

    window.addEventListener("naluxrp:disconnected", () => {
      updateStatus(false);
    });

    // Poll connection status every 2 seconds
    setInterval(checkConnection, 2000);
    
    // Check immediately
    setTimeout(checkConnection, 500);
  }

  // ========================================= 
  // KEYBOARD SHORTCUTS
  // ========================================= 
  function setupKeyboardShortcuts() {
    document.addEventListener("keydown", (e) => {
      // ESC to close bottom sheet
      if (e.key === "Escape") {
        const sheet = document.getElementById("navBottomSheet");
        if (sheet && sheet.classList.contains("show")) {
          closeBottomSheet();
        }
      }

      // Ctrl/Cmd + K for search
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        const m = mode();
        if (m === "icons" || m === "bottom") {
          openBottomSheet();
          setTimeout(() => {
            document.getElementById("sheetSearchInput")?.focus();
          }, 400);
        }
      }
    });
  }

  // ========================================= 
  // ACTIVE STATE MANAGEMENT
  // ========================================= 
  function setActiveNav(pageId) {
    const all = document.querySelectorAll("#navLinks .nav-btn, #navLinks .dropdown-item");
    all.forEach((el) => {
      el.classList.remove("is-active");
      el.removeAttribute("aria-current");
    });

    const candidates = [...document.querySelectorAll(`#navLinks .nav-btn[onclick], #navLinks .dropdown-item[onclick]`)];
    const match = candidates.find((el) => {
      const oc = el.getAttribute("onclick") || "";
      return oc.includes(`switchPage('${pageId}')`) || oc.includes(`switchPage("${pageId}")`);
    });

    if (match) {
      match.classList.add("is-active");
      match.setAttribute("aria-current", "page");
    }
  }

  // ========================================= 
  // BOTTOM NAVIGATION
  // ========================================= 
  function ensureBottomNav() {
    if (document.getElementById("bottomNav")) return;

    const bar = document.createElement("div");
    bar.id = "bottomNav";
    bar.className = "bottom-nav";
    bar.setAttribute("role", "navigation");
    bar.setAttribute("aria-label", "Mobile navigation");

    bar.innerHTML = `
      <div class="bottom-nav-track">
        ${PRIMARY_BOTTOM.map(
          (x) => `
            <button class="bottom-item" type="button" data-page="${x.id}" aria-label="${x.label}">
              <div class="bottom-ico">${x.icon}</div>
              <div class="bottom-lbl">${x.label}</div>
            </button>
          `
        ).join("")}
        <button class="bottom-item bottom-menu" type="button" data-page="__menu__" aria-label="Open menu">
          <div class="bottom-ico"></div>
          <div class="bottom-lbl">Menu</div>
        </button>
      </div>
    `;

    document.body.appendChild(bar);

    bar.addEventListener("click", (e) => {
      const btn = e.target.closest(".bottom-item");
      if (!btn) return;

      const page = btn.getAttribute("data-page");
      if (!page) return;

      // Liquid morph feedback
      btn.style.transform = "scale(0.9)";
      setTimeout(() => {
        btn.style.transform = "";
      }, 200);

      // Haptic feedback
      if (navigator.vibrate) {
        navigator.vibrate(10);
      }

      if (page === "__menu__") {
        openBottomSheet();
        return;
      }

      if (typeof window.switchPage === "function") {
        window.switchPage(page);
      }
    });
  }

  function showBottomNav(show) {
    const bar = document.getElementById("bottomNav");
    if (!bar) return;
    bar.classList.toggle("show", !!show);
    document.body.classList.toggle("has-bottom-nav", !!show);
  }

  function syncBottomActive(pageId) {
    const bar = document.getElementById("bottomNav");
    if (!bar) return;

    bar.querySelectorAll(".bottom-item").forEach((b) => {
      b.classList.remove("is-active");
      b.removeAttribute("aria-current");
    });

    const exact = bar.querySelector(`.bottom-item[data-page="${CSS.escape(pageId)}"]`);
    if (exact) {
      exact.classList.add("is-active");
      exact.setAttribute("aria-current", "page");
    }
  }

  // ========================================= 
  // BOTTOM SHEET
  // ========================================= 
  function ensureBottomSheet() {
    if (document.getElementById("navSheetBackdrop")) return;

    const backdrop = document.createElement("div");
    backdrop.id = "navSheetBackdrop";
    backdrop.className = "nav-sheet-backdrop";

    const sheet = document.createElement("div");
    sheet.id = "navBottomSheet";
    sheet.className = "nav-bottom-sheet";
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-label", "Navigation menu");

    sheet.innerHTML = `
      <div class="sheet-handle"></div>
      <div class="sheet-head">
        <div class="sheet-title">Navigation</div>
        <button class="sheet-close" type="button" aria-label="Close menu">✕</button>
      </div>

      <div class="sheet-search">
        <input id="sheetSearchInput" type="text" placeholder="Search address, tx, ledger…" aria-label="Search" />
        <button id="sheetSearchBtn" type="button">Go</button>
      </div>

      <div class="sheet-body">
        <div class="sheet-group">
          <button class="sheet-group-toggle" type="button" data-gi="saved" aria-expanded="true">
            <span>💾 Saved</span>
            <span class="chev">▾</span>
          </button>
          <div class="sheet-group-items" data-gi="saved" id="sheetSavedList"></div>
        </div>

        ${SHEET_GROUPS.map(
          (g, gi) => `
            <div class="sheet-group">
              <button class="sheet-group-toggle" type="button" data-gi="${gi}" aria-expanded="true">
                <span>${g.title}</span>
                <span class="chev">▾</span>
              </button>
              <div class="sheet-group-items" data-gi="${gi}">
                ${g.items
                  .map(
                    (it) => `
                      <button class="sheet-item" type="button" data-page="${it.id}">
                        <span class="sheet-ico">${it.icon}</span>
                        <span class="sheet-lbl">${it.label}</span>
                      </button>
                    `
                  )
                  .join("")}
              </div>
            </div>
          `
        ).join("")}

        <div class="sheet-group">
          <button class="sheet-item sheet-item-theme" type="button" data-action="theme">
            <span class="sheet-ico">🎨</span>
            <span class="sheet-lbl">Theme picker</span>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);
    document.body.appendChild(sheet);

    backdrop.addEventListener("click", closeBottomSheet);
    sheet.querySelector(".sheet-close").addEventListener("click", closeBottomSheet);

    // Swipe to close
    setupSwipeGesture(sheet);

    // Accordion
    sheet.querySelectorAll(".sheet-group-toggle").forEach((t) => {
      t.addEventListener("click", () => {
        const gi = t.getAttribute("data-gi");
        const items = sheet.querySelector(`.sheet-group-items[data-gi="${gi}"]`);
        if (!items) return;

        const collapsed = items.classList.toggle("collapsed");
        t.setAttribute("aria-expanded", collapsed ? "false" : "true");

        const chev = t.querySelector(".chev");
        if (chev) chev.textContent = collapsed ? "▸" : "▾";
      });
    });

    // Item clicks
    sheet.addEventListener("click", (e) => {
      const item = e.target.closest(".sheet-item");
      if (!item) return;

      const page = item.getAttribute("data-page");
      const action = item.getAttribute("data-action");

      if (navigator.vibrate) {
        navigator.vibrate(10);
      }

      if (action === "theme") {
        closeBottomSheet();
        setTimeout(() => {
          if (window.UIX?.openThemePicker) window.UIX.openThemePicker();
          else if (typeof window.cycleTheme === "function") window.cycleTheme();
        }, 200);
        return;
      }

      if (page && typeof window.switchPage === "function") {
        closeBottomSheet();
        setTimeout(() => {
          window.switchPage(page);
        }, 200);
      }
    });

    // Search
    sheet.querySelector("#sheetSearchBtn")?.addEventListener("click", () => {
      const v = sheet.querySelector("#sheetSearchInput")?.value || "";
      closeBottomSheet();
      setTimeout(() => {
        if (window.UIX?.runSearch) window.UIX.runSearch(v);
        else if (window.switchPage) window.switchPage("explorer");
      }, 200);
    });

    sheet.querySelector("#sheetSearchInput")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        sheet.querySelector("#sheetSearchBtn")?.click();
      }
    });

    renderSavedInSheet();
  }

  // Swipe gesture
  function setupSwipeGesture(sheet) {
    let startY = 0;
    let currentY = 0;
    let isDragging = false;

    sheet.addEventListener("touchstart", (e) => {
      const scrollTop = sheet.scrollTop;
      if (scrollTop === 0) {
        startY = e.touches[0].clientY;
        isDragging = true;
      }
    });

    sheet.addEventListener("touchmove", (e) => {
      if (!isDragging) return;
      currentY = e.touches[0].clientY;
      const diff = currentY - startY;

      if (diff > 0) {
        e.preventDefault();
        sheet.style.transform = `translateY(${diff}px)`;
        sheet.style.transition = "none";
      }
    });

    sheet.addEventListener("touchend", () => {
      if (!isDragging) return;
      isDragging = false;

      const diff = currentY - startY;
      sheet.style.transition = "";
      sheet.style.transform = "";

      if (diff > 120) {
        closeBottomSheet();
      }

      startY = 0;
      currentY = 0;
    });
  }

  function openBottomSheet() {
    const backdrop = document.getElementById("navSheetBackdrop");
    const sheet = document.getElementById("navBottomSheet");
    if (!backdrop || !sheet) return;

    renderSavedInSheet();

    backdrop.classList.add("show");
    sheet.classList.add("show");
    document.body.classList.add("sheet-open");

    setTimeout(() => {
      const firstInput = sheet.querySelector("input");
      firstInput?.focus();
    }, 400);

    sheet.setAttribute("aria-hidden", "false");
  }

  function closeBottomSheet() {
    const backdrop = document.getElementById("navSheetBackdrop");
    const sheet = document.getElementById("navBottomSheet");
    if (!backdrop || !sheet) return;

    backdrop.classList.remove("show");
    sheet.classList.remove("show");
    document.body.classList.remove("sheet-open");

    sheet.setAttribute("aria-hidden", "true");
  }

  function renderSavedInSheet() {
    const host = document.getElementById("sheetSavedList");
    if (!host) return;

    const list = window.UIX?.getSaved ? window.UIX.getSaved() : [];
    const pinned = window.UIX?.getPinned ? window.UIX.getPinned() : null;

    if (!list.length) {
      host.innerHTML = `<div class="sheet-empty">No saved addresses yet.</div>`;
      return;
    }

    host.innerHTML = list
      .slice(0, 10)
      .map((a) => {
        const short = `${a.slice(0, 6)}…${a.slice(-5)}`;
        const pin = pinned === a ? "📌" : "☆";
        return `
          <button class="sheet-item sheet-saved" type="button" data-saved="${a}">
            <span class="sheet-ico">${pin}</span>
            <span class="sheet-lbl">${short}</span>
          </button>
        `;
      })
      .join("");

    host.querySelectorAll(".sheet-saved").forEach((btn) => {
      btn.addEventListener("click", () => {
        const addr = btn.getAttribute("data-saved");
        closeBottomSheet();

        setTimeout(() => {
          if (typeof window.switchPage === "function") {
            window.switchPage("inspector");
          }

          setTimeout(() => {
            if (window.UnifiedInspector?.quickInspect) {
              window.UnifiedInspector.quickInspect(addr);
            } else if (window.UIX?.runSearch) {
              window.UIX.runSearch(addr);
            }
          }, 300);
        }, 200);
      });
    });
  }

  // ========================================= 
  // SAFETY STYLES
  // ========================================= 
  function injectSafetyStyles() {
    if (document.getElementById("navbar-safety-styles")) return;

    const style = document.createElement("style");
    style.id = "navbar-safety-styles";
    style.textContent = `
      #navbar, .navbar {
        pointer-events: auto;
        z-index: 60000 !important;
      }

      .notification-container,
      .notifications,
      .toast-container,
      .toast-wrapper,
      .toasts,
      #notifications {
        pointer-events: none !important;
        z-index: 9000 !important;
      }

      .notification,
      .toast {
        pointer-events: auto !important;
      }
    `;
    document.head.appendChild(style);
  }

})();
