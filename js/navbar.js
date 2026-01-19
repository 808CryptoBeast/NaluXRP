// =======================================================
// navbar.js — NaluXrp 🌊 Navbar V3
// Futuristic • Accessible • Hover + Touch • No Hamburger
// Adds:
// - Proper dropdown open/close (hover, click, focusout, outside click)
// - Keyboard navigation (Enter/Space, Arrows, Esc)
// - Active page highlight (wraps switchPage)
// - Command palette (Ctrl/Cmd+K or /)
// - Connection mini-panel (click status badge)
// - Mid-width layout safety (sets body padding-top)
// - One Account Inspector button (no duplicates)
// - “More” overflow dropdown (mobile-friendly, no hamburger)
// =======================================================

(function () {
  if (window.__NALU_NAVBAR_V3_INITED) return;
  window.__NALU_NAVBAR_V3_INITED = true;

  const SEL = {
    navbar: "#navbar",
    navLinks: "#navLinks",
    statusBadge: ".status-badge",
    statusDot: "#statusDot",
    statusText: "#connectionStatus",
    desktopToggle: "#navbarToggle",
    floatingToggle: "#navbarToggleBtn",
    dropdown: ".nav-dropdown",
    toggle: ".dropdown-toggle",
    menu: ".dropdown-menu",
    item: ".dropdown-item",
  };

  const STATE = {
    openDropdown: null,      // HTMLElement (.nav-dropdown)
    openReason: null,        // 'hover' | 'click' | 'kbd'
    hoverOpenT: null,
    hoverCloseT: null,
    paletteOpen: false,
    connOpen: false,
    activePage: null,
    moreDropdown: null,
    movedToMore: new Set(),  // elements moved into More menu
  };

  const CFG = {
    hoverOpenDelayMs: 90,
    hoverCloseDelayMs: 140,
    moreBreakpointPx: 860,     // below this, move some items to "More"
    compactBreakpointPx: 860,  // labels hidden in CSS already
  };

  document.addEventListener("DOMContentLoaded", () => {
    const navbar = document.querySelector(SEL.navbar);
    if (!navbar) return;

    // 1) Ensure body padding so navbar never blocks top content
    manageBodyPadding(navbar);
    window.addEventListener("resize", () => manageBodyPadding(navbar));

    // 2) Ensure inspector exists once
    ensureInspectorButton();

    // 3) Ensure inspector section exists (so switchPage('inspector') has a target)
    ensurePageSection("inspector");

    // 4) Convert dropdowns to fully JS-controlled + accessible
    setupDropdowns();

    // 5) Close dropdown on outside click + focus change
    setupGlobalDismiss();

    // 6) Fix toggle buttons (hide/show navbar)
    setupNavbarHideToggles();

    // 7) Add command palette
    initCommandPalette();

    // 8) Add connection panel
    initConnectionPanel();

    // 9) Active-page highlight
    wrapSwitchPageForActiveState();
    wireInlineOnclickFallbackActiveState();

    // 10) "More" overflow dropdown (no hamburger)
    ensureMoreDropdown();
    updateOverflowToMore();
    window.addEventListener("resize", debounce(updateOverflowToMore, 120));

    // 11) Make dropdown item clicks close dropdown
    document.querySelectorAll(SEL.item).forEach((el) => {
      el.addEventListener("click", () => closeDropdown(STATE.openDropdown, { restoreFocus: false }));
    });

    // 12) Safety: hamburger is not used — if it exists, hide + disable
    disableHamburgerIfPresent();

    // 13) Keep connection badge synced with xrpl-connection events (if used)
    window.addEventListener("xrpl-connection", () => refreshConnectionPanel());
    window.addEventListener("xrpl-ledger", () => refreshConnectionPanel());

    console.log("✅ Navbar V3 loaded (dropdowns, palette, connection panel, overflow 'More')");
  });

  // -----------------------
  // Utilities
  // -----------------------
  function debounce(fn, ms) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  function isHoverCapable() {
    return window.matchMedia && window.matchMedia("(hover: hover)").matches;
  }

  function isSmallScreen() {
    return window.innerWidth <= CFG.moreBreakpointPx;
  }

  function manageBodyPadding(navbar) {
    const h = navbar.offsetHeight || 78;
    document.documentElement.style.setProperty("--nav-safe-top", `${h}px`);
    document.body.classList.add("nav-padding-managed");
  }

  function disableHamburgerIfPresent() {
    const hb = document.getElementById("hamburger");
    if (!hb) return;
    hb.style.display = "none";
    hb.setAttribute("aria-hidden", "true");
  }

  function ensurePageSection(id) {
    const container = document.querySelector(".container");
    if (!container) return;
    const exists = document.getElementById(id);
    if (exists) return;

    const sec = document.createElement("section");
    sec.id = id;
    sec.className = "page-section";
    container.appendChild(sec);
  }

  // -----------------------
  // Inspector button (no duplicates)
  // -----------------------
  function ensureInspectorButton() {
    // If one already exists anywhere, do nothing
    if (document.querySelector('[data-page="inspector"], [data-nav-page="inspector"]')) return;

    const navLinks = document.querySelector(SEL.navLinks);
    if (!navLinks) return;

    // Create button consistent with your navbar buttons
    const btn = document.createElement("button");
    btn.className = "nav-btn nav-inspector-btn";
    btn.type = "button";
    btn.title = "Account Inspector";
    btn.setAttribute("data-nav-page", "inspector");
    btn.innerHTML = `<span class="nav-icon">🔎</span><span class="nav-label">Inspector</span>`;

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      navigateToPage("inspector");
      closeDropdown(STATE.openDropdown, { restoreFocus: false });
      closeCommandPalette();
      closeConnPanel();
    });

    // Place right after dashboard button if present
    const dashBtn = Array.from(navLinks.querySelectorAll("button.nav-btn")).find((b) =>
      /dashboard/i.test(b.textContent || "")
    );

    if (dashBtn && dashBtn.parentElement === navLinks) {
      dashBtn.insertAdjacentElement("afterend", btn);
    } else {
      navLinks.insertAdjacentElement("afterbegin", btn);
    }
  }

  // -----------------------
  // Navigation helpers + active state
  // -----------------------
  function navigateToPage(pageId) {
    if (!pageId) return;

    // If switchPage exists, use it
    if (typeof window.switchPage === "function") {
      window.switchPage(pageId);
    } else {
      console.error("❌ switchPage() not found");
    }

    setActivePage(pageId);
  }

  function setActivePage(pageId) {
    STATE.activePage = pageId;

    // Mark active among known nav buttons and dropdown items
    const navLinks = document.querySelector(SEL.navLinks);
    if (!navLinks) return;

    navLinks.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("is-active"));

    // Match by data-nav-page, data-page, or fallback text compare
    const direct =
      navLinks.querySelector(`.nav-btn[data-nav-page="${cssEscape(pageId)}"]`) ||
      navLinks.querySelector(`.nav-btn[data-page="${cssEscape(pageId)}"]`);

    if (direct) {
      direct.classList.add("is-active");
      return;
    }

    // Fallback: if button onclick calls switchPage('x'), we can’t reliably parse it,
    // but we can highlight based on label match.
    const match = Array.from(navLinks.querySelectorAll(".nav-btn")).find((b) =>
      (b.textContent || "").toLowerCase().includes(String(pageId).toLowerCase())
    );
    if (match) match.classList.add("is-active");
  }

  function cssEscape(s) {
    return String(s).replace(/"/g, '\\"');
  }

  function wrapSwitchPageForActiveState() {
    if (typeof window.switchPage !== "function") return;
    if (window.switchPage.__naluWrapped) return;

    const original = window.switchPage;
    function wrapped(pageId, ...rest) {
      try {
        const res = original.call(window, pageId, ...rest);
        setActivePage(pageId);
        // Close dropdowns/overlays after page change
        closeDropdown(STATE.openDropdown, { restoreFocus: false });
        closeCommandPalette();
        closeConnPanel();
        return res;
      } catch (e) {
        console.error("switchPage wrapper error:", e);
        throw e;
      }
    }

    wrapped.__naluWrapped = true;
    wrapped.__original = original;
    window.switchPage = wrapped;
  }

  // If user clicks a nav element that still uses inline onclick="switchPage('x')",
  // we still want to close dropdown + set active consistently.
  function wireInlineOnclickFallbackActiveState() {
    const navLinks = document.querySelector(SEL.navLinks);
    if (!navLinks) return;

    navLinks.addEventListener("click", (e) => {
      const t = e.target.closest("button, a");
      if (!t) return;

      // Close any open dropdown after any click inside navbar
      // (but allow dropdown toggles to manage themselves)
      if (!t.classList.contains("dropdown-toggle")) {
        closeDropdown(STATE.openDropdown, { restoreFocus: false });
      }

      // If it has data-nav-page, honor it
      const page = t.getAttribute("data-nav-page") || t.getAttribute("data-page");
      if (page) setActivePage(page);
    });
  }

  // -----------------------
  // Dropdowns: Accessible + hover + touch + keyboard
  // -----------------------
  function setupDropdowns() {
    document.querySelectorAll(SEL.dropdown).forEach((dd, i) => {
      const toggle = dd.querySelector(SEL.toggle);
      const menu = dd.querySelector(SEL.menu);
      if (!toggle || !menu) return;

      // IDs for aria
      const menuId = menu.id || `navMenu_${i}`;
      menu.id = menuId;

      toggle.setAttribute("aria-haspopup", "true");
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-controls", menuId);

      menu.setAttribute("role", "menu");
      menu.setAttribute("tabindex", "-1");

      // Ensure menu items have role + tabindex
      const items = Array.from(menu.querySelectorAll(SEL.item));
      items.forEach((it) => {
        it.setAttribute("role", "menuitem");
        it.setAttribute("tabindex", "-1");
      });

      // Hover open/close (desktop)
      dd.addEventListener("pointerenter", (e) => {
        if (!isHoverCapable()) return;
        if (e.pointerType && e.pointerType !== "mouse") return;

        clearTimeout(STATE.hoverCloseT);
        STATE.hoverOpenT = setTimeout(() => {
          openDropdown(dd, { reason: "hover" });
        }, CFG.hoverOpenDelayMs);
      });

      dd.addEventListener("pointerleave", (e) => {
        if (!isHoverCapable()) return;
        if (e.pointerType && e.pointerType !== "mouse") return;

        clearTimeout(STATE.hoverOpenT);
        STATE.hoverCloseT = setTimeout(() => {
          closeDropdown(dd, { restoreFocus: false });
        }, CFG.hoverCloseDelayMs);
      });

      // Click/tap toggle (mobile + also allowed on desktop)
      toggle.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (dd.classList.contains("is-open")) {
          closeDropdown(dd, { restoreFocus: true });
        } else {
          openDropdown(dd, { reason: "click", focusFirst: false });
        }
      });

      // Keyboard: Enter/Space/ArrowDown opens; Esc closes
      toggle.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (dd.classList.contains("is-open")) closeDropdown(dd, { restoreFocus: true });
          else openDropdown(dd, { reason: "kbd", focusFirst: true });
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          openDropdown(dd, { reason: "kbd", focusFirst: true });
        } else if (e.key === "Escape") {
          e.preventDefault();
          closeDropdown(dd, { restoreFocus: true });
        }
      });

      // Menu keyboard navigation
      menu.addEventListener("keydown", (e) => {
        const itemsNow = Array.from(menu.querySelectorAll(SEL.item));
        const currentIndex = itemsNow.findIndex((x) => x === document.activeElement);

        if (e.key === "Escape") {
          e.preventDefault();
          closeDropdown(dd, { restoreFocus: true });
          return;
        }

        if (e.key === "ArrowDown") {
          e.preventDefault();
          const next = itemsNow[Math.min(itemsNow.length - 1, currentIndex + 1)] || itemsNow[0];
          next && next.focus();
          return;
        }

        if (e.key === "ArrowUp") {
          e.preventDefault();
          const prev = itemsNow[Math.max(0, currentIndex - 1)] || itemsNow[itemsNow.length - 1];
          prev && prev.focus();
          return;
        }

        if (e.key === "Home") {
          e.preventDefault();
          itemsNow[0] && itemsNow[0].focus();
          return;
        }

        if (e.key === "End") {
          e.preventDefault();
          itemsNow[itemsNow.length - 1] && itemsNow[itemsNow.length - 1].focus();
          return;
        }
      });

      // Clicking any menu item closes the dropdown
      menu.addEventListener("click", () => {
        closeDropdown(dd, { restoreFocus: false });
      });
    });
  }

  function openDropdown(dd, { reason = "click", focusFirst = false } = {}) {
    if (!dd) return;

    // Close others
    if (STATE.openDropdown && STATE.openDropdown !== dd) {
      closeDropdown(STATE.openDropdown, { restoreFocus: false });
    }

    dd.classList.add("is-open");
    STATE.openDropdown = dd;
    STATE.openReason = reason;

    const toggle = dd.querySelector(SEL.toggle);
    const menu = dd.querySelector(SEL.menu);

    if (toggle) toggle.setAttribute("aria-expanded", "true");

    // Positioning safety (avoid clipping)
    if (menu) smartPositionMenu(dd, toggle, menu);

    if (focusFirst && menu) {
      const first = menu.querySelector(SEL.item);
      if (first) first.focus();
      else menu.focus();
    }
  }

  function closeDropdown(dd, { restoreFocus = false } = {}) {
    if (!dd) return;

    dd.classList.remove("is-open");

    const toggle = dd.querySelector(SEL.toggle);
    if (toggle) toggle.setAttribute("aria-expanded", "false");

    if (restoreFocus && toggle) toggle.focus();

    if (STATE.openDropdown === dd) {
      STATE.openDropdown = null;
      STATE.openReason = null;
    }
  }

  function smartPositionMenu(dd, toggle, menu) {
    try {
      // Reset first
      menu.style.left = "";
      menu.style.right = "0";
      menu.style.top = "";
      menu.style.bottom = "";
      menu.style.minWidth = "";

      // Ensure visible for measurement
      const wasHidden = menu.style.display === "none";
      // It might still be display:none, but parent has is-open so should show.
      // If not, temporarily show for compute:
      if (getComputedStyle(menu).display === "none") {
        menu.style.display = "flex";
      }

      const rect = menu.getBoundingClientRect();
      const pad = 10;

      // Clamp width on tiny screens
      if (window.innerWidth < 520) {
        menu.style.width = `min(320px, calc(100vw - ${pad * 2}px))`;
      }

      // If right edge clips, align left
      if (rect.right > window.innerWidth - pad) {
        menu.style.right = "auto";
        menu.style.left = "0";
      }

      // If left edge clips, clamp
      const rect2 = menu.getBoundingClientRect();
      if (rect2.left < pad) {
        menu.style.left = `${pad}px`;
        menu.style.right = "auto";
      }

      // If bottom clips, open upward
      const rect3 = menu.getBoundingClientRect();
      if (rect3.bottom > window.innerHeight - pad) {
        menu.style.top = "auto";
        menu.style.bottom = `calc(100% + 10px)`;
      }

      if (wasHidden) menu.style.display = "";
    } catch (_) {
      // Ignore positioning errors
    }
  }

  function setupGlobalDismiss() {
    // Click outside closes dropdown + panels
    document.addEventListener("pointerdown", (e) => {
      const t = e.target;

      // Command palette
      if (STATE.paletteOpen) {
        const cmd = document.getElementById("navCmdBackdrop");
        if (cmd && !t.closest("#navCmd")) closeCommandPalette();
      }

      // Connection panel
      if (STATE.connOpen) {
        const panel = document.getElementById("navConnPanel");
        const badge = document.querySelector(SEL.statusBadge);
        if (panel && badge && !t.closest("#navConnPanel") && !t.closest(SEL.statusBadge)) {
          closeConnPanel();
        }
      }

      // Dropdown
      if (STATE.openDropdown) {
        if (!t.closest(SEL.dropdown)) {
          closeDropdown(STATE.openDropdown, { restoreFocus: false });
        }
      }
    });

    // Focus leaving navbar/dropdown closes dropdown
    document.addEventListener("focusin", (e) => {
      if (!STATE.openDropdown) return;
      const t = e.target;
      if (!t.closest(SEL.dropdown)) {
        closeDropdown(STATE.openDropdown, { restoreFocus: false });
      }
    });

    // Global Esc closes overlays
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (STATE.openDropdown) closeDropdown(STATE.openDropdown, { restoreFocus: true });
        if (STATE.paletteOpen) closeCommandPalette();
        if (STATE.connOpen) closeConnPanel();
      }
    });
  }

  // -----------------------
  // Navbar hide toggles (optional)
  // -----------------------
  function setupNavbarHideToggles() {
    const navbar = document.querySelector(SEL.navbar);
    const btn = document.querySelector(SEL.desktopToggle);
    const floatBtn = document.querySelector(SEL.floatingToggle);
    if (!navbar) return;

    const toggle = () => {
      navbar.classList.toggle("hide");
      // rotate floating arrow
      const icon = floatBtn ? floatBtn.querySelector(".toggle-icon") : null;
      if (icon) {
        const hidden = navbar.classList.contains("hide");
        icon.style.transform = hidden ? "rotate(180deg)" : "rotate(0deg)";
      }
    };

    if (btn) btn.addEventListener("click", (e) => { e.preventDefault(); toggle(); });
    if (floatBtn) floatBtn.addEventListener("click", (e) => { e.preventDefault(); toggle(); });

    // Desktop scroll-hide behavior (gentle)
    let lastY = window.scrollY;
    window.addEventListener("scroll", () => {
      if (isSmallScreen()) return; // keep stable on small screens
      const y = window.scrollY;
      if (y > lastY && y > 120) navbar.classList.add("hide");
      else navbar.classList.remove("hide");
      lastY = y;
    });
  }

  // -----------------------
  // “More” overflow dropdown (no hamburger)
  // -----------------------
  function ensureMoreDropdown() {
    const navLinks = document.querySelector(SEL.navLinks);
    if (!navLinks) return;

    // If already exists, keep it
    let more = navLinks.querySelector(".nav-dropdown.nav-more");
    if (more) {
      STATE.moreDropdown = more;
      return;
    }

    more = document.createElement("div");
    more.className = "nav-dropdown nav-more";

    const btn = document.createElement("button");
    btn.className = "nav-btn dropdown-toggle";
    btn.type = "button";
    btn.innerHTML = `<span class="nav-icon">➕</span><span class="nav-label">More</span>`;

    const menu = document.createElement("div");
    menu.className = "dropdown-menu";
    // Use items inserted dynamically

    more.appendChild(btn);
    more.appendChild(menu);
    navLinks.appendChild(more);
    STATE.moreDropdown = more;

    // Make it behave like other dropdowns
    setupDropdowns();
  }

  function updateOverflowToMore() {
    const navLinks = document.querySelector(SEL.navLinks);
    const more = STATE.moreDropdown;
    if (!navLinks || !more) return;

    const moreMenu = more.querySelector(".dropdown-menu");
    if (!moreMenu) return;

    // Always clear moved set when switching between modes
    const shouldMove = isSmallScreen();

    // Candidate elements to move (keep core items in main row)
    // We DO NOT move: Dashboard, Inspector, Network, DeFi
    const keepMatchers = [
      /dashboard/i,
      /inspector/i,
      /network/i,
      /defi/i,
    ];

    const candidates = Array.from(navLinks.children)
      .filter((el) => el !== more)
      .filter((el) => {
        const txt = (el.textContent || "").trim();
        if (!txt) return false;

        // Keep dropdown wrappers too if matched
        const keep = keepMatchers.some((re) => re.test(txt));
        if (keep) return false;

        return true;
      });

    if (shouldMove) {
      // Move candidates into More menu
      candidates.forEach((el) => {
        if (STATE.movedToMore.has(el)) return;
        const wrap = document.createElement("div");
        wrap.className = "nav-more-wrap";
        wrap.appendChild(el);
        moreMenu.appendChild(wrap);
        STATE.movedToMore.add(el);
      });

      // Show More only if it has contents
      more.style.display = moreMenu.children.length ? "inline-block" : "none";
    } else {
      // Move them back out, before More
      Array.from(moreMenu.querySelectorAll(".nav-more-wrap")).forEach((wrap) => {
        const child = wrap.firstElementChild;
        if (child) {
          navLinks.insertBefore(child, more);
          STATE.movedToMore.delete(child);
        }
        wrap.remove();
      });
      more.style.display = "inline-block";
    }
  }

  // -----------------------
  // Command palette
  // -----------------------
  function initCommandPalette() {
    if (document.getElementById("navCmdBackdrop")) return;

    const backdrop = document.createElement("div");
    backdrop.id = "navCmdBackdrop";
    backdrop.className = "nav-cmd-backdrop";

    backdrop.innerHTML = `
      <div class="nav-cmd" id="navCmd" role="dialog" aria-modal="true" aria-label="Command palette">
        <div class="nav-cmd-top">
          <span>⌘</span>
          <input class="nav-cmd-input" id="navCmdInput" placeholder="Search pages & actions… (Esc to close)" />
        </div>
        <div class="nav-cmd-hint">Tip: use ↑ ↓ then Enter • Ctrl/Cmd+K or / to open</div>
        <div class="nav-cmd-list" id="navCmdList"></div>
      </div>
    `;

    document.body.appendChild(backdrop);

    const input = document.getElementById("navCmdInput");
    const list = document.getElementById("navCmdList");

    const actions = buildCommandActions();

    function render(q = "") {
      const query = q.trim().toLowerCase();
      const filtered = actions.filter((a) => {
        const hay = `${a.label} ${a.keywords || ""}`.toLowerCase();
        return !query || hay.includes(query);
      });

      list.innerHTML = filtered
        .slice(0, 12)
        .map((a, idx) => `
          <button class="nav-cmd-item ${idx === 0 ? "is-selected" : ""}" data-cmd="${a.id}">
            <span>${a.icon || "➡️"} ${a.label}</span>
            <small>${a.hint || ""}</small>
          </button>
        `)
        .join("");

      // Select behavior
      list.querySelectorAll(".nav-cmd-item").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.getAttribute("data-cmd");
          runCommand(id, actions);
        });
      });
    }

    function selectDelta(delta) {
      const items = Array.from(list.querySelectorAll(".nav-cmd-item"));
      if (!items.length) return;
      const idx = Math.max(0, items.findIndex((x) => x.classList.contains("is-selected")));
      items.forEach((x) => x.classList.remove("is-selected"));
      const next = items[(idx + delta + items.length) % items.length];
      next.classList.add("is-selected");
      next.scrollIntoView({ block: "nearest" });
    }

    function runSelected() {
      const selected = list.querySelector(".nav-cmd-item.is-selected");
      if (!selected) return;
      const id = selected.getAttribute("data-cmd");
      runCommand(id, actions);
    }

    input.addEventListener("input", () => render(input.value));

    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) closeCommandPalette();
    });

    document.addEventListener("keydown", (e) => {
      const isMac = /mac/i.test(navigator.platform);
      const k = e.key.toLowerCase();

      // Open
      if (((isMac ? e.metaKey : e.ctrlKey) && k === "k") || (k === "/" && !isTypingInInput(e))) {
        e.preventDefault();
        openCommandPalette();
        render("");
        setTimeout(() => input && input.focus(), 0);
        return;
      }

      if (!STATE.paletteOpen) return;

      // When open:
      if (e.key === "Escape") {
        e.preventDefault();
        closeCommandPalette();
        return;
      }
      if (e.key === "ArrowDown") { e.preventDefault(); selectDelta(1); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); selectDelta(-1); return; }
      if (e.key === "Enter") { e.preventDefault(); runSelected(); return; }
    });

    // Initial render
    render("");
  }

  function isTypingInInput(e) {
    const el = e.target;
    if (!el) return false;
    const tag = (el.tagName || "").toLowerCase();
    return tag === "input" || tag === "textarea" || el.isContentEditable;
  }

  function buildCommandActions() {
    // Pages you actually have in index.html (plus inspector)
    const pages = [
      { id: "dashboard", label: "Dashboard", icon: "📊", hint: "Go to dashboard", keywords: "ledgers stream" },
      { id: "validators", label: "Validators", icon: "🛡️", hint: "Network health", keywords: "unl quorum" },
      { id: "analytics", label: "Analytics", icon: "📈", hint: "Deep signals", keywords: "patterns dominance" },
      { id: "explorer", label: "Explorer", icon: "🔍", hint: "Search ledger/tx", keywords: "transactions" },
      { id: "tokens", label: "Tokens", icon: "🪙", hint: "Token view", keywords: "issuers distribution" },
      { id: "amm", label: "AMM Pools", icon: "💧", hint: "Liquidity pools", keywords: "dex amm" },
      { id: "nfts", label: "NFTs", icon: "🎨", hint: "NFT activity", keywords: "nftoken" },
      { id: "profile", label: "Profile", icon: "👤", hint: "Your profile", keywords: "user" },
      { id: "settings", label: "Settings", icon: "⚙️", hint: "Configure app", keywords: "theme" },
      { id: "news", label: "News", icon: "📰", hint: "XRPL news", keywords: "updates" },
      { id: "history", label: "History", icon: "📜", hint: "XRPL history", keywords: "timeline" },
      { id: "about", label: "About", icon: "ℹ️", hint: "Learn what signals mean", keywords: "glossary heuristics" },
      { id: "inspector", label: "Account Inspector", icon: "🔎", hint: "Inspect accounts", keywords: "tree graph" },
    ];

    const actions = [
      ...pages.map((p) => ({ ...p, type: "page" })),
      {
        id: "reconnect",
        type: "action",
        label: "Reconnect XRPL",
        icon: "♻️",
        hint: "Reconnect websocket",
        keywords: "network connect",
        run: () => (typeof window.reconnectXRPL === "function" ? window.reconnectXRPL() : null),
      },
      {
        id: "toggleNavbar",
        type: "action",
        label: "Toggle Navbar Visibility",
        icon: "☰",
        hint: "Show/hide navbar",
        keywords: "hide show",
        run: () => {
          const navbar = document.querySelector(SEL.navbar);
          if (navbar) navbar.classList.toggle("hide");
        },
      },
      {
        id: "themeCycle",
        type: "action",
        label: "Cycle Theme",
        icon: "🎨",
        hint: "Change theme",
        keywords: "color mode",
        run: () => (typeof window.cycleTheme === "function" ? window.cycleTheme() : null),
      },
    ];

    return actions;
  }

  function runCommand(id, actions) {
    const a = actions.find((x) => x.id === id);
    if (!a) return;

    if (a.type === "page") {
      navigateToPage(a.id);
      closeCommandPalette();
      return;
    }

    if (a.type === "action") {
      try { a.run && a.run(); } catch (_) {}
      closeCommandPalette();
    }
  }

  function openCommandPalette() {
    const backdrop = document.getElementById("navCmdBackdrop");
    const input = document.getElementById("navCmdInput");
    if (!backdrop) return;
    backdrop.classList.add("is-open");
    STATE.paletteOpen = true;
    // close any dropdown / conn panel
    if (STATE.openDropdown) closeDropdown(STATE.openDropdown, { restoreFocus: false });
    closeConnPanel();
    setTimeout(() => input && input.focus(), 0);
  }

  function closeCommandPalette() {
    const backdrop = document.getElementById("navCmdBackdrop");
    if (!backdrop) return;
    backdrop.classList.remove("is-open");
    STATE.paletteOpen = false;
  }

  // -----------------------
  // Connection panel
  // -----------------------
  function initConnectionPanel() {
    if (document.getElementById("navConnPanel")) return;

    const panel = document.createElement("div");
    panel.id = "navConnPanel";
    panel.className = "nav-conn-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "false");
    panel.setAttribute("aria-label", "Connection panel");
    document.body.appendChild(panel);

    const badge = document.querySelector(SEL.statusBadge);
    if (badge) {
      badge.title = "Connection details (click)";
      badge.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleConnPanel();
      });
    }

    refreshConnectionPanel();
  }

  function toggleConnPanel() {
    const panel = document.getElementById("navConnPanel");
    if (!panel) return;
    const open = panel.classList.toggle("is-open");
    STATE.connOpen = open;

    if (open) {
      // close dropdown + palette
      if (STATE.openDropdown) closeDropdown(STATE.openDropdown, { restoreFocus: false });
      closeCommandPalette();
      refreshConnectionPanel();
    }
  }

  function closeConnPanel() {
    const panel = document.getElementById("navConnPanel");
    if (!panel) return;
    panel.classList.remove("is-open");
    STATE.connOpen = false;
  }

  function getConnSnapshot() {
    // Prefer helper if you have it
    if (typeof window.getXRPLState === "function") {
      try { return window.getXRPLState(); } catch (_) {}
    }

    // Fallback to window.XRPL if present
    const X = window.XRPL || {};
    const s = X.state || {};
    return {
      connected: !!X.connected,
      server: X.server?.name || X.server || "—",
      serverUrl: X.server?.url || X.serverUrl || "—",
      network: X.network || "—",
      mode: X.mode || "—",
      modeReason: X.modeReason || "—",
      ledgerIndex: s.ledgerIndex || 0,
      lastUpdate: X.lastLedgerTime || null,
    };
  }

  function refreshConnectionPanel() {
    const panel = document.getElementById("navConnPanel");
    const dot = document.querySelector(SEL.statusDot);
    const text = document.querySelector(SEL.statusText);

    const snap = getConnSnapshot();

    // badge display
    if (dot) dot.classList.toggle("active", !!snap.connected);
    if (text) {
      if (snap.connected) text.textContent = `LIVE • ${snap.network || "XRPL"}`;
      else text.textContent = `Connecting…`;
    }

    if (!panel) return;

    panel.innerHTML = `
      <div class="nav-conn-row">
        <div class="nav-conn-title">🌐 Connection</div>
        <div class="nav-conn-sub">${snap.connected ? "LIVE" : "CONNECTING"}</div>
      </div>

      <div class="nav-conn-kv">
        <div class="kv"><div class="k">Network</div><div class="v">${escapeHtml(snap.network || "—")}</div></div>
        <div class="kv"><div class="k">Server</div><div class="v">${escapeHtml(snap.server || "—")}</div></div>
        <div class="kv"><div class="k">Ledger</div><div class="v">#${Number(snap.ledgerIndex || 0).toLocaleString()}</div></div>
        <div class="kv"><div class="k">Mode</div><div class="v">${escapeHtml(snap.mode || "—")}</div></div>
      </div>

      <div class="nav-conn-actions">
        <button class="nav-pill" type="button" data-conn="reconnect">♻️ Reconnect</button>
        <button class="nav-pill" type="button" data-net="xrpl-mainnet">Mainnet</button>
        <button class="nav-pill" type="button" data-net="xrpl-testnet">Testnet</button>
        <button class="nav-pill" type="button" data-net="xahau-mainnet">Xahau</button>
      </div>
    `;

    panel.querySelector('[data-conn="reconnect"]')?.addEventListener("click", () => {
      if (typeof window.reconnectXRPL === "function") window.reconnectXRPL();
      else if (typeof window.connectXRPL === "function") window.connectXRPL();
    });

    panel.querySelectorAll("[data-net]").forEach((b) => {
      b.addEventListener("click", () => {
        const net = b.getAttribute("data-net");
        if (typeof window.setXRPLNetwork === "function") window.setXRPLNetwork(net);
      });
    });
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
})();
