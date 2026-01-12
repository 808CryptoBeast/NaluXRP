// =======================================================
// navbar.js – NAVBAR + NETWORK DROPDOWN INTEGRATION
// - Adds "Account Inspector" entry into the Network dropdown (or nav links fallback)
// - Mobile-friendly hamburger, dropdown accordion, scroll-hide behavior
// - Ensures notification overlays don't block navbar interactions
// =======================================================

document.addEventListener("DOMContentLoaded", () => {
  initNavbar();
  injectNavbarSafetyStyles();
});

/* ------------------------------------------------------
   INIT NAVBAR
------------------------------------------------------ */
function initNavbar() {
  setupNavLinks();            // attach SPA navigation handlers for data-page links
  setupHamburger();          // mobile hamburger
  setupDropdowns();          // mobile dropdown accordion behavior
  setupScrollHideDesktop();  // hide navbar on scroll (desktop)
  insertInspectorInNetworkDropdown(); // add Inspector entry to network dropdown (preferred)
}

/* ------------------------------------------------------
   PAGE NAVIGATION (SAFE)
   - Buttons / links with data-page="<id>" will call window.switchPage(id)
------------------------------------------------------ */
function setupNavLinks() {
  // Use event delegation: listen on document for clicks on elements with data-page
  document.addEventListener("click", function (e) {
    const el = e.target.closest("[data-page]");
    if (!el) return;

    const page = el.dataset.page;
    if (!page) return;

    e.preventDefault();
    e.stopPropagation();

    navigateToPage(page);

    // Close mobile menu after navigating
    if (window.innerWidth <= 992) {
      closeMobileMenu();
    }
  });
}

function navigateToPage(pageId) {
  // Prefer SPA switchPage exported by ui.js
  if (typeof window.switchPage === "function") {
    try {
      window.switchPage(pageId);
    } catch (err) {
      console.error("switchPage() threw:", err);
      // fallback: set location hash
      location.hash = "#" + pageId;
    }
    return;
  }

  // Fallback: if switchPage not present, use simple hash navigation
  try {
    location.hash = "#" + pageId;
  } catch (e) {
    console.error("navigateToPage fallback failed:", e);
  }
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
    document.body.classList.toggle("mobile-menu-open");
  });

  // Tap outside closes menu (mobile only)
  document.addEventListener("click", (e) => {
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

  dropdownToggles.forEach((toggle) => {
    toggle.addEventListener("click", (e) => {
      // Desktop: allow CSS hover
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
   NAVBAR SAFETY STYLES
   Prevent overlays / toasts from blocking the navbar
------------------------------------------------------ */
function injectNavbarSafetyStyles() {
  if (document.getElementById("navbar-safety-styles")) return;

  const style = document.createElement("style");
  style.id = "navbar-safety-styles";
  style.textContent = `
    .navbar, #navbar { position: relative; z-index: 10000; pointer-events: auto; }
    .notification-container, .notifications, .toast-container, .toast-wrapper, .toasts, #notifications {
      pointer-events: none !important;
      z-index: 9000 !important;
    }
    .notification, .toast { pointer-events: auto !important; }
    .nav-dropdown, .nav-dropdown * { pointer-events: auto; }
    /* small visual for injected inspector menu entry */
    .nav-dropdown .inspector-entry, .nav-links .inspector-entry { font-weight:600; }
  `;
  document.head.appendChild(style);
}

/* ------------------------------------------------------
   Insert "Account Inspector" into Network dropdown
   - Tries several selectors to find the network dropdown/menu
   - If found, adds an anchor with data-page="inspector"
   - If not found, appends a button to the main navLinks container
------------------------------------------------------ */
function insertInspectorInNetworkDropdown() {
  try {
    // Candidate container selectors (try to be resilient to different html structures)
    const candidateSelectors = [
      ".network-dropdown",      // common
      "#networkDropdown",       // id
      "#network-menu",          // alternate id
      ".network-selector",      // small selector block
      "[data-network-dropdown]",// attribute hook
      "#navLinks .nav-section-network", // compound
    ];

    let container = null;
    let menuList = null;

    for (const sel of candidateSelectors) {
      const el = document.querySelector(sel);
      if (!el) continue;

      // If the element itself is a dropdown wrapper that contains a .dropdown-menu
      const dm = el.querySelector(".dropdown-menu") || el.querySelector(".menu") || el.querySelector("ul");
      if (dm) {
        container = el;
        menuList = dm;
        break;
      }

      // if element looks like a button + menu sibling structure
      container = el;
      break;
    }

    // If we found a dropdown menu area, append an <a> entry
    if (menuList) {
      // create anchor
      const a = document.createElement("a");
      a.href = "#";
      a.className = "dropdown-item inspector-entry";
      a.dataset.page = "inspector";
      a.textContent = "🔎 Account Inspector";
      a.style.cursor = "pointer";
      // insert at the top or bottom as preferred
      menuList.appendChild(a);
      return;
    }

    // If container found but no menuList, try to create one
    if (container && !menuList) {
      const list = document.createElement("div");
      list.className = "dropdown-menu";
      const a = document.createElement("a");
      a.href = "#";
      a.className = "dropdown-item inspector-entry";
      a.dataset.page = "inspector";
      a.textContent = "🔎 Account Inspector";
      list.appendChild(a);
      container.appendChild(list);
      return;
    }

    // Fallback: append to navLinks area
    const navLinks = document.getElementById("navLinks") || document.querySelector(".nav-links") || document.querySelector(".navbar");
    if (navLinks) {
      // avoid duplication
      if (navLinks.querySelector(".inspector-entry")) return;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "nav-btn inspector-entry";
      btn.dataset.page = "inspector";
      btn.textContent = "🔎 Inspector";
      btn.style.marginLeft = "8px";
      navLinks.appendChild(btn);
      return;
    }

    // Last resort: append to navbar itself
    const navbar = document.getElementById("navbar") || document.querySelector(".navbar") || document.body;
    if (navbar && !navbar.querySelector(".inspector-entry")) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "nav-btn inspector-entry";
      btn.dataset.page = "inspector";
      btn.textContent = "🔎 Inspector";
      btn.style.marginLeft = "8px";
      navbar.appendChild(btn);
    }
  } catch (e) {
    console.warn("insertInspectorInNetworkDropdown failed:", e && e.message ? e.message : e);
  }
}

/* ------------------------------------------------------
   EXPORTS (helpers other modules might use)
------------------------------------------------------ */
window.closeMobileMenu = closeMobileMenu;
window.navigateToPage = navigateToPage;

console.log("✅ Navbar module loaded (network-inspector integrated)");
