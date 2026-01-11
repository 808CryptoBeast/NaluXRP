// =======================================================
// navbar.js – STABLE + MOBILE FRIENDLY + OVERLAY SAFE
// Fixes notification / forensic overlay blocking issues
// Adds robust Account Inspector loader, keyboard shortcut,
// accessibility improvements, and persistence for inspector state.
// =======================================================

document.addEventListener("DOMContentLoaded", () => {
  initNavbar();
  injectNavbarSafetyStyles();

  // Restore inspector open state if user left it open
  try {
    const shouldOpen = localStorage.getItem("nalu:inspectorOpen") === "true";
    if (shouldOpen) {
      // Defer slightly to allow DOM ready
      setTimeout(() => {
        openAccountInspector();
      }, 600);
    }
  } catch (e) {
    /* ignore localStorage errors */
  }
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

  // Keyboard shortcut: Ctrl/Cmd+I toggles inspector
  window.addEventListener("keydown", (e) => {
    const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
    if ((isMac ? e.metaKey : e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "i") {
      e.preventDefault();
      openAccountInspector();
    }
  });
}

/* ------------------------------------------------------
   PAGE NAVIGATION (SAFE)
------------------------------------------------------ */
function setupNavLinks() {
  document.querySelectorAll("[data-page]").forEach(btn => {
    btn.addEventListener("click", (e) => {
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

  dropdownToggles.forEach(toggle => {
    toggle.addEventListener("click", (e) => {
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

    /* Small style for inspector badge when loaded */
    #navAccountInspectorBtn.loaded {
      background: linear-gradient(135deg, rgba(80,250,123,0.12), rgba(80,250,123,0.06));
      border-color: rgba(80,250,123,0.25);
    }
  `;

  document.head.appendChild(style);
}

/* ------------------------------------------------------
   ACCOUNT INSPECTOR BUTTON (inject into navbar)
   - Adds a small icon/button to open/toggle the Account Inspector
   - Lazy-loads js/account-inspector.js with robust path handling
   - Keyboard shortcut and persistence integrated
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
  btn.title = "Account Inspector (Merkle snapshots) — Ctrl/Cmd+I";
  btn.setAttribute("aria-label", "Open Account Inspector");
  btn.style.cssText = "margin-left:10px;padding:6px 10px;border-radius:8px;border:1px solid var(--accent-tertiary);background:transparent;color:var(--text-primary);cursor:pointer";
  btn.innerHTML = `🔎 Inspector`;

  // state
  let isLoading = false;
  let lastClick = 0;

  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (Date.now() - lastClick < 600) return; // debounce rapid clicks
    lastClick = Date.now();

    // close mobile menu if open
    if (window.innerWidth <= 992) closeMobileMenu();

    // If inspector already loaded, focus its input
    if (typeof window.AccountInspector !== "undefined") {
      focusInspectorInput();
      toggleInspectorVisibility(true);
      return;
    }

    if (isLoading) {
      flashTemporaryMessage("Inspector is loading…");
      return;
    }

    // Lazy-load the inspector script using a robust loader
    const scriptUrl = "js/account-inspector.js"; // relative path: works on GitHub Pages under repo subpath
    isLoading = true;
    btn.classList.add("loading");
    try {
      await loadScriptOnce(scriptUrl);
      // mark loaded visually
      btn.classList.add("loaded");
      flashTemporaryMessage("Account Inspector loaded", 1500);
      // persist open state
      try { localStorage.setItem("nalu:inspectorOpen", "true"); } catch (e) {}
      // small delay to let script initialize its UI
      setTimeout(() => {
        focusInspectorInput();
        toggleInspectorVisibility(true);
      }, 180);
    } catch (err) {
      console.error("Failed to load Account Inspector:", err);
      flashTemporaryMessage("Failed to load Inspector");
    } finally {
      isLoading = false;
      btn.classList.remove("loading");
    }
  });

  // Insert button into navLinks or navbar end
  if (navLinks) {
    navLinks.appendChild(btn);
  } else if (navbar) {
    navbar.appendChild(btn);
  } else {
    document.body.appendChild(btn);
  }
}

/* ------------------------------------------------------
   Robust script loader: tries multiple candidate URLs
   - relative path
   - root-absolute
   - origin-prefixed
   - raw.githubusercontent fallback (for quick testing)
------------------------------------------------------ */
function loadScriptOnce(src) {
  const cleaned = src.replace(/^\.\//, "").replace(/^\/+/, "");
  const candidates = [
    // prefer relative to current document (handles repo subpath)
    cleaned, // "js/account-inspector.js"
    '/' + cleaned, // "/js/account-inspector.js"
    window.location.origin + '/' + cleaned, // "https://host/js/..."
    // raw github content (last resort; may not set correct headers but usually works for simple scripts)
    `https://raw.githubusercontent.com/808CryptoBeast/NaluXRP/main/${cleaned}`
  ];

  return new Promise((resolve, reject) => {
    const tried = new Set();
    function tryNext() {
      if (!candidates.length) return reject(new Error("All script candidates failed"));
      const next = candidates.shift();
      if (tried.has(next)) return tryNext();
      tried.add(next);

      // If script already exists and loaded, resolve immediately
      const existing = Array.from(document.scripts).find(s => s.src && s.src.indexOf(next) !== -1);
      if (existing) {
        if (existing.getAttribute("data-loaded") === "true") return resolve();
        existing.addEventListener("load", () => resolve());
        existing.addEventListener("error", () => tryNext());
        return;
      }

      const s = document.createElement("script");
      s.src = next;
      s.async = true;
      s.setAttribute("data-loaded", "false");
      s.onload = () => { s.setAttribute("data-loaded", "true"); resolve(); };
      s.onerror = () => { s.remove(); tryNext(); };
      document.head.appendChild(s);
    }
    tryNext();
  });
}

/* ------------------------------------------------------
   Small helpers for inspector control & feedback
------------------------------------------------------ */
function focusInspectorInput() {
  const el = document.getElementById("aiAddress") || document.querySelector("#accountInspector input");
  if (el) {
    try { el.focus(); el.select(); } catch (e) {}
  }
}

function toggleInspectorVisibility(show) {
  const panel = document.getElementById("accountInspector");
  if (!panel) return;
  panel.style.display = show ? "block" : "none";
  try { localStorage.setItem("nalu:inspectorOpen", show ? "true" : "false"); } catch (e) {}
}

// convenience method — exposed globally at end of file
function flashTemporaryMessage(msg, timeout = 3000) {
  const id = "nav-temp-msg";
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement("div");
    el.id = id;
    el.style.cssText = "position:fixed;right:16px;top:64px;padding:8px 12px;background:rgba(0,0,0,0.85);color:#fff;border-radius:8px;z-index:12000;font-size:13px";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = "1";
  setTimeout(() => {
    el.style.transition = "opacity 0.4s";
    el.style.opacity = "0";
    setTimeout(() => { try { el.remove(); } catch (e) {} }, 450);
  }, timeout);
}

/* ------------------------------------------------------
   Programmatic API / Exports
------------------------------------------------------ */
window.navigateToPage = navigateToPage;
window.closeMobileMenu = closeMobileMenu;
window.openAccountInspector = function () {
  // simulate clicking the nav button
  const btn = document.getElementById("navAccountInspectorBtn");
  if (btn) { btn.click(); return; }

  // If button not present, try to lazy-load the script directly
  const scriptUrl = "js/account-inspector.js";
  loadScriptOnce(scriptUrl).then(() => {
    focusInspectorInput();
    toggleInspectorVisibility(true);
  }).catch((e) => {
    flashTemporaryMessage("Failed to open inspector");
    console.error(e);
  });
};
window.closeAccountInspector = function () {
  toggleInspectorVisibility(false);
};

/* ------------------------------------------------------
   Debug/log
------------------------------------------------------ */
console.log("✅ Navbar module loaded (overlay-safe, dropdown-safe, inspector-ready)");
