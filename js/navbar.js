// =====================================================
// navbar.js – NaluLF 🌊 "Riding The Ledger Waves"
//
// Navbar shows:
//   [Shield + NaluLF + Slogan] | [Dashboard] [Profile] [Explore ▼] | [XRP Price] [● Mainnet]
//
// Logo → goes to Landing
// =====================================================

(function () {
  'use strict';
  if (window.__NALU_NAVBAR__) return;
  window.__NALU_NAVBAR__ = true;

  const MOBILE_BP   = 520;
  const PRICE_MS    = 30000;
  const STORAGE_KEY = 'nalu_navbar';

  const S = {
    page:    'landing',  // Start on landing page
    network: 'mainnet',
    price:   null,
    change:  null,
  };

  // ─────────────────────────
  // BOOT
  // ─────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    loadState();
    buildParticles();
    initNetwork();
    initPrice();
    initBreadcrumbs();
    initDropdowns();
    buildBottomNav();
    buildSheet();
    checkBreakpoint();
    patchSwitchPage();
    window.addEventListener('resize', debounce(checkBreakpoint, 150));
    console.log('🌊 NaluLF Navbar ready');
  });

  // ─────────────────────────
  // PARTICLES
  // ─────────────────────────
  function buildParticles() {
    const bar = document.getElementById('navbar');
    if (!bar || bar.querySelector('.nav-particles')) return;
    const wrap = document.createElement('div');
    wrap.className = 'nav-particles';
    for (let i = 0; i < 12; i++) {
      const p = document.createElement('div');
      p.className = 'nav-particle';
      p.style.cssText = `left:${(Math.random()*100).toFixed(1)}%;animation-delay:${(Math.random()*10).toFixed(2)}s;animation-duration:${(10+Math.random()*5).toFixed(2)}s`;
      wrap.appendChild(p);
    }
    bar.insertBefore(wrap, bar.firstChild);
  }

  // ─────────────────────────
  // NETWORK SELECTOR
  // ─────────────────────────
  function initNetwork() {
    setNetworkUI(S.network);

    document.querySelectorAll('.network-option').forEach(opt => {
      opt.addEventListener('click', e => {
        e.stopPropagation();
        const net = opt.dataset.network;
        if (net === S.network) { closeAll(); return; }
        S.network = net;
        setNetworkUI(net);
        closeAll();
        save();
        window.dispatchEvent(new CustomEvent('nalu:network', { detail: { network: net } }));
      });
    });
  }

  function setNetworkUI(net) {
    // Main pill dot + name
    const dot  = document.getElementById('networkDot');
    const name = document.getElementById('networkName');
    if (dot)  dot.className   = 'network-dot' + (net !== 'mainnet' ? ` ${net}` : '');
    if (name) name.textContent = cap(net);

    // Dropdown options
    document.querySelectorAll('.network-option').forEach(o => {
      o.classList.toggle('active', o.dataset.network === net);
      const chk = o.querySelector('.network-option-check');
      if (chk) chk.style.display = o.dataset.network === net ? '' : 'none';
    });
  }

  // ─────────────────────────
  // XRP PRICE TICKER
  // ─────────────────────────
  function initPrice() {
    fetchPrice();
    setInterval(fetchPrice, PRICE_MS);
  }

  async function fetchPrice() {
    try {
      const res  = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ripple&vs_currencies=usd&include_24hr_change=true');
      const data = await res.json();
      if (data.ripple) {
        S.price  = data.ripple.usd;
        S.change = data.ripple.usd_24h_change;
        renderPrice();
      }
    } catch (_) {
      if (S.price) renderPrice(); // show cached
    }
  }

  function renderPrice() {
    const p = document.getElementById('xrpPrice');
    const c = document.getElementById('xrpChange');
    if (p) p.textContent = `$${(+S.price).toFixed(2)}`;
    if (c) {
      const up = S.change >= 0;
      c.textContent = `${up ? '+' : ''}${(+S.change).toFixed(2)}%`;
      c.className   = `price-change ${up ? 'up' : 'down'}`;
    }
  }

  // ─────────────────────────
  // BREADCRUMBS
  // ─────────────────────────
  function initBreadcrumbs() {
    renderCrumb(S.page);
    window.addEventListener('nalu:page', e => renderCrumb(e.detail?.page || S.page));
  }

  const PAGE_NAMES = {
    landing:   'Landing',
    dashboard: 'Dashboard',
    inspector: 'Inspector',
    validators:'Validators',
    analytics: 'Analytics',
    explorer:  'Explorer',
    tokens:    'Tokens',
    amm:       'AMM Pools',
    nfts:      'NFTs',
    profile:   'Profile',
    settings:  'Settings',
    about:     'About',
    news:      'News',
    history:   'History'
  };

  function renderCrumb(page) {
    S.page = page;
    const el = document.getElementById('navBreadcrumb');
    if (!el) return;

    // Build trail: Landing is root, everything else branches off it
    let trail;
    if (page === 'landing') {
      trail = [{ id: 'landing', name: 'Landing' }];
    } else {
      trail = [
        { id: 'landing', name: 'Landing' },
        { id: page, name: PAGE_NAMES[page] || cap(page) }
      ];
    }

    el.innerHTML = trail.map((t, i) => {
      const last = i === trail.length - 1;
      return `<span class="breadcrumb-item${last ? ' active' : ''}"
        ${!last ? `onclick="switchPage('${t.id}')" style="cursor:pointer"` : ''}>${t.name}</span>
        ${!last ? '<span class="breadcrumb-separator">›</span>' : ''}`;
    }).join('');
  }

  // ─────────────────────────
  // DROPDOWNS
  // ─────────────────────────
  function initDropdowns() {
    // .dropdown-toggle buttons
    document.querySelectorAll('.dropdown-toggle').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const menu = btn.closest('.nav-dropdown')?.querySelector('.dropdown-menu');
        if (!menu) return;
        const open = menu.classList.contains('show');
        closeAll();
        if (!open) menu.classList.add('show');
      });
    });

    // Close on outside click
    document.addEventListener('click', e => {
      if (!e.target.closest('.nav-dropdown, .nav-network-selector, [data-dropdown-parent]')) {
        closeAll();
      }
    });
  }

  function toggle(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const open = el.classList.contains('show');
    closeAll();
    if (!open) el.classList.add('show');
  }

  function closeAll() {
    document.querySelectorAll('.dropdown-menu, .network-dropdown').forEach(d => d.classList.remove('show'));
  }

  // ─────────────────────────
  // BOTTOM NAV (mobile)
  // ─────────────────────────
  function buildBottomNav() {
    if (document.getElementById('naluBotNav')) return;
    const nav = document.createElement('div');
    nav.id        = 'naluBotNav';
    nav.className = 'bottom-nav';
    nav.innerHTML = `
      <div class="bottom-nav-track">
        <button class="bottom-item" data-page="dashboard">
          <span class="bottom-ico">📊</span>
          <span class="bottom-lbl">Dashboard</span>
        </button>
        <button class="bottom-item" data-page="profile">
          <span class="bottom-ico">👤</span>
          <span class="bottom-lbl">Profile</span>
        </button>
        <button class="bottom-item" data-page="analytics">
          <span class="bottom-ico">📈</span>
          <span class="bottom-lbl">Analytics</span>
        </button>
        <button class="bottom-item" data-page="explorer">
          <span class="bottom-ico">🔍</span>
          <span class="bottom-lbl">Explorer</span>
        </button>
        <button class="bottom-item bottom-menu" id="botMoreBtn">
          <span class="bottom-ico"></span>
          <span class="bottom-lbl">More</span>
        </button>
      </div>`;

    nav.addEventListener('click', e => {
      const btn  = e.target.closest('.bottom-item');
      if (!btn) return;
      if (btn.id === 'botMoreBtn') { openSheet(); return; }
      const page = btn.dataset.page;
      if (page && typeof window.switchPage === 'function') window.switchPage(page);
    });

    document.body.appendChild(nav);
  }

  function checkBreakpoint() {
    const mobile = window.innerWidth <= MOBILE_BP;
    const nav    = document.getElementById('naluBotNav');
    if (nav) {
      nav.classList.toggle('show', mobile);
      document.body.classList.toggle('has-bottom-nav', mobile);
    }
  }

  // ─────────────────────────
  // BOTTOM SHEET (More menu)
  // ─────────────────────────
  function buildSheet() {
    if (document.getElementById('naluSheet')) return;

    // backdrop
    const backdrop = document.createElement('div');
    backdrop.id        = 'naluSheetBackdrop';
    backdrop.className = 'nav-sheet-backdrop';
    backdrop.addEventListener('click', closeSheet);

    // sheet
    const sheet = document.createElement('div');
    sheet.id        = 'naluSheet';
    sheet.className = 'nav-bottom-sheet';
    sheet.innerHTML = `
      <div class="sheet-handle"></div>
      <div class="sheet-head">
        <span class="sheet-title">🌊 Explore</span>
        <button class="sheet-close" onclick="NaluNavbar.closeSheet()">✕</button>
      </div>
      <div class="sheet-body">

        <div class="sheet-group">
          <div class="sheet-group-label">Inspector & Tools</div>
          <button class="sheet-item" onclick="switchPage('inspector');NaluNavbar.closeSheet()">
            <span class="sheet-ico">🔎</span><span class="sheet-lbl">Inspector</span>
          </button>
        </div>

        <div class="sheet-group">
          <div class="sheet-group-label">🌐 Network</div>
          <button class="sheet-item" onclick="switchPage('validators');NaluNavbar.closeSheet()">
            <span class="sheet-ico">🛡️</span><span class="sheet-lbl">Validators</span>
          </button>
          <button class="sheet-item" onclick="switchPage('analytics');NaluNavbar.closeSheet()">
            <span class="sheet-ico">📈</span><span class="sheet-lbl">Analytics</span>
          </button>
          <button class="sheet-item" onclick="switchPage('explorer');NaluNavbar.closeSheet()">
            <span class="sheet-ico">🔍</span><span class="sheet-lbl">Explorer</span>
          </button>
        </div>

        <div class="sheet-group">
          <div class="sheet-group-label">💰 DeFi</div>
          <button class="sheet-item" onclick="switchPage('tokens');NaluNavbar.closeSheet()">
            <span class="sheet-ico">🪙</span><span class="sheet-lbl">Tokens</span>
          </button>
          <button class="sheet-item" onclick="switchPage('amm');NaluNavbar.closeSheet()">
            <span class="sheet-ico">💧</span><span class="sheet-lbl">AMM Pools</span>
          </button>
          <button class="sheet-item" onclick="switchPage('nfts');NaluNavbar.closeSheet()">
            <span class="sheet-ico">🎨</span><span class="sheet-lbl">NFTs</span>
          </button>
        </div>

        <div class="sheet-group">
          <div class="sheet-group-label">📚 Resources</div>
          <button class="sheet-item" onclick="switchPage('news');NaluNavbar.closeSheet()">
            <span class="sheet-ico">📰</span><span class="sheet-lbl">News</span>
          </button>
          <button class="sheet-item" onclick="switchPage('history');NaluNavbar.closeSheet()">
            <span class="sheet-ico">📜</span><span class="sheet-lbl">History</span>
          </button>
          <button class="sheet-item" onclick="switchPage('about');NaluNavbar.closeSheet()">
            <span class="sheet-ico">ℹ️</span><span class="sheet-lbl">About</span>
          </button>
        </div>

        <div class="sheet-group">
          <div class="sheet-group-label">Account</div>
          <button class="sheet-item" onclick="switchPage('settings');NaluNavbar.closeSheet()">
            <span class="sheet-ico">⚙️</span><span class="sheet-lbl">Settings</span>
          </button>
        </div>

      </div>`;

    document.body.appendChild(backdrop);
    document.body.appendChild(sheet);

    // Also wire up hamburger (tablet)
    const hamburger = document.getElementById('hamburger');
    if (hamburger) hamburger.addEventListener('click', openSheet);
  }

  function openSheet() {
    document.getElementById('naluSheetBackdrop')?.classList.add('show');
    document.getElementById('naluSheet')?.classList.add('show');
  }

  function closeSheet() {
    document.getElementById('naluSheetBackdrop')?.classList.remove('show');
    document.getElementById('naluSheet')?.classList.remove('show');
  }

  // ─────────────────────────
  // PATCH switchPage
  // ─────────────────────────
  function patchSwitchPage() {
    const orig = window.switchPage;
    if (typeof orig !== 'function') return;

    window.switchPage = function (page) {
      orig(page);
      S.page = page;
      renderCrumb(page);

      // Highlight top nav buttons
      document.querySelectorAll('.nav-btn').forEach(btn => {
        const oc = btn.getAttribute('onclick') || '';
        btn.classList.toggle('is-active', oc.includes(`'${page}'`));
      });

      // Highlight bottom nav buttons
      document.querySelectorAll('#naluBotNav .bottom-item').forEach(btn =>
        btn.classList.toggle('is-active', btn.dataset.page === page)
      );

      window.dispatchEvent(new CustomEvent('nalu:page', { detail: { page } }));
    };
  }

  // ─────────────────────────
  // STORAGE
  // ─────────────────────────
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ network: S.network })); } catch(_) {}
  }

  function loadState() {
    try {
      const d = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      if (d.network) S.network = d.network;
    } catch(_) {}
  }

  // ─────────────────────────
  // UTILITIES
  // ─────────────────────────
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // ─────────────────────────
  // PUBLIC API
  // ─────────────────────────
  window.NaluNavbar = {
    toggleNetworkSelector: () => toggle('networkDropdown'),
    openSheet,
    closeSheet,
    getState: () => ({ ...S }),
  };

})();