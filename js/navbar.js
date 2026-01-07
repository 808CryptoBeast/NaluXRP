// =======================================================
// navbar.js – STABLE + MOBILE FRIENDLY + OVERLAY SAFE
// Fixes notification / forensic overlay blocking issues
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
   EXPORT
------------------------------------------------------ */
window.navigateToPage = navigateToPage;
window.closeMobileMenu = closeMobileMenu;

console.log("✅ Navbar module loaded (overlay-safe, dropdown-safe)");
