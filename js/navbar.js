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

  // Add Account Inspector toggle/button into the navbar
  setupInspectorButton();
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
   ACCOUNT INSPECTOR BUTTON (inject into navbar)
   - Adds a small icon/button to open/toggle the Account Inspector
   - If account-inspector.js is not loaded, will lazy-load it
------------------------------------------------------ */
function setupInspectorButton() {
  const navbar = document.getElementById("navbar");
  const navLinks = document.getElementById("navLinks");

  // Determine where to insert: prefer a right-aligned area or navLinks
  const insertTarget = navLinks || navbar || document.body;
  if (!insertTarget) return;

  // Avoid adding twice
  if (document.getElementById("navAccountInspectorBtn")) return;

  const btn = document.createElement("button");
  btn.id = "navAccountInspectorBtn";
  btn.className = "nav-btn nav-account-inspector";
  btn.type = "button";
  btn.title = "Account Inspector (Merkle snapshots)";
  btn.style.cssText = "margin-left:10px;padding:6px 10px;border-radius:8px;border:1px solid var(--accent-tertiary);background:transparent;color:var(--text-primary);cursor:pointer";
  btn.innerHTML = `🔎 Inspector`;

  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    // close mobile menu if open
    if (window.innerWidth <= 992) closeMobileMenu();

    // If the inspector module is already present, show panel and focus input
    if (typeof window.AccountInspector !== "undefined" && typeof window.AccountInspector.getSnapshot === "function") {
      // ensure panel element exists and focus input
      const ensure = document.getElementById("accountInspector");
      if (ensure) {
        // show if hidden (panel is fixed, ensure visible)
        // We expect account-inspector.js to manage its own UI; we simply focus input
        const addrInput = document.getElementById("aiAddress");
        if (addrInput) {
          addrInput.focus();
        }
      } else {
        // fallback: call init function if exposed
        try { if (typeof window.initAccountInspector === "function") window.initAccountInspector(); } catch (e) {}
      }
      return;
    }

    // Lazy-load the inspector script (relative path)
    const scriptUrl = "/js/account-inspector.js";
    try {
      await loadScriptOnce(scriptUrl);
      // after load, focus input if available
      setTimeout(() => {
        const ai = document.getElementById("aiAddress");
        if (ai) ai.focus();
      }, 200);
    } catch (err) {
      console.error("Failed to load Account Inspector:", err);
      // provide user feedback via small temporary toast
      flashTemporaryMessage("Failed to load Account Inspector");
    }
  });

  // Insert button into navLinks or navbar end
  if (navLinks) {
    // try to append to end of links container
    navLinks.appendChild(btn);
  } else if (navbar) {
    navbar.appendChild(btn);
  } else {
    document.body.appendChild(btn);
  }
}

// Load a script exactly once and return a Promise that resolves when loaded
function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    // if already present, resolve immediately
    const existing = Array.from(document.scripts).find(s => s.src && s.src.indexOf(src) !== -1);
    if (existing) {
      if (existing.getAttribute("data-loaded") === "true") return resolve();
      // else wait for it
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", (e) => reject(e));
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.setAttribute("data-loaded", "false");
    s.onload = () => { s.setAttribute("data-loaded", "true"); resolve(); };
    s.onerror = (e) => { reject(new Error("Failed to load " + src)); };
    document.head.appendChild(s);
  });
}

// small user feedback helper
function flashTemporaryMessage(msg, timeout = 3000) {
  const id = "nav-temp-msg";
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement("div");
    el.id = id;
    el.style.cssText = "position:fixed;right:16px;top:64px;padding:8px 12px;background:rgba(0,0,0,0.8);color:#fff;border-radius:8px;z-index:12000;font-size:13px";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = "1";
  setTimeout(() => {
    el.style.transition = "opacity 0.4s";
    el.style.opacity = "0";
    setTimeout(() => { try { el.remove(); } catch(e){} }, 450);
  }, timeout);
}

/* ------------------------------------------------------
   EXPORT
------------------------------------------------------ */
window.navigateToPage = navigateToPage;
window.closeMobileMenu = closeMobileMenu;
window.openAccountInspector = function() {
  // convenience: programmatically open the inspector as if clicking the nav button
  const btn = document.getElementById("navAccountInspectorBtn");
  if (btn) btn.click();
};

console.log("✅ Navbar module loaded (overlay-safe, dropdown-safe, inspector-ready)");
