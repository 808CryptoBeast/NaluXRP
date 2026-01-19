// =======================================================
// navbar.js — NO HAMBURGER + CLICK DROPDOWNS + SINGLE INSPECTOR
// Fixes:
// ✅ Removes hamburger behavior (mobile uses icon-only scroll rail)
// ✅ Dropdowns work on click/tap (desktop + mobile)
// ✅ Guarantees ONLY ONE Inspector button (removes duplicates everywhere)
// ✅ Keeps navbar from covering page content (dynamic --nav-offset)
// ✅ Connection badge updates via xrpl-connection events
// =======================================================

(function () {
  // Prevent double-initialization if script is loaded twice
  if (window.__NALU_NAVBAR_V3_INITIALIZED__) return;
  window.__NALU_NAVBAR_V3_INITIALIZED__ = true;

  const INSPECTOR_SELECTOR = [
    '[data-page="inspector"]',
    '.nav-inspector-btn',
    '.nav-inspector-item',
    'button[onclick*="switchPage(\'inspector\')"]',
    'button[onclick*="switchPage(\\"inspector\\")"]',
    'a[onclick*="switchPage(\'inspector\')"]',
    'a[onclick*="switchPage(\\"inspector\\")"]'
  ].join(",");

  document.addEventListener("DOMContentLoaded", () => {
    injectNavbarSafetyStyles();
    applyNavOffset();
    setupDropdowns();
    ensureSingleInspectorButton();
    bindConnectionBadge();

    window.addEventListener("resize", () => {
      closeAllDropdowns();
      applyNavOffset();
    });

    // If your app toggles sections, keep active button in sync
    hookSwitchPageForActiveState();
    // Initial active state
    setTimeout(() => syncActiveFromCurrentSection(), 0);
  });

  // ------------------------------------------------------
  // DROPDOWNS: click/tap to open (works everywhere)
  // ------------------------------------------------------
  function setupDropdowns() {
    const toggles = document.querySelectorAll(".nav-dropdown .dropdown-toggle");
    toggles.forEach((toggle) => {
      if (toggle.__naluBound) return;

      toggle.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();

        const parent = toggle.closest(".nav-dropdown");
        if (!parent) return;

        // Close other dropdowns
        document.querySelectorAll(".nav-dropdown.open").forEach((d) => {
          if (d !== parent) d.classList.remove("open");
        });

        parent.classList.toggle("open");
        ensureDropdownInViewport(parent);
      });

      toggle.__naluBound = true;
    });

    // Click outside closes
    document.addEventListener("click", (e) => {
      if (e.target.closest(".nav-dropdown")) return;
      closeAllDropdowns();
    });

    // ESC closes
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeAllDropdowns();
    });

    // Clicking a dropdown item closes dropdown
    document.querySelectorAll(".nav-dropdown .dropdown-menu").forEach((menu) => {
      menu.addEventListener("click", (e) => {
        const item = e.target.closest(".dropdown-item");
        if (!item) return;
        closeAllDropdowns();
      });
    });
  }

  function closeAllDropdowns() {
    document.querySelectorAll(".nav-dropdown.open").forEach((d) => d.classList.remove("open"));
  }

  // Keep dropdown menus inside viewport on small screens
  function ensureDropdownInViewport(dropdown) {
    const menu = dropdown.querySelector(".dropdown-menu");
    const toggle = dropdown.querySelector(".dropdown-toggle");
    if (!menu || !toggle) return;

    // Reset any prior inline tweaks
    menu.style.left = "";
    menu.style.right = "";
    menu.style.maxWidth = "";

    const rect = menu.getBoundingClientRect();
    const pad = 10;

    // If overflowing right, pin to right edge
    if (rect.right > window.innerWidth - pad) {
      menu.style.right = "0";
      menu.style.left = "auto";
      menu.style.maxWidth = `calc(100vw - ${pad * 2}px)`;
    }

    // If overflowing left, pin to left edge
    const rect2 = menu.getBoundingClientRect();
    if (rect2.left < pad) {
      menu.style.left = "0";
      menu.style.right = "auto";
      menu.style.maxWidth = `calc(100vw - ${pad * 2}px)`;
    }
  }

  // ------------------------------------------------------
  // SINGLE INSPECTOR BUTTON (no duplicates)
  // - removes duplicates anywhere in DOM
  // - ensures it lives in navLinks
  // ------------------------------------------------------
  function ensureSingleInspectorButton() {
    const navLinks = document.getElementById("navLinks");
    if (!navLinks) return;

    // Gather all possible inspector nodes across DOM
    const found = Array.from(document.querySelectorAll(INSPECTOR_SELECTOR));

    // Prefer the one inside navLinks, else first found
    let keeper = found.find((n) => navLinks.contains(n)) || found[0] || null;

    // Remove all others
    found.forEach((n) => {
      if (n !== keeper) n.remove();
    });

    // If none existed, create it
    if (!keeper) {
      keeper = document.createElement("button");
      keeper.type = "button";
      navLinks.appendChild(keeper);
    }

    // Normalize into a nav button
    normalizeInspectorNode(keeper);

    // Ensure it is placed right after Dashboard button if possible
    const dash = findNavTarget(navLinks, "dashboard");
    if (dash && dash.parentNode) {
      // If already directly after dashboard, leave it
      const after = dash.nextElementSibling;
      if (after !== keeper) dash.insertAdjacentElement("afterend", keeper);
    } else {
      // fallback: place at start
      if (navLinks.firstChild !== keeper) navLinks.prepend(keeper);
    }
  }

  function normalizeInspectorNode(node) {
    // Make it a button
    if (node.tagName.toLowerCase() !== "button") {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = node.className || "";
      btn.innerHTML = node.innerHTML || "";
      // Replace
      node.replaceWith(btn);
      node = btn;
    }

    node.type = "button";
    node.classList.add("nav-btn", "nav-inspector-btn");
    node.setAttribute("data-page", "inspector");
    node.removeAttribute("href");
    node.removeAttribute("onclick");

    // Standard content
    node.innerHTML = `<span class="nav-icon">🔎</span><span class="nav-label">Inspector</span>`;
    node.title = "Account Inspector";

    // Bind click once
    if (!node.__naluInspectorBound) {
      node.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        safeSwitchPage("inspector");
        closeAllDropdowns();
      });
      node.__naluInspectorBound = true;
    }

    return node;
  }

  function findNavTarget(container, pageId) {
    const dp = container.querySelector(`[data-page="${pageId}"]`);
    if (dp) return dp;

    const candidates = container.querySelectorAll("button, a");
    for (const el of candidates) {
      const oc = el.getAttribute("onclick") || "";
      const m = oc.match(/switchPage\(['"]([^'"]+)['"]\)/);
      if (m && m[1] === pageId) return el;
    }
    return null;
  }

  // ------------------------------------------------------
  // CONNECTION BADGE (statusDot + connectionStatus)
  // ------------------------------------------------------
  function bindConnectionBadge() {
    const dot = document.getElementById("statusDot");
    const label = document.getElementById("connectionStatus");
    if (!dot || !label) return;

    setBadge("connecting", "Connecting…");

    // initial state (if available)
    try {
      if (typeof window.getXRPLState === "function") {
        const s = window.getXRPLState();
        if (s?.connected) setBadge("live", `LIVE — ${s.server || "XRPL"}`);
      }
    } catch (_) {}

    window.addEventListener("xrpl-connection", (ev) => {
      const d = ev?.detail || {};
      if (d.connected) {
        setBadge("live", `LIVE — ${d.server || "XRPL"}`);
      } else {
        const mode = String(d.mode || "").toLowerCase();
        const reason = d.modeReason ? ` (${d.modeReason})` : "";
        if (mode.includes("connect")) setBadge("connecting", `Connecting…${reason}`);
        else setBadge("down", `Disconnected${reason}`);
      }
    });

    function setBadge(state, text) {
      dot.classList.remove("active", "connecting", "down");
      if (state === "live") dot.classList.add("active");
      else if (state === "connecting") dot.classList.add("connecting");
      else dot.classList.add("down");
      label.textContent = text;
    }
  }

  // ------------------------------------------------------
  // NAVBAR OFFSET so it doesn't cover top-of-page content
  // ------------------------------------------------------
  function applyNavOffset() {
    const navbar = document.getElementById("navbar");
    if (!navbar) return;

    const h = Math.max(70, Math.round(navbar.getBoundingClientRect().height));
    document.documentElement.style.setProperty("--nav-offset", `${h}px`);

    if (!document.getElementById("nav-offset-style")) {
      const style = document.createElement("style");
      style.id = "nav-offset-style";
      style.textContent = `
        .container { padding-top: var(--nav-offset, 78px) !important; }
        .page-section { scroll-margin-top: var(--nav-offset, 78px); }
      `;
      document.head.appendChild(style);
    }
  }

  // ------------------------------------------------------
  // ACTIVE PAGE HIGHLIGHTING
  // ------------------------------------------------------
  function hookSwitchPageForActiveState() {
    if (typeof window.switchPage !== "function") return;
    if (window.__NALU_SWITCHPAGE_WRAPPED__) return;

    const original = window.switchPage;
    window.switchPage = function (pageId, ...rest) {
      const res = original.apply(this, [pageId, ...rest]);
      setActiveNav(pageId);
      closeAllDropdowns();
      return res;
    };

    window.__NALU_SWITCHPAGE_WRAPPED__ = true;
  }

  function syncActiveFromCurrentSection() {
    const active = document.querySelector(".page-section.active");
    if (active?.id) setActiveNav(active.id);
  }

  function setActiveNav(pageId) {
    const navLinks = document.getElementById("navLinks");
    if (!navLinks) return;

    navLinks.querySelectorAll(".nav-btn.is-active, .dropdown-item.is-active").forEach((n) => {
      n.classList.remove("is-active");
    });

    navLinks.querySelectorAll("button, a").forEach((node) => {
      const target = getTargetPage(node);
      if (target === pageId) node.classList.add("is-active");
    });
  }

  function getTargetPage(node) {
    const dp = node.getAttribute("data-page");
    if (dp) return dp;
    const oc = node.getAttribute("onclick") || "";
    const m = oc.match(/switchPage\(['"]([^'"]+)['"]\)/);
    return m ? m[1] : null;
  }

  function safeSwitchPage(pageId) {
    if (typeof window.switchPage === "function") window.switchPage(pageId);
    else console.error("❌ switchPage() not found!");
  }

  // ------------------------------------------------------
  // Overlay safety: toasts/alerts should not block navbar
  // ------------------------------------------------------
  function injectNavbarSafetyStyles() {
    if (document.getElementById("navbar-safety-styles")) return;

    const style = document.createElement("style");
    style.id = "navbar-safety-styles";
    style.textContent = `
      .navbar, #navbar { z-index: 10000; pointer-events: auto; }
      .notification-container,
      .notifications,
      .toast-container,
      .toast-wrapper,
      .toasts,
      #notifications { pointer-events: none !important; z-index: 9000 !important; }
      .notification, .toast { pointer-events: auto !important; }
    `;
    document.head.appendChild(style);
  }
})();
