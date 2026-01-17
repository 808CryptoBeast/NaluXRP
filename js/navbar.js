// =======================================================
// File: js/navbar.js
// NaluXrp 🌊 – Navbar (Mobile Friendly + Desktop Friendly + Stable)
//
// Works with:
// - #navbar, #navLinks, #hamburger
// - .nav-dropdown .dropdown-toggle .dropdown-menu
// - buttons/links using [data-page="..."]
//
// Features:
// - Desktop: hover dropdowns still work; click also works
// - Mobile: hamburger opens slide-down menu; dropdowns are accordion
// - Closes menus on outside click + ESC
// - Scroll-hide on desktop
// - Overlay-safe injected styles remain compatible
// =======================================================

document.addEventListener("DOMContentLoaded", () => {
  initNavbar();
  injectNavbarSafetyStyles();
  ensureNavbarSpacer();
});

function initNavbar() {
  setupNavLinks();
  setupHamburger();
  setupDropdowns();
  setupScrollHideDesktop();
}

/* ------------------------------------------------------
   PAGE NAVIGATION
------------------------------------------------------ */
function setupNavLinks() {
  document.querySelectorAll("[data-page]").forEach((btn) => {
    if (btn.__navBound) return;

    btn.addEventListener("click", (e) => {
      const page = btn.dataset.page;
      if (!page) return;

      e.preventDefault();
      e.stopPropagation();

      if (typeof window.switchPage === "function") {
        window.switchPage(page);
      } else if (typeof window.navigateToPage === "function") {
        window.navigateToPage(page);
      } else {
        console.error("❌ switchPage()/navigateToPage() not found!");
      }

      // Close mobile nav after navigating
      if (window.innerWidth <= 992) closeMobileMenu();
      closeAllDropdowns();
    });

    btn.__navBound = true;
  });
}

/* ------------------------------------------------------
   MOBILE MENU (Hamburger)
------------------------------------------------------ */
function setupHamburger() {
  const hamburger = document.getElementById("hamburger");
  const navLinks = document.getElementById("navLinks");

  if (!hamburger || !navLinks) return;

  hamburger.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();

    hamburger.classList.toggle("active");
    navLinks.classList.toggle("show");
    document.body.classList.toggle("mobile-menu-open", navLinks.classList.contains("show"));

    // when opening mobile menu, close dropdowns so it doesn't look messy
    if (navLinks.classList.contains("show") === false) {
      closeAllDropdowns();
    }
  });

  // Tap outside closes menu (mobile only)
  document.addEventListener("click", (e) => {
    if (window.innerWidth > 992) return;

    const insideNavbar = e.target.closest(".navbar") || e.target.closest("#navbar");
    const insideMenu = e.target.closest("#navLinks");
    const insideHamburger = e.target.closest("#hamburger");

    if (!insideNavbar && !insideMenu && !insideHamburger) {
      closeMobileMenu();
      closeAllDropdowns();
    }
  });

  // ESC closes
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeMobileMenu();
      closeAllDropdowns();
    }
  });
}

function closeMobileMenu() {
  const hamburger = document.getElementById("hamburger");
  const navLinks = document.getElementById("navLinks");

  if (hamburger) hamburger.classList.remove("active");
  if (navLinks) navLinks.classList.remove("show");

  document.body.classList.remove("mobile-menu-open");
}

/* ------------------------------------------------------
   DROPDOWNS
   - Desktop: hover works by CSS
   - Mobile: click toggles accordion
   - Desktop: click toggles also works (for accessibility)
------------------------------------------------------ */
function setupDropdowns() {
  const toggles = document.querySelectorAll(".dropdown-toggle");

  toggles.forEach((toggle) => {
    if (toggle.__dropdownBound) return;

    toggle.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      const parent = toggle.closest(".nav-dropdown");
      if (!parent) return;

      // Mobile: accordion behavior (close others)
      if (window.innerWidth <= 992) {
        document.querySelectorAll(".nav-dropdown.open").forEach((d) => {
          if (d !== parent) d.classList.remove("open");
        });
        parent.classList.toggle("open");
        return;
      }

      // Desktop: allow click toggle (optional), but keep hover working too
      // Toggle only if user clicks; clicking outside closes.
      const willOpen = !parent.classList.contains("open");
      closeAllDropdowns(parent);
      parent.classList.toggle("open", willOpen);
    });

    toggle.__dropdownBound = true;
  });

  // Clicking inside dropdown items closes dropdown (both desktop & mobile)
  document.querySelectorAll(".dropdown-menu").forEach((menu) => {
    if (menu.__menuBound) return;
    menu.addEventListener("click", (e) => {
      const item = e.target.closest(".dropdown-item");
      if (!item) return;
      closeAllDropdowns();
      if (window.innerWidth <= 992) closeMobileMenu();
    });
    menu.__menuBound = true;
  });

  // Outside click closes dropdowns (desktop + mobile)
  document.addEventListener("click", () => {
    closeAllDropdowns();
  });

  // ESC closes
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAllDropdowns();
  });

  // When resizing: close mobile menu if switching to desktop
  window.addEventListener("resize", () => {
    if (window.innerWidth > 992) closeMobileMenu();
    closeAllDropdowns();
  });
}

function closeAllDropdowns(exceptEl = null) {
  document.querySelectorAll(".nav-dropdown.open").forEach((d) => {
    if (exceptEl && d === exceptEl) return;
    d.classList.remove("open");
  });
}

/* ------------------------------------------------------
   DESKTOP: Scroll-hide Navbar
------------------------------------------------------ */
function setupScrollHideDesktop() {
  const navbar = document.getElementById("navbar");
  if (!navbar) return;

  let lastScrollY = window.scrollY;

  window.addEventListener("scroll", () => {
    if (window.innerWidth <= 992) return;

    const currentY = window.scrollY;
    if (currentY > lastScrollY && currentY > 80) navbar.classList.add("hide");
    else navbar.classList.remove("hide");
    lastScrollY = currentY;
  });
}

/* ------------------------------------------------------
   CRITICAL: Overlays should not block navbar interactions
------------------------------------------------------ */
function injectNavbarSafetyStyles() {
  if (document.getElementById("navbar-safety-styles")) return;

  const style = document.createElement("style");
  style.id = "navbar-safety-styles";
  style.textContent = `
    .navbar, #navbar { pointer-events: auto !important; z-index: 10000 !important; }
    .notification-container, .notifications, .toast-container, .toast-wrapper, .toasts, #notifications {
      pointer-events: none !important;
      z-index: 9000 !important;
    }
    .notification, .toast { pointer-events: auto !important; }
  `;
  document.head.appendChild(style);
}

/* ------------------------------------------------------
   Prevent content hiding under fixed navbar
   Adds a spacer the same height as navbar (75px)
------------------------------------------------------ */
function ensureNavbarSpacer() {
  const navbar = document.getElementById("navbar");
  if (!navbar) return;

  if (document.getElementById("navbarSpacer")) return;

  const spacer = document.createElement("div");
  spacer.id = "navbarSpacer";
  spacer.style.height = "75px";
  spacer.style.width = "100%";
  spacer.style.pointerEvents = "none";

  // Insert right after navbar
  navbar.parentNode.insertBefore(spacer, navbar.nextSibling);
}

console.log("✅ Navbar module loaded (responsive + mobile menu + stable dropdowns)");
