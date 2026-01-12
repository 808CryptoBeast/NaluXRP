// =======================================================
// navbar.js – STABLE + MOBILE FRIENDLY + OVERLAY SAFE
// Updated: Inspector link inserted into Network dropdown (if present),
// fallback into nav links. Robust and accessible.
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

  // Add Inspector entry into the Network dropdown (or fallback)
  setupInspectorInNetworkDropdown();

  // Small keyboard helper: Ctrl/Cmd+K to focus nav search or open inspector
  window.addEventListener("keydown", (e) => {
    const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
    if ((isMac ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      // If inspector exists in DOM, navigate to it
      const inspectorBtn = document.querySelector('[data-page="inspector"]');
      if (inspectorBtn) {
        inspectorBtn.click();
      }
    }
  });
}

/* ------------------------------------------------------
   PAGE NAVIGATION (SAFE)
   Elements with data-page="..." are wired here
------------------------------------------------------ */
function setupNavLinks() {
  document.querySelectorAll("[data-page]").forEach((btn) => {
    // avoid double-binding
    if (btn.__navBound) return;
    btn.addEventListener("click", (e) => {
      const page = btn.dataset.page;
      if (!page) return;

      e.preventDefault();
      e.stopPropagation();

      navigateToPage(page);

      // Close mobile menu after navigating on small screens
      if (window.innerWidth <= 992) {
        closeMobileMenu();
      }
    });
    btn.__navBound = true;
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
   Insert Inspector into Network dropdown (preferred)
   If not found, append to primary navLinks as fallback
------------------------------------------------------ */
function setupInspectorInNetworkDropdown() {
  // Candidate selectors for network dropdown containers
  const selectors = [
    '#networkDropdown',
    '.nav-dropdown.network',
    '.nav-network',
    '.network-selector',
    '[data-dropdown="network"]',
    '.nav-dropdown' // fallback: find the nav-dropdown that mentions "Network"
  ];

  let targetMenu = null;
  let container = null;

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (!el) continue;

    // If the element itself looks like a dropdown container with menu child, use that menu
    const menu =
      el.querySelector('.dropdown-menu') ||
      el.querySelector('.nav-dropdown-menu') ||
      el.querySelector('ul') ||
      el.querySelector('.dropdown-content');

    // prefer the explicit menu element, else use the element itself
    targetMenu = menu || el;
    container = el;
    // If selector is generic .nav-dropdown, ensure it's the network one by checking text
    if (sel === '.nav-dropdown') {
      const text = el.textContent || '';
      if (!/network|networ|🌐/i.test(text)) {
        // not clearly the network dropdown - keep searching
        targetMenu = null;
        container = null;
        continue;
      }
    }
    break;
  }

  // Build the inspector node
  const inspectorNode = document.createElement('button');
  inspectorNode.type = 'button';
  inspectorNode.className = 'dropdown-item nav-inspector-item';
  inspectorNode.dataset.page = 'inspector';
  inspectorNode.textContent = '🔎 Account Inspector';
  inspectorNode.title = 'Open Account Inspector (full page)';

  // Style to fit many dropdown designs
  inspectorNode.style.cssText = 'display:block;width:100%;text-align:left;padding:8px 12px;background:transparent;border:0;cursor:pointer;color:inherit;font-size:0.95rem;';

  if (targetMenu) {
    // Append to menu
    try {
      targetMenu.appendChild(inspectorNode);
      // Ensure nav-links binding picks up this new element
      setupNavLinks();
      return;
    } catch (e) {
      console.warn('Failed to append inspector to detected network dropdown', e);
    }
  }

  // Fallback: append to primary navLinks container or navbar
  const navLinks = document.getElementById('navLinks');
  const navbar = document.getElementById('navbar');
  if (navLinks) {
    const wrapper = document.createElement('div');
    wrapper.className = 'nav-inspector-wrapper';
    wrapper.style.cssText = 'display:inline-block;margin-left:8px;';
    wrapper.appendChild(inspectorNode);
    navLinks.appendChild(wrapper);
    setupNavLinks();
    return;
  } else if (navbar) {
    navbar.appendChild(inspectorNode);
    setupNavLinks();
    return;
  }

  // Last fallback: append to body end
  document.body.appendChild(inspectorNode);
  setupNavLinks();
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
    // avoid double-binding
    if (toggle.__dropdownBound) return;
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
    toggle.__dropdownBound = true;
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

    /* Minor visual for injected inspector item */
    .nav-inspector-item { font-weight: 600; }
  `;

  document.head.appendChild(style);
}

/* ------------------------------------------------------
   EXPORT
------------------------------------------------------ */
window.navigateToPage = navigateToPage;
window.closeMobileMenu = closeMobileMenu;

console.log("✅ Navbar module loaded (overlay-safe, inspector link in network dropdown)");
