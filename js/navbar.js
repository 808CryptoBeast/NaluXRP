/* =========================================
   NaluXrp 🌊 – Navbar (navbar.js)
   Mobile menu FIX:
   - Closed by default
   - Overlay close
   - Click item closes menu
   - Touch devices use click-to-open dropdowns (no sticky hover)
   - Prevent double-toggling conflicts (ui.js also assigns onclick)
   ========================================= */

(function () {
  const BREAKPOINT = 992;

  function isMobileNow() {
    return window.matchMedia(`(max-width: ${BREAKPOINT}px)`).matches;
  }

  function $(id) {
    return document.getElementById(id);
  }

  function ensureHamburger(navbar) {
    let hamburger = $("hamburger");
    if (hamburger) return hamburger;

    // Create one if missing (so you don't have to edit HTML)
    hamburger = document.createElement("button");
    hamburger.id = "hamburger";
    hamburger.className = "hamburger";
    hamburger.type = "button";
    hamburger.setAttribute("aria-label", "Open menu");
    hamburger.setAttribute("aria-expanded", "false");
    hamburger.innerHTML = `<span></span><span></span><span></span>`;

    const content = navbar.querySelector(".nav-content") || navbar;
    // Put it near the right side (before status badge if present)
    const status = content.querySelector(".status-badge");
    if (status) content.insertBefore(hamburger, status);
    else content.appendChild(hamburger);

    return hamburger;
  }

  function ensureOverlay() {
    let overlay = document.querySelector(".nav-overlay");
    if (overlay) return overlay;

    overlay = document.createElement("div");
    overlay.className = "nav-overlay";
    document.body.appendChild(overlay);
    return overlay;
  }

  function closeAllDropdowns() {
    document.querySelectorAll(".nav-dropdown.active").forEach((d) => d.classList.remove("active"));
    document.querySelectorAll(".dropdown-toggle[aria-expanded='true']").forEach((t) => t.setAttribute("aria-expanded", "false"));
  }

  function closeMenu(hamburger, navLinks) {
    if (!hamburger || !navLinks) return;
    navLinks.classList.remove("show");
    hamburger.classList.remove("active");
    hamburger.setAttribute("aria-expanded", "false");
    document.body.classList.remove("nav-open");
    closeAllDropdowns();
  }

  function openMenu(hamburger, navLinks) {
    if (!hamburger || !navLinks) return;
    navLinks.classList.add("show");
    hamburger.classList.add("active");
    hamburger.setAttribute("aria-expanded", "true");
    document.body.classList.add("nav-open");
  }

  function toggleMenu(hamburger, navLinks) {
    if (!hamburger || !navLinks) return;
    const open = navLinks.classList.contains("show");
    if (open) closeMenu(hamburger, navLinks);
    else openMenu(hamburger, navLinks);
  }

  function setupDropdowns(navLinks) {
    const toggles = navLinks.querySelectorAll(".dropdown-toggle");
    toggles.forEach((toggle) => {
      toggle.setAttribute("aria-expanded", "false");

      toggle.addEventListener("click", (e) => {
        // Only accordion behavior on mobile/touch
        if (!isMobileNow()) return;

        e.preventDefault();
        e.stopPropagation();

        const parent = toggle.closest(".nav-dropdown");
        if (!parent) return;

        const already = parent.classList.contains("active");
        closeAllDropdowns();

        if (!already) {
          parent.classList.add("active");
          toggle.setAttribute("aria-expanded", "true");
        }
      });
    });
  }

  function initNavbar() {
    const navbar = $("navbar");
    const navLinks = $("navLinks");
    if (!navbar || !navLinks) return;

    const hamburger = ensureHamburger(navbar);
    const overlay = ensureOverlay();

    // Always start closed on mobile (fixes “always open”)
    closeMenu(hamburger, navLinks);

    // Expose API so other scripts (ui.js) can call without double toggles
    window.NavbarMobile = {
      open: () => openMenu(hamburger, navLinks),
      close: () => closeMenu(hamburger, navLinks),
      toggle: () => toggleMenu(hamburger, navLinks),
      isOpen: () => navLinks.classList.contains("show")
    };

    // Click hamburger: use capturing to reduce conflicts
    hamburger.addEventListener(
      "click",
      (e) => {
        e.preventDefault();
        // If ui.js also sets onclick, this makes our behavior win.
        toggleMenu(hamburger, navLinks);
      },
      true
    );

    // Click overlay closes menu
    overlay.addEventListener("click", () => closeMenu(hamburger, navLinks));

    // Click outside navbar closes menu (mobile)
    document.addEventListener("click", (e) => {
      if (!isMobileNow()) return;
      if (!navLinks.classList.contains("show")) return;

      const insideNav = navbar.contains(e.target) || navLinks.contains(e.target);
      if (!insideNav) closeMenu(hamburger, navLinks);
    });

    // Click any nav item closes (mobile)
    navLinks.addEventListener("click", (e) => {
      if (!isMobileNow()) return;

      const el = e.target;
      if (!el) return;

      // Don't close when tapping dropdown toggles (accordion)
      if (el.closest(".dropdown-toggle")) return;

      // Close when selecting a real destination
      if (el.closest(".nav-btn") || el.closest(".dropdown-item")) {
        closeMenu(hamburger, navLinks);
      }
    });

    // ESC closes
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeMenu(hamburger, navLinks);
    });

    // Resize: if switching to desktop, ensure mobile classes cleared
    window.addEventListener("resize", () => {
      if (!isMobileNow()) {
        document.body.classList.remove("nav-open");
        navLinks.classList.remove("show");
        hamburger.classList.remove("active");
        closeAllDropdowns();
      } else {
        // On re-enter mobile, ensure not stuck open
        closeMenu(hamburger, navLinks);
      }
    });

    // Dropdown accordion setup
    setupDropdowns(navLinks);

    // Auto hide navbar on scroll (kept)
    let lastScrollY = window.scrollY;
    window.addEventListener("scroll", () => {
      const y = window.scrollY;
      if (y > lastScrollY && y > 120) navbar.classList.add("hide");
      else navbar.classList.remove("hide");
      lastScrollY = y;
    });

    console.log("✅ Navbar initialized (mobile drawer fixed)");
  }

  document.addEventListener("DOMContentLoaded", initNavbar);
})();

