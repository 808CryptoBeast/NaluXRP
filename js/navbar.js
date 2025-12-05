// =======================================================
// navbar.js – FIXED + Mobile Friendly + Stable
// Option A: Full-width slide-down menu with accordion dropdowns
// =======================================================

document.addEventListener("DOMContentLoaded", () => {
  initNavbar();
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
   FIXED: Handle navigation WITHOUT overwriting dropdowns
------------------------------------------------------ */
function setupNavLinks() {
  document.querySelectorAll("[data-page]").forEach(btn => {
    btn.addEventListener("click", e => {
      const page = btn.dataset.page;
      if (!page) return;

      e.preventDefault();
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
    console.error("switchPage() not found!");
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
    e.stopPropagation();
    hamburger.classList.toggle("active");
    navLinks.classList.toggle("show");
    document.body.classList.toggle("mobile-menu-open");
  });

  // Tap outside closes menu
  document.addEventListener("click", e => {
    if (window.innerWidth <= 992) {
      if (!e.target.closest(".navbar") && !e.target.closest("#hamburger")) {
        closeMobileMenu();
      }
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
      // Desktop: allow hover default behavior
      if (window.innerWidth > 992) return;

      e.preventDefault();
      e.stopPropagation();

      const parent = toggle.closest(".nav-dropdown");

      // Close other dropdowns
      document.querySelectorAll(".nav-dropdown").forEach(d => {
        if (d !== parent) d.classList.remove("active");
      });

      // Toggle current
      parent.classList.toggle("active");
    });
  });
}

/* ------------------------------------------------------
   DESKTOP: Scroll-hide Navbar
   (Disabled on mobile)
------------------------------------------------------ */
function setupScrollHideDesktop() {
  const navbar = document.getElementById("navbar");
  if (!navbar) return;

  let lastScrollY = window.scrollY;

  window.addEventListener("scroll", () => {
    if (window.innerWidth <= 992) return; // ❗ disable on mobile

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
   EXPORT
------------------------------------------------------ */
window.navigateToPage = navigateToPage;
window.closeMobileMenu = closeMobileMenu;

console.log("✅ Navbar module loaded (Fully Mobile Friendly)");
