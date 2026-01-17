// =======================================================
// navbar.js – FULL (Desktop + Mobile Friendly + Inspector Injector)
// - Keeps your existing inline onclick="switchPage('...')" working
// - Adds robust mobile dropdown accordion behavior
// - Injects "🔎 Account Inspector" into Network dropdown (or fallback into nav)
// - Closes menus on outside click / ESC
// - Adds scroll progress bar + optional navbar lock toggle (N)
// - Overlay-safe: notifications never block navbar interactions
// =======================================================

(function () {
  const MOBILE_BREAKPOINT = 992;

  document.addEventListener("DOMContentLoaded", () => {
    try {
      injectNavbarSafetyStyles();
      setupHamburger();
      setupDropdownsMobileAccordion();
      setupOutsideClickClose();
      setupEscClose();
      setupScrollHideDesktop();
      setupNavbarLockToggle();
      setupScrollProgressBar();
      ensureInspectorButton();
      watchActivePage(); // optional nice-to-have
      console.log("✅ Navbar module loaded (mobile-friendly + inspector injected)");
    } catch (e) {
      console.error("❌ Navbar init failed:", e);
    }
  });

  /* ------------------------------------------------------
     Helpers
  ------------------------------------------------------ */
  function isMobile() {
    return window.innerWidth <= MOBILE_BREAKPOINT;
  }

  function getNavLinks() {
    return document.getElementById("navLinks") || document.querySelector(".nav-links");
  }

  function getNavbar() {
    return document.getElementById("navbar") || document.querySelector(".navbar");
  }

  function closeMobileMenu() {
    const hamburger = document.getElementById("hamburger");
    const navLinks = getNavLinks();
    if (hamburger) hamburger.classList.remove("active");
    if (navLinks) navLinks.classList.remove("show");
    document.body.classList.remove("mobile-menu-open");
  }

  function closeAllDropdowns() {
    document.querySelectorAll(".nav-dropdown.active").forEach((d) => d.classList.remove("active"));
  }

  function safeSwitchPage(pageId) {
    if (typeof window.switchPage === "function") {
      window.switchPage(pageId);
    } else {
      console.error("❌ switchPage() not found. Make sure ui.js is loaded before navbar.js");
    }
  }

  /* ------------------------------------------------------
     Mobile hamburger
  ------------------------------------------------------ */
  function setupHamburger() {
    const hamburger = document.getElementById("hamburger");
    const navLinks = getNavLinks();
    if (!hamburger || !navLinks) return;

    // Avoid double bind
    if (hamburger.__bound) return;
    hamburger.__bound = true;

    hamburger.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      hamburger.classList.toggle("active");
      navLinks.classList.toggle("show");
      document.body.classList.toggle("mobile-menu-open");
    });
  }

  /* ------------------------------------------------------
     Dropdowns: mobile accordion
     (Desktop stays hover-based via CSS)
  ------------------------------------------------------ */
  function setupDropdownsMobileAccordion() {
    const toggles = document.querySelectorAll(".dropdown-toggle");
    toggles.forEach((toggle) => {
      if (toggle.__bound) return;
      toggle.__bound = true;

      toggle.addEventListener("click", (e) => {
        // Desktop: do nothing; CSS hover controls dropdowns
        if (!isMobile()) return;

        e.preventDefault();
        e.stopPropagation();

        const parent = toggle.closest(".nav-dropdown");
        if (!parent) return;

        // Close others
        document.querySelectorAll(".nav-dropdown.active").forEach((d) => {
          if (d !== parent) d.classList.remove("active");
        });

        parent.classList.toggle("active");
      });
    });
  }

  /* ------------------------------------------------------
     Close menus on outside click (mobile)
  ------------------------------------------------------ */
  function setupOutsideClickClose() {
    document.addEventListener("click", (e) => {
      const navbar = getNavbar();
      const hamburger = document.getElementById("hamburger");

      if (isMobile()) {
        // close dropdown accordions if click outside nav area
        if (!e.target.closest(".navbar")) {
          closeAllDropdowns();
          closeMobileMenu();
        }
        // if click inside navbar but not in dropdown, close open dropdowns
        if (navbar && e.target.closest(".navbar") && !e.target.closest(".nav-dropdown")) {
          closeAllDropdowns();
        }
      } else {
        // Desktop: just close any .active dropdowns (if any were opened by tap devices)
        if (!e.target.closest(".nav-dropdown")) {
          closeAllDropdowns();
        }
      }
    }, { passive: true });
  }

  /* ------------------------------------------------------
     ESC closes mobile menu + dropdowns
  ------------------------------------------------------ */
  function setupEscClose() {
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeAllDropdowns();
        closeMobileMenu();
      }
    });
  }

  /* ------------------------------------------------------
     Desktop scroll-hide navbar
  ------------------------------------------------------ */
  function setupScrollHideDesktop() {
    const navbar = getNavbar();
    if (!navbar) return;

    let lastScrollY = window.scrollY || 0;

    window.addEventListener("scroll", () => {
      // Do not hide while locked
      if (navbar.classList.contains("navbar-locked")) return;
      // Do not hide on mobile (feels bad with panel)
      if (isMobile()) return;

      const y = window.scrollY || 0;

      if (y > lastScrollY && y > 90) navbar.classList.add("hide");
      else navbar.classList.remove("hide");

      lastScrollY = y;
    }, { passive: true });
  }

  /* ------------------------------------------------------
     Navbar lock toggle (Press "N")
     - Lock means it stays visible (no hide on scroll)
  ------------------------------------------------------ */
  function setupNavbarLockToggle() {
    const navbar = getNavbar();
    if (!navbar) return;

    // Optional: existing button in your HTML (#navbarToggle)
    const btn = document.getElementById("navbarToggle");
    if (btn && !btn.__bound) {
      btn.__bound = true;
      btn.addEventListener("click", () => toggleNavbarLock());
    }

    // Optional: floating button (#navbarToggleBtn)
    const floatBtn = document.getElementById("navbarToggleBtn");
    if (floatBtn && !floatBtn.__bound) {
      floatBtn.__bound = true;
      floatBtn.addEventListener("click", () => toggleNavbarLock());
    }

    window.addEventListener("keydown", (e) => {
      if (e.key && e.key.toLowerCase() === "n" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // ignore typing in inputs
        const t = e.target;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
        toggleNavbarLock();
      }
    });

    function toggleNavbarLock() {
      navbar.classList.toggle("navbar-locked");
      navbar.classList.remove("hide"); // ensure visible
    }
  }

  /* ------------------------------------------------------
     Scroll progress bar (nice polish)
  ------------------------------------------------------ */
  function setupScrollProgressBar() {
    const navbar = getNavbar();
    const navContent = document.querySelector(".nav-content");
    if (!navbar || !navContent) return;

    let bar = navContent.querySelector(".nalu-scroll-progress");
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "nalu-scroll-progress";
      navContent.appendChild(bar);
    }

    const update = () => {
      const doc = document.documentElement;
      const scrollTop = doc.scrollTop || document.body.scrollTop || 0;
      const scrollHeight = (doc.scrollHeight || 1) - (doc.clientHeight || 1);
      const pct = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;
      bar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    };

    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update, { passive: true });
  }

  /* ------------------------------------------------------
     ✅ Inspector button injection (robust)
     1) Try to insert into "Network" dropdown menu
     2) If not found, insert into nav-links as normal button
  ------------------------------------------------------ */
  function ensureInspectorButton() {
    // Prevent duplicates
    if (document.querySelector(".nav-inspector-item")) return;

    // Build the inspector entry (dropdown style)
    const inspectorItem = document.createElement("a");
    inspectorItem.className = "dropdown-item nav-inspector-item";
    inspectorItem.href = "#";
    inspectorItem.textContent = "🔎 Account Inspector";
    inspectorItem.title = "Open Account Inspector";

    inspectorItem.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      safeSwitchPage("inspector");
      closeAllDropdowns();
      if (isMobile()) closeMobileMenu();
    });

    // Find the Network dropdown menu
    const dropdowns = Array.from(document.querySelectorAll(".nav-dropdown"));
    let networkMenu = null;

    for (const d of dropdowns) {
      const toggle = d.querySelector(".dropdown-toggle");
      const menu = d.querySelector(".dropdown-menu");
      if (!toggle || !menu) continue;

      const label = (toggle.textContent || "").toLowerCase();
      // match "Network" or the globe icon
      if (label.includes("network") || label.includes("🌐")) {
        networkMenu = menu;
        break;
      }
    }

    if (networkMenu) {
      networkMenu.appendChild(inspectorItem);
      return;
    }

    // Fallback: add as its own top-level nav button
    const navLinks = getNavLinks();
    if (navLinks) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "nav-btn nav-inspector-item";
      btn.innerHTML = `<span class="nav-icon">🔎</span><span class="nav-label">Inspector</span>`;
      btn.title = "Open Account Inspector";
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        safeSwitchPage("inspector");
        closeAllDropdowns();
        if (isMobile()) closeMobileMenu();
      });
      navLinks.appendChild(btn);
      return;
    }

    // Last resort
    document.body.appendChild(inspectorItem);
  }

  /* ------------------------------------------------------
     Active page highlighting (optional polish)
     - Works by watching which .page-section has .active
  ------------------------------------------------------ */
  function watchActivePage() {
    const container = document.querySelector(".container") || document.body;

    const update = () => {
      const active = document.querySelector(".page-section.active");
      if (!active) return;
      const pageId = active.id;

      // Highlight nav buttons that have onclick with this pageId
      document.querySelectorAll(".nav-btn.is-active").forEach((b) => b.classList.remove("is-active"));
      document.querySelectorAll(".dropdown-item.is-active").forEach((b) => b.classList.remove("is-active"));

      // Match inline onclick="switchPage('xyz')"
      const candidates = Array.from(document.querySelectorAll(".nav-btn, .dropdown-item"));
      for (const el of candidates) {
        const oc = el.getAttribute("onclick") || "";
        if (oc.includes(`switchPage('${pageId}')`) || oc.includes(`switchPage("${pageId}")`)) {
          el.classList.add("is-active");
        }
      }
    };

    // Run now + observe
    update();

    const obs = new MutationObserver(() => update());
    obs.observe(container, { subtree: true, attributes: true, attributeFilter: ["class"] });
  }

  /* ------------------------------------------------------
     🔥 CRITICAL FIX: overlay / notification safety
  ------------------------------------------------------ */
  function injectNavbarSafetyStyles() {
    if (document.getElementById("navbar-safety-styles")) return;

    const style = document.createElement("style");
    style.id = "navbar-safety-styles";
    style.textContent = `
      /* Ensure navbar always remains clickable */
      .navbar, #navbar { z-index: 10000 !important; pointer-events: auto !important; }

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
      .notification, .toast { pointer-events: auto !important; }

      /* Dropdown menus explicitly interactive */
      .nav-dropdown, .nav-dropdown * { pointer-events: auto; }

      /* Minor highlight for inspector item */
      .nav-inspector-item { font-weight: 800; }
    `;
    document.head.appendChild(style);
  }

  // Expose a couple helpers if you want them elsewhere
  window.closeMobileMenu = closeMobileMenu;
  window.ensureInspectorButton = ensureInspectorButton;
})();
