// =======================================================
// navbar.js – STABLE + MOBILE FRIENDLY + OVERLAY SAFE (FULL)
// Fixes:
// - Mobile menu toggles reliably (even if other scripts bind clicks)
// - Dropdown accordion works on mobile
// - Outside-tap closes mobile menu
// - Does NOT rely on data-page; works with your onclick="switchPage(...)"
// =======================================================

document.addEventListener("DOMContentLoaded", () => {
  initNavbar();
  injectNavbarSafetyStyles();
});

function initNavbar() {
  setupHamburger();
  setupMobileCloseOnNavClick();
  setupDropdowns();
  setupScrollHideDesktop();
}

/* ------------------------------------------------------
   MOBILE MENU (Hamburger)
------------------------------------------------------ */
function setupHamburger() {
  const hamburger = document.getElementById("hamburger");
  const navLinks = document.getElementById("navLinks");
  if (!hamburger || !navLinks) return;

  // CAPTURE phase + stopImmediatePropagation prevents other handlers from also toggling
  hamburger.addEventListener(
    "click",
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      const isOpen = navLinks.classList.toggle("show");
      hamburger.classList.toggle("active", isOpen);
      document.body.classList.toggle("mobile-menu-open", isOpen);

      hamburger.setAttribute("aria-expanded", isOpen ? "true" : "false");
      hamburger.setAttribute("aria-label", isOpen ? "Close menu" : "Open menu");
    },
    true
  );

  // Tap outside closes menu (mobile only)
  document.addEventListener("click", (e) => {
    if (window.innerWidth > 992) return;
    if (!navLinks.classList.contains("show")) return;

    // if click isn't inside navbar / navLinks, close
    const inNav = e.target.closest(".navbar") || e.target.closest("#navbar") || e.target.closest("#navLinks");
    if (!inNav) closeMobileMenu();
  });
}

function closeMobileMenu() {
  const hamburger = document.getElementById("hamburger");
  const navLinks = document.getElementById("navLinks");

  if (navLinks) navLinks.classList.remove("show");
  if (hamburger) {
    hamburger.classList.remove("active");
    hamburger.setAttribute("aria-expanded", "false");
    hamburger.setAttribute("aria-label", "Open menu");
  }
  document.body.classList.remove("mobile-menu-open");
}

/* ------------------------------------------------------
   Close menu after tapping a normal nav button (mobile)
   Works with your onclick="switchPage(...)"
------------------------------------------------------ */
function setupMobileCloseOnNavClick() {
  const navLinks = document.getElementById("navLinks");
  if (!navLinks) return;

  navLinks.addEventListener("click", (e) => {
    if (window.innerWidth > 992) return;

    const btn = e.target.closest("button");
    if (!btn) return;

    // Don't close when toggling an accordion dropdown
    if (btn.classList.contains("dropdown-toggle")) return;

    // Let the onclick navigation run, then close
    setTimeout(() => closeMobileMenu(), 0);
  });
}

/* ------------------------------------------------------
   MOBILE DROPDOWNS (Accordion)
------------------------------------------------------ */
function setupDropdowns() {
  const dropdownToggles = document.querySelectorAll(".dropdown-toggle");

  dropdownToggles.forEach((toggle) => {
    toggle.addEventListener("click", (e) => {
      // Desktop: allow CSS hover dropdown
      if (window.innerWidth > 992) return;

      e.preventDefault();
      e.stopPropagation();

      const parent = toggle.closest(".nav-dropdown");
      if (!parent) return;

      // Close other dropdowns
      document.querySelectorAll(".nav-dropdown.active").forEach((d) => {
        if (d !== parent) d.classList.remove("active");
      });

      parent.classList.toggle("active");
    });
  });

  // If you resize up to desktop, reset mobile accordion states
  window.addEventListener("resize", () => {
    if (window.innerWidth > 992) {
      document.querySelectorAll(".nav-dropdown.active").forEach((d) => d.classList.remove("active"));
      closeMobileMenu();
    }
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
   🔥 OVERLAY / NOTIFICATION SAFETY
------------------------------------------------------ */
function injectNavbarSafetyStyles() {
  if (document.getElementById("navbar-safety-styles")) return;

  const style = document.createElement("style");
  style.id = "navbar-safety-styles";
  style.textContent = `
    /* Ensure navbar always remains clickable */
    .navbar,
    #navbar {
      z-index: 10000;
      pointer-events: auto;
    }

    /* Notifications must NEVER block nav interactions */
    .notification-container,
    .notifications,
    .toast-container,
    .toast-wrapper,
    .toasts,
    #notifications,
    .Toastify__toast-container,
    .notyf,
    .iziToast-wrapper,
    .swal2-container {
      pointer-events: none !important;
      z-index: 9000 !important;
    }

    /* Allow clicks INSIDE notification cards only */
    .notification,
    .toast,
    .Toastify__toast,
    .notyf__toast,
    .iziToast {
      pointer-events: auto !important;
    }
  `;
  document.head.appendChild(style);
}

window.closeMobileMenu = closeMobileMenu;
console.log("✅ Navbar module loaded (mobile dropdown fixed + shield toggle)");

