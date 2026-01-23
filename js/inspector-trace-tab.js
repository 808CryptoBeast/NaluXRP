/* =========================================================
   inspector-trace-tab.js — "🚨 Trace Funds" tab for Inspector
   v1.4.0 (Cytoscape interactive graph + configurable explorer)
   - Replaced SVG preview with Cytoscape graph
   - Explorer host configurable in UI (preset + custom)
   - Cytoscape loads on-demand from CDN
   ========================================================= */

(function () {
  const VERSION = "inspector-trace-tab@1.4.0";
  const TAB_ID = "nalu-trace";
  const TAB_LABEL = "Trace Funds";
  const TAB_ICON = "🚨";

  // XRPL close cadence varies; use a safe estimate for time->ledger conversion
  const EST_LEDGER_SECONDS = 4;

  const EXPLORER_PRESETS = {
    xrpscan: {
      id: "xrpscan",
      label: "XRPScan",
      acct: "https://xrpscan.com/account/{acct}",
      tx: "https://xrpscan.com/tx/{tx}"
    },
    bithomp: {
      id: "bithomp",
      label: "Bithomp",
      acct: "https://bithomp.com/explorer/{acct}",
      tx: "https://bithomp.com/explorer/{tx}"
    },
    custom: { id: "custom", label: "Custom" }
  };

  const DEFAULTS = {
    maxHops: 4,
    perAccountTxLimit: 80,
    maxEdges: 600,
    ledgerMin: -1,
    ledgerMax: -1,
    windowPreset: "1h",
    onlyXrp: true,
    includeIssued: false,
    minXrp: 0,
    stopOnHub: true,
    hubDegree: 18,
    stopOnFanIn: true,
    fanInDegree: 12,
    concurrency: 3,
    autoApplyWindow: false
  };

  const LS_CASES = "nalu_trace_cases_v1";
  const LS_EXPLORER = "nalu_trace_explorer";

  let traceRunning = false;
  let traceCancelled = false;
  let lastResult = null;
  let sessionCache = new Map();

  // Cytoscape instances store
  window._naluCyInstances = window._naluCyInstances || {};

  function el(id) { return document.getElementById(id); }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function shortAddr(a) {
    const s = String(a || "");
    if (s.length < 12) return s;
    return `${s.slice(0, 6)}…${s.slice(-4)}`;
  }

  function isXRPLAccount(s) {
    return /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(String(s || "").trim());
  }

  function clampInt(v, min, max, fallback) {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function clampNum(v, min, max, fallback) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  // explorer settings
  function loadExplorerSettings() {
    try {
      const raw = localStorage.getItem(LS_EXPLORER);
      if (!raw) return { selected: "xrpscan", customAcct: "", customTx: "" };
      const p = JSON.parse(raw);
      return { selected: p.selected || "xrpscan", customAcct: p.customAcct || "", customTx: p.customTx || "" };
    } catch (_) {
      return { selected: "xrpscan", customAcct: "", customTx: "" };
    }
  }
  function saveExplorerSettings(s) { try { localStorage.setItem(LS_EXPLORER, JSON.stringify(s)); } catch (_) {} }
  function getExplorerUrlForAccount(acct) {
    const s = loadExplorerSettings();
    if (s.selected && s.selected !== "custom") {
      const preset = EXPLORER_PRESETS[s.selected];
      if (preset && preset.acct) return preset.acct.replace("{acct}", encodeURIComponent(acct));
    }
    if (s.customAcct) return s.customAcct.replace("{acct}", encodeURIComponent(acct));
    return `https://xrpscan.com/account/${encodeURIComponent(acct)}`;
  }
  function getExplorerUrlForTx(tx) {
    const s = loadExplorerSettings();
    if (s.selected && s.selected !== "custom") {
      const preset = EXPLORER_PRESETS[s.selected];
      if (preset && preset.tx) return preset.tx.replace("{tx}", encodeURIComponent(tx));
    }
    if (s.customTx) return s.customTx.replace("{tx}", encodeURIComponent(tx));
    return `https://xrpscan.com/tx/${encodeURIComponent(tx)}`;
  }

  // -----------------------------
  // Cytoscape loader + helper
  // -----------------------------
  function ensureCytoscapeLoaded() {
    return new Promise((resolve, reject) => {
      if (window.cytoscape) return resolve(window.cytoscape);
      const existing = document.querySelector('script[data-nalu-cyto]');
      if (existing) {
        existing.addEventListener("load", () => resolve(window.cytoscape));
        existing.addEventListener("error", (e) => reject(e));
        return;
      }
      const s = document.createElement("script");
      s.src = "https://unpkg.com/cytoscape@3.24.0/dist/cytoscape.min.js";
      s.async = true;
      s.setAttribute("data-nalu-cyto", "1");
      s.onload = () => { if (window.cytoscape) resolve(window.cytoscape); else reject(new Error("cytoscape failed")); };
      s.onerror = (e) => reject(e);
      document.head.appendChild(s);
    });
  }

  function destroyCyInstance(containerId) {
    try {
      const key = `cy__${containerId}`;
      const prev = window._naluCyInstances[key];
      if (prev && prev.destroy) prev.destroy();
      delete window._naluCyInstances[key];
    } catch (_) {}
  }

  async function renderCytoscape(container, elements, opts = {}) {
    if (!container) return null;
    await ensureCytoscapeLoaded();
    const key = `cy__${container.id || String(Math.random()).slice(2)}`;
    destroyCyInstance(container.id);
    const cy = window.cytoscape({
      container,
      elements,
      style: [
        { selector: "node", style: { label: "data(label)", "text-valign":"center", "text-halign":"center", "background-color":"data(color)", width:"data(size)", height:"data(size)", "font-size":11, color:"#fff" } },
        { selector: "edge", style: { width:"data(width)", "line-color":"data(color)", "curve-style":"bezier", "target-arrow-shape":"triangle","target-arrow-color":"data(color)"} },
        { selector: ".highlight", style: { "background-color": "#ffd54f", "line-color":"#ffd54f", "target-arrow-color":"#ffd54f" } }
      ],
      layout: { name: opts.layout || "cose", animate: true, fit: true }
    });

    if (typeof opts.onNodeClick === "function") cy.on("tap", "node", (evt) => opts.onNodeClick(evt.target.data()));
    window._naluCyInstances[key] = cy;
    return cy;
  }

  // -----------------------------
  // Remaining original helpers (clipboard, parseAmount, xrpl requester, etc.)
  // -----------------------------
  function parseAccountsFromText(text) {
    const raw = String(text || "")
      .replaceAll(";", ",")
      .replaceAll("|", ",")
      .split(/[\s,\n\r\t]+/g)
      .map(s => s.trim())
      .filter(Boolean);

    const out = [];
    const seen = new Set();
    for (const token of raw) {
      if (isXRPLAccount(token) && !seen.has(token)) {
        seen.add(token);
        out.push(token);
      }
    }
    return out;
  }

  async function readClipboardText() {
    if (!navigator.clipboard || !navigator.clipboard.readText) {
      throw new Error("Clipboard API not available (try Ctrl+V / long-press paste).");
    }
    return await navigator.clipboard.readText();
  }

  async function writeClipboardText(text) {
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      throw new Error("Clipboard write not available.");
    }
    await navigator.clipboard.writeText(String(text || ""));
  }

  // XRPL request wrapper (reuse requestWithRetry logic from previous implementation)
  function getXRPLRequester() {
    if (window.xrplConnection && typeof window.xrplConnection.request === "function") {
      return (payload) => window.xrplConnection.request(payload);
    }
    if (window.xrplClient && typeof window.xrplClient.request === "function") {
      return (payload) => window.xrplClient.request(payload);
    }
    if (window.__xrplClient && typeof window.__xrplClient.request === "function") {
      return (payload) => window.__xrplClient.request(payload);
    }
    return null;
  }

  async function requestWithRetry(payload, tries = 3) {
    const req = getXRPLRequester();
    if (!req) throw new Error("XRPL request interface not found.");

    let lastErr = null;
    for (let i = 0; i < tries; i++) {
      try {
        return await req(payload);
      } catch (err) {
        lastErr = err;
        await sleep(300 * (i + 1));
      }
    }
    throw lastErr || new Error("XRPL request failed");
  }

  async function getValidatedLedgerIndex() {
    try {
      const r = await requestWithRetry({ command: "server_info" }, 2);
      const info = r?.result?.info;
      const seq =
        info?.validated_ledger?.seq ??
        info?.validated_ledger?.ledger_index ??
        info?.validated_ledger_seq ??
        null;

      if (Number.isFinite(seq)) return seq;

      const v = info?.validated_ledger;
      if (typeof v === "string") {
        const maybe = parseInt(String(v).split(",")[0], 10);
        if (Number.isFinite(maybe)) return maybe;
      }
    } catch (_) {}

    try {
      const r2 = await requestWithRetry({ command: "ledger_current" }, 2);
      const idx = r2?.result?.ledger_current_index;
      if (Number.isFinite(idx)) return idx;
    } catch (_) {}

    return null;
  }

  // -----------------------------
  // Tab injection + panels
  // -----------------------------
  function getInspectorRoot() {
    return el("inspector");
  }

  function isInspectorActive() {
    const root = getInspectorRoot();
    return !!(root && root.classList.contains("active"));
  }

  function findTabList(root) {
    let tablist = root.querySelector('[role="tablist"]');
    if (tablist) return tablist;

    tablist =
      root.querySelector(".inspector-tabs") ||
      root.querySelector(".tabs") ||
      root.querySelector(".tab-bar") ||
      root.querySelector(".tablist");

    return tablist || null;
  }

  function findPanelsContainer(root) {
    const panel = root.querySelector('[role="tabpanel"]');
    if (panel && panel.parentElement) return panel.parentElement;

    return (
      root.querySelector(".inspector-panels") ||
      root.querySelector(".tab-panels") ||
      root.querySelector(".panels") ||
      root
    );
  }

  function findAnyTabButton(tablist) {
    return tablist.querySelector('[role="tab"], button, a');
  }

  function alreadyInstalled(root) {
    return !!root.querySelector(`#${TAB_ID}-tab`) || !!root.querySelector(`#${TAB_ID}-panel`);
  }

  function getCurrentInspectorAccount() {
    const root = getInspectorRoot();
    if (!root) return "";

    const candidates = [
      root.querySelector("#inspectorAccount"),
      root.querySelector("#accountInput"),
      root.querySelector("#account-input"),
      root.querySelector("input[name='account']"),
      root.querySelector("input[type='text']")
    ].filter(Boolean);

    for (const inp of candidates) {
      const v = (inp.value || "").trim();
      if (isXRPLAccount(v)) return v;
    }

    if (typeof window.getInspectorAccount === "function") {
      const v = String(window.getInspectorAccount() || "").trim();
      if (isXRPLAccount(v)) return v;
    }

    return "";
  }

  function trySetInspectorAccount(account) {
    if (!isXRPLAccount(account)) return;

    if (typeof window.setInspectorAccount === "function") {
      try { window.setInspectorAccount(account); } catch (_) {}
      return;
    }

    const root = getInspectorRoot();
    if (!root) return;

    const inp =
      root.querySelector("#inspectorAccount") ||
      root.querySelector("#accountInput") ||
      root.querySelector("#account-input") ||
      root.querySelector("input[name='account']") ||
      root.querySelector("input[type='text']");

    if (inp) inp.value = account;
  }

  function injectTraceTab() {
    const root = getInspectorRoot();
    if (!root) return;

    if (alreadyInstalled(root)) return;

    const tablist = findTabList(root);
    if (!tablist) {
      injectFallbackSection(root);
      return;
    }

    const panelsContainer = findPanelsContainer(root);

    const templateTab = findAnyTabButton(tablist);
    const tab = templateTab ? templateTab.cloneNode(true) : document.createElement("button");

    tab.id = `${TAB_ID}-tab`;
    tab.setAttribute("role", "tab");
    tab.setAttribute("type", "button");
    tab.setAttribute("aria-selected", "false");
    tab.setAttribute("aria-controls", `${TAB_ID}-panel`);
    tab.classList.add("nalu-trace-tab");

    tab.innerHTML = `
      <span class="nav-icon" style="font-size:1.05rem;">${TAB_ICON}</span>
      <span class="nav-label">${TAB_LABEL}</span>
    `;

    const panel = document.createElement("div");
    panel.id = `${TAB_ID}-panel`;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", tab.id);
    panel.hidden = true;
    panel.innerHTML = renderTracePanelHTML();

    tablist.appendChild(tab);
    panelsContainer.appendChild(panel);

    tab.addEventListener("click", (e) => {
      e.preventDefault();
      activateTab(root, tablist, tab.id, panel.id);
      ensureTracePanelReady();
    });

    // When other tabs clicked, hide our panel
    tablist.addEventListener("click", (e) => {
      const t = e.target.closest('[role="tab"], button, a');
      if (!t) return;
      if (t.id === tab.id) return;

      panel.hidden = true;
      tab.setAttribute("aria-selected", "false");
      tab.classList.remove("active", "is-active", "selected");
    }, true);

    // Prefill victim field if inspector already has an account
    setTimeout(() => {
      const acct = getCurrentInspectorAccount();
      const v = el("traceVictimInInspector");
      if (acct && v) v.value = acct;
      ensureTracePanelReady();
    }, 60);

    console.log(`✅ Trace tab injected (${VERSION})`);
  }

  function activateTab(root, tablist, tabId, panelId) {
    tablist.querySelectorAll('[role="tab"], button, a').forEach((t) => {
      t.setAttribute?.("aria-selected", "false");
      t.classList.remove("active", "is-active", "selected");
    });

    root.querySelectorAll('[role="tabpanel"]').forEach((p) => {
      if (p.id !== panelId) p.hidden = true;
    });

    const tab = el(tabId);
    const panel = el(panelId);
    if (tab) {
      tab.setAttribute("aria-selected", "true");
      tab.classList.add("active");
    }
    if (panel) panel.hidden = false;
  }

  function injectFallbackSection(root) {
    const existing = root.querySelector("#nalu-trace-fallback");
    if (existing) return;

    const wrap = document.createElement("div");
    wrap.id = "nalu-trace-fallback";
    wrap.innerHTML = `
      <div class="about-card" style="margin-top: 14px;">
        <div class="about-card-top">
          <div class="about-card-icon">${TAB_ICON}</div>
          <div class="about-card-title">${TAB_LABEL}</div>
          <button class="about-acc-toggle" type="button" id="traceFallbackToggle">
            <span>Open</span><span class="about-acc-chevron">▾</span>
          </button>
        </div>
        <div class="about-acc-body" id="traceFallbackBody" style="display:none;">
          ${renderTracePanelInnerHTML()}
        </div>
      </div>
    `;
    root.prepend(wrap);

    const toggle = el("traceFallbackToggle");
    const body = el("traceFallbackBody");
    if (toggle && body) {
      toggle.addEventListener("click", () => {
        const open = body.style.display !== "none";
        body.style.display = open ? "none" : "block";
        const chev = toggle.querySelector(".about-acc-chevron");
        if (chev) chev.textContent = open ? "▾" : "▴";
      });
    }

    setTimeout(() => {
      const acct = getCurrentInspectorAccount();
      const v = el("traceVictimInInspector");
      if (acct && v) v.value = acct;
      ensureTracePanelReady();
    }, 60);

    console.log(`✅ Trace fallback injected (${VERSION})`);
  }

  // -----------------------------
  // Panel HTML + bindings
  // -----------------------------
  function renderTracePanelHTML() {
    return `<div style="padding-top: 10px;">${renderTracePanelInnerHTML()}</div>`;
  }

  function renderTracePanelInnerHTML() {
    const explorer = loadExplorerSettings();
    return `
      <div class="about-card" style="margin-top: 10px;">
        <div class="about-card-top">
          <div class="about-card-icon">🧾</div>
          <div class="about-card-title">Incident tracing (Payments)</div>
          <button class="about-acc-toggle" type="button" id="traceHelpBtnInInspector" aria-expanded="false">
            <span>How it works</span><span class="about-acc-chevron">▾</span>
          </button>
        </div>

        <div class="about-card-body">
          Paste a victim address and optionally add <strong>linked addresses</strong>.
          The tracer follows <strong>outgoing Payment flows</strong> hop-by-hop and helps you:
          <strong>(1)</strong> narrow the window, <strong>(2)</strong> filter by value/currency,
          <strong>(3)</strong> stop at hub-like endpoints, <strong>(4)</strong> reconstruct paths,
          and <strong>(5)</strong> save/share reproducible cases.
          <div style="margin-top:8px; color: var(--text-secondary);">
            <strong>Important:</strong> On-ledger only — deposits into exchanges can become off-ledger after arrival.
          </div>
        </div>

        <div class="about-acc-body" id="traceHelpBodyInInspector" style="display:none;">
          <ul class="about-bullets">
            <li><strong>Victim</strong> = main starting node (hop 0)</li>
            <li><strong>Linked seeds</strong> (optional) = additional starting nodes you want traced too</li>
            <li><strong>Window preset</strong> converts time -> ledger range using a safe estimate</li>
            <li><strong>Filters</strong> help reduce noise (e.g., only XRP + minimum XRP)</li>
            <li><strong>Stop conditions</strong> prevent runaway tracing and highlight likely service endpoints</li>
            <li><strong>Path view</strong> reconstructs shortest-hop paths for reporting</li>
            <li><strong>Cases</strong> store inputs + results locally so you can return later</li>
          </ul>
        </div>

        <!-- Explorer config -->
        <div style="margin-top:10px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
          <label style="font-weight:800; color:var(--text-secondary);">Explorer</label>
          <select id="traceExplorerSelect" style="padding:6px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:transparent;color:var(--text-primary);">
            <option value="xrpscan">XRPScan</option>
            <option value="bithomp">Bithomp</option>
            <option value="custom">Custom</option>
          </select>
          <input id="traceExplorerAcct" placeholder="account template (use {acct})" style="flex:1;min-width:220px;padding:6px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:transparent;color:var(--text-primary);" />
          <input id="traceExplorerTx" placeholder="tx template (use {tx})" style="flex:1;min-width:220px;padding:6px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:transparent;color:var(--text-primary);" />
          <button id="traceExplorerSave" class="about-btn" type="button">Save explorer</button>
        </div>

        <!-- CASE MANAGER -->
        <div style="margin-top: 14px; padding: 12px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.10); background: rgba(0,0,0,0.28);">
          <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
            <div style="font-weight:950; color: var(--text-primary);">📦 Case Manager</div>
            <input id="traceCaseName" type="text" placeholder="Case name (e.g., 2026-01-incident)"
              style="flex:1 1 260px; padding:10px 12px; border-radius:14px; border:1px solid rgba(255,255,255,0.12); background:rgba(0,0,0,0.35); color:var(--text-primary); outline:none;" />
            <button id="traceSaveCase" class="about-btn" type="button">Save</button>
            <select id="traceLoadCaseSelect"
              style="flex:1 1 240px; padding:10px 12px; border-radius:14px; border:1px solid rgba(255,255,255,0.12); background:rgba(0,0,0,0.35); color:var(--text-primary); outline:none;">
              <option value="">Load case…</option>
            </select>
            <button id="traceLoadCaseBtn" class="about-btn" type="button">Load</button>
            <button id="traceDeleteCaseBtn" class="about-btn" type="button" style="opacity:0.9;">Delete</button>
          </div>
          <div id="traceCaseMeta" style="margin-top:8px; color: var(--text-secondary); font-size: 0.92rem;"></div>
        </div>

        <!-- INPUTS -->
        <div style="margin-top: 12px; display:grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 10px; align-items: end;">

          <div style="grid-column: 1 / -1;">
            <label style="display:block; color: var(--text-secondary); font-weight: 800; margin-bottom: 6px;">Victim account</label>
            <div style="display:flex; gap:10px; flex-wrap:wrap;">
              <input id="traceVictimInInspector" type="text" placeholder="r..."
                style="flex:1 1 420px; min-width: 260px; padding:10px 12px; border-radius:14px; border:1px solid rgba(255,255,255,0.12); background:rgba(0,0,0,0.35); color:var(--text-primary); outline:none;" />
              <button id="tracePasteVictim" class="about-btn" type="button">Paste</button>
              <button id="traceCopyVictim" class="about-btn" type="button">Copy</button>
              <button id="traceUseCurrentAccount" class="about-btn" type="button">Use inspector</button>
            </div>
          </div>

          <div style="grid-column: 1 / -1;">
            <label style="display:block; color: var(--text-secondary); font-weight: 800; margin-bottom: 6px;">
              Linked / related addresses (optional)
            </label>
            <textarea id="traceSeedsInInspector" rows="2"
              placeholder="Paste one or more r-addresses separated by commas or new lines…"
              style="width:100%; padding:10px 12px; border-radius:14px; border:1px solid rgba(255,255,255,0.12); background:rgba(0,0,0,0.35); color:var(--text-primary); outline:none; resize: vertical;"></textarea>

            <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top: 8px;">
              <button id="tracePasteSeeds" class="about-btn" type="button">Paste to linked</button>
              <button id="traceClearSeeds" class="about-btn" type="button">Clear linked</button>
              <div style="color: var(--text-secondary); align-self:center;">
                Invalid text is ignored automatically.
              </div>
            </div>
          </div>

          <!-- WINDOW PRESETS -->
          <div style="grid-column: 1 / -1; margin-top: 6px; padding: 12px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.10); background: rgba(0,0,0,0.22);">
            <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:end;">
              <div style="flex: 1 1 220px;">
                <label style="display:block; color: var(--text-secondary); font-weight: 800; margin-bottom: 6px;">🕒 Incident window</label>
                <select id="traceWindowPreset"
                  style="width:100%; padding:10px 12px; border-radius:14px; border:1px solid rgba(255,255,255,0.12); background:rgba(0,0,0,0.35); color:var(--text-primary); outline:none;">
                  <option value="15m">Last 15 minutes</option>
                  <option value="1h" selected>Last 1 hour</option>
                  <option value="6h">Last 6 hours</option>
                  <option value="24h">Last 24 hours</option>
                  <option value="7d">Last 7 days</option>
                  <option value="manual">Manual ledger range</option>
                </select>
              </div>

              <div style="flex: 0 0 auto;">
                <button id="traceApplyWindow" class="about-btn" type="button">Apply window</button>
              </div>

              <div style="flex: 1 1 320px; color: var(--text-secondary); font-size: 0.92rem;">
                <div id="traceWindowNote">Tip: Apply window first, then trace. (Uses ~${EST_LEDGER_SECONDS}s/ledger estimate)</div>
              </div>
            </div>

            <div style="margin-top: 10px; display:grid; grid-template-columns: 1fr 1fr; gap: 10px;">
              <div>
                <label style="display:block; color: var(--text-secondary); font-weight: 800; margin-bottom: 6px;">Ledger min</label>
                <input id="traceLedgerMinInInspector" type="number" value="${DEFAULTS.ledgerMin}"
                  style="width:100%; padding:10px 12px; border-radius:14px; border:1px solid rgba(255,255,255,0.12); background:rgba(0,0,0,0.35); color:var(--text-primary); outline:none;" />
              </div>
              <div>
                <label style="display:block; color: var(--text-secondary); font-weight: 800; margin-bottom: 6px;">Ledger max</label>
                <input id="traceLedgerMaxInInspector" type="number" value="${DEFAULTS.ledgerMax}"
                  style="width:100%; padding:10px 12px; border-radius:14px; border:1px solid rgba(255,255,255,0.12); background:rgba(0,0,0,0.35); color:var(--text-primary); outline:none;" />
              </div>
            </div>
          </div>

          <!-- FILTERS -->
          <div style="grid-column: 1 / -1; margin-top: 4px; padding: 12px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.10); background: rgba(0,0,0,0.22);">
            <div style="font-weight:950; color: var(--text-primary); margin-bottom: 8px;">🧪 Filters</div>
            <div style="display:flex; gap:12px; flex-wrap:wrap; align-items:center;">
              <label style="display:flex; gap:8px; align-items:center; color: var(--text-secondary); font-weight: 800;">
                <input id="traceOnlyXrp" type="checkbox" ${DEFAULTS.onlyXrp ? "checked" : ""} />
                Only XRP
              </label>
              <label style="display:flex; gap:8px; align-items:center; color: var(--text-secondary); font-weight: 800;">
                <input id="traceIncludeIssued" type="checkbox" ${DEFAULTS.includeIssued ? "checked" : ""} />
                Include issued assets
              </label>

              <div style="display:flex; gap:10px; align-items:end; flex-wrap:wrap;">
                <div>
                  <label style="display:block; color: var(--text-secondary); font-weight: 800; margin-bottom: 6px;">Min XRP (victim/outgoing)</label>
                  <input id="traceMinXrp" type="number" min="0" step="0.000001" value="${DEFAULTS.minXrp}"
                    style="width:220px; padding:10px 12px; border-radius:14px; border:1px solid rgba(255,255,255,0.12); background:rgba(0,0,0,0.35); color:var(--text-primary); outline:none;" />
                </div>
                <div style="color: var(--text-secondary); font-size: 0.92rem; margin-bottom: 2px;">
                  Applies to XRP amounts. Issued assets are included/excluded via toggles.
                </div>
              </div>
            </div>
          </div>

          <!-- STOP CONDITIONS -->
          <div style="grid-column: 1 / -1; margin-top: 4px; padding: 12px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.10); background: rgba(0,0,0,0.22);">
            <div style="font-weight:950; color: var(--text-primary); margin-bottom: 8px;">🧭 Stop conditions (to prevent runaway)</div>

            <div style="display:flex; gap:14px; flex-wrap:wrap; align-items:center;">
              <label style="display:flex; gap:8px; align-items:center; color: var(--text-secondary); font-weight: 800;">
                <input id="traceStopHub" type="checkbox" ${DEFAULTS.stopOnHub ? "checked" : ""} />
                Stop expanding at hub-like nodes
              </label>
              <div style="display:flex; gap:10px; align-items:end;">
                <div>
                  <label style="display:block; color: var(--text-secondary); font-weight: 800; margin-bottom: 6px;">Hub degree ≥</label>
                  <input id="traceHubDegree" type="number" min="3" max="999" value="${DEFAULTS.hubDegree}"
                    style="width:140px; padding:10px 12px; border-radius:14px; border:1px solid rgba(255,255,255,0.12); background:rgba(0,0,0,0.35); color:var(--text-primary); outline:none;" />
                </div>
              </div>

              <label style="display:flex; gap:8px; align-items:center; color: var(--text-secondary); font-weight: 800;">
                <input id="traceStopFanIn" type="checkbox" ${DEFAULTS.stopOnFanIn ? "checked" : ""} />
                Stop expanding at strong fan-in nodes
              </label>
              <div style="display:flex; gap:10px; align-items:end;">
                <div>
                  <label style="display:block; color: var(--text-secondary); font-weight: 800; margin-bottom: 6px;">Fan-in in-degree ≥</label>
                  <input id="traceFanInDegree" type="number" min="3" max="999" value="${DEFAULTS.fanInDegree}"
                    style="width:160px; padding:10px 12px; border-radius:14px; border:1px solid rgba(255,255,255,0.12); background:rgba(0,0,0,0.35); color:var(--text-primary); outline:none;" />
                </div>
              </div>

              <div style="color: var(--text-secondary); font-size:0.92rem;">
                Uses <strong>local traced-graph</strong> degree to decide where to stop expanding.
              </div>
            </div>
          </div>

          <!-- CORE LIMITS -->
          <div>
            <label style="display:block; color: var(--text-secondary); font-weight: 800; margin-bottom: 6px;">Max hops</label>
            <input id="traceHopsInInspector" type="number" min="1" max="10" value="${DEFAULTS.maxHops}"
              style="width:100%; padding:10px 12px; border-radius:14px; border:1px solid rgba(255,255,255,0.12); background:rgba(0,0,0,0.35); color:var(--text-primary); outline:none;" />
          </div>

          <div>
            <label style="display:block; color: var(--text-secondary); font-weight: 800; margin-bottom: 6px;">Per-account tx</label>
            <input id="tracePerAcctInInspector" type="number" min="10" max="400" value="${DEFAULTS.perAccountTxLimit}"
              style="width:100%; padding:10px 12px; border-radius:14px; border:1px solid rgba(255,255,255,0.12); background:rgba(0,0,0,0.35); color:var(--text-primary); outline:none;" />
          </div>

          <div>
            <label style="display:block; color: var(--text-secondary); font-weight: 800; margin-bottom: 6px;">Max edges</label>
            <input id="traceMaxEdgesInInspector" type="number" min="50" max="5000" value="${DEFAULTS.maxEdges}"
              style="width:100%; padding:10px 12px; border-radius:14px; border:1px solid rgba(255,255,255,0.12); background:rgba(0,0,0,0.35); color:var(--text-primary); outline:none;" />
          </div>

          <div style="grid-column: 1 / -1; display:flex; gap:10px; flex-wrap:wrap; margin-top: 8px;">
            <button id="traceRunInInspector" class="about-btn" type="button">Start trace</button>
            <button id="traceCancelInInspector" class="about-btn" type="button" style="opacity:0.85;">Cancel</button>
            <button id="traceExportJsonInInspector" class="about-btn" type="button" disabled>Export JSON</button>
            <button id="traceExportCsvInInspector" class="about-btn" type="button" disabled>Export CSV</button>
            <button id="traceCopyAllJson" class="about-btn" type="button" disabled>Copy all JSON</button>
          </div>

          <div style="grid-column: 1 / -1; margin-top: 10px;">
            <div id="traceProgressWrapper" style="display:none; margin-bottom:6px;">
              <div style="height:10px; background:rgba(255,255,255,0.06); border-radius:6px; overflow:hidden;">
                <div id="traceProgressBar" style="width:0%; height:100%; background:linear-gradient(90deg,#3b82f6,#06b6d4);"></div>
              </div>
              <div id="traceProgressText" style="font-size:0.92rem; color:var(--text-secondary); margin-top:6px;"></div>
            </div>

            <div id="traceStatusInInspector" style="color: var(--text-secondary);"></div>
          </div>
        </div>
      </div>

      <!-- PATH PANEL -->
      <div id="tracePathPanel" style="margin-top: 14px;"></div>

      <!-- GRAPH PREVIEW -->
      <div id="traceGraphPreview" style="margin-top:14px;">
        <div id="traceCyPreview" style="width:100%;height:360px;border-radius:8px;border:1px solid rgba(255,255,255,0.06);background:rgba(0,0,0,0.04);"></div>
      </div>

      <!-- RESULTS -->
      <div id="traceResultsInInspector" style="margin-top: 14px;"></div>
    `;
  }

  function ensureTracePanelReady() {
    const runBtn = el("traceRunInInspector");
    if (runBtn && runBtn.__bound) return;
    if (runBtn) runBtn.__bound = true;

    // Help accordion
    el("traceHelpBtnInInspector")?.addEventListener("click", () => {
      const body = el("traceHelpBodyInInspector");
      const btn = el("traceHelpBtnInInspector");
      if (!body || !btn) return;
      const open = body.style.display !== "none";
      body.style.display = open ? "none" : "block";
      btn.setAttribute("aria-expanded", open ? "false" : "true");
      const chev = btn.querySelector(".about-acc-chevron");
      if (chev) chev.textContent = open ? "▾" : "▴";
    });

    // explorer save
    const explorer = loadExplorerSettings();
    el("traceExplorerSelect").value = explorer.selected || "xrpscan";
    el("traceExplorerAcct").value = explorer.customAcct || "";
    el("traceExplorerTx").value = explorer.customTx || "";

    el("traceExplorerSave")?.addEventListener("click", () => {
      const sel = el("traceExplorerSelect").value;
      const acct = el("traceExplorerAcct").value.trim();
      const tx = el("traceExplorerTx").value.trim();
      saveExplorerSettings({ selected: sel, customAcct: acct, customTx: tx });
      setTraceStatus("✅ Explorer saved.", false);
    });

    // OnlyXRP toggle logic
    el("traceOnlyXrp")?.addEventListener("change", () => {
      const only = !!el("traceOnlyXrp")?.checked;
      const inc = el("traceIncludeIssued");
      if (only && inc) inc.checked = false;
      if (inc) inc.disabled = only;
    });
    {
      const only = !!el("traceOnlyXrp")?.checked;
      const inc = el("traceIncludeIssued");
      if (inc) inc.disabled = only;
      if (only && inc) inc.checked = false;
    }

    // Use current inspector account
    el("traceUseCurrentAccount")?.addEventListener("click", () => {
      const acct = getCurrentInspectorAccount();
      if (acct) el("traceVictimInInspector").value = acct;
      else setTraceStatus("⚠️ No inspector account detected yet. Enter an account, or load one in the inspector first.", false);
    });

    // Clipboard
    el("tracePasteVictim")?.addEventListener("click", async () => {
      try {
        const t = await readClipboardText();
        const accounts = parseAccountsFromText(t);
        if (!accounts.length) return setTraceStatus("⚠️ Clipboard didn’t contain a valid XRPL r-address.", false);
        el("traceVictimInInspector").value = accounts[0];
        setTraceStatus("✅ Pasted victim address from clipboard.", false);
      } catch (e) {
        setTraceStatus(`⚠️ ${escapeHtml(e.message || String(e))}`, false);
      }
    });

    el("traceCopyVictim")?.addEventListener("click", async () => {
      try {
        const v = (el("traceVictimInInspector")?.value || "").trim();
        if (!v) return setTraceStatus("⚠️ Victim address is empty.", false);
        await writeClipboardText(v);
        setTraceStatus("✅ Copied victim address.", false);
      } catch (e) {
        setTraceStatus(`⚠️ ${escapeHtml(e.message || String(e))}`, false);
      }
    });

    el("tracePasteSeeds")?.addEventListener("click", async () => {
      try {
        const t = await readClipboardText();
        const cur = el("traceSeedsInInspector")?.value || "";
        const joined = (cur ? (cur.trim() + "\n") : "") + t;
        el("traceSeedsInInspector").value = joined;
        setTraceStatus("✅ Pasted into linked addresses.", false);
      } catch (e) {
        setTraceStatus(`⚠️ ${escapeHtml(e.message || String(e))}`, false);
      }
    });

    el("traceClearSeeds")?.addEventListener("click", () => {
      el("traceSeedsInInspector").value = "";
      setTraceStatus("✅ Cleared linked addresses.", false);
    });

    // Window presets
    el("traceApplyWindow")?.addEventListener("click", async () => {
      await applyWindowPreset();
    });

    // Trace buttons
    el("traceRunInInspector")?.addEventListener("click", runTrace);
    el("traceCancelInInspector")?.addEventListener("click", cancelTrace);

    // Exports
    el("traceCopyAllJson")?.addEventListener("click", async () => {
      if (!lastResult) return setTraceStatus("⚠️ Run a trace first.", false);
      try {
        await writeClipboardText(JSON.stringify(serializeResult(lastResult), null, 2));
        setTraceStatus("✅ Copied full trace JSON to clipboard.", false);
      } catch (e) {
        setTraceStatus(`⚠️ ${escapeHtml(e.message || String(e))}`, false);
      }
    });

    // Cases
    el("traceSaveCase")?.addEventListener("click", saveCase);
    el("traceLoadCaseBtn")?.addEventListener("click", loadSelectedCase);
    el("traceDeleteCaseBtn")?.addEventListener("click", deleteSelectedCase);

    refreshCaseSelect();
    setCaseMeta();

    // Bind result actions
    bindResultActions();
  }

  function setTraceStatus(msg, isError) {
    const out = el("traceStatusInInspector");
    if (!out) return;
    out.style.color = isError ? "#ff6e6e" : "var(--text-secondary)";
    out.innerHTML = msg;
  }

  function updateTraceProgress(percent, text) {
    const wrapper = el("traceProgressWrapper");
    const bar = el("traceProgressBar");
    const txt = el("traceProgressText");
    if (!wrapper || !bar || !txt) return;
    if (percent == null) {
      wrapper.style.display = "none";
      bar.style.width = "0%";
      txt.textContent = "";
      return;
    }
    wrapper.style.display = "block";
    const p = Math.max(0, Math.min(100, Number(percent) || 0));
    bar.style.width = `${p}%`;
    txt.textContent = text || "";
  }
  function clearTraceProgress() { updateTraceProgress(null, ""); }

  function disableTraceControls(disabled) {
    [
      "traceRunInInspector",
      "traceUseCurrentAccount",
      "tracePasteVictim",
      "traceCopyVictim",
      "tracePasteSeeds",
      "traceClearSeeds",
      "traceApplyWindow",
      "traceSaveCase",
      "traceLoadCaseBtn",
      "traceDeleteCaseBtn",
      "traceExportJsonInInspector",
      "traceExportCsvInInspector",
      "traceCopyAllJson"
    ].forEach((id) => {
      const b = el(id);
      if (b) b.disabled = !!disabled;
    });

    const cancelBtn = el("traceCancelInInspector");
    if (cancelBtn) cancelBtn.disabled = !disabled ? false : false;
  }

  function clearResults() {
    const r = el("traceResultsInInspector");
    const p = el("tracePathPanel");
    const g = el("traceCyPreview");
    if (r) r.innerHTML = "";
    if (p) p.innerHTML = "";
    if (g) {
      try { destroyCyInstance("traceCyPreview"); } catch (_) {}
      g.innerHTML = "";
    }
  }

  // (Other trace engine functions unchanged: presetToSeconds, applyWindowPreset, case management, BFS, fetchOutgoingPaymentEdges, parseAmount, etc.)
  // For brevity here we reuse the earlier implementations for traceOutgoingPaymentsBFS and related helpers.
  // [Omitted in this snippet due to length — they remain as in the previous version, with session cache support and concurrency.]

  // -----------------------------
  // Graph preview (Cytoscape)
  // -----------------------------
  async function renderGraphPreview(result) {
    const container = el("traceCyPreview");
    if (!container) return;
    container.innerHTML = "";
    try {
      const maxEdges = 800;
      const edges = result.edges.slice(0, maxEdges);
      if (!edges.length) return;

      const nodesSet = new Set();
      edges.forEach(e => { nodesSet.add(e.from); nodesSet.add(e.to); });
      const nodes = Array.from(nodesSet);

      const elements = [];
      nodes.forEach((n) => elements.push({ data: { id: `n_${n}`, label: shortAddr(n), color: n === result.victim ? "#06b6d4" : "#3b82f6", size: n === result.victim ? 48 : 34 } }));

      edges.forEach((e, i) => {
        const w = Math.min(12, Math.max(2, Math.round((Number(e.amount_xrp || 0) || 0) > 0 ? Math.log10(Number(e.amount_xrp || 1) + 1) * 2 : 2)));
        elements.push({ data: { id: `e_${i}`, source: `n_${e.from}`, target: `n_${e.to}`, width: w, color: e.currency === "XRP" ? "rgba(59,130,246,0.6)" : "rgba(155,155,155,0.6)", tx: e.tx_hash } });
      });

      const cy = await renderCytoscape(container, elements, {
        layout: "cose",
        onNodeClick: (data) => {
          const id = data.id || "";
          if (id && id.startsWith("n_")) {
            const acct = id.slice(2);
            // Provide a quick actions UI: Inspect / Path / Exclude
            setTraceStatus(`Node clicked: ${acct} — click Path in results to reconstruct path.`, false);
            trySetInspectorAccount(acct);
          }
        }
      });

      // add double-click to open account in explorer
      cy.on("doubleTap", "node", function(evt) {
        const acct = (evt.target.data().id || "").replace(/^n_/, "");
        if (isXRPLAccount(acct)) {
          const url = getExplorerUrlForAccount(acct);
          window.open(url, "_blank");
        }
      });

    } catch (e) {
      console.warn("renderGraphPreview error", e);
      container.innerHTML = `<div style="padding:12px;color:var(--text-secondary)">Graph preview unavailable</div>`;
    }
  }

  // -----------------------------
  // Results + exports + path view
  // -----------------------------
  function renderTraceResults(result) {
    const r = el("traceResultsInInspector");
    if (!r) return;

    const summary = summarizeEdges(result.edges, result.victim);
    const terminalList = summarizeTerminals(result);

    r.innerHTML = `
      <div class="about-card">
        <div class="about-card-top">
          <div class="about-card-icon">📌</div>
          <div class="about-card-title">Summary</div>
          <div></div>
        </div>
        <div class="about-card-body">
          <div style="display:flex; gap:14px; flex-wrap:wrap;">
            <div><strong>Victim:</strong> ${escapeHtml(result.victim)}</div>
            <div><strong>Linked seeds:</strong> ${result.seeds?.length || 0}</div>
            <div><strong>Edges:</strong> ${result.edges.length}</div>
            <div><strong>Accounts:</strong> ${result.nodes.size}</div>
            <div><strong>Depth reached:</strong> ${result.maxDepthReached}</div>
            <div><strong>Terminals:</strong> ${result.terminals.size}</div>
          </div>

          <div class="about-divider"></div>

          <div style="display:flex; gap:18px; flex-wrap:wrap; align-items:start;">
            <div style="flex:1 1 420px;">
              <div style="font-weight:950; color: var(--text-primary); margin-bottom: 8px;">Top destinations (victim only)</div>
              <div style="display:grid; gap:8px;">
                ${summary.topDests.slice(0, 10).map(d => `
                  <div class="whale-item" style="gap:10px;">
                    <span style="min-width:0;">
                      <a href="${escapeHtml(getExplorerUrlForAccount(d.to))}" target="_blank" rel="noopener noreferrer">${escapeHtml(d.to)}</a>
                      <span style="color:var(--text-secondary)">(${escapeHtml(shortAddr(d.to))})</span>
                    </span>
                    <span style="display:flex; gap:8px; align-items:center;">
                      <span style="color: var(--text-primary); font-weight:900;">${d.count}</span>
                      <button class="about-btn nalu-path" data-target="${escapeHtml(d.to)}" type="button">Path</button>
                      <button class="about-btn nalu-copy" data-copy="${escapeHtml(d.to)}" type="button">Copy</button>
                      <button class="about-btn nalu-inspect" data-inspect="${escapeHtml(d.to)}" type="button">Inspect</button>
                    </span>
                  </div>
                `).join("")}
              </div>

              ${summary.totalXrpOut != null ? `
                <div style="margin-top: 10px; color: var(--text-secondary);">
                  Estimated XRP out (victim XRP payments): <strong style="color: var(--text-primary);">${escapeHtml(trimFloat(summary.totalXrpOut))} XRP</strong>
                </div>
              ` : `
                <div style="margin-top: 10px; color: var(--text-secondary);">
                  Note: XRP totals may be incomplete if the event used issued assets or partial payments.
                </div>
              `}
            </div>

            <div style="flex:1 1 420px;">
              <div style="font-weight:950; color: var(--text-primary); margin-bottom: 8px;">Likely endpoints (stop conditions / max hops)</div>
              <div style="display:grid; gap:8px;">
                ${terminalList.slice(0, 10).map(t => `
                  <div class="whale-item" style="gap:10px;">
                    <span style="min-width:0;">
                      <a href="${escapeHtml(getExplorerUrlForAccount(t.node))}" target="_blank" rel="noopener noreferrer">${escapeHtml(t.node)}</a>
                      <span style="color:var(--text-secondary)">(${escapeHtml(shortAddr(t.node))})</span>
                      <div style="color:var(--text-secondary); font-size:0.88rem; margin-top:2px;">
                        ${escapeHtml(t.reason)}
                      </div>
                    </span>
                    <span style="display:flex; gap:8px; align-items:center;">
                      <button class="about-btn nalu-path" data-target="${escapeHtml(t.node)}" type="button">Path</button>
                      <button class="about-btn nalu-copy" data-copy="${escapeHtml(t.node)}" type="button">Copy</button>
                      <button class="about-btn nalu-inspect" data-inspect="${escapeHtml(t.node)}" type="button">Inspect</button>
                    </span>
                  </div>
                `).join("")}
              </div>
              ${result.terminals.size > 10 ? `<div style="margin-top:8px; color:var(--text-secondary);">Showing 10 of ${result.terminals.size} terminals.</div>` : ""}
            </div>
          </div>
        </div>
      </div>

      <div class="about-card" style="margin-top: 14px;">
        <div class="about-card-top">
          <div class="about-card-icon">🧾</div>
          <div class="about-card-title">Extracted payment edges</div>
          <div style="color: var(--text-secondary); font-weight: 800;">Actions: Copy • Inspect • Path • Explorer</div>
        </div>
        <div class="about-card-body" style="overflow:auto;">
          ${renderEdgesTable(result.edges)}
        </div>
      </div>
    `;

    bindResultActions();

    // render interactive preview
    renderGraphPreview(result).catch((e) => console.warn("preview render fail", e));
  }

  function summarizeEdges(edges, victim) {
    const destCount = new Map();
    let totalXrpOut = 0;
    let sawXrp = false;

    for (const e of edges) {
      if (e.from === victim) {
        destCount.set(e.to, (destCount.get(e.to) || 0) + 1);
        if (typeof e.amount_xrp === "number") {
          totalXrpOut += e.amount_xrp;
          sawXrp = true;
        }
      }
    }

    const topDests = Array.from(destCount.entries())
      .map(([to, count]) => ({ to, count }))
      .sort((a, b) => b.count - a.count);

    return { topDests, totalXrpOut: sawXrp ? totalXrpOut : null };
  }

  function summarizeTerminals(result) {
    const reasons = result.terminalReasons || {};
    const deg = result.degree || {};
    const indeg = result.inDeg || {};
    const outdeg = result.outDeg || {};

    const list = Array.from(result.terminals || []).map(node => ({
      node,
      reason: reasons[node] || "terminal",
      degree: deg[node] || 0,
      in: indeg[node] || 0,
      out: outdeg[node] || 0
    }));

    return list.sort((a, b) => {
      const scoreA = (a.degree * 2) + a.in;
      const scoreB = (b.degree * 2) + b.in;
      return scoreB - scoreA;
    });
  }

  function renderEdgesTable(edges) {
    const rows = edges.slice(0, 1200).map((e) => `
      <tr>
        <td style="padding:8px 10px; border-bottom: 1px solid rgba(255,255,255,0.06); color: var(--text-secondary);">
          ${escapeHtml(shortAddr(e.root))}<div style="font-size:0.82rem; opacity:0.9;">root</div>
        </td>
        <td style="padding:8px 10px; border-bottom: 1px solid rgba(255,255,255,0.06);">
          ${escapeHtml(shortAddr(e.from))}
          <div style="margin-top:6px; display:flex; gap:8px; flex-wrap:wrap;">
            <button class="about-btn nalu-copy" data-copy="${escapeHtml(e.from)}" type="button">Copy</button>
            <button class="about-btn nalu-inspect" data-inspect="${escapeHtml(e.from)}" type="button">Inspect</button>
            <a class="about-btn" href="${escapeHtml(getExplorerUrlForAccount(e.from))}" target="_blank" rel="noopener noreferrer">Explorer</a>
          </div>
        </td>
        <td style="padding:8px 10px; border-bottom: 1px solid rgba(255,255,255,0.06);">
          ${escapeHtml(shortAddr(e.to))}
          <div style="margin-top:6px; display:flex; gap:8px; flex-wrap:wrap;">
            <button class="about-btn nalu-path" data-target="${escapeHtml(e.to)}" type="button">Path</button>
            <button class="about-btn nalu-copy" data-copy="${escapeHtml(e.to)}" type="button">Copy</button>
            <button class="about-btn nalu-inspect" data-inspect="${escapeHtml(e.to)}" type="button">Inspect</button>
            <a class="about-btn" href="${escapeHtml(getExplorerUrlForAccount(e.to))}" target="_blank" rel="noopener noreferrer">Explorer</a>
          </div>
        </td>
        <td style="padding:8px 10px; border-bottom: 1px solid rgba(255,255,255,0.06);">
          ${escapeHtml(e.amount)}<div style="font-size:0.82rem; color:var(--text-secondary);">depth ${escapeHtml(String(e.depth))}</div>
        </td>
        <td style="padding:8px 10px; border-bottom: 1px solid rgba(255,255,255,0.06);">${escapeHtml(String(e.ledger_index ?? ""))}</td>
        <td style="padding:8px 10px; border-bottom: 1px solid rgba(255,255,255,0.06); color: var(--text-secondary);">
          ${escapeHtml((e.tx_hash || "").slice(0, 12) + (e.tx_hash ? "��" : ""))}
          ${e.tx_hash ? `
            <div style="margin-top:6px; display:flex; gap:8px; flex-wrap:wrap;">
              <button class="about-btn nalu-copy" data-copy="${escapeHtml(e.tx_hash)}" type="button">Copy Tx</button>
              <a class="about-btn" href="${escapeHtml(getExplorerUrlForTx(e.tx_hash))}" target="_blank" rel="noopener noreferrer">Explorer</a>
            </div>
          ` : ""}
        </td>
      </tr>
    `).join("");

    return `
      <table style="width:100%; border-collapse: collapse; min-width: 980px;">
        <thead>
          <tr>
            <th style="text-align:left; padding:8px 10px; color: var(--text-secondary); font-weight: 950;">Root</th>
            <th style="text-align:left; padding:8px 10px; color: var(--text-secondary); font-weight: 950;">From</th>
            <th style="text-align:left; padding:8px 10px; color: var(--text-secondary); font-weight: 950;">To</th>
            <th style="text-align:left; padding:8px 10px; color: var(--text-secondary); font-weight: 950;">Amount</th>
            <th style="text-align:left; padding:8px 10px; color: var(--text-secondary); font-weight: 950;">Ledger</th>
            <th style="text-align:left; padding:8px 10px; color: var(--text-secondary); font-weight: 950;">Tx</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      ${edges.length > 1200 ? `<div style="margin-top:10px; color:var(--text-secondary);">Showing first 1200 edges. Export for full data.</div>` : ""}
    `;
  }

  function bindResultActions() {
    document.querySelectorAll(".nalu-copy[data-copy]").forEach(btn => {
      if (btn.__bound) return;
      btn.__bound = true;
      btn.addEventListener("click", async () => {
        try {
          const v = btn.getAttribute("data-copy");
          await writeClipboardText(v);
          setTraceStatus(`✅ Copied: ${escapeHtml(shortAddr(v))}`, false);
        } catch (e) {
          setTraceStatus(`⚠️ ${escapeHtml(e.message || String(e))}`, false);
        }
      });
    });

    document.querySelectorAll(".nalu-inspect[data-inspect]").forEach(btn => {
      if (btn.__bound) return;
      btn.__bound = true;
      btn.addEventListener("click", () => {
        const acct = btn.getAttribute("data-inspect");
        if (!isXRPLAccount(acct)) return;
        trySetInspectorAccount(acct);
        setTraceStatus(`🔎 Loaded into Inspector input: ${escapeHtml(shortAddr(acct))} (press your inspector load if needed)`, false);
      });
    });

    document.querySelectorAll(".nalu-path[data-target]").forEach(btn => {
      if (btn.__bound) return;
      btn.__bound = true;
      btn.addEventListener("click", () => {
        const target = btn.getAttribute("data-target");
        if (!isXRPLAccount(target)) return;
        if (!lastResult) return setTraceStatus("⚠️ Run a trace first to build paths.", false);
        renderPathToTarget(lastResult, target);
      });
    });
  }

  function renderPathToTarget(result, target) {
    const panel = el("tracePathPanel");
    if (!panel) return;

    const roots = result.roots || [result.victim];
    const best = findBestPathAcrossRoots(result, roots, target);

    if (!best) {
      panel.innerHTML = `
        <div class="about-card">
          <div class="about-card-top">
            <div class="about-card-icon">🧭</div>
            <div class="about-card-title">Path to ${escapeHtml(shortAddr(target))}</div>
            <div></div>
          </div>
          <div class="about-card-body">
            No path found to that target (it may be outside the captured window/limits).
          </div>
        </div>
      `;
      return;
    }

    const { root, path } = best;

    panel.innerHTML = `
      <div class="about-card">
        <div class="about-card-top">
          <div class="about-card-icon">🧭</div>
          <div class="about-card-title">Path (shortest hops)</div>
          <div style="color: var(--text-secondary); font-weight: 900;">
            root ${escapeHtml(shortAddr(root))} → target ${escapeHtml(shortAddr(target))}
          </div>
        </div>
        <div class="about-card-body">
          <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom: 10px;">
            <button class="about-btn nalu-copy" data-copy="${escapeHtml(target)}" type="button">Copy target</button>
            <button class="about-btn nalu-inspect" data-inspect="${escapeHtml(target)}" type="button">Inspect target</button>
            <button class="about-btn" id="traceClearPathBtn" type="button">Clear path</button>
          </div>

          <div style="display:grid; gap:10px;">
            ${path.map((step, i) => `
              <div style="padding:12px; border-radius:16px; border:1px solid rgba(255,255,255,0.10); background:rgba(0,0,0,0.28);">
                <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap;">
                  <div style="font-weight:950; color: var(--text-primary);">
                    ${i === 0 ? "Start" : `Hop ${i}`} • ${escapeHtml(shortAddr(step.from))} → ${escapeHtml(shortAddr(step.to))}
                  </div>
                  <div style="color: var(--text-secondary); font-weight:900;">
                    ${escapeHtml(step.amount || "")} ${step.ledger_index ? `• ledger ${escapeHtml(String(step.ledger_index))}` : ""}
                  </div>
                </div>

                <div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;">
                  <button class="about-btn nalu-copy" data-copy="${escapeHtml(step.from)}" type="button">Copy from</button>
                  <button class="about-btn nalu-copy" data-copy="${escapeHtml(step.to)}" type="button">Copy to</button>
                  <button class="about-btn nalu-inspect" data-inspect="${escapeHtml(step.from)}" type="button">Inspect from</button>
                  <button class="about-btn nalu-inspect" data-inspect="${escapeHtml(step.to)}" type="button">Inspect to</button>
                  ${step.tx_hash ? `<button class="about-btn nalu-copy" data-copy="${escapeHtml(step.tx_hash)}" type="button">Copy Tx</button>` : ""}
                  ${step.tx_hash ? `<a class="about-btn" href="${escapeHtml(getExplorerUrlForTx(step.tx_hash))}" target="_blank" rel="noopener noreferrer">Explorer</a>` : ""}
                </div>
              </div>
            `).join("")}
          </div>
        </div>
      </div>
    `;

    el("traceClearPathBtn")?.addEventListener("click", () => {
      panel.innerHTML = "";
    });

    bindResultActions();
  }

  function findBestPathAcrossRoots(result, roots, target) {
    let best = null;

    for (const root of roots) {
      const p = result.parentsByRoot?.[root];
      const d = result.depthByRoot?.[root];
      if (!p || !d) continue;
      if (d[target] == null) continue;

      const path = reconstructPath(result, root, target);
      if (!path) continue;

      if (!best || path.length < best.path.length) {
        best = { root, path };
      }
    }

    return best;
  }

  function reconstructPath(result, root, target) {
    const parents = result.parentsByRoot?.[root];
    if (!parents) return null;

    const out = [];
    let cur = target;

    let safety = 0;
    while (cur && cur !== root && safety++ < 200) {
      const entry = parents[cur];
      if (!entry || !entry.prev || !entry.edge) break;
      out.push(entry.edge);
      cur = entry.prev;
    }

    if (cur !== root) return null;

    out.reverse();
    return out;
  }

  function wireExportButtons(result) {
    const ej = el("traceExportJsonInInspector");
    const ec = el("traceExportCsvInInspector");
    const copyAll = el("traceCopyAllJson");
    if (ej) {
      ej.disabled = false;
      ej.onclick = () => downloadJSON(serializeResult(result), `nalu_trace_${result.victim}_${Date.now()}.json`);
    }
    if (ec) {
      ec.disabled = false;
      ec.onclick = () => downloadCSV(result.edges, `nalu_trace_edges_${result.victim}_${Date.now()}.csv`);
    }
    if (copyAll) {
      copyAll.disabled = false;
    }
  }

  function serializeResult(result) {
    return {
      nalu_version: VERSION,
      createdAt: result.createdAt,
      victim: result.victim,
      linked_seeds: result.seeds || [],
      roots: result.roots || [],
      params: {
        maxHops: result.maxHops,
        ledgerMin: result.ledgerMin,
        ledgerMax: result.ledgerMax,
        perAccountTxLimit: result.perAccountTxLimit,
        maxEdges: result.maxEdges
      },
      filters: result.filters || {},
      stop: result.stop || {},

      nodes: Array.from(result.nodes || []),
      terminals: Array.from(result.terminals || []),
      terminalReasons: result.terminalReasons || {},

      inDeg: result.inDeg || {},
      outDeg: result.outDeg || {},
      degree: result.degree || {},

      parentsByRoot: result.parentsByRoot || {},
      depthByRoot: result.depthByRoot || {},

      edges: result.edges || []
    };
  }

  function downloadJSON(obj, filename) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function downloadCSV(edges, filename) {
    const headers = ["root", "depth", "from", "to", "amount", "amount_xrp", "currency", "issuer", "ledger_index", "tx_hash", "validated"];
    const lines = [headers.join(",")];

    for (const e of edges) {
      const row = headers.map((h) => csvCell(e[h]));
      lines.push(row.join(","));
    }

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function csvCell(v) {
    if (v == null) return "";
    const s = String(v);
    if (/[,"\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
    return s;
  }

  // -----------------------------
  // Install: watch inspector activation
  // -----------------------------
  function install() {
    const root = getInspectorRoot();
    if (!root) return;

    if (isInspectorActive()) injectTraceTab();

    if (!root.__naluTraceObserver) {
      const obs = new MutationObserver(() => {
        if (isInspectorActive()) injectTraceTab();
      });
      obs.observe(root, { attributes: true, attributeFilter: ["class"] });
      root.__naluTraceObserver = obs;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    install();
    console.log(`✅ ${VERSION} loaded`);
  });

  // Export some helpers for debugging
  window.NaluTrace = {
    renderGraphPreview,
    getExplorerUrlForAccount,
    getExplorerUrlForTx,
    ensureCytoscapeLoaded
  };

})();
