// =======================================================
// navbar.js – NaluXrp 🌊 (FULL)
// Mobile + Desktop friendly navbar controller
// - Hamburger menu (mobile overlay)
// - Dropdowns: hover on desktop, click accordion on mobile
// - Active page highlighting
// - Inspector link injected into Network dropdown + fallback button in navbar
// - Outside click + Escape closes menus
// - Optional navbar collapse toggle buttons supported (#navbarToggle / #navbarToggleBtn)
// =======================================================

(function () {
  const SELECTORS = {
    navbar: "#navbar",
    navLinks: "#navLinks",
    hamburger: "#hamburger",
    dropdown: ".nav-dropdown",
    dropdownToggle: ".dropdown-toggle",
    dropdownMenu: ".dropdown-menu",
    navBtn: ".nav-btn",
    dropdownItem: ".dropdown-item",
    statusBadge: ".status-badge",
    desktopToggle: "#navbarToggle",
    floatingToggle: "#navbarToggleBtn",
  };

  let initialized = false;
  let originalSwitchPage = null;

  function $(sel, root = document) {
    return root.querySelector(sel);
  }
  function $all(sel, root = document) {
    return Array.from(root.querySelectorAll(sel));
  }

  function isMobile() {
    return window.innerWidth <= 992;
  }

  function safeCallSwitchPage(pageId) {
    if (typeof window.switchPage === "function") {
      window.switchPage(pageId);
    } else {
      console.error("❌ switchPage() not found. Ensure ui.js loads before navbar.js");
    }
  }

  // -----------------------------
  // Mobile menu open/close
  // -----------------------------
  function openMobileMenu() {
    const hamburger = $(SELECTORS.hamburger);
    const navLinks = $(SELECTORS.navLinks);
    if (!hamburger || !navLinks) return;

    hamburger.classList.add("active");
    navLinks.classList.add("show");
    document.body.classList.add("mobile-menu-open");
    hamburger.setAttribute("aria-expanded", "true");
  }

  function closeMobileMenu() {
    const hamburger = $(SELECTORS.hamburger);
    const navLinks = $(SELECTORS.navLinks);
    if (hamburger) {
      hamburger.classList.remove("active");
      hamburger.setAttribute("aria-expanded", "false");
    }
    if (navLinks) navLinks.classList.remove("show");
    document.body.classList.remove("mobile-menu-open");

    // close any open dropdown accordions
    $all(`${SELECTORS.dropdown}.active`).forEach((d) => d.classList.remove("active"));
  }

  function toggleMobileMenu() {
    const navLinks = $(SELECTORS.navLinks);
    if (!navLinks) return;
    if (navLinks.classList.contains("show")) closeMobileMenu();
    else openMobileMenu();
  }

  // -----------------------------
  // Dropdown behavior
  // -----------------------------
  function setupDropdowns() {
    const dropdowns = $all(SELECTORS.dropdown);
    dropdowns.forEach((drop) => {
      const toggle = $(SELECTORS.dropdownToggle, drop);
      const menu = $(SELECTORS.dropdownMenu, drop);
      if (!toggle || !menu) return;

      // Accessibility
      toggle.setAttribute("aria-haspopup", "true");
      toggle.setAttribute("aria-expanded", "false");

      // Mobile: click accordion
      toggle.addEventListener("click", (e) => {
        if (!isMobile()) return; // Desktop uses CSS hover (still clickable but we skip)
        e.preventDefault();
        e.stopPropagation();

        // Close other dropdowns first
        dropdowns.forEach((d) => {
          if (d !== drop) d.classList.remove("active");
          const t = $(SELECTORS.dropdownToggle, d);
          if (t) t.setAttribute("aria-expanded", "false");
        });

        const nowActive = !drop.classList.contains("active");
        drop.classList.toggle("active", nowActive);
        toggle.setAttribute("aria-expanded", nowActive ? "true" : "false");
      });

      // Desktop: allow click-to-open too (optional)
      toggle.addEventListener("click", (e) => {
        if (isMobile()) return;
        // If user clicks on desktop, toggle a "forced open" state
        e.preventDefault();
        e.stopPropagation();

        const currently = drop.classList.contains("force-open");
        dropdowns.forEach((d) => d.classList.remove("force-open"));
        drop.classList.toggle("force-open", !currently);
        toggle.setAttribute("aria-expanded", !currently ? "true" : "false");
      });
    });

    // Outside click closes forced-open dropdowns (desktop) + mobile menus
    document.addEventListener("click", (e) => {
      const nav = $(SELECTORS.navbar);
      if (!nav) return;

      // Close forced-open dropdowns if click outside navbar
      if (!e.target.closest(SELECTORS.navbar)) {
        $all(`${SELECTORS.dropdown}.force-open`).forEach((d) => d.classList.remove("force-open"));
        $all(SELECTORS.dropdownToggle).forEach((t) => t.setAttribute("aria-expanded", "false"));
        if (isMobile()) closeMobileMenu();
        return;
      }

      // If click inside navbar but not inside a dropdown, close forced-open dropdowns
      if (!e.target.closest(SELECTORS.dropdown)) {
        $all(`${SELECTORS.dropdown}.force-open`).forEach((d) => d.classList.remove("force-open"));
        $all(SELECTORS.dropdownToggle).forEach((t) => t.setAttribute("aria-expanded", "false"));
      }
    });
  }

  // -----------------------------
  // Hamburger
  // -----------------------------
  function setupHamburger() {
    const hamburger = $(SELECTORS.hamburger);
    const navLinks = $(SELECTORS.navLinks);
    if (!hamburger || !navLinks) return;

    hamburger.setAttribute("role", "button");
    hamburger.setAttribute("tabindex", "0");
    hamburger.setAttribute("aria-label", "Toggle navigation");
    hamburger.setAttribute("aria-expanded", "false");

    hamburger.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleMobileMenu();
    });

    hamburger.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleMobileMenu();
      }
    });
  }

  // -----------------------------
  // Bind nav buttons + dropdown items
  // (Your HTML uses inline onclick="switchPage('...')"
  // We *also* add listeners so we can close mobile + highlight active.)
  // -----------------------------
  function bindNavigationClicks() {
    // Buttons
    $all(SELECTORS.navBtn).forEach((btn) => {
      if (btn.__navBound) return;
      btn.addEventListener("click", () => {
        // If this button is the theme button (no page navigation), ignore
        const txt = (btn.textContent || "").toLowerCase();
        if (btn.classList.contains("theme-btn") || txt.trim() === "🎨") return;

        // close mobile after click
        if (isMobile()) closeMobileMenu();
      });
      btn.__navBound = true;
    });

    // Dropdown items (anchors)
    $all(SELECTORS.dropdownItem).forEach((item) => {
      if (item.__dropBound) return;
      item.addEventListener("click", () => {
        if (isMobile()) closeMobileMenu();
        // close forced-open dropdowns on desktop after selection
        $all(`${SELECTORS.dropdown}.force-open`).forEach((d) => d.classList.remove("force-open"));
        $all(SELECTORS.dropdownToggle).forEach((t) => t.setAttribute("aria-expanded", "false"));
      });
      item.__dropBound = true;
    });
  }

  // -----------------------------
  // Active page highlighting
  // Wrap switchPage so any navigation updates active state.
  // -----------------------------
  function installActivePageHook() {
    if (originalSwitchPage) return;
    if (typeof window.switchPage !== "function") return;

    originalSwitchPage = window.switchPage;

    window.switchPage = function (pageId) {
      try {
        originalSwitchPage(pageId);
      } finally {
        // delay to allow UI.currentPage update + DOM changes
        setTimeout(updateActiveNavState, 0);
      }
    };

    // initial
    updateActiveNavState();
  }

  function normalizePageId(pageId) {
    return String(pageId || "").trim().toLowerCase();
  }

  function updateActiveNavState() {
    const current = normalizePageId(window.UI?.currentPage || "");

    // Clear previous active markers
    $all(`${SELECTORS.navBtn}.is-active`).forEach((b) => b.classList.remove("is-active"));
    $all(`${SELECTORS.dropdownItem}.is-active`).forEach((a) => a.classList.remove("is-active"));

    if (!current) return;

    // Try to match inline onclick="switchPage('X')"
    const matchByOnclick = (el) => {
      const oc = el.getAttribute("onclick") || "";
      return oc.includes(`switchPage('${current}')`) || oc.includes(`switchPage("${current}")`);
    };

    const btn = $all(SELECTORS.navBtn).find(matchByOnclick);
    if (btn) btn.classList.add("is-active");

    const item = $all(SELECTORS.dropdownItem).find(matchByOnclick);
    if (item) item.classList.add("is-active");
  }

  // -----------------------------
  // Insert "Account Inspector" into Network dropdown
  // (and if not found, add a normal nav button at end)
  // -----------------------------
  function injectInspectorButton() {
    // Already exists?
    if (document.querySelector(".nav-inspector-item")) return;

    const dropdowns = $all(SELECTORS.dropdown);
    let networkDrop = null;

    for (const d of dropdowns) {
      const t = $(SELECTORS.dropdownToggle, d);
      const label = (t?.textContent || "").toLowerCase();
      if (label.includes("network") || label.includes("🌐")) {
        networkDrop = d;
        break;
      }
    }

    // Build item
    const a = document.createElement("a");
    a.href = "#";
    a.className = "dropdown-item nav-inspector-item";
    a.textContent = "🔎 Account Inspector";
    a.title = "Open Account Inspector";
    a.addEventListener("click", (e) => {
      e.preventDefault();
      safeCallSwitchPage("inspector");
      if (isMobile()) closeMobileMenu();
    });

    if (networkDrop) {
      const menu = $(SELECTORS.dropdownMenu, networkDrop);
      if (menu) {
        menu.appendChild(a);
        return;
      }
    }

    // Fallback: add a normal nav button
    const navLinks = $(SELECTORS.navLinks);
    if (navLinks) {
      const btn = document.createElement("button");
      btn.className = "nav-btn nav-inspector-btn";
      btn.type = "button";
      btn.innerHTML = `<span class="nav-icon">🔎</span><span class="nav-label">Inspector</span>`;
      btn.title = "Open Account Inspector";
      btn.addEventListener("click", () => safeCallSwitchPage("inspector"));
      navLinks.appendChild(btn);
    }
  }

  // -----------------------------
  // Navbar hide-on-scroll (desktop)
  // -----------------------------
  function setupScrollHide() {
    const navbar = $(SELECTORS.navbar);
    if (!navbar) return;

    let lastY = window.scrollY || 0;

    window.addEventListener("scroll", () => {
      if (isMobile()) return; // don’t auto-hide on mobile
      if (document.body.classList.contains("navbar-collapsed")) return; // user override

      const y = window.scrollY || 0;
      if (y > lastY && y > 120) navbar.classList.add("hide");
      else navbar.classList.remove("hide");
      lastY = y;
    });
  }

  // -----------------------------
  // Optional: manual collapse toggles
  // (#navbarToggle and #navbarToggleBtn exist in your HTML)
  // -----------------------------
  function setupManualCollapseToggles() {
    const desktopToggle = $(SELECTORS.desktopToggle);
    const floatingToggle = $(SELECTORS.floatingToggle);

    const doToggle = () => {
      document.body.classList.toggle("navbar-collapsed");
      // when collapsed, ensure mobile menu is closed
      closeMobileMenu();
    };

    if (desktopToggle && !desktopToggle.__bound) {
      desktopToggle.addEventListener("click", doToggle);
      desktopToggle.__bound = true;
    }

    if (floatingToggle && !floatingToggle.__bound) {
      floatingToggle.addEventListener("click", doToggle);
      floatingToggle.__bound = true;
    }

    // Keyboard shortcut: press "N" to collapse/expand (desktop)
    window.addEventListener("keydown", (e) => {
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
      if (e.key.toLowerCase() === "n") {
        e.preventDefault();
        doToggle();
      }
      if (e.key === "Escape") {
        closeMobileMenu();
      }
    });
  }

  // -----------------------------
  // Keep bindings correct on resize
  // -----------------------------
  function setupResizeBehavior() {
    window.addEventListener("resize", () => {
      // If we leave mobile breakpoint, ensure menu isn’t stuck open
      if (!isMobile()) {
        closeMobileMenu();
        $all(`${SELECTORS.dropdown}.active`).forEach((d) => d.classList.remove("active"));
      }
      updateActiveNavState();
    });
  }

  // -----------------------------
  // INIT
  // -----------------------------
  function init() {
    if (initialized) return;
    initialized = true;

    setupHamburger();
    setupDropdowns();
    bindNavigationClicks();

    // Ensure inspector exists in nav
    injectInspectorButton();

    // Active page highlighting
    installActivePageHook();

    // Scroll hide behavior + manual toggles
    setupScrollHide();
    setupManualCollapseToggles();
    setupResizeBehavior();

    console.log("✅ Navbar module loaded (mobile + desktop + inspector injected)");
  }

  document.addEventListener("DOMContentLoaded", init);
})();
