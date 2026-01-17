// =======================================================
// navbar.js – STABLE + MOBILE FRIENDLY + OVERLAY SAFE
// NO HAMBURGER (removed by request)
// Keeps core behavior:
// - Scroll-hide on desktop
// - Dropdown hover desktop / click toggle mobile
// - Inspector link injected into Network dropdown
// - Desktop + floating navbar toggle buttons
// - Keyboard shortcut: "N" toggles navbar
// - DOES NOT break fixed navbar (no "position: relative" override)
// =======================================================

(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", () => {
    initNavbar();
    injectNavbarSafetyStyles();
  });

  /* ------------------------------------------------------
     INIT NAVBAR
  ------------------------------------------------------ */
  function initNavbar() {
    // Core features
    setupDesktopAndFloatingToggle();
    setupScrollHideDesktop();
    setupDropdownsMobile();
    setupInspectorInNetworkDropdown();
    setupGlobalCloseHandlers();

    // Optional: make inline onclick navigation "better" (closes menus, avoids double calls)
    // ONLY inside navbar/navLinks so it won't touch landing buttons etc.
    setupInlineSwitchPageInterception();

    console.log("✅ Navbar module loaded (overlay-safe, no-hamburger, toggles enabled)");
  }

  /* ------------------------------------------------------
     STATE HELPERS
  ------------------------------------------------------ */
  function getUIState() {
    // Uses your window.UI if present, else fallback internal
    window.UI = window.UI || {};
    if (typeof window.UI.navbarLocked !== "boolean") window.UI.navbarLocked = false;
    if (typeof window.UI.lastScrollY !== "number") window.UI.lastScrollY = window.scrollY || 0;
    return window.UI;
  }

  function isTypingContext(el) {
    if (!el) return false;
    const tag = (el.tagName || "").toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable;
  }

  /* ------------------------------------------------------
     NAVBAR TOGGLES (Desktop button + Floating button + Hotkey)
     - #navbarToggle (in navbar)
     - #navbarToggleBtn (floating)
     - "N" hotkey toggles navbar visibility (unless typing)
  ------------------------------------------------------ */
  function setupDesktopAndFloatingToggle() {
    const navbar = document.getElementById("navbar");
    const btn = document.getElementById("navbarToggle");
    const floatBtn = document.getElementById("navbarToggleBtn");
    const floatIcon = floatBtn ? floatBtn.querySelector(".toggle-icon") : null;

    if (!navbar) return;

    function setHidden(hidden) {
      const ui = getUIState();
      ui.navbarLocked = true; // when user explicitly toggles, lock it (stops scroll-hide)
      navbar.classList.toggle("hide", !!hidden);

      // Update floating icon direction if present
      if (floatIcon) {
        // If hidden, show ▼ (suggest expand). If shown, show ▲ (suggest collapse).
        floatIcon.textContent = hidden ? "▼" : "▲";
      }
    }

    function toggleHidden() {
      const hidden = navbar.classList.contains("hide");
      setHidden(!hidden);
    }

    // Click toggles
    if (btn && !btn.__bound) {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleHidden();
      });
      btn.__bound = true;
    }

    if (floatBtn && !floatBtn.__bound) {
      floatBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleHidden();
      });
      floatBtn.__bound = true;
    }

    // Hotkey: N
    window.addEventListener("keydown", (e) => {
      if (e.key.toLowerCase() !== "n") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingContext(document.activeElement)) return;

      // Prevent accidental toggling when user is scrolling with space etc.
      e.preventDefault();
      toggleHidden();
    });
  }

  /* ------------------------------------------------------
     DESKTOP: Scroll-hide Navbar
     - Disabled if navbarLocked = true
     - Only on desktop widths > 992
  ------------------------------------------------------ */
  function setupScrollHideDesktop() {
    const navbar = document.getElementById("navbar");
    if (!navbar) return;

    const ui = getUIState();
    ui.lastScrollY = window.scrollY || 0;

    window.addEventListener(
      "scroll",
      () => {
        if (window.innerWidth <= 992) return;

        // If user has locked the navbar (via toggle), do not auto-hide/show
        if (getUIState().navbarLocked) return;

        const currentY = window.scrollY;

        if (currentY > ui.lastScrollY && currentY > 80) {
          navbar.classList.add("hide");
        } else {
          navbar.classList.remove("hide");
        }

        ui.lastScrollY = currentY;
      },
      { passive: true }
    );
  }

  /* ------------------------------------------------------
     DROPDOWNS (Mobile click-to-toggle)
     - Desktop remains hover-based via CSS
     - Mobile uses .active on .nav-dropdown
  ------------------------------------------------------ */
  function setupDropdownsMobile() {
    const toggles = document.querySelectorAll(".dropdown-toggle");

    toggles.forEach((toggle) => {
      if (toggle.__dropdownBound) return;

      toggle.setAttribute("aria-haspopup", "true");
      toggle.setAttribute("aria-expanded", "false");

      toggle.addEventListener("click", (e) => {
        // On desktop, hover handles it, but click still helps touch laptops
        e.preventDefault();
        e.stopPropagation();

        const parent = toggle.closest(".nav-dropdown");
        if (!parent) return;

        const willOpen = !parent.classList.contains("active");

        // Close other dropdowns
        closeAllDropdowns(parent);

        // Toggle this one
        parent.classList.toggle("active", willOpen);
        toggle.setAttribute("aria-expanded", String(willOpen));
      });

      toggle.__dropdownBound = true;
    });
  }

  function closeAllDropdowns(exceptEl) {
    document.querySelectorAll(".nav-dropdown.active").forEach((d) => {
      if (exceptEl && d === exceptEl) return;
      d.classList.remove("active");
      const t = d.querySelector(".dropdown-toggle");
      if (t) t.setAttribute("aria-expanded", "false");
    });
  }

  /* ------------------------------------------------------
     GLOBAL CLOSE HANDLERS
     - Click outside closes dropdowns
     - Escape closes dropdowns
  ------------------------------------------------------ */
  function setupGlobalCloseHandlers() {
    document.addEventListener("click", (e) => {
      if (e.target.closest(".nav-dropdown")) return;
      closeAllDropdowns();
    });

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeAllDropdowns();
      }
    });
  }

  /* ------------------------------------------------------
     INLINE NAVIGATION INTERCEPT (Navbar only)
     Your HTML uses: onclick="switchPage('dashboard')"
     This interception:
     - prevents double calls
     - ensures dropdowns close after click
     - does NOT touch anything outside navbar
  ------------------------------------------------------ */
  function setupInlineSwitchPageInterception() {
    const navLinks = document.getElementById("navLinks");
    const navbar = document.getElementById("navbar");
    const root = navLinks || navbar;
    if (!root) return;

    // Capture phase so we can stop the inline onclick from firing if needed
    root.addEventListener(
      "click",
      (e) => {
        const target = e.target.closest("[onclick], [data-page]");
        if (!target) return;

        // data-page path
        const pageFromData = target.getAttribute("data-page");
        if (pageFromData) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          safeSwitchPage(pageFromData);
          closeAllDropdowns();
          return;
        }

        // onclick path: parse switchPage('xyz')
        const raw = target.getAttribute("onclick") || "";
        const page = extractSwitchPageArg(raw);
        if (!page) return;

        // stop inline onclick from firing and do it ourselves once
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        safeSwitchPage(page);
        closeAllDropdowns();
      },
      true // capture
    );
  }

  function extractSwitchPageArg(onclickText) {
    // matches: switchPage('dashboard') OR switchPage("dashboard")
    const m = String(onclickText).match(/switchPage\s*\(\s*['"]([^'"]+)['"]\s*\)/i);
    return m ? m[1] : null;
  }

  function safeSwitchPage(pageId) {
    if (typeof window.switchPage === "function") {
      window.switchPage(pageId);
    } else {
      console.error("❌ switchPage() not found!");
    }
  }

  /* ------------------------------------------------------
     Insert Inspector into Network dropdown (preferred)
     - Finds the dropdown whose toggle text contains "Network" or "🌐"
     - Appends a dropdown-item that uses switchPage('inspector')
  ------------------------------------------------------ */
  function setupInspectorInNetworkDropdown() {
    // Avoid duplicates
    if (document.querySelector(".nav-inspector-item")) return;

    const dropdowns = Array.from(document.querySelectorAll(".nav-dropdown"));
    let networkDropdown = null;

    for (const d of dropdowns) {
      const toggle = d.querySelector(".dropdown-toggle");
      const txt = (toggle ? toggle.textContent : d.textContent) || "";
      if (/network|🌐/i.test(txt)) {
        networkDropdown = d;
        break;
      }
    }

    const menu = networkDropdown ? networkDropdown.querySelector(".dropdown-menu") : null;

    // Create item that matches your markup style (you used <a class="dropdown-item" onclick="switchPage('...')">)
    const item = document.createElement("a");
    item.className = "dropdown-item nav-inspector-item";
    item.href = "javascript:void(0)";
    item.setAttribute("role", "menuitem");
    item.setAttribute("onclick", "switchPage('inspector')");
    item.textContent = "🔎 Account Inspector";

    if (menu) {
      menu.appendChild(item);
      return;
    }

    // Fallback: append into navLinks at end
    const navLinks = document.getElementById("navLinks");
    if (navLinks) {
      navLinks.appendChild(item);
      return;
    }
  }

  /* ------------------------------------------------------
     🔥 OVERLAY / NOTIFICATION SAFETY (FIXED)
     IMPORTANT: does NOT change navbar positioning
  ------------------------------------------------------ */
  function injectNavbarSafetyStyles() {
    if (document.getElementById("navbar-safety-styles")) return;

    const style = document.createElement("style");
    style.id = "navbar-safety-styles";
    style.textContent = `
      /* Ensure navbar always remains clickable and above overlays */
      .navbar,
      #navbar {
        z-index: 10000 !important;
        pointer-events: auto !important;
      }

      /* Notifications must NEVER block nav interactions */
      .notification-container,
      .notifications,
      .toast-container,
      .toast-wrapper,
      .toasts,
      #notifications {
        pointer-events: none !important;
        z-index: 9000 !important;
      }

      /* Allow clicks INSIDE notification cards only */
      .notification,
      .toast {
        pointer-events: auto !important;
      }

      /* Dropdown menus explicitly interactive */
      .nav-dropdown,
      .nav-dropdown * {
        pointer-events: auto !important;
      }

      /* Minor visual for injected inspector item */
      .nav-inspector-item { font-weight: 600; }
    `;

    document.head.appendChild(style);
  }

  /* ------------------------------------------------------
     EXPORTS
  ------------------------------------------------------ */
  window.closeAllDropdowns = closeAllDropdowns;
})();
