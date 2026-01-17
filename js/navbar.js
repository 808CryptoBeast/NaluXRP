// =======================================================
// File: js/navbar.js
// FIXES:
// - Works with your current HTML (inline onclick buttons + .nav-dropdown)
// - Removes hamburger dependency
// - Dropdowns toggle on click (mobile + desktop), close on outside click / ESC
// - Navbar toggle buttons collapse/expand nav links
// =======================================================

(function () {
  function $(sel, root = document) {
    return root.querySelector(sel);
  }

  function $all(sel, root = document) {
    return Array.from(root.querySelectorAll(sel));
  }

  function closeAllDropdowns(except = null) {
    $all(".nav-dropdown.open").forEach((d) => {
      if (except && d === except) return;
      d.classList.remove("open");
    });
  }

  function initDropdowns() {
    const dropdowns = $all(".nav-dropdown");
    dropdowns.forEach((dd) => {
      const toggle = dd.querySelector(".dropdown-toggle");
      const menu = dd.querySelector(".dropdown-menu");
      if (!toggle || !menu) return;

      toggle.setAttribute("aria-haspopup", "true");
      toggle.setAttribute("aria-expanded", "false");

      toggle.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();

        const willOpen = !dd.classList.contains("open");
        closeAllDropdowns(dd);

        dd.classList.toggle("open", willOpen);
        toggle.setAttribute("aria-expanded", String(willOpen));
      });

      menu.addEventListener("click", (e) => {
        // allow clicking links without closing immediate if they navigate;
        // we still close dropdowns for a clean state
        const target = e.target;
        if (target && target.closest(".dropdown-item")) {
          closeAllDropdowns();
        }
      });
    });

    document.addEventListener("click", () => closeAllDropdowns());
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeAllDropdowns();
    });
  }

  function initNavbarHideOnScroll() {
    const navbar = $("#navbar");
    if (!navbar) return;

    let lastScrollY = window.scrollY;

    window.addEventListener("scroll", () => {
      const currentY = window.scrollY;
      if (currentY > lastScrollY && currentY > 80) navbar.classList.add("hide");
      else navbar.classList.remove("hide");
      lastScrollY = currentY;
    });
  }

  function initNavbarToggles() {
    const navLinks = $("#navLinks");
    const toggleBtn = $("#navbarToggle");
    const floatBtn = $("#navbarToggleBtn");
    if (!navLinks) return;

    const setCollapsed = (collapsed) => {
      navLinks.classList.toggle("is-collapsed", collapsed);
      const icon = $(".toggle-icon");
      if (icon) icon.textContent = collapsed ? "▼" : "▲";
      try {
        localStorage.setItem("naluxrp_nav_collapsed", collapsed ? "1" : "0");
      } catch (_) {}
    };

    let collapsed = false;
    try {
      collapsed = localStorage.getItem("naluxrp_nav_collapsed") === "1";
    } catch (_) {}
    setCollapsed(collapsed);

    const toggle = () => setCollapsed(!navLinks.classList.contains("is-collapsed"));

    if (toggleBtn) toggleBtn.addEventListener("click", (e) => { e.preventDefault(); toggle(); });
    if (floatBtn) floatBtn.addEventListener("click", (e) => { e.preventDefault(); toggle(); });

    window.addEventListener("keydown", (e) => {
      if (e.key.toLowerCase() === "n" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        toggle();
      }
    });
  }

  function injectNavbarSafetyStyles() {
    if (document.getElementById("navbar-safety-styles")) return;

    const style = document.createElement("style");
    style.id = "navbar-safety-styles";
    style.textContent = `
      .navbar, #navbar { position: fixed; z-index: 10000; pointer-events: auto; }
      .notification-container,
      .notifications,
      .toast-container,
      .toast-wrapper,
      .toasts,
      #notifications { pointer-events: none !important; z-index: 9000 !important; }
      .notification, .toast { pointer-events: auto !important; }
      .nav-dropdown, .nav-dropdown * { pointer-events: auto; }
    `;
    document.head.appendChild(style);
  }

  document.addEventListener("DOMContentLoaded", () => {
    injectNavbarSafetyStyles();
    initDropdowns();
    initNavbarHideOnScroll();
    initNavbarToggles();
    console.log("✅ Navbar module loaded (dropdown click-toggle, no hamburger dependency)");
  });
})();
