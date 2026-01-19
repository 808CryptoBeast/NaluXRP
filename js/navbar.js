// =======================================================
// navbar.js — NaluXrp 🌊 (Responsive + Mobile Friendly + Robust)
// FIXES INCLUDED:
// ✅ Prevent duplicate Account Inspector buttons (dedupe)
// ✅ Ensure Account Inspector button exists (single, consistent)
// ✅ Medium-screen layout works (CSS handles wrap; JS doesn't fight it)
// ✅ Connection badge updates from xrpl-connection events
// ✅ Mobile hamburger + outside click close + mobile dropdown accordion
// =======================================================

(function () {
  function $(id) {
    return document.getElementById(id);
  }

  function safeSwitchPage(pageId) {
    if (typeof window.switchPage === "function") {
      window.switchPage(pageId);
      return true;
    }
    console.warn("❌ switchPage() not found");
    return false;
  }

  function initNavbar() {
    bindHamburger();
    bindMobileDropdowns();
    bindNavButtonsFallback();
    ensureSingleInspectorButton();
    bindConnectionBadge();
    bindKeyboardShortcuts();
    bindNavbarToggleIfExists();
  }

  // -------------------------------------------------------
  // 1) HAMBURGER (mobile)
  // -------------------------------------------------------
  function bindHamburger() {
    const hamburger = $("hamburger");
    const navLinks = $("navLinks");
    if (!hamburger || !navLinks) return;

    if (hamburger.__bound) return;
    hamburger.__bound = true;

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

    window.addEventListener("resize", () => {
      if (window.innerWidth > 992) closeMobileMenu();
    });
  }

  function closeMobileMenu() {
    const hamburger = $("hamburger");
    const navLinks = $("navLinks");
    if (hamburger) hamburger.classList.remove("active");
    if (navLinks) navLinks.classList.remove("show");
    document.body.classList.remove("mobile-menu-open");

    // also collapse any active accordion dropdown
    document.querySelectorAll(".nav-dropdown.active").forEach((d) => d.classList.remove("active"));
  }

  // -------------------------------------------------------
  // 2) MOBILE DROPDOWNS become accordion
  // -------------------------------------------------------
  function bindMobileDropdowns() {
    const toggles = document.querySelectorAll(".dropdown-toggle");
    toggles.forEach((toggle) => {
      if (toggle.__bound) return;
      toggle.__bound = true;

      toggle.addEventListener("click", (e) => {
        if (window.innerWidth > 992) return; // desktop uses hover CSS

        e.preventDefault();
        e.stopPropagation();

        const parent = toggle.closest(".nav-dropdown");
        if (!parent) return;

        // close others
        document.querySelectorAll(".nav-dropdown.active").forEach((d) => {
          if (d !== parent) d.classList.remove("active");
        });

        parent.classList.toggle("active");
      });
    });
  }

  // -------------------------------------------------------
  // 3) NAV BUTTON FALLBACK binding
  // (Your HTML uses inline onclick, but this makes it resilient
  //  if you later remove inline handlers.)
  // -------------------------------------------------------
  function bindNavButtonsFallback() {
    document.querySelectorAll("[data-page]").forEach((btn) => {
      if (btn.__navBound) return;
      btn.__navBound = true;
      btn.addEventListener("click", (e) => {
        const page = btn.getAttribute("data-page");
        if (!page) return;
        e.preventDefault();
        e.stopPropagation();
        safeSwitchPage(page);
        if (window.innerWidth <= 992) closeMobileMenu();
      });
    });
  }

  // -------------------------------------------------------
  // 4) ACCOUNT INSPECTOR BUTTON (single + deduped)
  // -------------------------------------------------------
  function ensureSingleInspectorButton() {
    const navLinks = $("navLinks");
    if (!navLinks) return;

    // Remove any inspector duplicates first (from old injections / other modules)
    // Keep the one with id="navInspectorBtn" if it exists, otherwise keep first found.
    const candidates = [
      ...document.querySelectorAll(
        '#navInspectorBtn, [data-page="inspector"], .nav-inspector-item, .nav-inspector, a[onclick*="inspector"], button[onclick*="inspector"]'
      )
    ];

    // If one already exists in the nav, we will normalize it to our preferred button
    let primary = document.getElementById("navInspectorBtn");

    // Create primary if missing
    if (!primary) {
      primary = document.createElement("button");
      primary.id = "navInspectorBtn";
      primary.type = "button";
      primary.className = "nav-btn nav-inspector";
      primary.setAttribute("data-page", "inspector");
      primary.innerHTML = `<span class="nav-icon">🔎</span><span class="nav-label">Inspector</span>`;
      primary.title = "Account Inspector";

      // Insert near Dashboard button if possible
      const dashBtn = navLinks.querySelector('button[onclick*="dashboard"], button[data-page="dashboard"]');
      if (dashBtn && dashBtn.parentNode === navLinks) {
        dashBtn.insertAdjacentElement("afterend", primary);
      } else {
        navLinks.insertAdjacentElement("afterbegin", primary);
      }
    } else {
      // Normalize existing inspector element to our styling
      primary.classList.add("nav-btn", "nav-inspector");
      primary.setAttribute("data-page", "inspector");
      if (!primary.innerHTML || !primary.innerHTML.includes("Inspector")) {
        primary.innerHTML = `<span class="nav-icon">🔎</span><span class="nav-label">Inspector</span>`;
      }
    }

    // Bind click (ensure it actually navigates)
    if (!primary.__bound) {
      primary.__bound = true;
      primary.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        safeSwitchPage("inspector");
        if (window.innerWidth <= 992) closeMobileMenu();
      });
    }

    // Remove all duplicates besides the primary
    const allInspectorEls = [
      ...document.querySelectorAll(
        '#navInspectorBtn, [data-page="inspector"], .nav-inspector-item, .nav-inspector, a[onclick*="inspector"], button[onclick*="inspector"]'
      )
    ];

    allInspectorEls.forEach((el) => {
      if (el === primary) return;
      // Only remove if it is inside the navbar area (don’t delete real page content)
      if (el.closest(".navbar") || el.closest("#navbar")) {
        try { el.remove(); } catch (_) {}
      }
    });

    // Re-bind any [data-page] that were newly created
    bindNavButtonsFallback();
  }

  // -------------------------------------------------------
  // 5) CONNECTION BADGE: updates status bubble in navbar
  // HTML: #statusDot, #connectionStatus
  // -------------------------------------------------------
  function bindConnectionBadge() {
    const dot = $("statusDot");
    const text = $("connectionStatus");
    if (!dot || !text) return;

    function setBadge(mode, serverName) {
      // modes: "live" | "connecting" | "disconnected"
      dot.classList.remove("active", "connecting", "disconnected");
      if (mode === "live") {
        dot.classList.add("active");
        text.textContent = `LIVE • ${serverName || "XRPL"}`;
      } else if (mode === "disconnected") {
        dot.classList.add("disconnected");
        text.textContent = `DISCONNECTED`;
      } else {
        dot.classList.add("connecting");
        text.textContent = `CONNECTING…`;
      }
    }

    // initial
    setBadge("connecting");

    // Listen to XRPL module events
    window.addEventListener("xrpl-connection", (ev) => {
      const d = ev.detail || {};
      if (d.connected) setBadge("live", d.server || d.url || "XRPL");
      else {
        // If switching networks: show a clearer state
        if (String(d.modeReason || "").toLowerCase().includes("network")) setBadge("connecting", "Switching");
        else setBadge("connecting");
      }
    });

    // Optional: click badge triggers reconnect
    text.style.cursor = "pointer";
    text.title = "Click to reconnect";
    text.addEventListener("click", () => {
      if (typeof window.reconnectXRPL === "function") window.reconnectXRPL();
    });
  }

  // -------------------------------------------------------
  // 6) KEYBOARD SHORTCUTS
  // -------------------------------------------------------
  function bindKeyboardShortcuts() {
    window.addEventListener("keydown", (e) => {
      const isMac = navigator.platform.toUpperCase().includes("MAC");
      const ctrlOrCmd = isMac ? e.metaKey : e.ctrlKey;

      // Ctrl/Cmd+I -> Inspector
      if (ctrlOrCmd && e.key.toLowerCase() === "i") {
        e.preventDefault();
        safeSwitchPage("inspector");
        return;
      }

      // Esc -> close mobile menu
      if (e.key === "Escape") {
        closeMobileMenu();
      }
    });
  }

  // -------------------------------------------------------
  // 7) Navbar toggle button (optional)
  // -------------------------------------------------------
  function bindNavbarToggleIfExists() {
    const navbar = $("navbar");
    const toggle = $("navbarToggle");
    const floating = $("navbarToggleBtn");

    if (!navbar) return;

    function toggleNav() {
      navbar.classList.toggle("hide");
      if (floating) {
        const icon = floating.querySelector(".toggle-icon");
        if (icon) icon.textContent = navbar.classList.contains("hide") ? "▼" : "▲";
      }
    }

    if (toggle && !toggle.__bound) {
      toggle.__bound = true;
      toggle.addEventListener("click", toggleNav);
    }

    if (floating && !floating.__bound) {
      floating.__bound = true;
      floating.addEventListener("click", toggleNav);
    }

    // Press "N" to toggle
    window.addEventListener("keydown", (e) => {
      if (e.key.toLowerCase() === "n" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        toggleNav();
      }
    });
  }

  document.addEventListener("DOMContentLoaded", initNavbar);

  // Exports
  window.closeMobileMenu = closeMobileMenu;
})();
