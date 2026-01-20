// =======================================================
// navbar.js – CLEAN + RESPONSIVE + DROPDOWNS THAT CLOSE
// FIXES:
//  - No hamburger / no toggle buttons (hidden)
//  - Exactly ONE Inspector button (dedupe + remove from dropdowns)
//  - Dropdowns work on desktop hover + click, and mobile tap
//  - Dropdowns close when mouse leaves / tap outside / ESC
//  - Prevent stuck-open menus
//  - NEW: navbar height auto-offset (prevents overlaying dashboard header)
//  - NEW: connection badge updates from xrpl-connection events
// =======================================================

(function () {
  const DESKTOP_BREAKPOINT = 992; // <= this is "mobile/tap" behavior
  let _offsetRAF = null;

  document.addEventListener("DOMContentLoaded", () => {
    hideUnusedControls();
    ensureSingleInspectorButton();

    initDropdowns();
    initGlobalCloseHandlers();

    // ✅ Prevent navbar from covering content (especially when it wraps to 2 rows)
    syncNavbarOffset();
    window.addEventListener("resize", () => syncNavbarOffset());

    // ✅ Navbar connection badge should reflect real connection state
    initConnectionBadge();

    console.log("✅ Navbar module loaded (single inspector, working dropdowns, auto-offset, live connection badge)");
  });

  // -------------------------------------------------------
  // Helpers
  // -------------------------------------------------------
  function isMobileMode() {
    return window.innerWidth <= DESKTOP_BREAKPOINT;
  }

  function safeSwitchPage(pageId) {
    if (typeof window.switchPage === "function") {
      window.switchPage(pageId);
    } else {
      console.error("❌ switchPage() not found. Make sure ui.js is loaded before navbar.js");
    }
  }

  // -------------------------------------------------------
  // Remove/disable unused controls (in case HTML still has them)
  // -------------------------------------------------------
  function hideUnusedControls() {
    const ids = ["hamburger", "navbarToggle", "navbarToggleBtn"];
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.display = "none";
    });
  }

  // -------------------------------------------------------
  // ✅ FIX: Prevent fixed navbar from overlaying page content
  // We measure actual navbar height (can be ~76px or ~126px when wrapped)
  // and store it in CSS variable --nav-offset used by navbar.css
  // -------------------------------------------------------
  function syncNavbarOffset() {
    if (_offsetRAF) cancelAnimationFrame(_offsetRAF);

    _offsetRAF = requestAnimationFrame(() => {
      const navbar = document.getElementById("navbar");
      if (!navbar) return;

      const rect = navbar.getBoundingClientRect();
      const h = Math.max(0, Math.round(rect.height));
      document.documentElement.style.setProperty("--nav-offset", `${h}px`);
    });
  }

  // -------------------------------------------------------
  // Ensure EXACTLY ONE Inspector button in the main nav row
  // - Remove inspector entries inside dropdown menus
  // - Remove duplicates in the nav row
  // - Create the button if missing
  // -------------------------------------------------------
  function ensureSingleInspectorButton() {
    const navLinks = document.getElementById("navLinks");
    if (!navLinks) return;

    // 1) Remove any "Inspector" items inside dropdown menus
    document
      .querySelectorAll(".dropdown-menu .dropdown-item, .dropdown-menu button, .dropdown-menu a")
      .forEach((node) => {
        const txt = (node.textContent || "").toLowerCase();
        const isInspector = txt.includes("inspector") || txt.includes("account inspector");
        if (isInspector) node.remove();
      });

    // 2) Find existing inspector buttons in the main nav area
    const candidates = Array.from(navLinks.querySelectorAll("button, a")).filter((el) => {
      const txt = (el.textContent || "").toLowerCase();
      const isInspector = txt.includes("inspector");
      const byAttr = el.getAttribute("data-page") === "inspector";
      const byOnclick = (el.getAttribute("onclick") || "").includes("switchPage('inspector'");
      return isInspector || byAttr || byOnclick;
    });

    // Keep first, remove others
    if (candidates.length > 1) {
      candidates.slice(1).forEach((el) => el.remove());
    }

    let inspectorBtn = candidates[0] || null;

    // 3) If missing, create it
    if (!inspectorBtn) {
      inspectorBtn = document.createElement("button");
      inspectorBtn.className = "nav-btn nav-inspector-btn";
      inspectorBtn.type = "button";
      inspectorBtn.setAttribute("data-page", "inspector");
      inspectorBtn.title = "Account Inspector";
      inspectorBtn.innerHTML = `<span class="nav-icon">🔎</span><span class="nav-label">Inspector</span>`;
      inspectorBtn.addEventListener("click", (e) => {
        e.preventDefault();
        safeSwitchPage("inspector");
      });

      // Insert it right after Dashboard button if possible
      const dashboardBtn = Array.from(navLinks.querySelectorAll("button, a")).find((el) =>
        (el.textContent || "").toLowerCase().includes("dashboard")
      );

      if (dashboardBtn && dashboardBtn.parentNode === navLinks) {
        dashboardBtn.insertAdjacentElement("afterend", inspectorBtn);
      } else {
        navLinks.insertBefore(inspectorBtn, navLinks.firstChild?.nextSibling || null);
      }
    } else {
      // normalize its look
      inspectorBtn.classList.add("nav-btn", "nav-inspector-btn");
      inspectorBtn.setAttribute("title", inspectorBtn.getAttribute("title") || "Account Inspector");
    }
  }

  // -------------------------------------------------------
  // Dropdown behavior
  // Desktop:
  //   - hover opens, leaving closes
  //   - click also toggles (useful for touch laptops)
  // Mobile:
  //   - tap toggles open/close
  //   - selecting an item closes
  // -------------------------------------------------------
  function initDropdowns() {
    const dropdowns = Array.from(document.querySelectorAll(".nav-dropdown"));

    dropdowns.forEach((dd) => {
      const toggle = dd.querySelector(".dropdown-toggle");
      const menu = dd.querySelector(".dropdown-menu");
      if (!toggle || !menu) return;

      if (dd.__navBound) return;
      dd.__navBound = true;

      let closeTimer = null;

      const open = () => {
        clearTimeout(closeTimer);
        closeAllDropdownsExcept(dd);
        dd.classList.add("open");
        toggle.setAttribute("aria-expanded", "true");
      };

      const close = () => {
        dd.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      };

      // Desktop hover open/close
      dd.addEventListener("mouseenter", () => {
        if (isMobileMode()) return;
        open();
      });

      dd.addEventListener("mouseleave", () => {
        if (isMobileMode()) return;
        closeTimer = setTimeout(() => close(), 140);
      });

      // Click/tap toggle
      toggle.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();

        const isOpen = dd.classList.contains("open");
        if (isOpen) close();
        else open();
      });

      // Clicking inside menu should not bubble to document
      menu.addEventListener("click", (e) => {
        e.stopPropagation();
        if (isMobileMode()) {
          setTimeout(() => close(), 0);
        }
      });

      // Keyboard accessibility
      toggle.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          close();
          toggle.blur();
        }
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          const isOpen = dd.classList.contains("open");
          if (isOpen) close();
          else open();
        }
      });
    });

    // Reset open state on resize (prevents stuck-open menus)
    window.addEventListener("resize", () => {
      closeAllDropdownsExcept(null);
    });
  }

  function closeAllDropdownsExcept(except) {
    document.querySelectorAll(".nav-dropdown.open").forEach((dd) => {
      if (except && dd === except) return;
      const toggle = dd.querySelector(".dropdown-toggle");
      dd.classList.remove("open");
      if (toggle) toggle.setAttribute("aria-expanded", "false");
    });
  }

  // -------------------------------------------------------
  // Close menus when clicking outside + ESC key
  // -------------------------------------------------------
  function initGlobalCloseHandlers() {
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".nav-dropdown")) {
        closeAllDropdownsExcept(null);
      }
    });

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeAllDropdownsExcept(null);
      }
    });
  }

  // -------------------------------------------------------
  // ✅ Connection badge: updates #statusDot + #connectionStatus
  // Listens to your xrpl-connection module events.
  // -------------------------------------------------------
  function initConnectionBadge() {
    const dot = document.getElementById("statusDot");
    const text = document.getElementById("connectionStatus");
    const badge = dot?.closest(".status-badge") || null;

    if (!dot || !text) return;

    const setUI = (connected, serverName, mode, reason) => {
      if (connected) {
        dot.classList.add("active");
        text.textContent = `LIVE — ${serverName || "XRPL"}`;
        if (badge) badge.dataset.state = "live";
      } else {
        dot.classList.remove("active");

        const r = String(reason || "");
        const m = String(mode || "");

        // A nicer reconnecting message
        if (/disconnected|ws_disconnected|closed/i.test(r) || /connecting/i.test(m)) {
          text.textContent = "Reconnecting…";
          if (badge) badge.dataset.state = "connecting";
        } else {
          text.textContent = "Connecting…";
          if (badge) badge.dataset.state = "connecting";
        }
      }
    };

    // Initial sync (best-effort)
    try {
      if (typeof window.isXRPLConnected === "function" && window.isXRPLConnected()) {
        const st = typeof window.getXRPLState === "function" ? window.getXRPLState() : null;
        setUI(true, st?.server || "XRPL", st?.mode, st?.modeReason);
      } else if (window.XRPL && window.XRPL.connected) {
        setUI(true, window.XRPL.server?.name || "XRPL", window.XRPL.mode, window.XRPL.modeReason);
      } else {
        setUI(false, null, "connecting", "Initializing");
      }
    } catch {
      setUI(false, null, "connecting", "Initializing");
    }

    // Live updates from your connection module
    window.addEventListener("xrpl-connection", (ev) => {
      const d = ev?.detail || {};
      setUI(!!d.connected, d.server || d.name, d.mode, d.modeReason);
    });
  }
})();
