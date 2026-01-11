// =======================================================
// navbar.js – STABLE + MOBILE FRIENDLY + OVERLAY SAFE
// Updated: Inspector is a full-page feature now.
// The navbar will navigate to the "inspector" page (data-page="inspector")
// instead of lazy-loading a floating panel.
// =======================================================

document.addEventListener("DOMContentLoaded", () => {
  initNavbar();
  injectNavbarSafetyStyles();
});

/* ------------------------------------------------------
   INIT NAVBAR
------------------------------------------------------ */
function initNavbar() {
  setupNavLinks();
  setupHamburger();
  setupDropdowns();
  setupScrollHideDesktop();

  // Add Account Inspector navigation button into the navbar
  setupInspectorNavButton();
}

/* ------------------------------------------------------
   PAGE NAVIGATION (SAFE)
------------------------------------------------------ */
function setupNavLinks() {
  document.querySelectorAll("[data-page]").forEach(btn => {
    btn.addEventListener("click", e => {
      const page = btn.dataset.page;
      if (!page) return;

      e.preventDefault();
      e.stopPropagation();

      navigateToPage(page);

      // Close mobile menu after navigating
      if (window.innerWidth <= 992) {
        closeMobileMenu();
      }
    });
  });
}

function navigateToPage(pageId) {
  if (typeof window.switchPage === "function") {
    window.switchPage(pageId);
  } else {
    console.error("❌ switchPage() not found!");
  }
}

/* ------------------------------------------------------
   MOBILE MENU (Hamburger)
------------------------------------------------------ */
function setupHamburger() {
  const hamburger = document.getElementById("hamburger");
  const navLinks = document.getElementById("navLinks");

  if (!hamburger || !navLinks) return;

  hamburger.addEventListener("click", e => {
    e.preventDefault();
    e.stopPropagation();

    hamburger.classList.toggle("active");
    navLinks.classList.toggle("show");
    document.body.classList.toggle("mobile-menu-open");
  });

  // Tap outside closes menu (mobile only)
  document.addEventListener("click", e => {
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
}

/* ------------------------------------------------------
   MOBILE DROPDOWNS (Accordion)
------------------------------------------------------ */
function setupDropdowns() {
  const dropdownToggles = document.querySelectorAll(".dropdown-toggle");

  dropdownToggles.forEach(toggle => {
    toggle.addEventListener("click", e => {
      // Desktop: allow CSS hover
      if (window.innerWidth > 992) return;

      e.preventDefault();
      e.stopPropagation();

      const parent = toggle.closest(".nav-dropdown");
      if (!parent) return;

      // Close other dropdowns
      document.querySelectorAll(".nav-dropdown.active").forEach(d => {
        if (d !== parent) d.classList.remove("active");
      });

      parent.classList.toggle("active");
    });
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

    if (currentY > lastScrollY && currentY > 80) {
      navbar.classList.add("hide");
    } else {
      navbar.classList.remove("hide");
    }

    lastScrollY = currentY;
  });
}

/* ------------------------------------------------------
   🔥 CRITICAL FIX: OVERLAY / NOTIFICATION SAFETY
------------------------------------------------------ */
function injectNavbarSafetyStyles() {
  if (document.getElementById("navbar-safety-styles")) return;

  const style = document.createElement("style");
  style.id = "navbar-safety-styles";
  style.textContent = `
    /* Ensure navbar always remains clickable */
    .navbar,
    #navbar {
      position: relative;
      z-index: 10000;
      pointer-events: auto;
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
      pointer-events: auto;
    }
  `;

  document.head.appendChild(style);
}

/* ------------------------------------------------------
   NAV: Inspector PAGE BUTTON
   - Adds a link/button with data-page="inspector"
   - When clicked it uses the existing SPA nav system
------------------------------------------------------ */
function setupInspectorNavButton() {
  const navbar = document.getElementById("navbar");
  const navLinks = document.getElementById("navLinks");

  const insertTarget = navLinks || navbar || document.body;
  if (!insertTarget) return;

  // Avoid duplication
  if (document.querySelector('[data-page="inspector"]')) return;

  const btn = document.createElement("button");
  btn.className = "nav-btn";
  btn.dataset.page = "inspector";
  btn.type = "button";
  btn.title = "Account Inspector";
  btn.style.cssText = "margin-left:10px;padding:6px 10px;border-radius:8px;border:1px solid var(--accent-tertiary);background:transparent;color:var(--text-primary);cursor:pointer";
  btn.innerHTML = `🔎 Inspector`;

  // Insert at the end of navLinks if available, else append to navbar
  if (navLinks) navLinks.appendChild(btn);
  else if (navbar) navbar.appendChild(btn);
  else document.body.appendChild(btn);
}

/* ------------------------------------------------------
   Programmatic API / Exports
------------------------------------------------------ */
window.navigateToPage = navigateToPage;
window.closeMobileMenu = closeMobileMenu;

console.log("✅ Navbar module loaded (overlay-safe, dropdown-safe)");
