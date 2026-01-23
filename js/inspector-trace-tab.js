/* =========================================================
   inspector-trace-tab.js — "🚨 Trace Funds" tab for Inspector
   v1.3.0 (All upgrades)
   - Expanded help + Quick start + Troubleshooting
   - Progress bar + live counters + keyboard shortcuts (Enter/Esc)
   - Date/time window pickers -> ledger conversion
   - Auto-apply window option
   - Explorer links (xrpscan) for accounts & txs
   - Export/import cases, copy-all JSON
   - In-session caching of account_tx responses
   - Limited concurrency for account fetches
   - Simple SVG graph preview for up to 200 edges (click nodes to Inspect/Path/Exclude)
   - Confirm delete with Undo
   ========================================================= */

(function () {
  const VERSION = "inspector-trace-tab@1.3.0";
  const TAB_ID = "nalu-trace";
  const TAB_LABEL = "Trace Funds";
  const TAB_ICON = "🚨";

  // XRPL close cadence varies; use a safe estimate for time->ledger conversion
  const EST_LEDGER_SECONDS = 4;

  const EXPLORER = {
    account: (a) => `https://xrpscan.com/account/${a}`,
    tx: (h) => `https://xrpscan.com/tx/${h}`
  };

  const DEFAULTS = {
    maxHops: 4,
    perAccountTxLimit: 80,
    maxEdges: 600,

    // manual ledger bounds default: "any"
    ledgerMin: -1,
    ledgerMax: -1,

    // window preset
    windowPreset: "1h", // "15m" | "1h" | "6h" | "24h" | "7d" | "manual"

    // filters
    onlyXrp: true,
    includeIssued: false, // used only if onlyXrp is false
    minXrp: 0,

    // stop conditions
    stopOnHub: true,
    hubDegree: 18, // total degree in traced graph
    stopOnFanIn: true,
    fanInDegree: 12, // in-degree threshold in traced graph

    // advanced
    concurrency: 3,
    autoApplyWindow: false
  };

  // LocalStorage keys
  const LS_CASES = "nalu_trace_cases_v1";

  // Session caches and state
  let traceRunning = false;
  let traceCancelled = false;
  let lastResult = null;
  let sessionCache = new Map(); // key -> edges
  let lastDeletedCase = null;
  let undoDeleteTimer = null;

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

  // Parse comma/newline separated accounts; returns unique valid accounts
  function parseAccountsFromText(text) {
    const raw = String(text || "")
      .replaceAll(";", ",")
      .replaceAll("|", ",")
      .split(/[\s,\n\r\t,]+/g)
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

  // -----------------------------
  // XRPL request wrapper
  // -----------------------------
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
    if (!req) throw new Error("XRPL request interface not found (expected window.xrplConnection.request / window.xrplClient.request).");

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
    // Try server_info first (often has validated ledger)
    try {
      const r = await requestWithRetry({ command: "server_info" }, 2);
      const info = r?.result?.info;
      const seq =
        info?.validated_ledger?.seq ??
        info?.validated_ledger?.ledger_index ??
        info?.validated_ledger_seq ??
        null;

      if (Number.isFinite(seq)) return seq;

      // Sometimes validated_ledger is "seq,hash"
      const v = info?.validated_ledger;
      if (typeof v === "string") {
        const maybe = parseInt(String(v).split(",")[0], 10);
        if (Number.isFinite(maybe)) return maybe;
      }
    } catch (_) {}

    // Fallback ledger_current
    try {
      const r2 = await requestWithRetry({ command: "ledger_current" }, 2);
      const idx = r2?.result?.ledger_current_index;
      if (Number.isFinite(idx)) return idx;
    } catch (_) {}

    return null;
  }

  // -----------------------------
  // Inspector integration hooks
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

  // -----------------------------
  // Tab injection
  // -----------------------------
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
          <div style="display:grid; gap:8px;">
            <div>
              <strong>Quick start</strong>
              <ol style="margin:6px 0 0 18px; color:var(--text-secondary);">
                <li>Paste the victim address (or press Paste).</li>
                <li>Apply a time window (or enter start/end times) → this converts to ledger range.</li>
                <li>Set simple filters (Only XRP, Min XRP) to reduce noise.</li>
                <li>Press Start trace. Use Cancel (or Esc) to stop early.</li>
                <li>Click Path on destinations to reconstruct shortest-hop paths for reporting.</li>
              </ol>
            </div>

            <div>
              <strong>What the tracer captures</strong>
              <ul style="margin:6px 0 0 18px; color:var(--text-secondary);">
                <li>Outgoing Payment transactions from each visited account in the ledger range.</li>
                <li>Only payments that match your coin/currency filters (XRP vs issued assets).</li>
                <li>Basic parent pointers so you can rebuild shortest-hop paths to any target captured.</li>
              </ul>
            </div>

            <div>
              <strong>Troubleshooting</strong>
              <ul style="margin:6px 0 0 18px; color:var(--text-secondary);">
                <li><strong>No validated ledger:</strong> Apply window manually with ledger numbers or wait for server_info to respond.</li>
                <li><strong>Empty results:</strong> widen the window, increase per-account tx limit, or disable Only XRP if issued assets might have been used.</li>
                <li><strong>Slow trace / rate-limit:</strong> lower Max edges / Per-account tx or reduce concurrency (advanced).</li>
              </ul>
            </div>

            <div>
              <strong>Shortcuts & tips</strong>
              <ul style="margin:6px 0 0 18px; color:var(--text-secondary);">
                <li>Enter: start trace (unless focus is in the seeds textarea). Esc: cancel trace.</li>
                <li>Use inspector 'Use inspector' to load the current inspected account as victim.</li>
                <li>Saved cases include inputs and optionally cached results for quick re-open; you can export/import cases as JSON.</li>
              </ul>
            </div>
          </div>
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
            <button id="traceExportCaseBtn" class="about-btn" type="button">Export case</button>
            <label class="about-btn" style="display:inline-flex; align-items:center; gap:8px; padding:8px 12px; border-radius:14px;">
              Import <input id="traceImportCaseFile" type="file" accept="application/json" style="display:none;" />
            </label>
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

          <!-- WINDOW PRESETS + date/time -->
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

              <label style="display:flex; gap:8px; align-items:center; color:var(--text-secondary);">
                <input id="traceAutoApplyWindow" type="checkbox" />
                Auto-apply window on open
              </label>

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

            <div style="margin-top:10px; display:grid; grid-template-columns: 1fr 1fr; gap:8px; align-items:center;">
              <div>
                <label style="display:block; color: var(--text-secondary); font-weight:800; margin-bottom:6px;">Start (ISO)</label>
                <input id="traceStartISO" type="datetime-local" style="width:100%; padding:10px; border-radius:10px;" />
              </div>
              <div>
                <label style="display:block; color: var(--text-secondary); font-weight:800; margin-bottom:6px;">End (ISO)</label>
                <input id="traceEndISO" type="datetime-local" style="width:100%; padding:10px; border-radius:10px;" />
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

              <div style="margin-left:auto; display:flex; gap:8px; align-items:center;">
                <label style="color:var(--text-secondary); font-weight:800;">Group by dest</label>
                <input id="traceGroupByDest" type="checkbox" />
              </div>
            </div>

            <div style="margin-top:8px; display:flex; gap:8px; align-items:center;">
              <label style="display:block; color: var(--text-secondary); font-weight: 800;">Exclude addresses (comma/newline)</label>
              <input id="traceExcludeList" type="text" placeholder="r... , r... , ..." style="flex:1 1 420px; padding:8px; border-radius:10px;" />
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
      <div id="traceGraphPreview" style="margin-top:14px;"></div>

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

    // OnlyXRP toggle logic
    el("traceOnlyXrp")?.addEventListener("change", () => {
      const only = !!el("traceOnlyXrp")?.checked;
      const inc = el("traceIncludeIssued");
      if (only && inc) inc.checked = false;
      if (inc) inc.disabled = only;
    });
    // Initialize includeIssued disabled state
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

    // Clipboard buttons
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

    // Auto apply window
    const auto = el("traceAutoApplyWindow");
    if (auto) {
      auto.checked = DEFAULTS.autoApplyWindow;
    }

    // Trace buttons
    el("traceRunInInspector")?.addEventListener("click", runTrace);
    el("traceCancelInInspector")?.addEventListener("click", cancelTrace);

    // Export & copy all
    el("traceCopyAllJson")?.addEventListener("click", async () => {
      if (!lastResult) return setTraceStatus("⚠️ Run a trace first.", false);
      try {
        await writeClipboardText(JSON.stringify(serializeResult(lastResult), null, 2));
        setTraceStatus("✅ Copied full trace JSON to clipboard.", false);
      } catch (e) {
        setTraceStatus(`⚠️ ${escapeHtml(e.message || String(e))}`, false);
      }
    });

    // Case manager
    el("traceSaveCase")?.addEventListener("click", saveCase);
    el("traceLoadCaseBtn")?.addEventListener("click", loadSelectedCase);
    el("traceDeleteCaseBtn")?.addEventListener("click", deleteSelectedCase);
    el("traceExportCaseBtn")?.addEventListener("click", () => {
      const sel = el("traceLoadCaseSelect");
      const cases = loadCases();
      let c = null;
      if (sel && sel.value) c = cases.find(x => x.id === sel.value);
      if (!c) {
        setTraceStatus("⚠️ Select a case to export.", false);
        return;
      }
      const blob = new Blob([JSON.stringify(c, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `nalu_trace_case_${c.id}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });
    el("traceImportCaseFile")?.addEventListener("change", async (ev) => {
      const f = ev.target.files?.[0];
      if (!f) return;
      try {
        const txt = await f.text();
        const parsed = JSON.parse(txt);
        if (!parsed || !parsed.id) {
          setTraceStatus("⚠️ Invalid case file.", false);
          return;
        }
        const cases = loadCases();
        cases.push(parsed);
        saveCases(cases);
        refreshCaseSelect();
        setTraceStatus("✅ Imported case.", false);
      } catch (e) {
        setTraceStatus(`⚠️ ${escapeHtml(e.message || String(e))}`, false);
      } finally {
        ev.target.value = "";
      }
    });

    refreshCaseSelect();
    setCaseMeta();

    // Keyboard shortcuts: Enter to run (unless inside textarea), Esc to cancel
    document.addEventListener("keydown", handleGlobalKeys);

    // Bind dynamic actions in results (if any)
    bindResultActions();
  }

  function handleGlobalKeys(e) {
    if (e.key === "Escape") {
      if (traceRunning) cancelTrace();
    } else if (e.key === "Enter") {
      const active = document.activeElement;
      const tag = active?.tagName?.toLowerCase();
      if (tag === "textarea") return;
      if ((active?.getAttribute?.("contenteditable") === "true")) return;
      // run only if not focused in inputs that expect enter
      runTrace();
    }
  }

  function setTraceStatus(msg, isError) {
    const out = el("traceStatusInInspector");
    if (!out) return;
    out.style.color = isError ? "#ff6e6e" : "var(--text-secondary)";
    out.innerHTML = msg;
  }

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
      "traceExportCaseBtn",
      "traceImportCaseFile",
      "traceExportJsonInInspector",
      "traceExportCsvInInspector",
      "traceCopyAllJson"
    ].forEach((id) => {
      const b = el(id);
      if (b) b.disabled = !!disabled;
    });

    const cancelBtn = el("traceCancelInInspector");
    if (cancelBtn) cancelBtn.disabled = !disabled ? false : false; // cancel should stay available when running
  }

  function clearResults() {
    const r = el("traceResultsInInspector");
    const p = el("tracePathPanel");
    const g = el("traceGraphPreview");
    if (r) r.innerHTML = "";
    if (p) p.innerHTML = "";
    if (g) g.innerHTML = "";
  }

  // -----------------------------
  // Window preset logic + time -> ledger conversion
  // -----------------------------
  function presetToSeconds(preset) {
    switch (preset) {
      case "15m": return 15 * 60;
      case "1h": return 60 * 60;
      case "6h": return 6 * 60 * 60;
      case "24h": return 24 * 60 * 60;
      case "7d": return 7 * 24 * 60 * 60;
      default: return null;
    }
  }

  async function applyWindowPreset() {
    const preset = el("traceWindowPreset")?.value || "manual";
    const note = el("traceWindowNote");

    if (preset === "manual") {
      if (note) note.textContent = "Manual mode: enter ledger min/max directly (use -1 for any).";
      setTraceStatus("✅ Window preset set to manual.", false);
      return;
    }

    const seconds = presetToSeconds(preset);
    if (!seconds) {
      setTraceStatus("⚠️ Unknown preset.", false);
      return;
    }

    setTraceStatus("⏳ Fetching current validated ledger…", false);
    const current = await getValidatedLedgerIndex();

    if (!Number.isFinite(current)) {
      setTraceStatus("⚠️ Could not fetch validated ledger index. You can still run trace with manual ledger bounds.", false);
      if (note) note.textContent = "Could not fetch validated ledger; use manual ledger bounds.";
      return;
    }

    const ledgersBack = Math.max(1, Math.round(seconds / EST_LEDGER_SECONDS));
    const min = Math.max(0, current - ledgersBack);
    const max = current;

    const minEl = el("traceLedgerMinInInspector");
    const maxEl = el("traceLedgerMaxInInspector");
    if (minEl) minEl.value = String(min);
    if (maxEl) maxEl.value = String(max);

    if (note) note.textContent = `Applied preset ${preset}: ledger ${min} → ${max} (~${ledgersBack} ledgers).`;
    setTraceStatus(`✅ Window set: ledger ${min} → ${max}`, false);
  }

  // Convert ISO datetime inputs to ledger min/max using validated ledger mapping (approx)
  async function applyIsoWindowToLedgers() {
    const start = el("traceStartISO")?.value;
    const end = el("traceEndISO")?.value;
    if (!start && !end) {
      setTraceStatus("⚠️ Enter a Start and/or End time to convert to ledger range.", false);
      return;
    }

    setTraceStatus("⏳ Fetching validated ledger for time->ledger conversion…", false);
    const currentLedger = await getValidatedLedgerIndex();
    if (!Number.isFinite(currentLedger)) {
      setTraceStatus("⚠️ Could not fetch validated ledger index.", false);
      return;
    }

    const nowTs = Date.now() / 1000;
    const getLedgerForTs = (ts) => {
      const diff = nowTs - ts;
      const ledgersBack = Math.round(diff / EST_LEDGER_SECONDS);
      return Math.max(0, currentLedger - ledgersBack);
    };

    const startTs = start ? Math.floor(new Date(start).getTime() / 1000) : null;
    const endTs = end ? Math.floor(new Date(end).getTime() / 1000) : null;

    const min = startTs ? getLedgerForTs(startTs) : Number(el("traceLedgerMinInInspector")?.value ?? -1);
    const max = endTs ? getLedgerForTs(endTs) : Number(el("traceLedgerMaxInInspector")?.value ?? -1);

    el("traceLedgerMinInInspector").value = String(min);
    el("traceLedgerMaxInInspector").value = String(max);
    setTraceStatus(`✅ Converted times → ledgers: ${min} → ${max}`, false);
  }

  // -----------------------------
  // Case management
  // -----------------------------
  function loadCases() {
    try {
      const raw = localStorage.getItem(LS_CASES);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function saveCases(list) {
    try {
      localStorage.setItem(LS_CASES, JSON.stringify(list || []));
    } catch (e) {
      console.warn("saveCases failed", e);
    }
  }

  function refreshCaseSelect() {
    const sel = el("traceLoadCaseSelect");
    if (!sel) return;

    const cases = loadCases()
      .slice()
      .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));

    const current = sel.value;
    sel.innerHTML = `<option value="">Load case…</option>` + cases.map(c => {
      const label = `${c.name || "Untitled"} • ${new Date(c.savedAt || Date.now()).toLocaleString()}`;
      // include small preview in title attribute (top dests)
      const preview = (c.result && c.result.edges) ? ` • edges ${c.result.edges.length}` : "";
      return `<option value="${escapeHtml(c.id)}" title="${escapeHtml(preview)}">${escapeHtml(label)}</option>`;
    }).join("");

    // restore selection if possible
    if (current) sel.value = current;
  }

  function getCurrentInputs() {
    const victim = (el("traceVictimInInspector")?.value || "").trim();
    const seedsText = el("traceSeedsInInspector")?.value || "";
    const preset = el("traceWindowPreset")?.value || "manual";

    return {
      victim,
      seedsText,
      preset,

      ledgerMin: parseInt(el("traceLedgerMinInInspector")?.value ?? -1, 10),
      ledgerMax: parseInt(el("traceLedgerMaxInInspector")?.value ?? -1, 10),

      maxHops: clampInt(el("traceHopsInInspector")?.value, 1, 10, DEFAULTS.maxHops),
      perAccountTxLimit: clampInt(el("tracePerAcctInInspector")?.value, 10, 400, DEFAULTS.perAccountTxLimit),
      maxEdges: clampInt(el("traceMaxEdgesInInspector")?.value, 50, 5000, DEFAULTS.maxEdges),

      onlyXrp: !!el("traceOnlyXrp")?.checked,
      includeIssued: !!el("traceIncludeIssued")?.checked,
      minXrp: clampNum(el("traceMinXrp")?.value, 0, 1e18, DEFAULTS.minXrp),

      stopOnHub: !!el("traceStopHub")?.checked,
      hubDegree: clampInt(el("traceHubDegree")?.value, 3, 999, DEFAULTS.hubDegree),
      stopOnFanIn: !!el("traceStopFanIn")?.checked,
      fanInDegree: clampInt(el("traceFanInDegree")?.value, 3, 999, DEFAULTS.fanInDegree),

      excludeList: parseAccountsFromText(el("traceExcludeList")?.value || ""),
      groupByDest: !!el("traceGroupByDest")?.checked,

      concurrency: clampInt(el("traceConcurrency")?.value || DEFAULTS.concurrency, 1, 12, DEFAULTS.concurrency),
      autoApplyWindow: !!el("traceAutoApplyWindow")?.checked
    };
  }

  function applyInputs(inputs) {
    if (!inputs) return;

    if (el("traceVictimInInspector")) el("traceVictimInInspector").value = inputs.victim || "";
    if (el("traceSeedsInInspector")) el("traceSeedsInInspector").value = inputs.seedsText || "";

    if (el("traceWindowPreset")) el("traceWindowPreset").value = inputs.preset || "manual";
    if (el("traceLedgerMinInInspector")) el("traceLedgerMinInInspector").value = String(inputs.ledgerMin ?? -1);
    if (el("traceLedgerMaxInInspector")) el("traceLedgerMaxInInspector").value = String(inputs.ledgerMax ?? -1);

    if (el("traceHopsInInspector")) el("traceHopsInInspector").value = String(inputs.maxHops ?? DEFAULTS.maxHops);
    if (el("tracePerAcctInInspector")) el("tracePerAcctInInspector").value = String(inputs.perAccountTxLimit ?? DEFAULTS.perAccountTxLimit);
    if (el("traceMaxEdgesInInspector")) el("traceMaxEdgesInInspector").value = String(inputs.maxEdges ?? DEFAULTS.maxEdges);

    if (el("traceOnlyXrp")) el("traceOnlyXrp").checked = !!inputs.onlyXrp;
    if (el("traceIncludeIssued")) el("traceIncludeIssued").checked = !!inputs.includeIssued;
    if (el("traceMinXrp")) el("traceMinXrp").value = String(inputs.minXrp ?? 0);

    if (el("traceStopHub")) el("traceStopHub").checked = !!inputs.stopOnHub;
    if (el("traceHubDegree")) el("traceHubDegree").value = String(inputs.hubDegree ?? DEFAULTS.hubDegree);
    if (el("traceStopFanIn")) el("traceStopFanIn").checked = !!inputs.stopOnFanIn;
    if (el("traceFanInDegree")) el("traceFanInDegree").value = String(inputs.fanInDegree ?? DEFAULTS.fanInDegree);

    if (el("traceExcludeList")) el("traceExcludeList").value = (inputs.excludeList || []).join(", ");
    if (el("traceGroupByDest")) el("traceGroupByDest").checked = !!inputs.groupByDest;
    if (el("traceAutoApplyWindow")) el("traceAutoApplyWindow").checked = !!inputs.autoApplyWindow;

    // enforce onlyXrp UI rules
    const only = !!el("traceOnlyXrp")?.checked;
    const inc = el("traceIncludeIssued");
    if (inc) inc.disabled = only;
    if (only && inc) inc.checked = false;
  }

  function saveCase() {
    const name = (el("traceCaseName")?.value || "").trim();
    if (!name) {
      setTraceStatus("⚠️ Give your case a name first.", false);
      return;
    }

    const inputs = getCurrentInputs();
    const cases = loadCases();

    const id = `case_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const entry = {
      id,
      name,
      savedAt: Date.now(),
      version: VERSION,
      inputs,
      // store results only if we have them
      result: lastResult ? serializeResult(lastResult) : null
    };

    cases.push(entry);
    saveCases(cases);
    refreshCaseSelect();
    setCaseMeta();
    setTraceStatus(`✅ Case saved: ${escapeHtml(name)}`, false);
  }

  function loadSelectedCase() {
    const sel = el("traceLoadCaseSelect");
    if (!sel || !sel.value) {
      setTraceStatus("⚠️ Select a case to load.", false);
      return;
    }

    const cases = loadCases();
    const c = cases.find(x => x.id === sel.value);
    if (!c) {
      setTraceStatus("⚠️ Case not found.", false);
      return;
    }

    applyInputs(c.inputs);
    clearResults();

    if (c.result && c.result.edges && c.result.nodes) {
      // restore lastResult in memory for export/path
      lastResult = restoreResultFromSerialized(c.result);
      renderTraceResults(lastResult);
      wireExportButtons(lastResult);
      setTraceStatus(`✅ Loaded case: ${escapeHtml(c.name)} (with results)`, false);
    } else {
      lastResult = null;
      setTraceStatus(`✅ Loaded case: ${escapeHtml(c.name)} (inputs only)`, false);
    }

    setCaseMeta(c);
  }

  function deleteSelectedCase() {
    const sel = el("traceLoadCaseSelect");
    if (!sel || !sel.value) {
      setTraceStatus("⚠️ Select a case to delete.", false);
      return;
    }

    const cases = loadCases();
    const idx = cases.findIndex(x => x.id === sel.value);
    if (idx === -1) {
      setTraceStatus("⚠️ Case not found.", false);
      return;
    }

    const name = cases[idx]?.name || "Untitled";
    lastDeletedCase = cases.splice(idx, 1)[0];
    saveCases(cases);
    sel.value = "";
    refreshCaseSelect();
    setCaseMeta();

    // show undo
    setTraceStatus(`✅ Deleted case: ${escapeHtml(name)}. <button id="traceUndoDelete" class="about-btn" style="margin-left:8px;">Undo</button>`, false);
    const btn = el("traceUndoDelete");
    if (btn) {
      btn.addEventListener("click", () => {
        if (!lastDeletedCase) return;
        const cs = loadCases();
        cs.push(lastDeletedCase);
        saveCases(cs);
        lastDeletedCase = null;
        refreshCaseSelect();
        setTraceStatus("✅ Undo: case restored.", false);
        clearTimeout(undoDeleteTimer);
      });
    }

    // clear undo after 10s
    clearTimeout(undoDeleteTimer);
    undoDeleteTimer = setTimeout(() => { lastDeletedCase = null; setTraceStatus("Deleted (undo expired).", false); }, 10000);
  }

  function setCaseMeta(caseObj) {
    const meta = el("traceCaseMeta");
    if (!meta) return;

    const sel = el("traceLoadCaseSelect");
    const cases = loadCases();
    const selected = caseObj || (sel?.value ? cases.find(x => x.id === sel.value) : null);

    if (!selected) {
      meta.textContent = `Saved cases: ${cases.length}. (Cases are stored locally in your browser.)`;
      return;
    }

    const dt = new Date(selected.savedAt || Date.now()).toLocaleString();
    meta.textContent = `Selected: ${selected.name} • saved ${dt} • ${selected.result ? "includes results" : "inputs only"}`;
  }

  // -----------------------------
  // Trace engine (Payments BFS) with concurrency & caching
  // -----------------------------
  async function runTrace() {
    if (traceRunning) return;

    // if ISO start/end fields have values, convert them to ledgers before running
    const hasIso = (el("traceStartISO")?.value || "") || (el("traceEndISO")?.value || "");
    if (hasIso) {
      await applyIsoWindowToLedgers();
    }

    const inputs = getCurrentInputs();

    const victim = inputs.victim;
    if (!isXRPLAccount(victim)) {
      setTraceStatus("❌ Please enter a valid XRPL account (r...).", true);
      return;
    }

    const seeds = parseAccountsFromText(inputs.seedsText).filter(a => a !== victim);

    traceRunning = true;
    traceCancelled = false;
    lastResult = null;
    sessionCache = new Map(); // new session cache for each run

    setTraceStatus(`⏳ Starting trace… (victim + ${seeds.length} linked)`, false);
    updateTraceProgress(0, "Starting…");
    disableTraceControls(true);
    clearResults();

    try {
      const result = await traceOutgoingPaymentsBFS({
        victim,
        seeds,
        maxHops: inputs.maxHops,
        ledgerMin: Number.isFinite(inputs.ledgerMin) ? inputs.ledgerMin : -1,
        ledgerMax: Number.isFinite(inputs.ledgerMax) ? inputs.ledgerMax : -1,
        perAccountTxLimit: inputs.perAccountTxLimit,
        maxEdges: inputs.maxEdges,
        concurrency: inputs.concurrency,

        // filters
        onlyXrp: inputs.onlyXrp,
        includeIssued: inputs.includeIssued,
        minXrp: inputs.minXrp,
        excludeList: inputs.excludeList,

        // stop conditions
        stopOnHub: inputs.stopOnHub,
        hubDegree: inputs.hubDegree,
        stopOnFanIn: inputs.stopOnFanIn,
        fanInDegree: inputs.fanInDegree
      });

      if (traceCancelled) {
        setTraceStatus("🟡 Trace cancelled.", false);
        return;
      }

      lastResult = result;

      renderTraceResults(result);
      wireExportButtons(result);

      setTraceStatus(
        `✅ Trace complete: ${result.edges.length} edges • ${result.nodes.size} accounts • depth ${result.maxDepthReached} • terminals ${result.terminals.size}`,
        false
      );
    } catch (err) {
      console.error(err);
      setTraceStatus(`❌ Trace failed: ${escapeHtml(err?.message || String(err))}`, true);
    } finally {
      traceRunning = false;
      disableTraceControls(false);
      updateTraceProgress(100, "Done");
      setTimeout(clearTraceProgress, 1200);
      refreshCaseSelect();
      setCaseMeta();
    }
  }

  function cancelTrace() {
    if (!traceRunning) return;
    traceCancelled = true;
    setTraceStatus("🟡 Cancelling…", false);
    updateTraceProgress(null, "Cancelling…");
  }

  async function traceOutgoingPaymentsBFS(opts) {
    const {
      victim, seeds, maxHops, ledgerMin, ledgerMax, perAccountTxLimit, maxEdges, concurrency,
      onlyXrp, includeIssued, minXrp, excludeList,
      stopOnHub, hubDegree, stopOnFanIn, fanInDegree
    } = opts;

    const visited = new Set();
    const nodes = new Set();
    const edges = [];

    // graph stats
    const inDeg = new Map();
    const outDeg = new Map();
    const degree = new Map();

    // terminals: nodes we decided not to expand further
    const terminals = new Set();
    const terminalReasons = new Map();

    // Multi-root BFS
    const roots = [victim, ...(seeds || [])].filter(Boolean);
    const queue = [];

    // Path parents: for each root, store shortest path tree
    const parentsByRoot = new Map(); // root -> Map(node -> {prev, edge})
    const depthByRoot = new Map();   // root -> Map(node -> depth)
    for (const r of roots) {
      parentsByRoot.set(r, new Map());
      depthByRoot.set(r, new Map([[r, 0]]));
    }

    for (const r of roots) {
      if (!visited.has(r)) {
        visited.add(r);
        nodes.add(r);
        queue.push({ account: r, depth: 0, root: r });
      }
    }

    let maxDepthReached = 0;

    function bump(map, k, n = 1) {
      map.set(k, (map.get(k) || 0) + n);
    }
    function recomputeDegree(k) {
      const d = (inDeg.get(k) || 0) + (outDeg.get(k) || 0);
      degree.set(k, d);
      return d;
    }

    function shouldExpand(node) {
      if (terminals.has(node)) return false;

      const d = degree.get(node) || 0;
      const indeg = inDeg.get(node) || 0;

      if (stopOnHub && d >= hubDegree) {
        terminals.add(node);
        terminalReasons.set(node, `hub-degree ${d} ≥ ${hubDegree}`);
        return false;
      }
      if (stopOnFanIn && indeg >= fanInDegree) {
        terminals.add(node);
        terminalReasons.set(node, `fan-in in-degree ${indeg} ≥ ${fanInDegree}`);
        return false;
      }
      return true;
    }

    // Queue processing with limited concurrency: process in BFS-style levels but allow up to concurrency accounts at once
    while (queue.length) {
      if (traceCancelled) break;
      if (edges.length >= maxEdges) break;

      // prepare a batch
      const batch = [];
      for (let i = 0; i < (concurrency || DEFAULTS.concurrency) && queue.length; i++) {
        batch.push(queue.shift());
      }

      // map to promises
      const promises = batch.map(async (item) => {
        const { account, depth, root } = item;
        maxDepthReached = Math.max(maxDepthReached, depth);

        setTraceStatus(
          `🔍 Depth ${depth}/${maxHops} • edges ${edges.length}/${maxEdges} • ${escapeHtml(shortAddr(account))}`,
          false
        );
        updateTraceProgress(Math.min(99, Math.round((edges.length / Math.max(1, maxEdges)) * 90)), `Depth ${depth} • edges ${edges.length}`);

        if (depth >= maxHops) {
          terminals.add(account);
          if (!terminalReasons.has(account)) terminalReasons.set(account, "max-hops reached");
          return;
        }

        if (!shouldExpand(account)) return;

        // check exclude list
        if (excludeList && excludeList.includes(account)) {
          terminals.add(account);
          terminalReasons.set(account, "excluded by user");
          return;
        }

        const key = `${account}_${ledgerMin}_${ledgerMax}_${onlyXrp ? 'xrp' : 'all'}_${perAccountTxLimit}_${minXrp}`;
        if (sessionCache.has(key)) {
          return { account, depth, root, outgoing: sessionCache.get(key) };
        }

        const outgoing = await fetchOutgoingPaymentEdges(account, {
          ledgerMin,
          ledgerMax,
          perAccountTxLimit,
          onlyXrp,
          includeIssued,
          minXrp,
          victim
        });

        sessionCache.set(key, outgoing);
        return { account, depth, root, outgoing };
      });

      const results = await Promise.all(promises);

      for (const res of results) {
        if (traceCancelled) break;
        if (!res) continue;
        const { account, depth, root, outgoing } = res;

        for (const e of (outgoing || [])) {
          if (traceCancelled) break;
          if (edges.length >= maxEdges) break;

          const edge = {
            ...e,
            depth,
            root
          };

          edges.push(edge);
          nodes.add(edge.from);
          nodes.add(edge.to);

          bump(outDeg, edge.from);
          bump(inDeg, edge.to);
          recomputeDegree(edge.from);
          recomputeDegree(edge.to);

          // Update parent map for shortest path for that root:
          const pMap = parentsByRoot.get(root);
          const dMap = depthByRoot.get(root);
          if (pMap && dMap && !dMap.has(edge.to)) {
            dMap.set(edge.to, (dMap.get(edge.from) ?? depth) + 1);
            pMap.set(edge.to, { prev: edge.from, edge });
          }

          // Enqueue if not visited AND allowed to expand later
          if (!visited.has(edge.to)) {
            visited.add(edge.to);
            queue.push({ account: edge.to, depth: depth + 1, root });

            // if it becomes terminal by stats immediately, mark terminal but still keep node
            shouldExpand(edge.to); // may mark terminals
          }
        }
      }

      // small pause to avoid hammering connections
      await sleep(30);
    }

    // Build endpoint sets: nodes that were reached but never expanded or were terminal
    if (!terminals.has(victim)) terminals.add(victim);

    return {
      victim,
      seeds,
      roots,
      maxHops,
      ledgerMin,
      ledgerMax,
      perAccountTxLimit,
      maxEdges,

      filters: {
        onlyXrp,
        includeIssued: onlyXrp ? false : includeIssued,
        minXrp
      },
      stop: {
        stopOnHub,
        hubDegree,
        stopOnFanIn,
        fanInDegree
      },

      maxDepthReached,
      nodes,
      edges,

      inDeg: mapToObj(inDeg),
      outDeg: mapToObj(outDeg),
      degree: mapToObj(degree),

      terminals,
      terminalReasons: mapToObj(terminalReasons),

      parentsByRoot: serializeParents(parentsByRoot),
      depthByRoot: serializeDepth(depthByRoot),

      createdAt: new Date().toISOString(),
      version: VERSION
    };
  }

  function mapToObj(map) {
    const obj = {};
    for (const [k, v] of map.entries()) obj[k] = v;
    return obj;
  }

  function serializeParents(parentsByRoot) {
    const out = {};
    for (const [root, pMap] of parentsByRoot.entries()) {
      out[root] = {};
      for (const [node, val] of pMap.entries()) {
        out[root][node] = {
          prev: val.prev,
          edge: val.edge ? {
            from: val.edge.from,
            to: val.edge.to,
            amount: val.edge.amount,
            amount_xrp: val.edge.amount_xrp,
            currency: val.edge.currency,
            issuer: val.edge.issuer,
            tx_hash: val.edge.tx_hash,
            ledger_index: val.edge.ledger_index
          } : null
        };
      }
    }
    return out;
  }

  function serializeDepth(depthByRoot) {
    const out = {};
    for (const [root, dMap] of depthByRoot.entries()) {
      out[root] = {};
      for (const [node, d] of dMap.entries()) out[root][node] = d;
    }
    return out;
  }

  function restoreResultFromSerialized(s) {
    // rebuild sets
    const nodes = new Set(s.nodes || []);
    const terminals = new Set(s.terminals || []);
    return {
      ...s,
      nodes,
      terminals
    };
  }

  async function fetchOutgoingPaymentEdges(account, params) {
    const {
      ledgerMin, ledgerMax, perAccountTxLimit,
      onlyXrp, includeIssued, minXrp, victim
    } = params;

    const edges = [];
    let marker = undefined;
    let fetched = 0;

    while (true) {
      if (traceCancelled) break;
      if (fetched >= perAccountTxLimit) break;

      const limit = Math.min(200, perAccountTxLimit - fetched);
      const payload = {
        command: "account_tx",
        account,
        ledger_index_min: Number.isFinite(ledgerMin) ? ledgerMin : -1,
        ledger_index_max: Number.isFinite(ledgerMax) ? ledgerMax : -1,
        limit,
        binary: false
      };
      if (marker) payload.marker = marker;

      const res = await requestWithRetry(payload, 3);
      const txs = res?.result?.transactions || [];
      fetched += txs.length;

      for (const item of txs) {
        const tx = item?.tx || item;
        const meta = item?.meta || item?.metaData;

        if (!tx || tx.TransactionType !== "Payment") continue;
        if (tx.Account !== account) continue;
        if (!tx.Destination) continue;

        // delivered amount is best when present
        const delivered = meta?.delivered_amount ?? meta?.DeliveredAmount;
        const amt = delivered ?? tx.Amount;

        const parsed = parseAmount(amt);

        // FILTERS
        const isXrp = parsed.currency === "XRP";
        const allowIssued = !onlyXrp && includeIssued;

        if (onlyXrp && !isXrp) continue;
        if (!onlyXrp && !allowIssued && !isXrp) continue;

        // Min XRP filter (applies to XRP edges; best UX: apply primarily to victim, but keep it consistent)
        if (isXrp && Number.isFinite(minXrp) && minXrp > 0) {
          const ax = parsed.xrp;
          if (Number.isFinite(ax)) {
            const applyToThisEdge = (account === victim);
            if (applyToThisEdge && ax < minXrp) continue;
          }
        }

        edges.push({
          from: tx.Account,
          to: tx.Destination,
          amount: parsed.display,
          amount_xrp: parsed.xrp,
          currency: parsed.currency,
          issuer: parsed.issuer,
          tx_hash: item?.hash || tx?.hash || tx?.TransactionHash || null,
          ledger_index: item?.ledger_index ?? tx?.ledger_index ?? null,
          validated: !!item?.validated
        });

        if (edges.length >= perAccountTxLimit) break;
      }

      marker = res?.result?.marker;
      if (!marker) break;
    }

    return edges;
  }

  function parseAmount(amt) {
    if (typeof amt === "string") {
      const drops = Number(amt);
      const xrp = Number.isFinite(drops) ? drops / 1_000_000 : null;
      return {
        xrp,
        currency: "XRP",
        issuer: null,
        display: Number.isFinite(xrp) ? `${trimFloat(xrp)} XRP` : `${amt} drops`
      };
    }

    if (amt && typeof amt === "object") {
      const cur = amt.currency || "???";
      const iss = amt.issuer || null;
      const val = amt.value ?? "";
      const issuerShort = iss ? shortAddr(iss) : "";
      return {
        xrp: null,
        currency: cur,
        issuer: iss,
        display: `${val} ${cur}${issuerShort ? " · " + issuerShort : ""}`
      };
    }

    return { xrp: null, currency: null, issuer: null, display: "unknown" };
  }

  function trimFloat(n) {
    const s = String(n);
    if (s.includes("e") || s.includes("E")) return n.toFixed(6);
    const fixed = n.toFixed(6);
    return fixed.replace(/\.?0+$/, "");
  }

  // -----------------------------
  // Results + exports + path view + graph preview
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
                      <a href="${escapeHtml(EXPLORER.account(d.to))}" target="_blank" rel="noopener noreferrer">${escapeHtml(d.to)}</a>
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
                      <a href="${escapeHtml(EXPLORER.account(t.node))}" target="_blank" rel="noopener noreferrer">${escapeHtml(t.node)}</a>
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
          ${renderEdgesTable(result.edges, { groupByDest: !!el("traceGroupByDest")?.checked })}
        </div>
      </div>
    `;

    bindResultActions();
    renderGraphPreview(result);
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

    // Rank: hubs/fan-in first, then degree
    return list.sort((a, b) => {
      const scoreA = (a.degree * 2) + a.in;
      const scoreB = (b.degree * 2) + b.in;
      return scoreB - scoreA;
    });
  }

  function renderEdgesTable(edges, opts = {}) {
    const { groupByDest = false } = opts;
    const rows = (groupByDest ? groupEdgesByDest(edges) : edges).slice(0, 1200).map((e) => {
      if (e.grouped) {
        return `
          <tr>
            <td colspan="6" style="padding:8px 10px; border-bottom: 1px solid rgba(255,255,255,0.06); background: rgba(255,255,255,0.01);">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <div>
                  <strong>${escapeHtml(e.to)}</strong>
                  <div style="color:var(--text-secondary); font-size:0.92rem;">${escapeHtml(shortAddr(e.to))} • ${e.edges.length} incoming edges</div>
                </div>
                <div style="display:flex; gap:8px;">
                  <button class="about-btn nalu-path" data-target="${escapeHtml(e.to)}" type="button">Path</button>
                  <button class="about-btn nalu-copy" data-copy="${escapeHtml(e.to)}" type="button">Copy</button>
                  <button class="about-btn nalu-inspect" data-inspect="${escapeHtml(e.to)}" type="button">Inspect</button>
                  <a class="about-btn" href="${escapeHtml(EXPLORER.account(e.to))}" target="_blank" rel="noopener noreferrer">Explorer</a>
                </div>
              </div>
            </td>
          </tr>
        `;
      }

      return `
      <tr>
        <td style="padding:8px 10px; border-bottom: 1px solid rgba(255,255,255,0.06); color: var(--text-secondary);">
          ${escapeHtml(shortAddr(e.root))}<div style="font-size:0.82rem; opacity:0.9;">root</div>
        </td>
        <td style="padding:8px 10px; border-bottom: 1px solid rgba(255,255,255,0.06);">
          ${escapeHtml(shortAddr(e.from))}
          <div style="margin-top:6px; display:flex; gap:8px; flex-wrap:wrap;">
            <button class="about-btn nalu-copy" data-copy="${escapeHtml(e.from)}" type="button">Copy</button>
            <button class="about-btn nalu-inspect" data-inspect="${escapeHtml(e.from)}" type="button">Inspect</button>
            <a class="about-btn" href="${escapeHtml(EXPLORER.account(e.from))}" target="_blank" rel="noopener noreferrer">Explorer</a>
          </div>
        </td>
        <td style="padding:8px 10px; border-bottom: 1px solid rgba(255,255,255,0.06);">
          ${escapeHtml(shortAddr(e.to))}
          <div style="margin-top:6px; display:flex; gap:8px; flex-wrap:wrap;">
            <button class="about-btn nalu-path" data-target="${escapeHtml(e.to)}" type="button">Path</button>
            <button class="about-btn nalu-copy" data-copy="${escapeHtml(e.to)}" type="button">Copy</button>
            <button class="about-btn nalu-inspect" data-inspect="${escapeHtml(e.to)}" type="button">Inspect</button>
            <a class="about-btn" href="${escapeHtml(EXPLORER.account(e.to))}" target="_blank" rel="noopener noreferrer">Explorer</a>
          </div>
        </td>
        <td style="padding:8px 10px; border-bottom: 1px solid rgba(255,255,255,0.06);">
          ${escapeHtml(e.amount)}<div style="font-size:0.82rem; color:var(--text-secondary);">depth ${escapeHtml(String(e.depth))}</div>
        </td>
        <td style="padding:8px 10px; border-bottom: 1px solid rgba(255,255,255,0.06);">${escapeHtml(String(e.ledger_index ?? ""))}</td>
        <td style="padding:8px 10px; border-bottom: 1px solid rgba(255,255,255,0.06); color: var(--text-secondary);">
          ${escapeHtml((e.tx_hash || "").slice(0, 12) + (e.tx_hash ? "…" : ""))}
          ${e.tx_hash ? `
            <div style="margin-top:6px; display:flex; gap:8px; flex-wrap:wrap;">
              <button class="about-btn nalu-copy" data-copy="${escapeHtml(e.tx_hash)}" type="button">Copy Tx</button>
              <a class="about-btn" href="${escapeHtml(EXPLORER.tx(e.tx_hash))}" target="_blank" rel="noopener noreferrer">Explorer</a>
            </div>
          ` : ""}
        </td>
      </tr>
    `;
    }).join("");

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

  function groupEdgesByDest(edges) {
    const byDest = new Map();
    for (const e of edges) {
      const arr = byDest.get(e.to) || [];
      arr.push(e);
      byDest.set(e.to, arr);
    }
    const out = [];
    for (const [to, arr] of byDest.entries()) {
      out.push({ grouped: true, to, edges: arr });
      // push first few as individual rows as well (optional)
      for (const e of arr) out.push(e);
    }
    return out;
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

    // Graph preview interactivity: add ability to exclude node
    document.querySelectorAll(".nalu-exclude[data-exclude]").forEach(btn => {
      if (btn.__bound) return;
      btn.__bound = true;
      btn.addEventListener("click", () => {
        const a = btn.getAttribute("data-exclude");
        const cur = el("traceExcludeList")?.value || "";
        el("traceExcludeList").value = cur ? (cur + ", " + a) : a;
        setTraceStatus(`✅ Added ${shortAddr(a)} to exclude list. Rerun trace to apply.`, false);
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
                  ${step.tx_hash ? `<a class="about-btn" href="${escapeHtml(EXPLORER.tx(step.tx_hash))}" target="_blank" rel="noopener noreferrer">Explorer</a>` : ""}
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

    // Bind new buttons inside path panel
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

    // walk backward using prev pointers
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
  // Graph preview (simple SVG)
  // -----------------------------
  function renderGraphPreview(result) {
    const container = el("traceGraphPreview");
    if (!container) return;
    container.innerHTML = "";

    const maxEdges = 200;
    const edges = result.edges.slice(0, maxEdges);
    if (!edges.length) return;

    // build node list
    const nodes = Array.from(new Set(edges.flatMap(e => [e.from, e.to])));
    const w = Math.min(900, Math.max(400, nodes.length * 10 + 200));
    const h = 300;

    // simple circular layout
    const centerX = w / 2;
    const centerY = h / 2;
    const radius = Math.min(w, h) / 2 - 40;

    const nodePos = {};
    nodes.forEach((n, i) => {
      const ang = (i / nodes.length) * Math.PI * 2;
      nodePos[n] = { x: centerX + Math.cos(ang) * radius, y: centerY + Math.sin(ang) * radius };
    });

    // create SVG
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", String(w));
    svg.setAttribute("height", String(h));
    svg.style.border = "1px solid rgba(255,255,255,0.04)";
    svg.style.borderRadius = "8px";
    svg.style.background = "rgba(0,0,0,0.06)";

    // draw edges (lines)
    for (const e of edges) {
      const a = nodePos[e.from];
      const b = nodePos[e.to];
      if (!a || !b) continue;
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", String(a.x));
      line.setAttribute("y1", String(a.y));
      line.setAttribute("x2", String(b.x));
      line.setAttribute("y2", String(b.y));
      line.setAttribute("stroke", "rgba(255,255,255,0.06)");
      line.setAttribute("stroke-width", "1");
      svg.appendChild(line);
    }

    // draw nodes
    nodes.forEach(n => {
      const p = nodePos[n];
      if (!p) return;
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.style.cursor = "pointer";

      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", String(p.x));
      circle.setAttribute("cy", String(p.y));
      circle.setAttribute("r", "8");
      circle.setAttribute("fill", "#06b6d4");
      circle.setAttribute("opacity", n === result.victim ? "1" : "0.85");
      g.appendChild(circle);

      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", String(p.x + 12));
      text.setAttribute("y", String(p.y + 4));
      text.setAttribute("fill", "var(--text-secondary)");
      text.setAttribute("font-size", "11");
      text.textContent = shortAddr(n);
      g.appendChild(text);

      g.addEventListener("click", () => {
        // actions: inspect / path / exclude
        setTraceStatus(`Node: ${n} — actions: Inspect • Path • Exclude`, false);
        // quick action UI
        renderNodeActionCard(n);
      });

      svg.appendChild(g);
    });

    const wrapper = document.createElement("div");
    wrapper.style.marginTop = "12px";
    const title = document.createElement("div");
    title.style.fontWeight = "950";
    title.style.color = "var(--text-primary)";
    title.style.marginBottom = "8px";
    title.textContent = "Graph preview (first 200 edges) — click a node for actions";
    wrapper.appendChild(title);
    wrapper.appendChild(svg);
    container.appendChild(wrapper);
  }

  function renderNodeActionCard(account) {
    const panel = el("tracePathPanel");
    if (!panel) return;
    panel.innerHTML = `
      <div class="about-card">
        <div class="about-card-top">
          <div class="about-card-icon">🔗</div>
          <div class="about-card-title">Node actions</div>
          <div></div>
        </div>
        <div class="about-card-body">
          <div style="display:flex; gap:8px; align-items:center; margin-bottom:8px;">
            <button class="about-btn nalu-inspect" data-inspect="${escapeHtml(account)}">Inspect</button>
            <button class="about-btn nalu-path" data-target="${escapeHtml(account)}">Path</button>
            <button class="about-btn nalu-copy" data-copy="${escapeHtml(account)}">Copy</button>
            <button class="about-btn nalu-exclude" data-exclude="${escapeHtml(account)}">Add to exclude</button>
            <a class="about-btn" href="${escapeHtml(EXPLORER.account(account))}" target="_blank" rel="noopener noreferrer">Explorer</a>
          </div>
        </div>
      </div>
    `;
    bindResultActions();
  }

  // -----------------------------
  // Utilities
  // -----------------------------
  function serializeResultForCase(result) {
    return serializeResult(result);
  }

  // -----------------------------
  // Progress helpers
  // -----------------------------
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

  function clearTraceProgress() {
    updateTraceProgress(null, "");
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

})();
