// =======================================================
// navbar.js — FIXED (PORTAL DROPDOWNS) + HOVER + MOBILE TAP
// - Dropdown menus are "portaled" to <body> so they are never clipped by overflow containers
// - Hover opens on desktop (hover-capable devices)
// - Tap/click toggles on mobile/touch
// - Outside click + ESC closes
// - Wires ALL nav buttons and dropdown items (data-page or onclick="switchPage('x')")
// - Ensures ONLY ONE Account Inspector button
// - Updates connection badge via xrpl-connection events
// - Sets --nav-offset so navbar doesn't cover top content
// =======================================================

(function () {
  if (window.__NALU_NAVBAR_V5__) return;
  window.__NALU_NAVBAR_V5__ = true;

  const PORTAL_CLASS = "dropdown-menu--portal";
  const OPEN_CLASS = "open";

  const INSPECTOR_SELECTOR = [
    '[data-page="inspector"]',
    '.nav-inspector-btn',
    '.nav-inspector-item',
    'button[onclick*="switchPage(\'inspector\')"]',
    'button[onclick*="switchPage(\\"inspector\\")"]',
    'a[onclick*="switchPage(\'inspector\')"]',
    'a[onclick*="switchPage(\\"inspector\\")"]'
  ].join(",");

  // Tracks portal state for each menu
  const menuHome = new WeakMap(); // menu -> { parent, nextSibling }
  const ddState = new WeakMap();  // dropdown -> { isOpen, closeTimer, onScroll }

  document.addEventListener("DOMContentLoaded", () => {
    injectNavbarSafetyStyles();
    hideLegacyHamburgerAndToggles();
    applyNavOffset();

    wireAllNavTargets();            // bind Dashboard/Profile/Settings/etc + dropdown items
    setupDropdownsWithPortal();      // makes dropdowns actually appear (not clipped)
    ensureSingleInspectorButton();   // de-dupe + normalize
    wireAllNavTargets();            // rebind after inspector normalization

    bindConnectionBadge();
    hookSwitchPageForActiveState();
    setTimeout(syncActiveFromCurrentSection, 0);

    window.addEventListener("resize", () => {
      closeAllDropdowns();
      applyNavOffset();
    });
  });

  // ------------------------------------------------------
  // NAV WIRING: supports:
  // - data-page="..."
  // - onclick="switchPage('xyz')"
  // ------------------------------------------------------
  function wireAllNavTargets() {
    const navRoot = document.getElementById("navbar") || document;
    const candidates = navRoot.querySelectorAll("button, a");

    candidates.forEach((el) => {
      if (el.classList.contains("dropdown-toggle")) return;

      const page = getPageFromElement(el);
      if (!page) return;

      if (el.__naluNavBound) return;

      // Remove inline onclick to prevent double / inconsistent behavior
      if (el.getAttribute("onclick")) el.removeAttribute("onclick");

      // anchors should not navigate away
      if (el.tagName.toLowerCase() === "a" && !el.getAttribute("href")) {
        el.setAttribute("href", "#");
      }

      el.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        safeSwitchPage(page);
        setActiveNav(page);
        closeAllDropdowns();
      });

      el.dataset.page = page;
      el.__naluNavBound = true;
    });
  }

  function getPageFromElement(el) {
    const dp = el.getAttribute("data-page");
    if (dp) return dp;

    const oc = el.getAttribute("onclick") || "";
    const m = oc.match(/switchPage\(['"]([^'"]+)['"]\)/);
    if (m && m[1]) return m[1];

    return null;
  }

  // ------------------------------------------------------
  // DROPDOWNS (PORTAL): hover desktop + tap mobile
  // ------------------------------------------------------
  function setupDropdownsWithPortal() {
    const dropdowns = document.querySelectorAll(".nav-dropdown");
    const isHoverDevice = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

    dropdowns.forEach((dd) => {
      const toggle = dd.querySelector(".dropdown-toggle");
      const menu = dd.querySelector(".dropdown-menu");
      if (!toggle || !menu) return;

      if (toggle.__naluDropdownBound) return;

      // Initialize state
      ddState.set(dd, { isOpen: false, closeTimer: null, onScroll: null });

      // Toggle click works for ALL devices (mobile + desktop)
      toggle.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (isDropdownOpen(dd)) closeDropdown(dd);
        else openDropdown(dd);
      });

      // Desktop hover behavior (only on hover-capable devices)
      if (isHoverDevice) {
        dd.addEventListener("mouseenter", () => {
          openDropdown(dd);
        });

        dd.addEventListener("mouseleave", () => {
          // Delay close slightly so pointer can move toward menu
          scheduleClose(dd, 180);
        });
      }

      // Prevent inside click from bubbling to outside-close listener
      dd.addEventListener("click", (e) => e.stopPropagation());

      toggle.__naluDropdownBound = true;
    });

    // Outside click closes
    document.addEventListener("click", () => closeAllDropdowns());

    // ESC closes
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeAllDropdowns();
    });
  }

  function isDropdownOpen(dd) {
    const st = ddState.get(dd);
    return !!st?.isOpen;
  }

  function openDropdown(dd) {
    // Close others
    document.querySelectorAll(".nav-dropdown").forEach((x) => {
      if (x !== dd && isDropdownOpen(x)) closeDropdown(x);
    });

    const toggle = dd.querySelector(".dropdown-toggle");
    const menu = dd.querySelector(".dropdown-menu");
    if (!toggle || !menu) return;

    clearCloseTimer(dd);

    // Portal menu to body to avoid overflow clipping
    portalMenu(dd, menu);

    // Show and position
    menu.style.display = "flex";
    positionPortalMenu(toggle, menu);

    dd.classList.add(OPEN_CLASS);
    toggle.setAttribute("aria-expanded", "true");

    // Keep it open when hovering menu itself (desktop)
    const isHoverDevice = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    if (isHoverDevice) {
      menu.addEventListener("mouseenter", menu.__naluEnter || (menu.__naluEnter = () => clearCloseTimer(dd)));
      menu.addEventListener("mouseleave", menu.__naluLeave || (menu.__naluLeave = () => scheduleClose(dd, 180)));
    }

    // Reposition on scroll while open
    const st = ddState.get(dd) || {};
    if (!st.onScroll) {
      st.onScroll = () => {
        if (!isDropdownOpen(dd)) return;
        positionPortalMenu(toggle, menu);
      };
      window.addEventListener("scroll", st.onScroll, true);
      window.addEventListener("resize", st.onScroll);
      ddState.set(dd, st);
    }

    st.isOpen = true;
    ddState.set(dd, st);
  }

  function closeDropdown(dd) {
    const toggle = dd.querySelector(".dropdown-toggle");
    const menu = dd.querySelector(".dropdown-menu");
    if (!toggle || !menu) return;

    clearCloseTimer(dd);

    // Hide
    menu.style.display = "none";

    // Return menu to original location
    unportalMenu(menu);

    dd.classList.remove(OPEN_CLASS);
    toggle.setAttribute("aria-expanded", "false");

    const st = ddState.get(dd);
    if (st?.onScroll) {
      window.removeEventListener("scroll", st.onScroll, true);
      window.removeEventListener("resize", st.onScroll);
      st.onScroll = null;
    }

    if (st) {
      st.isOpen = false;
      ddState.set(dd, st);
    }
  }

  function closeAllDropdowns() {
    document.querySelectorAll(".nav-dropdown").forEach((dd) => {
      if (isDropdownOpen(dd)) closeDropdown(dd);
    });
  }

  function scheduleClose(dd, ms) {
    const st = ddState.get(dd);
    if (!st) return;

    clearCloseTimer(dd);
    st.closeTimer = setTimeout(() => {
      closeDropdown(dd);
    }, ms);

    ddState.set(dd, st);
  }

  function clearCloseTimer(dd) {
    const st = ddState.get(dd);
    if (!st) return;
    if (st.closeTimer) clearTimeout(st.closeTimer);
    st.closeTimer = null;
    ddState.set(dd, st);
  }

  // ------------------------------------------------------
  // PORTAL HELPERS
  // ------------------------------------------------------
  function portalMenu(dd, menu) {
    if (menu.classList.contains(PORTAL_CLASS)) return;

    // Save original location once
    if (!menuHome.has(menu)) {
      menuHome.set(menu, { parent: menu.parentNode, nextSibling: menu.nextSibling });
    }

    // Move to body
    document.body.appendChild(menu);
    menu.classList.add(PORTAL_CLASS);

    // Stop click propagation so outside click doesn't instantly close before navigation
    if (!menu.__naluMenuClickBound) {
      menu.addEventListener("click", (e) => e.stopPropagation());
      menu.__naluMenuClickBound = true;
    }

    // After any selection, close (navigation handler also closes, this is backup)
    if (!menu.__naluMenuSelectBound) {
      menu.addEventListener("click", () => setTimeout(closeAllDropdowns, 0));
      menu.__naluMenuSelectBound = true;
    }
  }

  function unportalMenu(menu) {
    if (!menu.classList.contains(PORTAL_CLASS)) return;
    const home = menuHome.get(menu);
    if (!home || !home.parent) return;

    menu.classList.remove(PORTAL_CLASS);
    if (home.nextSibling && home.nextSibling.parentNode === home.parent) {
      home.parent.insertBefore(menu, home.nextSibling);
    } else {
      home.parent.appendChild(menu);
    }
  }

  function positionPortalMenu(toggle, menu) {
    const pad = 10;
    const rect = toggle.getBoundingClientRect();

    menu.style.position = "fixed";
    menu.style.top = `${Math.round(rect.bottom + 10)}px`;

    // Default align right edge with toggle right edge
    let left = rect.right - menu.offsetWidth;
    if (!Number.isFinite(left)) left = rect.left;

    // Clamp to viewport
    left = Math.max(pad, Math.min(left, window.innerWidth - pad - menu.offsetWidth));
    menu.style.left = `${Math.round(left)}px`;

    // Prevent going off bottom: if needed, place above
    const mRect = menu.getBoundingClientRect();
    if (mRect.bottom > window.innerHeight - pad && rect.top > mRect.height + pad) {
      menu.style.top = `${Math.round(rect.top - 10 - mRect.height)}px`;
    }
  }

  // ------------------------------------------------------
  // SINGLE INSPECTOR BUTTON (dedupe + normalize)
  // ------------------------------------------------------
  function ensureSingleInspectorButton() {
    const navLinks = document.getElementById("navLinks");
    if (!navLinks) return;

    const found = Array.from(document.querySelectorAll(INSPECTOR_SELECTOR));
    let keeper = found.find((n) => navLinks.contains(n)) || found[0] || null;

    found.forEach((n) => {
      if (n !== keeper) n.remove();
    });

    if (!keeper) {
      keeper = document.createElement("button");
      keeper.type = "button";
      navLinks.appendChild(keeper);
    }

    // Normalize to button
    if (keeper.tagName.toLowerCase() !== "button") {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = keeper.className || "";
      btn.innerHTML = keeper.innerHTML || "";
      keeper.replaceWith(btn);
      keeper = btn;
    }

    keeper.type = "button";
    keeper.classList.add("nav-btn", "nav-inspector-btn");
    keeper.dataset.page = "inspector";
    keeper.innerHTML = `<span class="nav-icon">🔎</span><span class="nav-label">Inspector</span>`;
    keeper.title = "Account Inspector";

    // Place after Dashboard when possible
    const dash = navLinks.querySelector('[data-page="dashboard"]') || navLinks.querySelector('button.nav-btn');
    if (dash && dash.nextElementSibling !== keeper) dash.insertAdjacentElement("afterend", keeper);
  }

  // ------------------------------------------------------
  // Connection badge
  // ------------------------------------------------------
  function bindConnectionBadge() {
    const dot = document.getElementById("statusDot");
    const label = document.getElementById("connectionStatus");
    if (!dot || !label) return;

    setBadge("connecting", "Connecting…");

    try {
      if (typeof window.getXRPLState === "function") {
        const s = window.getXRPLState();
        if (s?.connected) setBadge("live", `LIVE — ${s.server || "XRPL"}`);
      }
    } catch (_) {}

    window.addEventListener("xrpl-connection", (ev) => {
      const d = ev?.detail || {};
      if (d.connected) setBadge("live", `LIVE — ${d.server || "XRPL"}`);
      else {
        const reason = d.modeReason ? ` (${d.modeReason})` : "";
        setBadge("connecting", `Connecting…${reason}`);
      }
    });

    function setBadge(state, text) {
      dot.classList.remove("active", "connecting", "down");
      if (state === "live") dot.classList.add("active");
      else if (state === "connecting") dot.classList.add("connecting");
      else dot.classList.add("down");
      label.textContent = text;
    }
  }

  // ------------------------------------------------------
  // Active page highlighting
  // ------------------------------------------------------
  function hookSwitchPageForActiveState() {
    if (typeof window.switchPage !== "function") return;
    if (window.__NALU_SWITCHPAGE_WRAPPED__) return;

    const original = window.switchPage;
    window.switchPage = function (pageId, ...rest) {
      const res = original.apply(this, [pageId, ...rest]);
      setActiveNav(pageId);
      closeAllDropdowns();
      return res;
    };

    window.__NALU_SWITCHPAGE_WRAPPED__ = true;
  }

  function syncActiveFromCurrentSection() {
    const active = document.querySelector(".page-section.active");
    if (active?.id) setActiveNav(active.id);
  }

  function setActiveNav(pageId) {
    const navLinks = document.getElementById("navLinks");
    if (!navLinks) return;

    navLinks.querySelectorAll(".is-active").forEach((n) => n.classList.remove("is-active"));
    navLinks.querySelectorAll(`[data-page="${pageId}"]`).forEach((n) => n.classList.add("is-active"));
  }

  function safeSwitchPage(pageId) {
    if (typeof window.switchPage === "function") window.switchPage(pageId);
    else console.error("❌ switchPage() not found!");
  }

  // ------------------------------------------------------
  // Navbar offset
  // ------------------------------------------------------
  function applyNavOffset() {
    const navbar = document.getElementById("navbar");
    if (!navbar) return;

    const h = Math.max(70, Math.round(navbar.getBoundingClientRect().height));
    document.documentElement.style.setProperty("--nav-offset", `${h}px`);

    if (!document.getElementById("nav-offset-style")) {
      const style = document.createElement("style");
      style.id = "nav-offset-style";
      style.textContent = `
        .container { padding-top: var(--nav-offset, 78px) !important; }
        .page-section { scroll-margin-top: var(--nav-offset, 78px); }
      `;
      document.head.appendChild(style);
    }
  }

  // ------------------------------------------------------
  // Safety: toasts can't block navbar
  // ------------------------------------------------------
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

  function hideLegacyHamburgerAndToggles() {
    const hamburger = document.getElementById("hamburger");
    if (hamburger) hamburger.style.display = "none";

    const t1 = document.getElementById("navbarToggle");
    const t2 = document.getElementById("navbarToggleBtn");
    if (t1) t1.style.display = "none";
    if (t2) t2.style.display = "none";
  }
})();
