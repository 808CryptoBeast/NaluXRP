// =======================================================
// navbar.js — FULL (NO HAMBURGER) + WORKING NAV BUTTONS + DROPDOWNS
// Fixes:
// ✅ Wires ALL nav buttons + dropdown items (onclick OR data-page)
// ✅ Dropdowns: hover (desktop) + click/tap (touch/mobile)
// ✅ Guarantees only ONE Account Inspector button (dedupe)
// ✅ Closes dropdowns on outside click / ESC / navigation
// ✅ Dynamic --nav-offset so navbar doesn't cover content
// ✅ Updates connection badge via xrpl-connection events
// =======================================================

(function () {
  if (window.__NALU_NAVBAR_V4__) return;
  window.__NALU_NAVBAR_V4__ = true;

  const INSPECTOR_SELECTOR = [
    '[data-page="inspector"]',
    '.nav-inspector-btn',
    '.nav-inspector-item',
    'button[onclick*="switchPage(\'inspector\')"]',
    'button[onclick*="switchPage(\\"inspector\\")"]',
    'a[onclick*="switchPage(\'inspector\')"]',
    'a[onclick*="switchPage(\\"inspector\\")"]'
  ].join(",");

  document.addEventListener("DOMContentLoaded", () => {
    injectNavbarSafetyStyles();
    applyNavOffset();

    // Remove hamburger if it exists in DOM (some older HTML still includes it)
    const hamburger = document.getElementById("hamburger");
    if (hamburger) hamburger.style.display = "none";

    // 1) Wire navigation everywhere (this makes all buttons work)
    wireAllNavTargets();

    // 2) Fix dropdown behavior (desktop hover + click/tap)
    setupDropdowns();

    // 3) Ensure only one Inspector button exists, and make it a proper nav button
    ensureSingleInspectorButton();

    // 4) Wire again (in case inspector was created/normalized)
    wireAllNavTargets();

    // 5) Connection badge updates
    bindConnectionBadge();

    // Active state sync
    hookSwitchPageForActiveState();
    setTimeout(syncActiveFromCurrentSection, 0);

    window.addEventListener("resize", () => {
      closeAllDropdowns();
      applyNavOffset();
    });
  });

  // ------------------------------------------------------
  // NAV WIRING (CRITICAL): supports:
  // - data-page="..."
  // - onclick="switchPage('...')"
  // - dropdown <a> items with onclick
  // ------------------------------------------------------
  function wireAllNavTargets() {
    const navRoot = document.getElementById("navbar") || document;
    const candidates = navRoot.querySelectorAll("button, a");

    candidates.forEach((el) => {
      // If it's a dropdown toggle, skip (handled separately)
      if (el.classList.contains("dropdown-toggle")) return;

      // Determine intended page
      const page = getPageFromElement(el);
      if (!page) return;

      // Avoid double-binding
      if (el.__naluNavBound) return;

      // Remove inline onclick to prevent double-fires
      if (el.getAttribute("onclick")) el.removeAttribute("onclick");

      // Normalize anchor usability
      if (el.tagName.toLowerCase() === "a") {
        // If no href, prevent jumping
        if (!el.getAttribute("href")) el.setAttribute("href", "#");
      }

      el.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();

        safeSwitchPage(page);
        setActiveNav(page);
        closeAllDropdowns();
      });

      // Store dataset for highlighting
      el.dataset.page = page;

      el.__naluNavBound = true;
    });
  }

  function getPageFromElement(el) {
    // Prefer data-page
    const dp = el.getAttribute("data-page");
    if (dp) return dp;

    // Parse onclick="switchPage('xyz')"
    const oc = el.getAttribute("onclick") || "";
    const m = oc.match(/switchPage\(['"]([^'"]+)['"]\)/);
    if (m && m[1]) return m[1];

    return null;
  }

  // ------------------------------------------------------
  // DROPDOWNS: open on hover for desktop, click/tap for touch
  // ------------------------------------------------------
  function setupDropdowns() {
    const dropdowns = document.querySelectorAll(".nav-dropdown");
    const isHoverDevice = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

    dropdowns.forEach((dd) => {
      const toggle = dd.querySelector(".dropdown-toggle");
      const menu = dd.querySelector(".dropdown-menu");
      if (!toggle || !menu) return;

      // Avoid double-binding
      if (toggle.__naluDropdownBound) return;

      // Click/tap toggles (works everywhere)
      toggle.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();

        // Close other dropdowns
        document.querySelectorAll(".nav-dropdown.open").forEach((x) => {
          if (x !== dd) x.classList.remove("open");
        });

        dd.classList.toggle("open");
        ensureDropdownInViewport(dd);
      });

      // Desktop hover support (only on hover-capable devices)
      if (isHoverDevice) {
        let closeTimer = null;

        dd.addEventListener("mouseenter", () => {
          if (closeTimer) clearTimeout(closeTimer);

          // Close others
          document.querySelectorAll(".nav-dropdown.open").forEach((x) => {
            if (x !== dd) x.classList.remove("open");
          });

          dd.classList.add("open");
          ensureDropdownInViewport(dd);
        });

        dd.addEventListener("mouseleave", () => {
          if (closeTimer) clearTimeout(closeTimer);
          closeTimer = setTimeout(() => dd.classList.remove("open"), 180);
        });
      }

      toggle.__naluDropdownBound = true;
    });

    // Outside click closes
    document.addEventListener("click", (e) => {
      if (e.target.closest(".nav-dropdown")) return;
      closeAllDropdowns();
    });

    // ESC closes
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeAllDropdowns();
    });

    // Click inside menu closes after selection (wired nav handler will navigate)
    document.querySelectorAll(".nav-dropdown .dropdown-menu").forEach((menu) => {
      if (menu.__naluMenuBound) return;
      menu.addEventListener("click", () => {
        // navigation handler closes too, but this helps if a click doesn't navigate
        setTimeout(closeAllDropdowns, 0);
      });
      menu.__naluMenuBound = true;
    });
  }

  function closeAllDropdowns() {
    document.querySelectorAll(".nav-dropdown.open").forEach((d) => d.classList.remove("open"));
  }

  function ensureDropdownInViewport(dropdown) {
    const menu = dropdown.querySelector(".dropdown-menu");
    if (!menu) return;

    // Reset tweaks
    menu.style.left = "";
    menu.style.right = "";
    menu.style.maxWidth = "";

    const pad = 10;
    const r = menu.getBoundingClientRect();

    if (r.right > window.innerWidth - pad) {
      menu.style.right = "0";
      menu.style.left = "auto";
      menu.style.maxWidth = `calc(100vw - ${pad * 2}px)`;
    }

    const r2 = menu.getBoundingClientRect();
    if (r2.left < pad) {
      menu.style.left = "0";
      menu.style.right = "auto";
      menu.style.maxWidth = `calc(100vw - ${pad * 2}px)`;
    }
  }

  // ------------------------------------------------------
  // SINGLE INSPECTOR BUTTON (dedupe + normalize)
  // ------------------------------------------------------
  function ensureSingleInspectorButton() {
    const navLinks = document.getElementById("navLinks");
    if (!navLinks) return;

    const found = Array.from(document.querySelectorAll(INSPECTOR_SELECTOR));

    // Prefer one inside navLinks
    let keeper = found.find((n) => navLinks.contains(n)) || found[0] || null;

    // Remove duplicates
    found.forEach((n) => {
      if (n !== keeper) n.remove();
    });

    // Create if missing
    if (!keeper) {
      keeper = document.createElement("button");
      keeper.type = "button";
      navLinks.appendChild(keeper);
    }

    // Normalize
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

    // Position after Dashboard if possible
    const dash = navLinks.querySelector('[data-page="dashboard"]');
    if (dash && dash.nextElementSibling !== keeper) {
      dash.insertAdjacentElement("afterend", keeper);
    }
  }

  // ------------------------------------------------------
  // Connection badge (statusDot + connectionStatus)
  // ------------------------------------------------------
  function bindConnectionBadge() {
    const dot = document.getElementById("statusDot");
    const label = document.getElementById("connectionStatus");
    if (!dot || !label) return;

    setBadge("connecting", "Connecting…");

    // initial (if available)
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
  // Navbar offset so it doesn't cover top-of-page content
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

    navLinks.querySelectorAll(".nav-btn.is-active, .dropdown-item.is-active").forEach((n) => {
      n.classList.remove("is-active");
    });

    navLinks.querySelectorAll(`[data-page="${pageId}"]`).forEach((n) => n.classList.add("is-active"));
  }

  function safeSwitchPage(pageId) {
    if (typeof window.switchPage === "function") window.switchPage(pageId);
    else console.error("❌ switchPage() not found!");
  }

  // ------------------------------------------------------
  // Overlay safety: alerts/toasts should not block navbar
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
})();
