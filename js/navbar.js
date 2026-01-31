// =======================================================
// navbar.js – FULL (Mobile panel + Small-phone bottom bar)
// - Uses #hamburger as shield-logo button (CSS background)
// - <=992px: hamburger opens/closes dropdown panel
// - <=520px: bottom navbar always visible, dropdowns open as bottom sheets
// - Fixes “dropdown not visible on smallest screens”
// =======================================================

document.addEventListener("DOMContentLoaded", () => {
  initNavbar();
  injectNavbarSafetyStyles();
});

const NAV_MOBILE_BP = 992;
const NAV_BOTTOM_BP = 520;

function initNavbar(){
  const navbar = document.getElementById("navbar");
  const hamburger = document.getElementById("hamburger");
  const navLinks = document.getElementById("navLinks");

  if (!navbar || !navLinks) return;

  // Prevent double-toggling if other scripts set hamburger.onclick (UI.js)
  if (hamburger) hamburger.onclick = null;

  // Setup hamburger (tablet/mobile panel)
  setupHamburger(navbar, hamburger, navLinks);

  // Setup dropdown toggles
  setupDropdowns(navbar);

  // Close menu/sheets on outside tap
  setupOutsideClose(navbar);

  // Desktop scroll-hide
  setupScrollHideDesktop(navbar);

  // On resize, normalize state
  window.addEventListener("resize", () => normalizeNavState(navbar));

  // First normalize
  normalizeNavState(navbar);
}

function isMobilePanelMode(){
  return window.innerWidth <= NAV_MOBILE_BP && window.innerWidth > NAV_BOTTOM_BP;
}

function isBottomMode(){
  return window.innerWidth <= NAV_BOTTOM_BP;
}

function setupHamburger(navbar, hamburger, navLinks){
  if (!hamburger) return;

  hamburger.addEventListener("click", (e) => {
    // Bottom mode doesn't use hamburger
    if (isBottomMode()) return;

    e.preventDefault();
    e.stopPropagation();

    const open = !navbar.classList.contains("open");
    setMobilePanelOpen(navbar, open);

    hamburger.setAttribute("aria-expanded", open ? "true" : "false");
  });
}

function setMobilePanelOpen(navbar, open){
  const navLinks = document.getElementById("navLinks");
  const hamburger = document.getElementById("hamburger");

  if (!navLinks) return;

  if (open){
    navbar.classList.add("open");
    navLinks.classList.add("show");
    document.body.classList.add("mobile-menu-open");
  } else {
    navbar.classList.remove("open");
    navLinks.classList.remove("show");
    document.body.classList.remove("mobile-menu-open");
    closeAllDropdowns();
    hideSheetBackdrop();
  }

  if (hamburger){
    hamburger.setAttribute("aria-expanded", open ? "true" : "false");
  }
}

function setupDropdowns(navbar){
  const toggles = document.querySelectorAll(".dropdown-toggle");

  toggles.forEach((toggle) => {
    toggle.addEventListener("click", (e) => {
      const parent = toggle.closest(".nav-dropdown");
      if (!parent) return;

      // Desktop: allow hover dropdown
      if (window.innerWidth > NAV_MOBILE_BP) return;

      e.preventDefault();
      e.stopPropagation();

      const isActive = parent.classList.contains("active");

      // Close others
      document.querySelectorAll(".nav-dropdown.active").forEach((d) => {
        if (d !== parent) d.classList.remove("active");
      });

      // Toggle this one
      parent.classList.toggle("active", !isActive);

      // Bottom mode: show backdrop for sheet
      if (isBottomMode()){
        if (!isActive) showSheetBackdrop();
        else hideSheetBackdrop();
      }
    });
  });

  // If user taps a dropdown item, close menus
  document.querySelectorAll(".dropdown-item").forEach((item) => {
    item.addEventListener("click", () => {
      // In bottom mode, close sheet; in mobile-panel mode, close panel too
      if (isBottomMode()){
        closeAllDropdowns();
        hideSheetBackdrop();
      } else if (window.innerWidth <= NAV_MOBILE_BP){
        setMobilePanelOpen(navbar, false);
      }
    });
  });

  // If user taps a normal nav button, close panel on mobile
  document.querySelectorAll(".nav-links .nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (isBottomMode()){
        // bottom bar stays; just close any open sheets
        closeAllDropdowns();
        hideSheetBackdrop();
        return;
      }
      if (window.innerWidth <= NAV_MOBILE_BP){
        setMobilePanelOpen(navbar, false);
      }
    });
  });
}

function setupOutsideClose(navbar){
  document.addEventListener("click", (e) => {
    if (window.innerWidth > NAV_MOBILE_BP) return;

    // If click is inside navbar or inside a dropdown menu, ignore
    if (e.target.closest("#navbar")) return;

    // Bottom mode: close sheets only
    if (isBottomMode()){
      closeAllDropdowns();
      hideSheetBackdrop();
      return;
    }

    // Mobile panel mode: close panel
    setMobilePanelOpen(navbar, false);
  });
}

function closeAllDropdowns(){
  document.querySelectorAll(".nav-dropdown.active").forEach((d) => d.classList.remove("active"));
}

function normalizeNavState(navbar){
  // Bottom mode: bottom bar always visible; ensure mobile panel is closed
  if (isBottomMode()){
    setMobilePanelOpen(navbar, false);
    return;
  }

  // Desktop: ensure mobile panel closed and backdrop removed
  if (window.innerWidth > NAV_MOBILE_BP){
    setMobilePanelOpen(navbar, false);
    return;
  }

  // Tablet/mobile panel: keep closed by default (don’t force open)
  hideSheetBackdrop();
}

function setupScrollHideDesktop(navbar){
  let lastY = window.scrollY;

  window.addEventListener("scroll", () => {
    if (window.innerWidth <= NAV_MOBILE_BP) return;

    const y = window.scrollY;
    if (y > lastY && y > 90){
      navbar.classList.add("hide");
    } else {
      navbar.classList.remove("hide");
    }
    lastY = y;
  });
}

/* ---------- Bottom-sheet backdrop (small phones) ---------- */
function ensureSheetBackdrop(){
  let el = document.getElementById("navSheetBackdrop");
  if (el) return el;

  el = document.createElement("div");
  el.id = "navSheetBackdrop";
  document.body.appendChild(el);

  el.addEventListener("click", () => {
    closeAllDropdowns();
    hideSheetBackdrop();
  });

  return el;
}

function showSheetBackdrop(){
  const el = ensureSheetBackdrop();
  el.classList.add("show");
}

function hideSheetBackdrop(){
  const el = document.getElementById("navSheetBackdrop");
  if (!el) return;
  el.classList.remove("show");
}

/* ------------------------------------------------------
   🔥 OVERLAY / NOTIFICATION SAFETY
------------------------------------------------------ */
function injectNavbarSafetyStyles(){
  if (document.getElementById("navbar-safety-styles")) return;

  const style = document.createElement("style");
  style.id = "navbar-safety-styles";
  style.textContent = `
    /* Ensure navbar always remains clickable */
    .navbar, #navbar { pointer-events: auto; }

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
  `;
  document.head.appendChild(style);
}

console.log("✅ Navbar module loaded (mobile panel + bottom bar + sheet dropdowns)");
