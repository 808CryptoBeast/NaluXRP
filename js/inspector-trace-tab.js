/* =========================================================
   inspector-trace-tab.js — Adds "🚨 Trace Funds" tab to Inspector
   - Injects a new tab into existing inspector tablist (if present)
   - Adds a new tab panel with tracing UI (Payments hop-by-hop BFS)
   - Cancel + Export JSON/CSV
   - Prefill from current Inspector account when possible
   - Safe: no duplicate tabs/panels; works with most tab systems
   ========================================================= */

(function () {
  const VERSION = "inspector-trace-tab@1.0.0";

  // Seed address can be set before the panel is mounted
  let pendingSeedAddress = null;

  const TAB_ID = "nalu-trace";
  const TAB_LABEL = "Trace Funds";
  const TAB_ICON = "🚨";

  const DEFAULTS = {
    maxHops: 4,
    perAccountTxLimit: 60,
    maxEdges: 400,
    ledgerMin: -1,
    ledgerMax: -1
  };

  let traceRunning = false;
  let traceCancelled = false;

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
    return /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(String(s || ""));
  }

  function clampInt(v, min, max, fallback) {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  // -----------------------------
  // XRPL request wrapper
  // -----------------------------
  function getXRPLRequester() {
    // Prefer UnifiedInspector (shares transport with the main Inspector)
    if (window.UnifiedInspector?.request) return (payload, opts) => window.UnifiedInspector.request(payload, opts || {});
    // Prefer shared wrapper if available
    if (window.requestXrpl) return (payload, opts) => window.requestXrpl(payload, opts);
    // Legacy shared connection wrapper (older builds)
    if (window.xrplConnection?.request) return (payload) => window.xrplConnection.request(payload);
    // NaluXrp connection module (window.XRPL.client)
    if (window.XRPL?.client?.request) return (payload) => window.XRPL.client.request(payload);
    // Legacy global client
    if (window.xrpl?.Client && window.xrplClient?.request) return (payload) => window.xrplClient.request(payload);
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
    // Prefer ARIA tablist
    let tablist = root.querySelector('[role="tablist"]');
    if (tablist) return tablist;

    // Common class fallbacks
    tablist =
      root.querySelector(".inspector-tabs") ||
      root.querySelector(".tabs") ||
      root.querySelector(".tab-bar") ||
      root.querySelector(".tablist");

    return tablist || null;
  }

  function findPanelsContainer(root) {
    // If ARIA tabpanels exist, container is parent of first panel
    const panel = root.querySelector('[role="tabpanel"]');
    if (panel && panel.parentElement) return panel.parentElement;

    // Common fallbacks
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

  function findAnyPanel(root) {
    return root.querySelector('[role="tabpanel"], .tab-panel, .panel, section, div');
  }

  function alreadyInstalled(root) {
    return !!root.querySelector(`#${TAB_ID}-tab`) || !!root.querySelector(`#${TAB_ID}-panel`);
  }

  function getCurrentInspectorAccount() {
    const root = getInspectorRoot();
    if (!root) return "";

    // Try known ids
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

      const ph = (inp.getAttribute("placeholder") || "").toLowerCase();
      if (ph.includes("r...") || ph.includes("account")) {
        if (isXRPLAccount(v)) return v;
      }
    }

    // Try reading any inspector state if you exposed it
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
// Prefer the Unified Inspector trace mount if present (tabs are handled by account-inspector.js)
const mount = document.getElementById("inspectorTraceMount");
if (mount) {
  let panel = mount.querySelector("#inspectorTracePanel");
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "inspectorTracePanel";
    mount.innerHTML = "";
    mount.appendChild(panel);
  }
  if (!panel.querySelector(".trace-controls")) {
    panel.innerHTML = renderTracePanelHTML();
  }
  ensureTracePanelReady();
  if (pendingSeedAddress) {
    const inp = document.getElementById("traceVictimInInspector");
    if (inp) inp.value = pendingSeedAddress;
  }
  return;
}

    const root = getInspectorRoot();
    if (!root) return;

    if (alreadyInstalled(root)) return;

    const tablist = findTabList(root);
    if (!tablist) {
      // If inspector has no tablist, we won’t force a new global layout.
      // We’ll inject a collapsible section at the top instead (still accessible).
      injectFallbackSection(root);
      return;
    }

    const panelsContainer = findPanelsContainer(root);

    // Create new tab
    const templateTab = findAnyTabButton(tablist);
    const tab = templateTab ? templateTab.cloneNode(true) : document.createElement("button");

    tab.id = `${TAB_ID}-tab`;
    tab.setAttribute("role", "tab");
    tab.setAttribute("type", "button");
    tab.setAttribute("aria-selected", "false");
    tab.setAttribute("aria-controls", `${TAB_ID}-panel`);
    tab.classList.add("nalu-trace-tab");

    // Normalize text
    tab.innerHTML = `
      <span class="nav-icon" style="font-size:1.05rem;">${TAB_ICON}</span>
      <span class="nav-label">${TAB_LABEL}</span>
    `;

    // Create panel
    const panel = document.createElement("div");
    panel.id = `${TAB_ID}-panel`;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", tab.id);
    panel.hidden = true;

    // Use about card styles (already in your app) so we don’t need extra CSS
    panel.innerHTML = renderTracePanelHTML();

    // Insert tab near other “action” tabs (end)
    tablist.appendChild(tab);
    panelsContainer.appendChild(panel);

    // Add tab click behavior (works even if inspector has its own)
    tab.addEventListener("click", (e) => {
      e.preventDefault();
      activateTab(root, tablist, panelsContainer, tab.id, panel.id);
      ensureTracePanelReady();
    });

    // Capture clicks on other tabs to hide our panel (prevents “stuck open”)
    tablist.addEventListener("click", (e) => {
      const t = e.target.closest('[role="tab"], button, a');
      if (!t) return;
      if (t.id === tab.id) return;

      // If some other tab was clicked, hide trace panel
      panel.hidden = true;
      tab.setAttribute("aria-selected", "false");
      tab.classList.remove("active", "is-active", "selected");
    }, true);

    // Prefill victim field when installed
    setTimeout(() => {
      const acct = getCurrentInspectorAccount();
      if (acct) el("traceVictimInInspector").value = acct;
    }, 50);

    // Bind panel UI
    ensureTracePanelReady();

    console.log(`✅ Trace tab injected (${VERSION})`);
  }

  function activateTab(root, tablist, panelsContainer, tabId, panelId) {
    // Deactivate all tabs
    tablist.querySelectorAll('[role="tab"], button, a').forEach((t) => {
      t.setAttribute?.("aria-selected", "false");
      t.classList.remove("active", "is-active", "selected");
    });

    // Hide all panels if they use role=tabpanel
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

  // If no tab system exists, we still add it (not as a tab) so feature exists
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
    }, 50);

    console.log(`✅ Trace fallback injected (${VERSION})`);
  }

  // -----------------------------
  // Panel HTML + bindings
  // -----------------------------
  function renderTracePanelHTML() {
    return `
      <div style="padding-top: 10px;">
        ${renderTracePanelInnerHTML()}
      </div>
    `;
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
          Follow outgoing <strong>Payment</strong> flows hop-by-hop. This is <strong>on-ledger</strong> only.
          Exchanges may “absorb” funds off-ledger after a deposit — so treat results as investigative pivots, not conclusions.
        </div>

        <div class="about-acc-body" id="traceHelpBodyInInspector" style="display:none;">
          <ul class="about-bullets">
            <li><strong>Hop 0</strong>: victim → destinations found in account_tx</li>
            <li><strong>Hop 1+</strong>: each destination → its destinations (BFS)</li>
            <li><strong>Limits</strong>: per-account tx cap + global edge cap to avoid rate limits</li>
            <li><strong>Best practice</strong>: use a narrow ledger window around the incident</li>
          </ul>
        </div>

        <div style="margin-top: 12px; display:grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 10px; align-items: end;">
          <div style="grid-column: 1 / -1;">
            <label style="display:block; color: var(--text-secondary); font-weight: 800; margin-bottom: 6px;">Victim account</label>
            <input id="traceVictimInInspector" type="text" placeholder="r..."
              style="width:100%; padding:10px 12px; border-radius:14px; border:1px solid rgba(255,255,255,0.12); background:rgba(0,0,0,0.35); color:var(--text-primary); outline:none;" />
          </div>

          <div>
            <label style="display:block; color: var(--text-secondary); font-weight: 800; margin-bottom: 6px;">Max hops</label>
            <input id="traceHopsInInspector" type="number" min="1" max="10" value="${DEFAULTS.maxHops}"
              style="width:100%; padding:10px 12px; border-radius:14px; border:1px solid rgba(255,255,255,0.12); background:rgba(0,0,0,0.35); color:var(--text-primary); outline:none;" />
          </div>

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

          <div style="grid-column: 1 / -1; display:flex; gap:10px; flex-wrap:wrap; margin-top: 6px;">
            <button id="traceUseCurrentAccount" class="about-btn" type="button">Use inspector account</button>
            <button id="traceRunInInspector" class="about-btn" type="button">Start trace</button>
            <button id="traceCancelInInspector" class="about-btn" type="button" style="opacity:0.85;">Cancel</button>
            <button id="traceExportJsonInInspector" class="about-btn" type="button" disabled>Export JSON</button>
            <button id="traceExportCsvInInspector" class="about-btn" type="button" disabled>Export CSV</button>
          </div>

          <div style="grid-column: 1 / -1; margin-top: 10px;">
            <div id="traceStatusInInspector" style="color: var(--text-secondary);"></div>
          </div>
        </div>
      </div>

      <div id="traceResultsInInspector" style="margin-top: 14px;"></div>
    `;
  }

  function ensureTracePanelReady() {
    // Avoid double binding
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

    // Use current inspector account
    el("traceUseCurrentAccount")?.addEventListener("click", () => {
      const acct = getCurrentInspectorAccount();
      if (acct) el("traceVictimInInspector").value = acct;
      else setTraceStatus("⚠️ No inspector account detected yet. Enter an account, or load one in the inspector first.", false);
    });

    // Trace buttons
    el("traceRunInInspector")?.addEventListener("click", () => (typeof runTrace === "function" ? runTrace() : null));
    el("traceCancelInInspector")?.addEventListener("click", cancelTrace);
  }

  function setTraceStatus(msg, isError) {
    const out = el("traceStatusInInspector");
    if (!out) return;
    out.style.color = isError ? "#ff6e6e" : "var(--text-secondary)";
    out.innerHTML = msg;
  }

  function disableTraceControls(disabled) {
    ["traceRunInInspector", "traceUseCurrentAccount"].forEach((id) => {
      const b = el(id);
      if (b) b.disabled = !!disabled;
    });
    const cancelBtn = el("traceCancelInInspector");
    if (cancelBtn) cancelBtn.disabled = false;

    const ej = el("traceExportJsonInInspector");
    const ec = el("traceExportCsvInInspector");
    if (ej) ej.disabled = true;
    if (ec) ec.disabled = true;
  }

  function clearResults() {
    const r = el("traceResultsInInspector");
    if (r) r.innerHTML = "";
  }

  // -----------------------------
  // Trace engine (Payments BFS)
  // -----------------------------
  async function runTrace() {
    if (traceRunning) return;

    const victim = (el("traceVictimInInspector")?.value || "").trim();
    if (!isXRPLAccount(victim)) {
      setTraceStatus("❌ Please enter a valid XRPL account (r...).", true);
      return;
    }

    const maxHops = clampInt(el("traceHopsInInspector")?.value, 1, 10, DEFAULTS.maxHops);
    const ledgerMin = parseInt(el("traceLedgerMinInInspector")?.value ?? DEFAULTS.ledgerMin, 10);
    const ledgerMax = parseInt(el("traceLedgerMaxInInspector")?.value ?? DEFAULTS.ledgerMax, 10);
    const perAcct = clampInt(el("tracePerAcctInInspector")?.value, 10, 400, DEFAULTS.perAccountTxLimit);
    const maxEdges = clampInt(el("traceMaxEdgesInInspector")?.value, 50, 5000, DEFAULTS.maxEdges);

    traceRunning = true;
    traceCancelled = false;

    setTraceStatus("⏳ Starting trace…", false);
    disableTraceControls(true);
    clearResults();

    try {
      const result = await traceOutgoingPaymentsBFS({
        victim,
        maxHops,
        ledgerMin: Number.isFinite(ledgerMin) ? ledgerMin : -1,
        ledgerMax: Number.isFinite(ledgerMax) ? ledgerMax : -1,
        perAccountTxLimit: perAcct,
        maxEdges
      });

      if (traceCancelled) {
        setTraceStatus("🟡 Trace cancelled.", false);
        return;
      }

      renderTraceResults(result);
      wireExportButtons(result);
      setTraceStatus(`✅ Trace complete: ${result.edges.length} edges • ${result.nodes.size} accounts • depth ${result.maxDepthReached}`, false);
    } catch (err) {
      console.error(err);
      setTraceStatus(`❌ Trace failed: ${escapeHtml(err?.message || String(err))}`, true);
    } finally {
      traceRunning = false;
      disableTraceControls(false);
    }
  }

  function cancelTrace() {
    if (!traceRunning) return;
    traceCancelled = true;
    setTraceStatus("🟡 Cancelling…", false);
  }

  async function traceOutgoingPaymentsBFS(opts) {
    const { victim, maxHops, ledgerMin, ledgerMax, perAccountTxLimit, maxEdges } = opts;

    const visited = new Set();
    const nodes = new Set();
    const edges = [];
    const queue = [{ account: victim, depth: 0 }];

    visited.add(victim);
    nodes.add(victim);

    let maxDepthReached = 0;

    while (queue.length) {
      if (traceCancelled) break;
      if (edges.length >= maxEdges) break;

      const { account, depth } = queue.shift();
      maxDepthReached = Math.max(maxDepthReached, depth);

      setTraceStatus(`🔍 Depth ${depth}/${maxHops} • edges ${edges.length}/${maxEdges} • ${escapeHtml(shortAddr(account))}`, false);

      if (depth >= maxHops) continue;

      const outgoing = await fetchOutgoingPaymentEdges(account, {
        ledgerMin,
        ledgerMax,
        perAccountTxLimit
      });

      for (const e of outgoing) {
        if (traceCancelled) break;
        edges.push(e);
        nodes.add(e.from);
        nodes.add(e.to);

        if (!visited.has(e.to)) {
          visited.add(e.to);
          queue.push({ account: e.to, depth: depth + 1 });
        }

        if (edges.length >= maxEdges) break;
      }

      await sleep(80);
    }

    return {
      victim,
      maxHops,
      ledgerMin,
      ledgerMax,
      perAccountTxLimit,
      maxEdges,
      maxDepthReached,
      nodes,
      edges,
      createdAt: new Date().toISOString()
    };
  }

  async function fetchOutgoingPaymentEdges(account, params) {
    const { ledgerMin, ledgerMax, perAccountTxLimit } = params;

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

        const delivered = meta?.delivered_amount ?? meta?.DeliveredAmount;
        const amt = delivered ?? tx.Amount;

        const parsed = parseAmount(amt);

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
  // Results + exports
  // -----------------------------
  function renderTraceResults(result) {
    const r = el("traceResultsInInspector");
    if (!r) return;

    const summary = summarizeEdges(result.edges, result.victim);

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
            <div><strong>Edges:</strong> ${result.edges.length}</div>
            <div><strong>Accounts:</strong> ${result.nodes.size}</div>
            <div><strong>Depth reached:</strong> ${result.maxDepthReached}</div>
          </div>

          <div class="about-divider"></div>

          <div style="font-weight:950; color: var(--text-primary); margin-bottom: 8px;">Top destinations (by outgoing count)</div>
          <div style="display:grid; gap:8px;">
            ${summary.topDests.slice(0, 10).map(d => `
              <div class="whale-item">
                <span>${escapeHtml(d.to)} <span style="color:var(--text-secondary)">(${escapeHtml(shortAddr(d.to))})</span></span>
                <span style="color: var(--text-primary); font-weight:900;">${d.count}</span>
              </div>
            `).join("")}
          </div>

          ${summary.totalXrpOut != null ? `
            <div style="margin-top: 10px; color: var(--text-secondary);">
              Estimated XRP out (victim payments parsed): <strong style="color: var(--text-primary);">${escapeHtml(trimFloat(summary.totalXrpOut))} XRP</strong>
            </div>
          ` : `
            <div style="margin-top: 10px; color: var(--text-secondary);">
              Note: XRP totals may be incomplete if payments are issued assets / partials / non-standard.
            </div>
          `}
        </div>
      </div>

      <div class="about-card" style="margin-top: 14px;">
        <div class="about-card-top">
          <div class="about-card-icon">🧾</div>
          <div class="about-card-title">Extracted payment edges</div>
          <div style="color: var(--text-secondary); font-weight: 800;">Payments only</div>
        </div>
        <div class="about-card-body" style="overflow:auto;">
          ${renderEdgesTable(result.edges)}
        </div>
      </div>
    `;
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

  function renderEdgesTable(edges) {
    const rows = edges.slice(0, 1200).map((e) => `
      <tr>
        <td style="padding:8px 10px; border-bottom: 1px solid rgba(255,255,255,0.06);">${escapeHtml(shortAddr(e.from))}</td>
        <td style="padding:8px 10px; border-bottom: 1px solid rgba(255,255,255,0.06);">${escapeHtml(shortAddr(e.to))}</td>
        <td style="padding:8px 10px; border-bottom: 1px solid rgba(255,255,255,0.06);">${escapeHtml(e.amount)}</td>
        <td style="padding:8px 10px; border-bottom: 1px solid rgba(255,255,255,0.06);">${escapeHtml(String(e.ledger_index ?? ""))}</td>
        <td style="padding:8px 10px; border-bottom: 1px solid rgba(255,255,255,0.06); color: var(--text-secondary);">${escapeHtml((e.tx_hash || "").slice(0, 10) + (e.tx_hash ? "…" : ""))}</td>
      </tr>
    `).join("");

    return `
      <table style="width:100%; border-collapse: collapse; min-width: 860px;">
        <thead>
          <tr>
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

  function wireExportButtons(result) {
    const ej = el("traceExportJsonInInspector");
    const ec = el("traceExportCsvInInspector");
    if (ej) {
      ej.disabled = false;
      ej.onclick = () => downloadJSON(serializeResult(result), `nalu_trace_${result.victim}_${Date.now()}.json`);
    }
    if (ec) {
      ec.disabled = false;
      ec.onclick = () => downloadCSV(result.edges, `nalu_trace_edges_${result.victim}_${Date.now()}.csv`);
    }
  }

  function serializeResult(result) {
    return {
      victim: result.victim,
      createdAt: result.createdAt,
      params: {
        maxHops: result.maxHops,
        ledgerMin: result.ledgerMin,
        ledgerMax: result.ledgerMax,
        perAccountTxLimit: result.perAccountTxLimit,
        maxEdges: result.maxEdges
      },
      nodes: Array.from(result.nodes),
      edges: result.edges
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
    const headers = ["from", "to", "amount", "amount_xrp", "currency", "issuer", "ledger_index", "tx_hash", "validated"];
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
  // Install: watch inspector section activation
  // -----------------------------
  function install() {
    const root = getInspectorRoot();
    if (!root) return;

    // Inject immediately if already active
    if (isInspectorActive()) injectTraceTab();

    // Observe class changes to detect when inspector becomes active
    if (!root.__naluTraceObserver) {
      const obs = new MutationObserver(() => {
        if (isInspectorActive()) injectTraceTab();
      });
      obs.observe(root, { attributes: true, attributeFilter: ["class"] });
      root.__naluTraceObserver = obs;
    }
  }

  // ---------------------------------------------------------------------------
// Unified Inspector integration
//  - account-inspector.js calls window.initInspectorTraceTab({ mountId })
//  - other modules can call window.InspectorTraceTab.setSeedAddress(address)
// ---------------------------------------------------------------------------
function setSeedAddressForTrace(addr) {
  const v = String(addr || "").trim();
  if (v) pendingSeedAddress = v;
  const inp = document.getElementById("traceVictimInInspector");
  if (inp && v) inp.value = v;
}

window.initInspectorTraceTab = function initInspectorTraceTab(opts) {
  try {
    const mountId = (opts && opts.mountId) ? String(opts.mountId) : "inspectorTraceMount";
    const mount = document.getElementById(mountId);
    if (!mount) return false;

    let panel = mount.querySelector("#inspectorTracePanel");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "inspectorTracePanel";
      mount.innerHTML = "";
      mount.appendChild(panel);
    }

    if (!panel.querySelector(".trace-controls")) {
      panel.innerHTML = renderTracePanelHTML();
    }

    ensureTracePanelReady();

    if (pendingSeedAddress) {
      const inp = document.getElementById("traceVictimInInspector");
      if (inp) inp.value = pendingSeedAddress;
    }

    return true;
  } catch (e) {
    console.warn("initInspectorTraceTab failed:", e && e.message ? e.message : e);
    return false;
  }
};

window.InspectorTraceTab = window.InspectorTraceTab || {};
window.InspectorTraceTab.version = VERSION;
window.InspectorTraceTab.setSeedAddress = setSeedAddressForTrace;
window.InspectorTraceTab.runTrace = function () {
  return typeof runTrace === "function" ? runTrace() : null;
};


document.addEventListener("DOMContentLoaded", () => {
    install();
    console.log(`✅ ${VERSION} loaded`);
  });
})();
