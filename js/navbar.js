// =======================================================
// navbar.js — Stable + Responsive + Inspector Safe
// FIXES:
// ✅ Prevents Inspector duplication (keeps only ONE)
// ✅ Prevents overlap at ~1068px (CSS handles + scroll rail helpers)
// ✅ Dropdown readable and usable on desktop + mobile
// ✅ Connection badge updates from xrpl-connection events
// ✅ Adds global top-offset so navbar doesn't cover page content
// =======================================================

(function () {
  const NAV_OFFSET_STYLE_ID = "nav-offset-style";
  const INSPECTOR_BTN_CLASS = "nav-inspector-btn";

  document.addEventListener("DOMContentLoaded", () => {
    initNavbar();
    injectNavbarSafetyStyles();
    ensureInspectorButton();
    bindConnectionBadge();
    applyNavOffset();
    installPageHighlighting();
  });

  // ----------------------------
  // Init
  // ----------------------------
  function initNavbar() {
    setupHamburger();
    setupDropdownsMobile();
    setupScrollHideDesktop();
    enableHorizontalWheelScroll();
    window.addEventListener("resize", () => {
      applyNavOffset();
      // close drawer if resizing up
      if (window.innerWidth > 992) closeMobileMenu();
    });
  }

  // ----------------------------
  // Inspector button (ONE only)
  // ----------------------------
  function ensureInspectorButton() {
    const navLinks = document.getElementById("navLinks");
    if (!navLinks) return;

    // Remove duplicates if any
    const all = navLinks.querySelectorAll(`[data-page="inspector"], .${INSPECTOR_BTN_CLASS}`);
    if (all.length > 1) {
      for (let i = 1; i < all.length; i++) all[i].remove();
    }

    // If exists already, ensure it has correct styling/class
    if (all.length === 1) {
      all[0].classList.add(INSPECTOR_BTN_CLASS);
      all[0].setAttribute("data-page", "inspector");
      return;
    }

    // Create
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `nav-btn ${INSPECTOR_BTN_CLASS}`;
    btn.setAttribute("data-page", "inspector");
    btn.innerHTML = `<span class="nav-icon">🔎</span><span class="nav-label">Inspector</span>`;
    btn.title = "Account Inspector";

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      safeSwitchPage("inspector");
      if (window.innerWidth <= 992) closeMobileMenu();
    });

    // Insert right after Dashboard if possible
    const dashBtn = findButtonForPage(navLinks, "dashboard");
    if (dashBtn && dashBtn.parentNode) {
      dashBtn.insertAdjacentElement("afterend", btn);
    } else {
      navLinks.prepend(btn);
    }
  }

  function findButtonForPage(container, pageId) {
    const direct = container.querySelector(`[data-page="${pageId}"]`);
    if (direct) return direct;

    // Try parsing onclick="switchPage('dashboard')"
    const candidates = container.querySelectorAll("button, a");
    for (const el of candidates) {
      const oc = el.getAttribute("onclick") || "";
      const match = oc.match(/switchPage\(['"]([^'"]+)['"]\)/);
      if (match && match[1] === pageId) return el;
    }
    return null;
  }

  // ----------------------------
  // Mobile menu (hamburger)
  // ----------------------------
  function setupHamburger() {
    const hamburger = document.getElementById("hamburger");
    const navLinks = document.getElementById("navLinks");
    if (!hamburger || !navLinks) return;

    hamburger.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      hamburger.classList.toggle("active");
      navLinks.classList.toggle("show");
      document.body.classList.toggle("mobile-menu-open");
    });

    // Tap outside closes menu (mobile only)
    document.addEventListener("click", (e) => {
      if (window.innerWidth > 992) return;
      if (!e.target.closest(".navbar") && !e.target.closest("#hamburger")) {
        closeMobileMenu();
      }
    });
  }

  function closeMobileMenu() {
    const hamburger = document.getElementById("hamburger");
    const navLinks = document.getElementById("navLinks");

    if (hamburger) hamburger.classList.remove("active");
    if (navLinks) navLinks.classList.remove("show");
    document.body.classList.remove("mobile-menu-open");

    // close any open dropdowns
    document.querySelectorAll(".nav-dropdown.open").forEach((d) => d.classList.remove("open"));
  }

  // ----------------------------
  // Dropdowns: Mobile click accordion, Desktop hover + click toggle
  // ----------------------------
  function setupDropdownsMobile() {
    const dropdownToggles = document.querySelectorAll(".dropdown-toggle");

    dropdownToggles.forEach((toggle) => {
      if (toggle.__bound) return;

      toggle.addEventListener("click", (e) => {
        const parent = toggle.closest(".nav-dropdown");
        if (!parent) return;

        // Desktop: allow click to toggle open state (nice for touch laptops)
        if (window.innerWidth > 992) {
          e.preventDefault();
          e.stopPropagation();

          // close others
          document.querySelectorAll(".nav-dropdown.open").forEach((d) => {
            if (d !== parent) d.classList.remove("open");
          });

          parent.classList.toggle("open");
          return;
        }

        // Mobile: accordion
        e.preventDefault();
        e.stopPropagation();

        document.querySelectorAll(".nav-dropdown.open").forEach((d) => {
          if (d !== parent) d.classList.remove("open");
        });

        parent.classList.toggle("open");
      });

      toggle.__bound = true;
    });

    // Click outside closes dropdowns (desktop + mobile)
    document.addEventListener("click", (e) => {
      if (e.target.closest(".nav-dropdown")) return;
      document.querySelectorAll(".nav-dropdown.open").forEach((d) => d.classList.remove("open"));
    });
  }

  // ----------------------------
  // Desktop scroll-hide navbar (optional)
  // ----------------------------
  function setupScrollHideDesktop() {
    const navbar = document.getElementById("navbar");
    if (!navbar) return;

    let lastScrollY = window.scrollY;

    window.addEventListener("scroll", () => {
      if (window.innerWidth <= 992) return;

      const currentY = window.scrollY;
      if (currentY > lastScrollY && currentY > 90) navbar.classList.add("hide");
      else navbar.classList.remove("hide");

      lastScrollY = currentY;
    });
  }

  // ----------------------------
  // Horizontal wheel scroll for nav rail (desktop)
  // ----------------------------
  function enableHorizontalWheelScroll() {
    const navLinks = document.getElementById("navLinks");
    if (!navLinks) return;

    navLinks.addEventListener(
      "wheel",
      (e) => {
        // Only when not in mobile drawer mode
        if (window.innerWidth <= 992) return;

        // Convert vertical wheel to horizontal scroll
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          navLinks.scrollLeft += e.deltaY;
          e.preventDefault();
        }
      },
      { passive: false }
    );
  }

  // ----------------------------
  // Connection badge hookup
  // ----------------------------
  function bindConnectionBadge() {
    const dot = document.getElementById("statusDot");
    const label = document.getElementById("connectionStatus");
    if (!dot || !label) return;

    // Default state
    setBadge("connecting", "Connecting…");

    // If XRPL has a getter, use initial
    try {
      if (typeof window.getXRPLState === "function") {
        const s = window.getXRPLState();
        if (s && s.connected) setBadge("live", `LIVE — ${s.server || "XRPL"}`);
      }
    } catch (_) {}

    window.addEventListener("xrpl-connection", (ev) => {
      const d = (ev && ev.detail) || {};
      if (d.connected) {
        setBadge("live", `LIVE — ${d.server || "XRPL"}`);
      } else {
        // distinguish connecting vs disconnected if mode is provided
        const mode = String(d.mode || "").toLowerCase();
        const reason = d.modeReason || "";
        if (mode.includes("connect")) {
          setBadge("connecting", reason ? `Connecting… (${reason})` : "Connecting…");
        } else {
          setBadge("down", reason ? `Disconnected (${reason})` : "Disconnected");
        }
      }
    });

    function setBadge(state, text) {
      dot.classList.remove("active", "connecting");
      if (state === "live") dot.classList.add("active");
      else if (state === "connecting") dot.classList.add("connecting");
      label.textContent = text;
    }
  }

  // ----------------------------
  // Prevent navbar from covering page content
  // (global offset based on actual navbar height)
  // ----------------------------
  function applyNavOffset() {
    const navbar = document.getElementById("navbar");
    if (!navbar) return;

    const h = Math.max(70, Math.round(navbar.getBoundingClientRect().height));
    document.documentElement.style.setProperty("--nav-offset", `${h}px`);

    // inject once: apply padding to container & scroll margin
    if (!document.getElementById(NAV_OFFSET_STYLE_ID)) {
      const style = document.createElement("style");
      style.id = NAV_OFFSET_STYLE_ID;
      style.textContent = `
        .container { padding-top: var(--nav-offset, 78px) !important; }
        .page-section { scroll-margin-top: var(--nav-offset, 78px); }
        /* About page uses its own padding; keep it consistent even if navbar height changes */
        .about-page { padding-top: calc(var(--nav-offset, 78px) + 28px) !important; }
      `;
      document.head.appendChild(style);
    }
  }

  // ----------------------------
  // Active page highlighting
  // ----------------------------
  function installPageHighlighting() {
    // Wrap switchPage (if present) to update nav highlights
    if (typeof window.switchPage === "function" && !window.__navHighlightWrapped) {
      const original = window.switchPage;
      window.switchPage = function (pageId, ...rest) {
        const res = original.apply(this, [pageId, ...rest]);
        setActiveNav(pageId);
        // close mobile menu after navigation
        if (window.innerWidth <= 992) closeMobileMenu();
        return res;
      };
      window.__navHighlightWrapped = true;
    }

    // Attempt initial highlight based on active section
    setTimeout(() => {
      const active = document.querySelector(".page-section.active");
      if (active && active.id) setActiveNav(active.id);
    }, 0);
  }

  function setActiveNav(pageId) {
    const navLinks = document.getElementById("navLinks");
    if (!navLinks) return;

    // Clear
    navLinks.querySelectorAll(".nav-btn.is-active, .dropdown-item.is-active").forEach((n) => {
      n.classList.remove("is-active");
    });

    // Mark buttons that match page
    const nodes = navLinks.querySelectorAll("button, a");
    nodes.forEach((node) => {
      const target = getTargetPage(node);
      if (target === pageId) node.classList.add("is-active");
    });

    // Also close dropdown open state on desktop after navigation
    document.querySelectorAll(".nav-dropdown.open").forEach((d) => d.classList.remove("open"));
  }

  function getTargetPage(node) {
    if (!node) return null;
    const dp = node.getAttribute("data-page");
    if (dp) return dp;

    const oc = node.getAttribute("onclick") || "";
    const match = oc.match(/switchPage\(['"]([^'"]+)['"]\)/);
    return match ? match[1] : null;
  }

  function safeSwitchPage(pageId) {
    if (typeof window.switchPage === "function") window.switchPage(pageId);
    else console.error("❌ switchPage() not found!");
  }

  // ----------------------------
  // Overlay safety (notifications shouldn’t block nav)
  // ----------------------------
  function injectNavbarSafetyStyles() {
    if (document.getElementById("navbar-safety-styles")) return;

    const style = document.createElement("style");
    style.id = "navbar-safety-styles";
    style.textContent = `
      .navbar, #navbar { z-index: 10000; pointer-events: auto; }
      .notification-container,
      .notifications,
      .toast-container,
      .toast-wrapper,
      .toasts,
      #notifications { pointer-events: none !important; z-index: 9000 !important; }
      .notification, .toast { pointer-events: auto !important; }
    `;
    document.head.appendChild(style);
  }

  // exports
  window.closeMobileMenu = closeMobileMenu;
})();
