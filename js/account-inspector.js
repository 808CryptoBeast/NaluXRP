/* =========================================================
   FILE: js/account-inspector.js
   NaluXrp — Unified Inspector (One Page, Data-First, Ledger-First)
   v2.6.0 (Full merged — Resilient builds + auto-reconnect + checkpoints + resume)
   - Concurrency pool + inflight dedupe + IndexedDB page cache
   - Pause/resume XRPL processing integration (avoids contention with dashboard)
   - Resumable, fault-tolerant build with per-node retries, backoff, and checkpoints
   - Cytoscape integration for flow diagrams (on-demand)
   ========================================================= */

(function () {
  "use strict";

  // ---------------- CONFIG ----------------
  const DEPLOYED_PROXY =
    typeof window !== "undefined" && window.NALU_DEPLOYED_PROXY ? String(window.NALU_DEPLOYED_PROXY) : "";

  const RPC_HTTP_ENDPOINTS = ["https://xrplcluster.com/", "https://xrpl.ws/"];
  const RPC_HTTP_OVERRIDE = typeof window !== "undefined" && window.NALU_RPC_HTTP ? String(window.NALU_RPC_HTTP) : "";

  const SHARED_WAIT_MS = 8000;

  // paging / caps
  const PAGE_LIMIT = 200;

  // Tree scan caps (keep sane; tree scan uses RECENT pages so should finish quickly)
  const MAX_PAGES_TREE_SCAN = 200;
  const MAX_TX_SCAN_PER_NODE = 50_000;

  const DEFAULT_DEPTH = 2;
  const DEFAULT_PER_NODE = 100;
  const DEFAULT_MAX_ACCTS = 250;
  const DEFAULT_MAX_EDGES = 1600;

  // activation lookup caps (needs earliest-forward, so can be bigger)
  const ACTIVATION_PAGE_LIMIT = 200;
  const ACTIVATION_MAX_PAGES = 2000;
  const ACTIVATION_MAX_TX_SCAN = 350_000;

  // localStorage keys
  const LOCAL_KEY_ISSUER_LIST = "naluxrp_issuer_list";
  const LOCAL_KEY_SELECTED_ISSUER = "naluxrp_selected_issuer";
  const LOCAL_KEY_EXPLORER = "naluxrp_explorer";

  // IndexedDB cache constants
  const IDB_DB_NAME = "nalu_cache_v1";
  const IDB_STORE_PAGES = "account_tx_pages";
  const IDB_PAGE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days default TTL

  // checkpointing key prefix
  const CHECKPOINT_PREFIX = "naluxrp_build_ck_";

  // default concurrency
  const DEFAULT_CONCURRENCY = 2;
  let REQUEST_CONCURRENCY = DEFAULT_CONCURRENCY;

  const SHARED_RETRY_COOLDOWN_MS = 10_000;

  const MODULE_VERSION = "unified-inspector@2.6.0-resilient";

  // ---------------- STATE ----------------
  let buildingTree = false;
  let activeIssuer = null;

  const issuerRegistry = new Map(); // issuer -> graph
  const activationCache = new Map(); // addr -> { act|null, complete:boolean, scanned:number, pages:number, source:string }
  const accountInfoCache = new Map(); // addr -> { domain, balanceXrp, sequence, ownerCount }
  const sessionCache = { account_tx: new Map() }; // simple session-only cache

  // inflight dedupe map for account_tx pages
  const inflightPages = new Map();

  // concurrency pool (created later)
  let requestPool = null;

  const transportState = {
    wsConnected: false,
    lastSource: "—",
    lastError: null,
    lastSharedReconnectAttemptAt: 0
  };

  // Cytoscape instances store
  window._naluCyInstances = window._naluCyInstances || {};

  // ---------------- DOM ----------------
  const $ = (id) => document.getElementById(id);

  function escapeHtml(s) {
    if (s == null) return "";
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function isValidXrpAddress(addr) {
    return /^r[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(String(addr || "").trim());
  }

  function safeGetStorage(key) {
    try {
      return window.localStorage ? window.localStorage.getItem(key) : null;
    } catch (_) {
      return null;
    }
  }

  function safeSetStorage(key, value) {
    try {
      if (window.localStorage) window.localStorage.setItem(key, value);
    } catch (_) {}
  }

  function setStatus(s) {
    const el = $("uiStatus");
    if (el) el.innerHTML = s;
  }

  function setProgress(p) {
    const wrap = $("uiProgress");
    const bar = $("uiProgressBar");
    if (!wrap || !bar) return;

    if (p < 0) {
      wrap.style.display = "none";
      bar.style.width = "0%";
      return;
    }

    wrap.style.display = "block";
    const clamped = Math.max(0, Math.min(1, Number(p) || 0));
    bar.style.width = `${Math.round(clamped * 100)}%`;
  }

  function setBuildBusy(busy, label) {
    const btn = $("uiBuild");
    if (!btn) return;
    btn.disabled = !!busy;
    btn.style.opacity = busy ? "0.75" : "1";
    btn.style.cursor = busy ? "not-allowed" : "pointer";
    btn.textContent = label || (busy ? "Building…" : "Build");
  }

  function openModal(title, html) {
    $("uiModalTitle").textContent = title || "Details";
    $("uiModalBody").innerHTML = html || "";
    $("uiModalOverlay").style.display = "flex";
    $("uiModalBody").scrollTop = 0;
  }

  function closeModal() {
    $("uiModalOverlay").style.display = "none";
  }

  async function copyToClipboard(text) {
    const s = String(text || "");
    try {
      await navigator.clipboard.writeText(s);
      return true;
    } catch (_) {
      try {
        const ta = document.createElement("textarea");
        ta.value = s;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        return !!ok;
      } catch (e) {
        return false;
      }
    }
  }

  function downloadText(text, filename, mime = "text/plain") {
    const blob = new Blob([String(text || "")], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || `download-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function explorerLinks(txHash) {
    if (!txHash) return { xrpscan: null, bithomp: null };
    return {
      xrpscan: `https://xrpscan.com/tx/${encodeURIComponent(txHash)}`,
      bithomp: `https://bithomp.com/explorer/${encodeURIComponent(txHash)}`
    };
  }

  // short address helper
  function shortAddr(a) {
    if (!a) return "—";
    return String(a).slice(0, 8) + "…";
  }

  // ---------------- EXPLORER CONFIG ----------------
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
    custom: {
      id: "custom",
      label: "Custom"
    }
  };

  function loadExplorerSettings() {
    try {
      const raw = safeGetStorage(LOCAL_KEY_EXPLORER);
      if (!raw) return { selected: "xrpscan", customAcct: "", customTx: "" };
      const p = JSON.parse(raw);
      return { selected: p.selected || "xrpscan", customAcct: p.customAcct || "", customTx: p.customTx || "" };
    } catch (_) {
      return { selected: "xrpscan", customAcct: "", customTx: "" };
    }
  }

  function saveExplorerSettings(settings) {
    try { safeSetStorage(LOCAL_KEY_EXPLORER, JSON.stringify(settings || {})); } catch (_) {}
  }

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

  // ---------------- TIME / INPUT HELPERS ----------------
  function safeToIso(x) {
    try {
      if (x == null) return null;
      if (typeof x === "string") {
        const d = new Date(x);
        if (!Number.isNaN(d.getTime())) return d.toISOString();
      }
      if (typeof x === "number") {
        if (x > 10_000_000_000) return new Date(x).toISOString(); // ms epoch
        if (x > 1_000_000_000) return new Date(x * 1000).toISOString(); // sec epoch
        const rippleEpochMs = Date.UTC(2000, 0, 1);
        return new Date(rippleEpochMs + x * 1000).toISOString(); // ripple epoch seconds
      }
      const d = new Date(x);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    } catch (_) {}
    return null;
  }

  function parseNullableInt(v) {
    const s = String(v ?? "").trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? Math.floor(n) : null;
  }

  function clampInt(n, min, max) {
    const nn = Number(n);
    if (!Number.isFinite(nn)) return min;
    return Math.max(min, Math.min(max, Math.floor(nn)));
  }

  // ---------------- XRPL AMOUNT ----------------
  function parseAmount(amount) {
    if (amount == null) return { value: 0, currency: "XRP", issuer: null, raw: amount };
    if (typeof amount === "string") {
      const v = Number(amount);
      return { value: Number.isFinite(v) ? v / 1_000_000 : 0, currency: "XRP", issuer: null, raw: amount };
    }
    if (typeof amount === "object" && amount.value != null) {
      const v = Number(amount.value);
      return {
        value: Number.isFinite(v) ? v : 0,
        currency: amount.currency || "XRP",
        issuer: amount.issuer || null,
        raw: amount
      };
    }
    if (typeof amount === "number") return { value: amount, currency: "XRP", issuer: null, raw: amount };
    return { value: 0, currency: "XRP", issuer: null, raw: amount };
  }

  // ---------------- TRANSPORT BADGE + AUTO-RETRY ----------------
  function computeWsConnected() {
    if (typeof window.isXRPLConnected === "function") return !!window.isXRPLConnected();
    if (window.XRPL?.connected) return true;
    if (window.XRPL?.client && typeof window.XRPL.client.isConnected === "function") return !!window.XRPL.client.isConnected();
    return false;
  }

  function setTransportLastSource(src) {
    transportState.lastSource = src || "—";
    updateConnBadge();
  }

  function updateConnBadge() {
    const badge = $("uiConnBadge");
    const text = $("uiConnText");
    const dot = $("uiConnDot");
    if (!badge || !text || !dot) return;

    transportState.wsConnected = computeWsConnected();

    if (transportState.wsConnected) {
      badge.style.background = "linear-gradient(135deg,#50fa7b,#2ecc71)";
      badge.style.color = "#000";
      dot.style.background = "rgba(0,0,0,0.35)";
      text.textContent = `WS live • last: ${transportState.lastSource}`;
    } else {
      badge.style.background = "rgba(255,255,255,0.10)";
      badge.style.color = "var(--text-primary)";
      dot.style.background = "rgba(255,255,255,0.25)";
      const err = transportState.lastError ? ` • ${transportState.lastError}` : "";
      text.textContent = `WS offline • last: ${transportState.lastSource}${err}`;
    }
  }

  async function waitForSharedConn(timeoutMs = SHARED_WAIT_MS) {
    return new Promise((resolve) => {
      try {
        if (computeWsConnected()) return resolve(true);

        const onConn = (ev) => {
          const d = ev && ev.detail;
          if (d && d.connected) {
            window.removeEventListener("xrpl-connection", onConn);
            clearTimeout(t);
            resolve(true);
          }
        };
        window.addEventListener("xrpl-connection", onConn);

        const t = setTimeout(() => {
          window.removeEventListener("xrpl-connection", onConn);
          resolve(false);
        }, timeoutMs);
      } catch (_) {
        resolve(false);
      }
    });
  }

  function attemptSharedReconnect(reason) {
    const now = Date.now();
    if (now - transportState.lastSharedReconnectAttemptAt < SHARED_RETRY_COOLDOWN_MS) return;
    transportState.lastSharedReconnectAttemptAt = now;

    try {
      if (typeof window.reconnectXRPL === "function") {
        window.reconnectXRPL();
      } else if (typeof window.connectXRPL === "function") {
        window.connectXRPL();
      }

      transportState.lastError = reason || "reconnect requested";
    } catch (e) {
      transportState.lastError = e?.message ? e.message : String(e);
    }

    updateConnBadge();
  }

  // ---------------- HTTP JSON-RPC ----------------
  async function tryFetchJson(url, { method = "GET", body = null, timeoutMs = 15000, headers = {} } = {}) {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeoutMs);

      const resp = await fetch(url, {
        method,
        headers: {
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...headers
        },
        body: body ? JSON.stringify(body) : null,
        signal: controller.signal
      });

      clearTimeout(id);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.json();
    } catch (err) {
      console.warn("tryFetchJson failed", url, err && err.message ? err.message : err);
      transportState.lastError = err && err.message ? err.message : String(err);
      updateConnBadge();
      return null;
    }
  }

  function unwrapRpcResult(json) {
    const r = json?.result;
    if (!r) return null;
    if (r.error) return null;
    if (r.status === "success" && r.result && typeof r.result === "object") return r.result;
    return r;
  }

  async function rpcCall(method, paramsObj, { timeoutMs = 15000, retries = 2 } = {}) {
    const endpoints = [];
    if (DEPLOYED_PROXY && DEPLOYED_PROXY.startsWith("http")) endpoints.push(DEPLOYED_PROXY);
    if (RPC_HTTP_OVERRIDE && RPC_HTTP_OVERRIDE.startsWith("http")) endpoints.push(RPC_HTTP_OVERRIDE);
    endpoints.push(...RPC_HTTP_ENDPOINTS);

    const body = { method, params: [paramsObj] };

    for (const base of endpoints) {
      const url = base.endsWith("/") ? base : base + "/";
      let attempt = 0;

      while (attempt <= retries) {
        const j = await tryFetchJson(url, { method: "POST", body, timeoutMs });
        const out = unwrapRpcResult(j);
        if (out) {
          setTransportLastSource(base.includes("localhost") ? "local_proxy_http_rpc" : "http_rpc");
          transportState.lastError = null;
          updateConnBadge();
          return out;
        }
        attempt += 1;
        if (attempt <= retries) await new Promise((res) => setTimeout(res, 250 * attempt));
      }
    }

    return null;
  }

  // Prefer shared WS request wrapper (it already has HTTP fallback in your hardened xrpl-connection.js)
  async function xrplRequest(payload, { timeoutMs = 20000, allowHttpFallback = true } = {}) {
    if (typeof window.requestXrpl === "function") {
      try {
        const r = await window.requestXrpl(payload, { timeoutMs });
        const out = r?.result || r;
        setTransportLastSource(computeWsConnected() ? "shared_ws" : "shared_wrapper_http_fallback");
        transportState.lastError = null;
        updateConnBadge();
        return out;
      } catch (e) {
        transportState.lastError = e?.message ? e.message : String(e);
        updateConnBadge();
        if (!allowHttpFallback) throw e;
      }
    }

    if (window.XRPL?.client?.request) {
      const out = await window.XRPL.client.request(payload);
      setTransportLastSource("direct_ws_client");
      transportState.lastError = null;
      updateConnBadge();
      return out?.result || out;
    }

    if (allowHttpFallback) {
      const out = await rpcCall(payload.command, { ...payload }, { timeoutMs, retries: 2 });
      if (out) return out;
    }

    throw new Error("No XRPL transport available");
  }

  // ---------------- UX / RENDER helpers (Cytoscape etc.) ----------------

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
      s.onload = () => {
        if (window.cytoscape) resolve(window.cytoscape);
        else reject(new Error("cytoscape failed to initialize"));
      };
      s.onerror = (e) => reject(e);
      document.head.appendChild(s);
    });
  }

  function destroyCyInstance(containerId) {
    try {
      const key = `cy__${containerId}`;
      const prev = window._naluCyInstances[key];
      if (prev && prev.destroy) {
        prev.destroy();
      }
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
        {
          selector: "node",
          style: {
            label: "data(label)",
            "text-wrap": "wrap",
            "text-max-width": 120,
            "background-color": "data(color)",
            width: "data(size)",
            height: "data(size)",
            "font-size": 11,
            color: "#fff",
            "text-valign": "center",
            "text-halign": "center",
            "overlay-padding": "6px"
          }
        },
        {
          selector: "edge",
          style: {
            width: "data(width)",
            "line-color": "data(color)",
            "curve-style": "bezier",
            "target-arrow-shape": "triangle",
            "target-arrow-color": "data(color)",
            opacity: 0.9
          }
        },
        {
          selector: ".highlight",
          style: {
            "background-color": "#ffd54f",
            "line-color": "#ffd54f",
            "target-arrow-color": "#ffd54f"
          }
        }
      ],
      layout: { name: opts.layout || "cose", animate: true, fit: true }
    });

    if (typeof opts.onNodeClick === "function") {
      cy.on("tap", "node", (evt) => {
        const node = evt.target;
        opts.onNodeClick(node.data());
      });
    }

    if (opts.fitAfter !== false) cy.fit();

    window._naluCyInstances[key] = cy;
    return cy;
  }

  // ---------------- TX NORMALIZATION helpers ----------------
  function normalizeTxEntry(entry) {
    const t0 = entry?.tx || entry?.transaction || entry?.tx_json || entry;
    if (!t0) return null;
    return {
      ...t0,
      _meta: entry?.meta || entry?.metaData || t0?.meta || t0?.metaData || null,
      hash: t0.hash || entry?.hash || t0?.tx_hash || null,
      ledger_index: Number(t0.ledger_index ?? t0.LedgerIndex ?? entry?.ledger_index ?? entry?.ledger_index_min ?? 0),
      _iso: safeToIso(t0.date ?? entry?.date ?? null)
    };
  }

  function normalizeAndSortTxsAsc(entries) {
    const txs = (entries || []).map(normalizeTxEntry).filter(Boolean);
    txs.sort((a, b) => {
      const la = Number(a.ledger_index || 0);
      const lb = Number(b.ledger_index || 0);
      if (la !== lb) return la - lb;
      const da = a._iso ? new Date(a._iso).getTime() : 0;
      const db = b._iso ? new Date(b._iso).getTime() : 0;
      return da - db;
    });
    return txs;
  }

  // ---------------- GRAPH / RENDER / UI ----------------
  // The UI rendering functions are preserved from prior working version:
  // renderPage, hydrateIssuerSelect, renderAll, renderSummary, renderTree,
  // renderEdgeFilter, renderEdgeFilterActive, showNodeModal, renderMiniFlow,
  // renderFlowDiagramForNode, exportActiveGraph, findPathClicked, patternsClicked,
  // and clearViews. They were kept intact and are included below.

  // For brevity, these functions are lengthy but unchanged in behavior from previous UI version.
  // Below is the full set of UI functions (copied from latest working version).

  // ---------------- ISSUER LIST ----------------
  function normalizeIssuerListText(text) {
    const raw = String(text || "")
      .split(/[\n,;\s]+/g)
      .map((s) => s.trim())
      .filter(Boolean);

    const uniq = [];
    const seen = new Set();
    for (const a of raw) {
      if (!isValidXrpAddress(a)) continue;
      if (seen.has(a)) continue;
      seen.add(a);
      uniq.push(a);
    }
    return uniq;
  }

  function getIssuerList() {
    const v = safeGetStorage(LOCAL_KEY_ISSUER_LIST);
    if (!v) return [];
    try {
      const arr = JSON.parse(v);
      if (!Array.isArray(arr)) return [];
      return arr.filter(isValidXrpAddress);
    } catch (_) {
      return [];
    }
  }

  function setIssuerList(list) {
    safeSetStorage(LOCAL_KEY_ISSUER_LIST, JSON.stringify(list));
  }

  function hydrateIssuerSelect() {
    const list = getIssuerList();
    const sel = $("uiIssuerSelect");
    if (!sel) return;
    sel.innerHTML = "";

    if (!list.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "— paste issuers —";
      sel.appendChild(opt);
      return;
    }

    for (const issuer of list) {
      const opt = document.createElement("option");
      opt.value = issuer;
      opt.textContent = issuer;
      sel.appendChild(opt);
    }

    const stored = safeGetStorage(LOCAL_KEY_SELECTED_ISSUER);
    const initial = stored && list.includes(stored) ? stored : list[0];
    sel.value = initial;
    onIssuerSelected(initial, { autoBuildIfMissing: true });
  }

  function onIssuerSelected(issuer, { autoBuildIfMissing } = { autoBuildIfMissing: false }) {
    if (!issuer || !isValidXrpAddress(issuer)) return;
    activeIssuer = issuer;
    safeSetStorage(LOCAL_KEY_SELECTED_ISSUER, issuer);

    const cached = issuerRegistry.get(issuer);
    if (cached?.builtAt) {
      renderAll(cached);
      setStatus(`Loaded cached tree (${cached.nodes.size} accounts / ${cached.edges.length} edges)`);
      return;
    }

    clearViews();
    setStatus("Ready");

    if (autoBuildIfMissing) buildTreeClicked().catch(() => {});
  }

  // ---------------- RENDER ----------------
  function ensurePage() {
    let page = document.getElementById("inspector");
    if (!page) {
      page = document.createElement("section");
      page.id = "inspector";
      page.className = "page-section";
      const main = document.getElementById("main") || document.body;
      main.appendChild(page);
    }
    return page;
  }

  function renderPage() {
    const page = ensurePage();
    const explorerSettings = loadExplorerSettings();

    page.innerHTML = `
      <div class="chart-section" style="padding:18px;">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
          <h2 style="margin:0">Unified Inspector</h2>
          <div style="opacity:.85">issuer tree • activated_by • recent outgoing (ledger-first)</div>
          <div style="opacity:.65;font-size:12px;">${escapeHtml(MODULE_VERSION)}</div>

          <div id="uiConnBadge" style="margin-left:auto;display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:999px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.02);">
            <div id="uiConnDot" style="width:10px;height:10px;border-radius:999px;background:rgba(255,255,255,0.25);"></div>
            <div id="uiConnText" style="font-weight:900;font-size:12px;">—</div>
            <button id="uiRetryWs" style="padding:6px 10px;border-radius:999px;border:1px solid rgba(255,255,255,0.18);background:transparent;color:var(--text-primary);cursor:pointer;">Retry</button>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 360px;gap:12px;margin-top:12px;align-items:start;">
          <div style="display:flex;flex-direction:column;gap:10px;">
            <div style="padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,0.06);background:rgba(255,255,255,0.02);">
              <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
                <div style="font-weight:900;">Issuers</div>
                <select id="uiIssuerSelect" style="flex:1;min-width:260px;padding:10px;border-radius:10px;border:1px solid var(--accent-tertiary);background:transparent;color:var(--text-primary);"></select>
                <button id="uiBuild" class="nav-btn" style="padding:10px 14px;border-radius:10px;background:linear-gradient(135deg,#50fa7b,#2ecc71);border:none;color:#000;font-weight:900;">Build</button>
              </div>

              <details style="margin-top:10px;">
                <summary style="cursor:pointer;opacity:.9;">Issuer list (edit)</summary>
                <div style="display:grid;grid-template-columns:1fr 140px;gap:10px;margin-top:10px;">
                  <textarea id="uiIssuerList" placeholder="Paste issuers (one per line or comma-separated)" style="width:100%;min-height:86px;padding:10px;border-radius:10px;border:1px solid var(--accent-tertiary);background:transparent;color:var(--text-primary);"></textarea>
                  <div style="display:flex;flex-direction:column;gap:8px;">
                    <button id="uiSaveList" class="nav-btn" style="padding:10px 12px;border-radius:10px;background:#50a8ff;border:none;color:#000;font-weight:900;">Save</button>
                    <button id="uiClearCache" class="nav-btn" style="padding:10px 12px;border-radius:10px;background:#ffb86c;border:none;color:#000;font-weight:900;">Clear</button>
                  </div>
                </div>
              </details>

              <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;align-items:center;">
                <label style="font-size:13px;">Depth</label>
                <input id="uiDepth" type="number" min="1" max="6" value="${DEFAULT_DEPTH}" style="width:70px;padding:8px;border-radius:10px;border:1px solid var(--accent-tertiary);" />
                <label style="font-size:13px;">Per-node</label>
                <input id="uiPerNode" type="number" min="10" max="300" value="${DEFAULT_PER_NODE}" style="width:90px;padding:8px;border-radius:10px;border:1px solid var(--accent-tertiary);" />
                <label style="font-size:13px;">Max accts</label>
                <input id="uiMaxA" type="number" min="20" max="2000" value="${DEFAULT_MAX_ACCTS}" style="width:100px;padding:8px;border-radius:10px;border:1px solid var(--accent-tertiary);" />
                <label style="font-size:13px;">Max edges</label>
                <input id="uiMaxE" type="number" min="50" max="10000" value="${DEFAULT_MAX_EDGES}" style="width:110px;padding:8px;border-radius:10px;border:1px solid var(--accent-tertiary);" />
              </div>

              <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;align-items:center;">
                <label style="font-size:13px;">Date</label>
                <input id="uiStart" type="date" style="padding:8px;border-radius:8px;border:1px solid var(--accent-tertiary);" />
                <input id="uiEnd" type="date" style="padding:8px;border-radius:8px;border:1px solid var(--accent-tertiary);" />
                <label style="font-size:13px;margin-left:8px;">Ledger</label>
                <input id="uiLedgerMin" type="number" placeholder="min" style="width:110px;padding:8px;border-radius:8px;border:1px solid var(--accent-tertiary);" />
                <input id="uiLedgerMax" type="number" placeholder="max" style="width:110px;padding:8px;border-radius:8px;border:1px solid var(--accent-tertiary);" />
                <input id="uiMinXrp" type="number" placeholder="Min XRP" style="width:110px;padding:8px;border-radius:8px;border:1px solid var(--accent-tertiary);" />
              </div>

              <div style="margin-top:10px;display:flex;gap:8px;align-items:center;">
                <label style="font-size:13px;font-weight:700;">Explorer</label>
                <select id="uiExplorerSelect" style="padding:6px;border-radius:8px;border:1px solid var(--accent-tertiary);background:transparent;color:var(--text-primary);">
                  <option value="xrpscan">XRPScan</option>
                  <option value="bithomp">Bithomp</option>
                  <option value="custom">Custom...</option>
                </select>
                <input id="uiExplorerAcct" placeholder="account template (use {acct})" style="flex:1;min-width:220px;padding:6px;border-radius:8px;border:1px solid var(--accent-tertiary);background:transparent;color:var(--text-primary);" />
                <input id="uiExplorerTx" placeholder="tx template (use {tx})" style="flex:1;min-width:220px;padding:6px;border-radius:8px;border:1px solid var(--accent-tertiary);background:transparent;color:var(--text-primary);" />
                <button id="uiExplorerSave" class="nav-btn" style="padding:6px 10px;border-radius:8px;background:#50a8ff;border:none;color:#000;font-weight:900;">Save</button>
              </div>

              <div style="margin-top:10px;display:flex;gap:8px;align-items:center;">
                <label style="font-size:13px;font-weight:700;">Concurrency</label>
                <input id="uiConcurrency" type="number" min="1" max="8" value="${REQUEST_CONCURRENCY}" style="width:80px;padding:8px;border-radius:10px;border:1px solid var(--accent-tertiary);" />
                <div style="color:var(--text-secondary);font-size:12px;">Lower concurrency avoids hitting public nodes.</div>
              </div>

              <div id="uiProgress" style="margin-top:10px;height:10px;background:rgba(255,255,255,0.04);border-radius:8px;overflow:hidden;display:none;">
                <div id="uiProgressBar" style="height:100%;width:0%;background:linear-gradient(90deg,#50fa7b,#2ecc71)"></div>
              </div>

              <div id="uiStatus" style="margin-top:8px;color:var(--text-secondary)">Ready</div>
            </div>

            <div style="padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,0.06);background:var(--card-bg);">
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                <div style="font-weight:900;">Issuer Tree</div>
                <input id="uiSearch" placeholder="Search edges..." style="margin-left:auto;flex:1;min-width:260px;padding:10px;border-radius:10px;border:1px solid var(--accent-tertiary);background:transparent;color:var(--text-primary);" />
              </div>

              <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
                <input id="uiTarget" placeholder="Target address (path optional)" style="flex:1;min-width:260px;padding:10px;border-radius:10px;border:1px solid var(--accent-tertiary);background:transparent;color:var(--text-primary);" />
                <button id="uiFindPath" class="nav-btn" style="padding:10px 12px;border-radius:10px;background:#ffd1a9;border:none;color:#000;font-weight:900;">Path</button>
                <button id="uiPatterns" class="nav-btn" style="padding:10px 12px;border-radius:10px;background:#bd93f9;border:none;color:#000;font-weight:900;">Patterns</button>
              </div>

              <div id="uiTree" style="margin-top:10px;max-height:520px;overflow:auto;border-radius:10px;border:1px solid rgba(255,255,255,0.05);padding:10px;background:rgba(0,0,0,0.12);"></div>
            </div>
          </div>

          <div style="display:flex;flex-direction:column;gap:10px;">
            <div id="uiSummary" style="padding:12px;background:rgba(255,255,255,0.02);border-radius:12px;min-height:220px;border:1px solid rgba(255,255,255,0.06);">
              <div style="opacity:.8">Tree summary appears here.</div>
              <div id="uiFlowMini" style="margin-top:10px;"></div>
            </div>

            <div id="uiResults" style="padding:12px;background:rgba(255,255,255,0.02);border-radius:12px;min-height:220px;border:1px solid rgba(255,255,255,0.06);">
              <div style="opacity:.8">Path + patterns appear here.</div>
            </div>

            <div id="uiEdgeList" style="padding:12px;background:rgba(255,255,255,0.02);border-radius:12px;min-height:220px;max-height:420px;overflow:auto;border:1px solid rgba(255,255,255,0.06);">
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                <strong>Edges (counterparty-derived)</strong>
                <button id="uiExportGraph" class="nav-btn" style="margin-left:auto;padding:8px 10px;border-radius:10px;border:none;background:#50a8ff;color:#000;font-weight:900;cursor:pointer;">Export</button>
              </div>
              <div id="uiEdgeItems" style="margin-top:10px;"></div>
            </div>
          </div>
        </div>

        <div id="uiModalOverlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);align-items:center;justify-content:center;z-index:12000;">
          <div style="width:min(940px,95%);max-height:80vh;overflow:auto;background:var(--bg-secondary);padding:14px;border-radius:10px;border:1px solid var(--accent-tertiary);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <strong id="uiModalTitle">Details</strong>
              <button id="uiModalClose">✕</button>
            </div>
            <div id="uiModalBody"></div>
          </div>
        </div>
      </div>
    `;

    // hydrate explorer UI defaults
    const ex = $("uiExplorerSelect");
    if (ex) ex.value = explorerSettings.selected || "xrpscan";
    if ($("uiExplorerAcct")) $("uiExplorerAcct").value = explorerSettings.customAcct || "";
    if ($("uiExplorerTx")) $("uiExplorerTx").value = explorerSettings.customTx || "";

    const closeBtn = $("uiModalClose");
    if (closeBtn) closeBtn.addEventListener("click", closeModal);

    const retryBtn = $("uiRetryWs");
    if (retryBtn) retryBtn.addEventListener("click", () => {
      attemptSharedReconnect("manual retry");
      setStatus("Retry requested.");
    });

    const explorerSave = $("uiExplorerSave");
    if (explorerSave) explorerSave.addEventListener("click", () => {
      const sel = ($("uiExplorerSelect") || {}).value;
      const acct = ($("uiExplorerAcct") || {}).value.trim();
      const tx = ($("uiExplorerTx") || {}).value.trim();
      saveExplorerSettings({ selected: sel, customAcct: acct, customTx: tx });
      setStatus("Explorer saved.");
    });

    updateConnBadge();
    window.addEventListener("xrpl-connection", () => updateConnBadge());
    setInterval(updateConnBadge, 1500);

    const list = getIssuerList();
    if ($("uiIssuerList")) $("uiIssuerList").value = list.join("\n");
    hydrateIssuerSelect();

    const issuerSelect = $("uiIssuerSelect");
    if (issuerSelect) issuerSelect.addEventListener("change", () => onIssuerSelected($("uiIssuerSelect").value));
    const saveList = $("uiSaveList");
    if (saveList) saveList.addEventListener("click", () => {
      const arr = normalizeIssuerListText(($("uiIssuerList") || {}).value);
      setIssuerList(arr);
      hydrateIssuerSelect();
      setStatus(`Saved issuer list (${arr.length})`);
    });

    const clearCacheBtn = $("uiClearCache");
    if (clearCacheBtn) clearCacheBtn.addEventListener("click", () => {
      const prevIssuerRegistry = new Map(issuerRegistry);
      issuerRegistry.clear();
      activationCache.clear();
      accountInfoCache.clear();
      sessionCache.account_tx.clear();
      clearViews();
      setStatus("Cache cleared. <button id='uiUndoClear' class='nav-btn'>Undo</button>");
      const undoBtn = $("uiUndoClear");
      if (undoBtn) {
        undoBtn.addEventListener("click", () => {
          for (const [k, v] of prevIssuerRegistry.entries()) issuerRegistry.set(k, v);
          setStatus("Cache restored (undo).");
          renderAll(issuerRegistry.get(activeIssuer) || {});
        });
      }
    });

    const buildBtn = $("uiBuild");
    if (buildBtn) buildBtn.addEventListener("click", () => buildTreeClicked().catch(() => {}));
    const searchEl = $("uiSearch");
    if (searchEl) searchEl.addEventListener("input", renderEdgeFilterActive);
    const findPathBtn = $("uiFindPath");
    if (findPathBtn) findPathBtn.addEventListener("click", findPathClicked);
    const patternsBtn = $("uiPatterns");
    if (patternsBtn) patternsBtn.addEventListener("click", patternsClicked);
    const exportBtn = $("uiExportGraph");
    if (exportBtn) exportBtn.addEventListener("click", exportActiveGraph);

    const concurrencyEl = $("uiConcurrency");
    if (concurrencyEl) {
      concurrencyEl.addEventListener("change", () => {
        const n = clampInt(Number(($("uiConcurrency") || {}).value || REQUEST_CONCURRENCY), 1, 8);
        REQUEST_CONCURRENCY = n;
        requestPool = createPool(REQUEST_CONCURRENCY);
        setStatus(`Concurrency set to ${n}`);
      });
    }
  }

  function clearViews() {
    if ($("uiTree")) $("uiTree").innerHTML = "";
    if ($("uiSummary")) $("uiSummary").innerHTML = `<div style="opacity:.8">Tree summary appears here.</div>`;
    if ($("uiResults")) $("uiResults").innerHTML = `<div style="opacity:.8">Path + patterns appear here.</div>`;
    if ($("uiEdgeItems")) $("uiEdgeItems").innerHTML = "";
    const mini = $("uiFlowMini");
    if (mini) mini.innerHTML = "";
  }

  function renderAll(g) {
    renderSummary(g);
    renderTree(g);
    renderEdgeFilter(g);
  }

  function renderSummary(g) {
    if (!g) {
      if ($("uiSummary")) $("uiSummary").innerHTML = `<div style="opacity:.8">No graph</div>`;
      return;
    }
    const issuer = g.issuer;
    const edges = g.edges.length;
    const accounts = g.nodes.size;

    const issuerNode = g.nodes.get(issuer);
    const info = issuerNode?.acctInfo || null;
    const actEntry = issuerNode?.activation || null;
    const act = actEntry?.act || null;

    const domain = info?.domain ? escapeHtml(info.domain) : "—";
    const bal = info?.balanceXrp != null ? `${info.balanceXrp.toFixed(6)} XRP` : "—";

    const actHtml = act
      ? (() => {
          const links = act.tx_hash ? { xrpscan: getExplorerUrlForTx(act.tx_hash), bithomp: getExplorerUrlForTx(act.tx_hash) } : null;
          const txLinks = links
            ? `<a href="${escapeHtml(links.xrpscan)}" target="_blank" rel="noopener noreferrer">XRPScan</a>
               <a href="${escapeHtml(links.bithomp)}" target="_blank" rel="noopener noreferrer" style="margin-left:10px;">Bithomp</a>`
            : "";
          const amt = act.amount != null ? `XRP ${act.amount.toFixed(6)}` : escapeHtml(act.currency || "—");
          return `<div style="margin-top:8px;"><strong>Activated by</strong>: <code>${escapeHtml(act.activatedBy)}</code> • ${escapeHtml(
            amt
          )} • ${escapeHtml(act.date || "—")} <span style="opacity:.7">(${escapeHtml(actEntry.source)})</span>
          <div style="margin-top:4px;font-size:12px;opacity:.85;">${txLinks}</div>
          </div>`;
        })()
      : `<div style="margin-top:8px;opacity:.85;"><strong>Activated by</strong>: — <span style="opacity:.7">(${escapeHtml(
          actEntry?.source || "unknown"
        )}${actEntry && !actEntry.complete ? ", incomplete" : ""})</span></div>`;

    if ($("uiSummary")) {
      $("uiSummary").innerHTML = `
        <div><strong>Issuer</strong>: <code>${escapeHtml(issuer)}</code></div>
        <div style="margin-top:8px;"><strong>Domain</strong>: ${domain}</div>
        <div style="margin-top:6px;"><strong>Balance</strong>: ${escapeHtml(bal)} • Seq: ${escapeHtml(info?.sequence ?? "—")} • Owners: ${escapeHtml(info?.ownerCount ?? "—")}</div>
        ${actHtml}
        <div style="margin-top:10px;">Accounts: <strong>${escapeHtml(accounts)}</strong> • Edges: <strong>${escapeHtml(edges)}</strong></div>
        <div style="margin-top:6px;opacity:.8;font-size:12px;">Built: ${escapeHtml(g.builtAt || "—")}</div>
      `;
    }

    const mini = $("uiFlowMini");
    if (mini) {
      mini.innerHTML = `<div id="cyMini" style="width:100%;height:84px;border-radius:8px;background:rgba(0,0,0,0.02);padding:6px;"></div>`;
      renderMiniFlow(g, g.issuer, "cyMini").catch((e) => {
        mini.innerHTML = `<div style="opacity:.8">Flow preview unavailable</div>`;
        console.warn("cy mini failed", e);
      });
    }
  }

  function renderTree(g) {
    const host = $("uiTree");
    if (!host) return;

    const levels = new Map();
    levels.set(g.issuer, 0);
    const qq = [g.issuer];

    while (qq.length) {
      const cur = qq.shift();
      const lv = levels.get(cur) ?? 0;
      if (lv >= g.params.depth) continue;

      const idxs = g.adjacency.get(cur) || [];
      for (const ei of idxs) {
        const e = g.edges[ei];
        if (!levels.has(e.to)) {
          levels.set(e.to, lv + 1);
          qq.push(e.to);
        }
      }
    }

    const children = new Map();
    for (const addr of levels.keys()) children.set(addr, []);
    for (const [child, parent] of g.parentChoice.entries()) {
      if (!parent) continue;
      if (levels.has(child) && levels.has(parent) && levels.get(child) === levels.get(parent) + 1) {
        children.get(parent).push(child);
      }
    }
    for (const [p, arr] of children.entries()) {
      arr.sort((a, b) => (g.nodes.get(b)?.inCount || 0) - (g.nodes.get(a)?.inCount || 0));
    }

    function activationLine(entry) {
      if (!entry) return `<div style="opacity:.7;font-size:12px;">activated by: —</div>`;
      if (!entry.act) {
        return `<div style="opacity:.75;font-size:12px;">activated by: — <span style="opacity:.7">(${escapeHtml(entry.source || "unknown")}${
          entry.complete ? "" : ", incomplete"
        })</span></div>`;
      }
      const act = entry.act;
      const amt = act.amount != null ? `XRP ${act.amount.toFixed(6)}` : escapeHtml(act.currency || "—");
      return `<div style="opacity:.85;font-size:12px;">activated by: <code>${escapeHtml(act.activatedBy)}</code> • ${escapeHtml(
        amt
      )} • ${escapeHtml(act.date || "—")}</div>`;
    }

    function nodeRow(addr) {
      const n = g.nodes.get(addr);
      const lvl = levels.get(addr) ?? n?.level ?? 0;
      const firstN = Array.isArray(n?.outgoingFirst) ? n.outgoingFirst.length : 0;

      return `
        <div>
          <div><code>${escapeHtml(addr)}</code> <span style="opacity:.7">lvl ${escapeHtml(lvl)}</span></div>
          ${activationLine(n?.activation)}
          <div style="opacity:.75;font-size:12px;margin-top:4px;">
            edges out:${escapeHtml(n?.outCount ?? 0)} (XRP ${(n?.outXrp ?? 0).toFixed(2)}) •
            edges in:${escapeHtml(n?.inCount ?? 0)} (XRP ${(n?.inXrp ?? 0).toFixed(2)}) •
            recent outgoing loaded:${escapeHtml(firstN)}
          </div>
        </div>
      `;
    }

    function renderRec(addr, indentPx) {
      const kids = children.get(addr) || [];
      const sectionId = `uiKids_${addr}`;
      const hasKids = kids.length > 0;

      const head = `
        <div style="padding:8px;border-bottom:1px dashed rgba(255,255,255,0.05);margin-left:${indentPx}px;">
          <div style="display:flex;align-items:flex-start;gap:8px;">
            ${
              hasKids
                ? `<button class="uiToggle" data-target="${escapeHtml(sectionId)}" style="width:28px;height:28px;border-radius:10px;border:1px solid var(--accent-tertiary);background:transparent;cursor:pointer;">▸</button>`
                : `<div style="width:28px;height:28px;opacity:.35;display:flex;align-items:center;justify-content:center;">•</div>`
            }
            <div style="flex:1;">${nodeRow(addr)}</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
              <button class="uiNode" data-addr="${escapeHtml(addr)}" style="padding:6px 10px;border-radius:10px;border:none;background:#50fa7b;color:#000;cursor:pointer;font-weight:900;">Inspect</button>
              <button class="uiMiniFlow" data-addr="${escapeHtml(addr)}" title="Flow" style="padding:6px 10px;border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:transparent;color:var(--text-primary);cursor:pointer;">Flow</button>
            </div>
          </div>
          ${hasKids ? `<div id="${escapeHtml(sectionId)}"></div>` : ""}
        </div>
      `;

      let html = head;
      if (hasKids) {
        const inner = kids.map((k) => renderRec(k, indentPx + 18)).join("");
        html = html.replace(`<div id="${escapeHtml(sectionId)}"></div>`, `<div id="${escapeHtml(sectionId)}">${inner}</div>`);
      }
      return html;
    }

    host.innerHTML = renderRec(g.issuer, 0);

    Array.from(document.querySelectorAll(".uiToggle")).forEach((btn) =>
      btn.addEventListener("click", () => {
        const target = btn.getAttribute("data-target");
        const el = document.getElementById(target);
        if (!el) return;
        const open = el.style.display !== "none";
        el.style.display = open ? "none" : "block";
        btn.textContent = open ? "▸" : "▾";
      })
    );

    Array.from(document.querySelectorAll(".uiNode")).forEach((btn) =>
      btn.addEventListener("click", () => showNodeModal(g, btn.getAttribute("data-addr")))
    );

    Array.from(document.querySelectorAll(".uiMiniFlow")).forEach((btn) =>
      btn.addEventListener("click", () => {
        renderMiniFlow(g, btn.getAttribute("data-addr"), null, { openPanel: true }).catch(() => {});
      })
    );
  }

  function renderEdgeFilter(g) {
    const q = String(($("uiSearch") || {}).value || "").trim().toLowerCase();
    const items = $("uiEdgeItems");
    if (!items) return;

    const filtered = q
      ? g.edges.filter((e) => {
          const hay = `${e.from} ${e.to} ${e.tx_hash} ${e.type} ${e.kind} ${e.currency} ${e.amount} ${e.ledger_index} ${e.date || ""}`.toLowerCase();
          return hay.includes(q);
        })
      : g.edges;

    const slice = filtered.slice(0, 300);
    items.innerHTML =
      slice
        .map((e) => {
          const shortHash = e.tx_hash ? e.tx_hash.slice(0, 10) + "…" : "";
          const txLink = e.tx_hash ? getExplorerUrlForTx(e.tx_hash) : "#";
          return `<div style="padding:8px;border-bottom:1px dashed rgba(255,255,255,0.05);font-size:12px;">
            <div><code>${escapeHtml(e.from.slice(0, 8))}…</code> → <code>${escapeHtml(e.to.slice(0, 8))}…</code>
              • ${escapeHtml(e.type)} <span style="opacity:.7">(${escapeHtml(e.kind)})</span>
              • ledger ${escapeHtml(e.ledger_index)}
              • ${escapeHtml(e.currency)} ${escapeHtml(e.amount)}
              <span style="margin-left:8px;"><a href="${escapeHtml(txLink)}" target="_blank" rel="noopener noreferrer">tx</a></span>
            </div>
            <div style="opacity:.75;">${escapeHtml(e.date || "—")} • ${escapeHtml(shortHash)}</div>
          </div>`;
        })
        .join("") || `<div style="opacity:.7">No edges (try increasing per-node / clearing filters).</div>`;
  }

  function renderEdgeFilterActive() {
    const g = issuerRegistry.get(activeIssuer);
    if (!g) return;
    renderEdgeFilter(g);
  }

  function showNodeModal(g, addr) {
    if (!addr) return;
    const n = g.nodes.get(addr);
    if (!n) return;

    const actEntry = n.activation;
    const act = actEntry?.act || null;

    const info = n.acctInfo;
    const domain = info?.domain || null;
    const balance = info?.balanceXrp != null ? info.balanceXrp.toFixed(6) : null;

    const outgoing = Array.isArray(n.outgoingFirst) ? n.outgoingFirst : [];

    const hashesOnly = outgoing.map((x) => x.tx_hash).filter(Boolean).join("\n");
    const csv = [
      ["tx_hash", "type", "counterparty", "counterpartyKind", "ledger_index", "date", "amount", "currency"].join(","),
      ...outgoing.map((x) =>
        [
          `"${String(x.tx_hash || "").replace(/"/g, '""')}"`,
          `"${String(x.type || "").replace(/"/g, '""')}"`,
          `"${String(x.counterparty || "").replace(/"/g, '""')}"`,
          `"${String(x.counterpartyKind || "").replace(/"/g, '""')}"`,
          Number(x.ledger_index || 0),
          `"${String(x.date || "").replace(/"/g, '""')}"`,
          Number.isFinite(Number(x.amount)) ? Number(x.amount) : "",
          `"${String(x.currency || "").replace(/"/g, '""')}"`
        ].join(",")
      )
    ].join("\n");

    const actLinks = act?.tx_hash ? { xrpscan: getExplorerUrlForTx(act.tx_hash), bithomp: getExplorerUrlForTx(act.tx_hash) } : null;

    const actBlock = act
      ? `
        <div style="margin-top:10px;">
          <div style="font-weight:900;">Activated by</div>
          <div style="margin-top:6px;">
            <code>${escapeHtml(act.activatedBy)}</code>
            <span style="opacity:.8;"> • ledger ${escapeHtml(act.ledger_index)} • ${escapeHtml(act.date || "—")}</span>
          </div>
          <div style="margin-top:6px;opacity:.9;">
            ${act.amount != null ? `XRP ${escapeHtml(act.amount.toFixed(6))}` : escapeHtml(act.currency || "—")}
            <span style="opacity:.7;">(${escapeHtml(actEntry.source || "unknown")})</span>
          </div>
          <div style="margin-top:6px;font-size:12px;opacity:.9;">
            ${
              actLinks?.xrpscan
                ? `<a href="${escapeHtml(actLinks.xrpscan)}" target="_blank" rel="noopener noreferrer">XRPScan</a>
                   <a href="${escapeHtml(actLinks.bithomp)}" target="_blank" rel="noopener noreferrer" style="margin-left:10px;">Bithomp</a>`
                : `<span style="opacity:.75;">no tx link</span>`
            }
          </div>
        </div>
      `
      : `
        <div style="margin-top:10px;">
          <div style="font-weight:900;">Activated by</div>
          <div style="margin-top:6px;opacity:.85;">— <span style="opacity:.7;">(${escapeHtml(actEntry?.source || "unknown")}${
            actEntry && !actEntry.complete ? ", incomplete" : ""
          })</span></div>
        </div>
      `;

    const metaLine = n.outgoingMeta
      ? `<div style="margin-top:10px;opacity:.8;font-size:12px;">scan: pages=${escapeHtml(n.outgoingMeta.pages)} • scanned=${escapeHtml(n.outgoingMeta.scanned)} • mode=${escapeHtml(n.outgoingMeta.mode || "")}</div>`
      : "";

    const rows = outgoing
      .slice(0, 200)
      .map((x, i) => {
        const links = x.tx_hash ? { xrpscan: getExplorerUrlForTx(x.tx_hash) } : null;
        const cp = x.counterparty ? `<code>${escapeHtml(x.counterparty)}</code>` : `<span style="opacity:.6;">—</span>`;
        const cpKind = x.counterpartyKind ? `<span style="opacity:.7;">${escapeHtml(x.counterpartyKind)}</span>` : "";
        const amt = `${escapeHtml(x.currency)} ${Number.isFinite(Number(x.amount)) ? escapeHtml(Number(x.amount).toFixed(6)) : "—"}`;
        const txLink = links?.xrpscan ? `<a href="${escapeHtml(links.xrpscan)}" target="_blank" rel="noopener noreferrer">tx</a>` : "";
        return `
          <div style="padding:8px;border-bottom:1px dashed rgba(255,255,255,0.08);font-size:12px;">
            <div style="display:flex;justify-content:space-between;gap:10px;">
              <div><strong>#${i + 1}</strong> • ${escapeHtml(x.type)} • ${cp} ${cpKind}</div>
              <div style="opacity:.8;">ledger ${escapeHtml(x.ledger_index)} • ${escapeHtml(x.date || "—")} • ${txLink}</div>
            </div>
            <div style="margin-top:4px;opacity:.9;">${escapeHtml(amt)}</div>
          </div>
        `;
      })
      .join("");

    const html = `
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start;">
        <div style="flex:1;min-width:320px;padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.02);">
          <div style="font-weight:900;">Account</div>
          <div style="margin-top:6px;"><code>${escapeHtml(addr)}</code></div>
          <div style="margin-top:8px;opacity:.9;"><strong>Domain</strong>: ${domain ? escapeHtml(domain) : "—"}</div>
          <div style="margin-top:6px;opacity:.9;"><strong>Balance</strong>: ${balance != null ? escapeHtml(balance) + " XRP" : "—"} • Seq: ${escapeHtml(info?.sequence ?? "—")} • Owners: ${escapeHtml(info?.ownerCount ?? "—")}</div>
          ${actBlock}
          ${metaLine}
        </div>

        <div style="width:360px;min-width:300px;padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.02);">
          <div style="font-weight:900;">Actions</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
            <button id="uiCopyHashes" style="padding:8px 10px;border-radius:10px;border:none;background:#50a8ff;color:#000;font-weight:900;cursor:pointer;">Copy hashes</button>
            <button id="uiExportCsv" style="padding:8px 10px;border-radius:10px;border:none;background:#ffd166;color:#000;font-weight:900;cursor:pointer;">Export CSV</button>
            <button id="uiExportTxt" style="padding:8px 10px;border-radius:10px;border:1px solid var(--accent-tertiary);background:transparent;color:var(--text-primary);cursor:pointer;">Download hashes</button>
            <button id="uiShowRaw" style="padding:8px 10px;border-radius:10px;border:none;background:#bd93f9;color:#000;font-weight:900;cursor:pointer;">Raw JSON</button>
            <a id="uiExplorerAcct" class="about-btn" style="padding:8px 10px;border-radius:10px;background:transparent;color:var(--text-primary);" target="_blank" href="${escapeHtml(getExplorerUrlForAccount(addr))}">Explorer</a>
          </div>
          <div style="margin-top:10px;opacity:.85;font-size:12px;">
            outgoing loaded: <strong>${escapeHtml(outgoing.length)}</strong>
          </div>
          <div style="margin-top:6px;opacity:.75;font-size:12px;">
            note: edges only created when counterparty exists (Payment/TrustSet/OfferCreate issuer).
          </div>
        </div>

        <div style="width:100%;margin-top:12px;">
          <div style="font-weight:900;margin-bottom:8px;">Flow: where value came from → ${escapeHtml(addr)} → where it went (top counterparties)</div>
          <div id="uiFlowDiagram" style="width:100%;height:360px;border-radius:8px;border:1px solid rgba(255,255,255,0.06);background:rgba(0,0,0,0.04);padding:6px;">
            <div id="cyFlowContainer" style="width:100%;height:100%;"></div>
          </div>
        </div>
      </div>

      <div style="margin-top:12px;padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,0.08);background:rgba(0,0,0,0.12);">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <div style="font-weight:900;">Recent outgoing transactions</div>
          <div style="opacity:.75;font-size:12px;">(shown chronological)</div>
        </div>
        <div style="margin-top:10px;max-height:420px;overflow:auto;border-radius:10px;border:1px solid rgba(255,255,255,0.06);">
          ${rows || `<div style="padding:12px;opacity:.75;">No outgoing txs found in this range. Try removing date/ledger filters or increasing per-node.</div>`}
        </div>
      </div>
    `;

    openModal(`Node: ${addr}`, html);

    const copyBtn = $("uiCopyHashes");
    if (copyBtn) copyBtn.onclick = async () => {
      const ok = await copyToClipboard(hashesOnly || "");
      copyBtn.textContent = ok ? "Copied ✅" : "Copy failed ❌";
      setTimeout(() => (copyBtn.textContent = "Copy hashes"), 1200);
    };
    const csvBtn = $("uiExportCsv");
    if (csvBtn) csvBtn.onclick = () => downloadText(csv, `naluxrp-node-${addr}-outgoing-${outgoing.length}-txs.csv`, "text/csv");
    const txtBtn = $("uiExportTxt");
    if (txtBtn) txtBtn.onclick = () => downloadText(hashesOnly, `naluxrp-node-${addr}-tx-hashes.txt`, "text/plain");
    const rawBtn = $("uiShowRaw");
    if (rawBtn) rawBtn.onclick = () => {
      const rawObj = { address: addr, node: n };
      openModal(`Raw: ${addr}`, `<pre style="white-space:pre-wrap;">${escapeHtml(JSON.stringify(rawObj, null, 2))}</pre>`);
    };

    // render flow diagram for this node using Cytoscape
    renderFlowDiagramForNode(g, addr, "cyFlowContainer").catch((e) => {
      console.warn("Flow cytoscape error", e);
      const c = $("cyFlowContainer");
      if (c) c.innerHTML = `<div style="padding:12px;color:var(--text-secondary)">Flow preview unavailable</div>`;
    });
  }

  async function renderMiniFlow(g, account, containerId, opts = {}) {
    const maxNodes = 6;
    const container = (typeof containerId === "string" ? $(containerId) : containerId) || null;
    const openPanel = opts.openPanel;
    const inbound = {};
    const outbound = {};

    for (const e of g.edges) {
      if (e.to === account && e.currency === "XRP") {
        inbound[e.from] = (inbound[e.from] || 0) + Number(e.amount || 0);
      }
      if (e.from === account && e.currency === "XRP") {
        outbound[e.to] = (outbound[e.to] || 0) + Number(e.amount || 0);
      }
    }

    const inList = Object.entries(inbound).map(([a, v]) => ({ a, v })).sort((a, b) => b.v - a.v).slice(0, 3);
    const outList = Object.entries(outbound).map(([a, v]) => ({ a, v })).sort((a, b) => b.v - a.v).slice(0, 3);

    if (openPanel && !container) {
      openModal(`Flow: ${account}`, `<div style="width:100%;height:480px;"><div id="cyMiniModal" style="width:100%;height:100%;"></div></div>`);
      await renderMiniFlowCytoscape(g, account, "cyMiniModal", inList, outList);
      return;
    }

    if (!container) return;

    const elements = [];
    const nodesMap = new Map();
    const centerId = `n_${account}`;

    nodesMap.set(centerId, { data: { id: centerId, label: shortAddr(account), color: "#06b6d4", size: 36 } });
    elements.push(nodesMap.get(centerId));

    inList.forEach((it, i) => {
      const id = `in_${i}_${it.a}`;
      elements.push({ data: { id, label: shortAddr(it.a), color: "#3b82f6", size: 28 } });
      elements.push({ data: { id: `e_${id}_${centerId}`, source: id, target: centerId, width: Math.max(2, Math.round((it.v / Math.max(1, inList[0]?.v || 1)) * 8)), color: "rgba(59,130,246,0.6)" } });
    });

    outList.forEach((it, i) => {
      const id = `out_${i}_${it.a}`;
      elements.push({ data: { id, label: shortAddr(it.a), color: "#f97316", size: 28 } });
      elements.push({ data: { id: `e_${centerId}_${id}`, source: centerId, target: id, width: Math.max(2, Math.round((it.v / Math.max(1, outList[0]?.v || 1)) * 8)), color: "rgba(249,115,22,0.6)" } });
    });

    await renderCytoscape(container, elements, {
      layout: "cose",
      onNodeClick: (data) => {
        const label = data.id || "";
        if (label.startsWith("n_")) {
          const acct = label.slice(2);
          showNodeModal(g, acct);
        } else {
          const parts = (data.id || "").split("_");
          const possible = parts.slice(2).join("_");
          if (isValidXrpAddress(possible)) showNodeModal(g, possible);
        }
      }
    });
  }

  async function renderMiniFlowCytoscape(g, account, containerId, inList, outList) {
    const container = $(containerId);
    if (!container) return;
    container.innerHTML = "";

    const elements = [];
    const centerId = `n_${account}`;
    elements.push({ data: { id: centerId, label: account, color: "#06b6d4", size: 48 } });

    inList.forEach((it, i) => {
      const id = `in_${i}_${it.a}`;
      elements.push({ data: { id, label: it.a, color: "#3b82f6", size: 36 } });
      elements.push({ data: { id: `e_${id}_${centerId}`, source: id, target: centerId, width: Math.max(2, Math.round((it.v / Math.max(1, inList[0]?.v || 1)) * 12)), color: "rgba(59,130,246,0.6)" } });
    });

    outList.forEach((it, i) => {
      const id = `out_${i}_${it.a}`;
      elements.push({ data: { id, label: it.a, color: "#f97316", size: 36 } });
      elements.push({ data: { id: `e_${centerId}_${id}`, source: centerId, target: id, width: Math.max(2, Math.round((it.v / Math.max(1, outList[0]?.v || 1)) * 12)), color: "rgba(249,115,22,0.6)" } });
    });

    await renderCytoscape(container, elements, {
      layout: "cose",
      onNodeClick: (data) => {
        const id = data.id || "";
        if (id.startsWith("n_")) {
          showNodeModal(g, id.slice(2));
        } else {
          const parts = id.split("_");
          const acct = parts.slice(2).join("_");
          if (isValidXrpAddress(acct)) showNodeModal(g, acct);
        }
      },
      fitAfter: true
    });
  }

  async function renderFlowDiagramForNode(g, account, containerId) {
    const container = $(containerId);
    if (!container) return;
    container.innerHTML = "";

    const inbound = {};
    const outbound = {};

    for (const e of g.edges) {
      if (e.to === account && e.currency === "XRP") {
        inbound[e.from] = (inbound[e.from] || 0) + Number(e.amount || 0);
      }
      if (e.from === account && e.currency === "XRP") {
        outbound[e.to] = (outbound[e.to] || 0) + Number(e.amount || 0);
      }
    }

    const inList = Object.entries(inbound).map(([a, v]) => ({ a, v })).sort((a, b) => b.v - a.v).slice(0, 6);
    const outList = Object.entries(outbound).map(([a, v]) => ({ a, v })).sort((a, b) => b.v - a.v).slice(0, 6);

    const elements = [];
    const addNode = (id, label, color, size = 36) => elements.push({ data: { id, label, color, size } });

    const centerId = `n_${account}`;
    addNode(centerId, shortAddr(account), "#06b6d4", 52);

    inList.forEach((it, i) => {
      const id = `in_${i}_${it.a}`;
      addNode(id, shortAddr(it.a), "#3b82f6", 40);
      elements.push({ data: { id: `e_${id}_${centerId}`, source: id, target: centerId, width: Math.max(2, Math.round((it.v / Math.max(1, inList[0]?.v || 1)) * 12)), color: "rgba(59,130,246,0.6)" } });
    });

    outList.forEach((it, i) => {
      const id = `out_${i}_${it.a}`;
      addNode(id, shortAddr(it.a), "#f97316", 40);
      elements.push({ data: { id: `e_${centerId}_${id}`, source: centerId, target: id, width: Math.max(2, Math.round((it.v / Math.max(1, outList[0]?.v || 1)) * 12)), color: "rgba(249,115,22,0.6)" } });
    });

    await renderCytoscape(container, elements, {
      layout: "cose",
      onNodeClick: (data) => {
        const id = data.id || "";
        if (id === centerId) return;
        const parts = id.split("_");
        const acct = parts.slice(2).join("_");
        if (isValidXrpAddress(acct)) showNodeModal(g, acct);
      }
    });
  }

  // ---------------- EXPORT GRAPH ----------------
  function exportActiveGraph() {
    const g = issuerRegistry.get(activeIssuer);
    if (!g) {
      setStatus("Build a tree first.");
      return;
    }

    const exportObj = {
      version: MODULE_VERSION,
      issuer: g.issuer,
      builtAt: g.builtAt,
      transport: { lastSource: transportState.lastSource, wsConnected: transportState.wsConnected, lastError: transportState.lastError },
      params: g.params,
      nodes: Array.from(g.nodes.values()).map((n) => ({
        address: n.address,
        level: n.level,
        outCount: n.outCount,
        inCount: n.inCount,
        outXrp: Number(n.outXrp.toFixed(6)),
        inXrp: Number(n.inXrp?.toFixed ? n.inXrp.toFixed(6) : (n.inXrp||0)),
        domain: n.acctInfo?.domain || null,
        balanceXrp: n.acctInfo?.balanceXrp ?? null,
        activated_by: n.activation?.act || null,
        activation_source: n.activation?.source || null,
        activation_complete: n.activation?.complete ?? null,
        outgoingMeta: n.outgoingMeta || null,
        recentOutgoing: n.outgoingFirst || []
      })),
      edges: g.edges
    };

    downloadText(JSON.stringify(exportObj, null, 2), `naluxrp-issuer-tree-${g.issuer}-${Date.now()}.json`, "application/json");
  }

  // ---------------- PATH / PATTERNS ----------------
  function findShortestPath(g, src, dst) {
    if (src === dst) return [src];
    const prev = new Map();
    const q = [src];
    prev.set(src, null);

    while (q.length) {
      const cur = q.shift();
      const idxs = g.adjacency.get(cur) || [];
      for (const ei of idxs) {
        const e = g.edges[ei];
        const nxt = e.to;
        if (!prev.has(nxt)) {
          prev.set(nxt, cur);
          if (nxt === dst) {
            const path = [];
            let x = dst;
            while (x != null) {
              path.push(x);
              x = prev.get(x);
            }
            return path.reverse();
          }
          q.push(nxt);
        }
      }
    }
    return null;
  }

  function findPathClicked() {
    const g = issuerRegistry.get(activeIssuer);
    if (!g) {
      setStatus("Build a tree first.");
      return;
    }
    const target = ($("uiTarget") || {}).value?.trim();
    if (!isValidXrpAddress(target)) {
      setStatus("Enter a valid target address.");
      return;
    }
    const path = findShortestPath(g, g.issuer, target);
    if (!path) {
      if ($("uiResults")) $("uiResults").innerHTML = `<div>No path found (within current tree).</div>`;
      return;
    }
    if ($("uiResults")) {
      $("uiResults").innerHTML = `
        <div><strong>Shortest path</strong> (${escapeHtml(path.length - 1)} hops)</div>
        <div style="margin-top:8px;">${path
          .map((p) => `<div style="display:flex;align-items:center;gap:8px;"><code>${escapeHtml(p)}</code><button class="uiNodeMini" data-addr="${escapeHtml(
            p
          )}" style="padding:4px 8px;border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:transparent;color:var(--text-primary);cursor:pointer;">Inspect</button></div>`)
          .join("")}</div>
      `;
    }

    Array.from(document.querySelectorAll(".uiNodeMini")).forEach((btn) =>
      btn.addEventListener("click", () => showNodeModal(issuerRegistry.get(activeIssuer), btn.getAttribute("data-addr")))
    );
  }

  function runPatternScanFull(g) {
    const outBy = new Map();
    const inBy = new Map();
    for (const e of g.edges) {
      if (!outBy.has(e.from)) outBy.set(e.from, []);
      outBy.get(e.from).push(e);
      if (!inBy.has(e.to)) inBy.set(e.to, []);
      inBy.get(e.to).push(e);
    }

    const issuerOut = outBy.get(g.issuer) || [];
    const firstHopCounts = new Map();
    for (const e of issuerOut) firstHopCounts.set(e.to, (firstHopCounts.get(e.to) || 0) + 1);
    const top = Array.from(firstHopCounts.entries()).sort((a, b) => b[1] - a[1])[0] || [null, 0];
    const dom = issuerOut.length ? top[1] / issuerOut.length : 0;

    const hubCounts = new Map();
    const firstHop = new Set(issuerOut.map((e) => e.to));

    for (const leaf of firstHop) {
      const outs = outBy.get(leaf) || [];
      for (const e of outs) {
        const hub = e.to;
        if (!hubCounts.has(hub)) hubCounts.set(hub, new Set());
        hubCounts.get(hub).add(leaf);
      }
    }

    const reconHubs = Array.from(hubCounts.entries())
      .map(([hub, contributors]) => ({ hub, contributors: contributors.size }))
      .filter((x) => x.contributors >= 3)
      .sort((a, b) => b.contributors - a.contributors)
      .slice(0, 120);

    const bursts = [];
    const BURST_LEDGER_WINDOW = 200;
    const BURST_MIN_TX = 12;

    for (const n of g.nodes.values()) {
      const txs = Array.isArray(n.outgoingFirst) ? n.outgoingFirst : [];
      if (txs.length < BURST_MIN_TX) continue;

      const ledgers = txs.map((t) => Number(t.ledger_index || 0)).filter((x) => x > 0).sort((a, b) => a - b);
      if (ledgers.length < BURST_MIN_TX) continue;

      let best = 0;
      let bestSpan = null;

      let j = 0;
      for (let i = 0; i < ledgers.length; i++) {
        while (ledgers[i] - ledgers[j] > BURST_LEDGER_WINDOW) j++;
        const count = i - j + 1;
        if (count > best) {
          best = count;
          bestSpan = [ledgers[j], ledgers[i]];
        }
      }

      if (best >= BURST_MIN_TX && bestSpan) {
        bursts.push({ address: n.address, txs: best, span: bestSpan[1] - bestSpan[0], from: bestSpan[0], to: bestSpan[1] });
      }
    }

    bursts.sort((a, b) => b.txs - a.txs);

    const cycles = [];
    const seenCycle = new Set();

    const nodesLimit = 600;
    const nodeList = Array.from(g.nodes.keys()).slice(0, nodesLimit);

    function canonicalizeCycle(path) {
      const strs = path.slice(0, -1);
      if (!strs.length) return "";
      let best = strs;
      for (let i = 1; i < strs.length; i++) {
        const rotated = strs.slice(i).concat(strs.slice(0, i));
        if (rotated.join("|") < best.join("|")) best = rotated;
      }
      return best.join("|");
    }

    function dfs(start, cur, depthLeft, stack, visited) {
      if (cycles.length >= 120) return;

      const idxs = g.adjacency.get(cur) || [];
      for (const ei of idxs) {
        const nxt = g.edges[ei].to;

        if (nxt === start && stack.length >= 2) {
          const cyc = stack.concat([start]);
          const key = canonicalizeCycle(cyc);
          if (!seenCycle.has(key)) {
            seenCycle.add(key);
            cycles.push({ length: cyc.length - 1, path: cyc.slice() });
          }
          continue;
        }

        if (depthLeft <= 0) continue;
        if (visited.has(nxt)) continue;

        visited.add(nxt);
        stack.push(nxt);
        dfs(start, nxt, depthLeft - 1, stack, visited);
        stack.pop();
        visited.delete(nxt);
      }
    }

    const startNodes = [g.issuer]
      .concat(
        nodeList
          .filter((a) => a !== g.issuer)
          .sort((a, b) => (outBy.get(b)?.length || 0) - (outBy.get(a)?.length || 0))
          .slice(0, 18)
      )
      .slice(0, 24);

    for (const start of startNodes) {
      const visited = new Set([start]);
      dfs(start, start, 6, [start], visited);
      if (cycles.length >= 120) break;
    }

    cycles.sort((a, b) => a.length - b.length);

    const classicHubs = [];
    for (const addr of g.nodes.keys()) {
      const ins = inBy.get(addr) || [];
      const outs = outBy.get(addr) || [];
      const parents = new Set(ins.map((x) => x.from));
      const children = new Set(outs.map((x) => x.to));
      if (parents.size >= 6 && children.size <= 3 && ins.length >= 8 && outs.length >= 4) {
        classicHubs.push({ hub: addr, parents: parents.size, in: ins.length, children: children.size, out: outs.length });
      }
    }
    classicHubs.sort((a, b) => b.parents - a.parents);

    return {
      summary: {
        issuerFirstHopUniqueRecipients: firstHopCounts.size,
        issuerFirstHopDominancePct: Math.round(dom * 100),
        issuerTopRecipient: top[0],
        reconsolidationHubs: classicHubs.length,
        fanInHubsFromIssuerFirstHop: reconHubs.length,
        burstsDetected: bursts.length,
        cyclesDetected: cycles.length
      },
      reconHubs,
      classicHubs: classicHubs.slice(0, 120),
      bursts: bursts.slice(0, 120),
      cycles: cycles.slice(0, 60)
    };
  }

  function patternsClicked() {
    const g = issuerRegistry.get(activeIssuer);
    if (!g) {
      setStatus("Build a tree first.");
      return;
    }

    const report = runPatternScanFull(g);

    const hubRows = report.reconHubs.length
      ? report.reconHubs
          .map(
            (h) => `
        <div style="padding:8px;border-bottom:1px dashed rgba(255,255,255,0.08);font-size:12px;">
          <div><code>${escapeHtml(h.hub)}</code></div>
          <div style="opacity:.85;margin-top:4px;">contributors from issuer-first-hop: <strong>${escapeHtml(h.contributors)}</strong></div>
        </div>`
          )
          .join("")
      : `<div style="padding:12px;opacity:.75;">No fan-in hubs detected from issuer first-hop.</div>`;

    const burstRows = report.bursts.length
      ? report.bursts
          .map(
            (b) => `
        <div style="padding:8px;border-bottom:1px dashed rgba(255,255,255,0.08);font-size:12px;">
          <div><code>${escapeHtml(b.address)}</code></div>
          <div style="opacity:.85;margin-top:4px;">burst txs: <strong>${escapeHtml(b.txs)}</strong> • span: ${escapeHtml(b.span)} ledgers (${escapeHtml(
              b.from
            )} → ${escapeHtml(b.to)})</div>
        </div>`
          )
          .join("")
      : `<div style="padding:12px;opacity:.75;">No bursts detected (within loaded outgoing windows).</div>`;

    const cycleRows = report.cycles.length
      ? report.cycles
          .map(
            (c) => `
        <div style="padding:8px;border-bottom:1px dashed rgba(255,255,255,0.08);font-size:12px;">
          <div style="opacity:.85;">len ${escapeHtml(c.length)}:</div>
          <div style="margin-top:4px;">${c.path.map((p) => `<code style="margin-right:6px;">${escapeHtml(p.slice(0, 6))}…</code>`).join(" ")}</div>
        </div>`
          )
          .join("")
      : `<div style="padding:12px;opacity:.75;">No cycles found (within current graph bounds).</div>`;

    if ($("uiResults")) {
      $("uiResults").innerHTML = `
        <div style="padding:10px;border-radius:12px;border:1px solid rgba(255,255,255,0.06);background:rgba(255,255,255,0.02);">
          <div style="font-weight:900;">Pattern summary</div>
          <div style="margin-top:10px;opacity:.9;">
            <div>Issuer first-hop unique recipients: <strong>${escapeHtml(report.summary.issuerFirstHopUniqueRecipients)}</strong></div>
            <div>Issuer first-hop dominance: <strong>${escapeHtml(report.summary.issuerFirstHopDominancePct)}%</strong></div>
            <div>Issuer top recipient: <code>${escapeHtml(report.summary.issuerTopRecipient || "—")}</code></div>
            <div>Classic reconsolidation hubs: <strong>${escapeHtml(report.summary.reconsolidationHubs)}</strong></div>
            <div>Fan-in hubs from issuer first-hop: <strong>${escapeHtml(report.summary.fanInHubsFromIssuerFirstHop)}</strong></div>
            <div>Bursts detected: <strong>${escapeHtml(report.summary.burstsDetected)}</strong></div>
            <div>Cycles detected: <strong>${escapeHtml(report.summary.cyclesDetected)}</strong></div>
          </div>

          <div style="margin-top:14px;">
            <div style="font-weight:900;">Fan-in hubs (issuer → many → hub)</div>
            <div style="margin-top:8px;max-height:220px;overflow:auto;border-radius:10px;border:1px solid rgba(255,255,255,0.06);">
              ${hubRows}
            </div>
          </div>

          <div style="margin-top:14px;">
            <div style="font-weight:900;">Bursts (high-density outgoing)</div>
            <div style="margin-top:8px;max-height:220px;overflow:auto;border-radius:10px;border:1px solid rgba(255,255,255,0.06);">
              ${burstRows}
            </div>
          </div>

          <div style="margin-top:14px;">
            <div style="font-weight:900;">Cycles (bounded)</div>
            <div style="margin-top:8px;max-height:220px;overflow:auto;border-radius:10px;border:1px solid rgba(255,255,255,0.06);">
              ${cycleRows}
            </div>
          </div>
        </div>
      `;
    }
  }

  // ---------------- BUTTON HANDLERS / buildTreeClicked wrapper ----------------
  async function buildTreeClicked() {
    const issuer = ($("uiIssuerSelect") || {}).value;
    if (!issuer || !isValidXrpAddress(issuer)) {
      setStatus("Pick a valid issuer.");
      return;
    }

    if (buildingTree) return;
    buildingTree = true;

    // Pause dashboard processing while inspector runs (safe no-op if API missing)
    if (window.pauseXRPLProcessing) window.pauseXRPLProcessing("inspector");

    try {
      setBuildBusy(true, "Building…");
      setProgress(0);
      setStatus("Starting build…");

      activeIssuer = issuer;

      if ($("uiTree")) $("uiTree").innerHTML = `<div style="padding:12px;opacity:.85;">Building tree…</div>`;
      if ($("uiEdgeItems")) $("uiEdgeItems").innerHTML = `<div style="padding:12px;opacity:.7;">Edges will populate as nodes expand…</div>`;

      const depth = clampInt(Number(($("uiDepth") || {}).value || DEFAULT_DEPTH), 1, 6);
      const perNode = clampInt(Number(($("uiPerNode") || {}).value || DEFAULT_PER_NODE), 10, 300);
      const maxAccounts = clampInt(Number(($("uiMaxA") || {}).value || DEFAULT_MAX_ACCTS), 20, 2000);
      const maxEdges = clampInt(Number(($("uiMaxE") || {}).value || DEFAULT_MAX_EDGES), 50, 10000);

      const startDate = ($("uiStart") || {}).value ? new Date(($("uiStart") || {}).value).toISOString() : null;
      const endDate = ($("uiEnd") || {}).value ? new Date(($("uiEnd") || {}).value).toISOString() : null;
      const ledgerMin = parseNullableInt(($("uiLedgerMin") || {}).value);
      const ledgerMax = parseNullableInt(($("uiLedgerMax") || {}).value);
      const minXrp = Number(($("uiMinXrp") || {}).value || 0);

      const constraints = { startDate, endDate, ledgerMin, ledgerMax, minXrp };

      const g = makeGraph(issuer, { depth, perNode, maxAccounts, maxEdges, constraints });
      clearViews();

      waitForSharedConn(1500).then((ok) => {
        if (!ok && typeof attemptSharedReconnect === "function") attemptSharedReconnect("build requested but ws offline");
      });

      sessionCache.account_tx.clear();

      // resilient build with checkpointing
      const result = await buildIssuerTree(g, { checkpointing: true, checkpointEvery: 5, delayBetweenNodesMs: 120 });

      issuerRegistry.set(issuer, g);
      renderAll(g);

      setStatus(`Tree built: ${g.nodes.size} accounts • ${g.edges.length} edges (deferred: ${result.deferred?.length || 0})`);
      setProgress(-1);
    } catch (e) {
      console.error(e);
      setStatus(`Build failed: ${e?.message ? e.message : String(e)}`);
      setProgress(-1);
    } finally {
      buildingTree = false;
      setBuildBusy(false, "Build");
      // Always resume XRPL processing for dashboard even on error
      if (window.resumeXRPLProcessing) window.resumeXRPLProcessing("inspector");
      try { if (typeof refreshCaseSelect === "function") refreshCaseSelect(); } catch (_) {}
      try { if (typeof setCaseMeta === "function") setCaseMeta(); } catch (_) {}
    }
  }

  async function resumeBuildFromCheckpoint(issuer) {
    if (!issuer || !isValidXrpAddress(issuer)) {
      setStatus("Provide a valid issuer to resume.");
      return;
    }
    const ck = await loadBuildCheckpoint(issuer);
    if (!ck) {
      setStatus("No checkpoint found for " + issuer);
      return;
    }
    setStatus("Resuming build from checkpoint...");
    const g = makeGraph(issuer, ck.params || { depth: DEFAULT_DEPTH, perNode: DEFAULT_PER_NODE, maxAccounts: DEFAULT_MAX_ACCTS, maxEdges: DEFAULT_MAX_EDGES, constraints: {} });
    if (ck.nodes) ck.nodes.forEach(n => ensureNode(g, n.address, n.level || 99));
    if (ck.edges) ck.edges.forEach(e => addEdge(g, e));
    const res = await buildIssuerTree(g, { checkpointing: true, checkpointEvery: 5, delayBetweenNodesMs: 120 });
    issuerRegistry.set(issuer, g);
    renderAll(g);
    setStatus("Resumed build complete for " + issuer + " (deferred: " + (res.deferred?.length || 0) + ")");
  }

  // ---------------- INIT ----------------
  function initInspector() {
    renderPage();
    setStatus("Ready — Tip: paste issuers, set window/ledger and press Build.");
  }

  window.initInspector = initInspector;
  window.UnifiedInspector = {
    version: MODULE_VERSION,
    buildActive: () => buildTreeClicked(),
    getGraph: () => issuerRegistry.get(activeIssuer) || null,
    exportActiveGraph,
    attemptSharedReconnect,
    resumeBuildFromCheckpoint
  };

  console.log(`✅ Unified Inspector loaded (${MODULE_VERSION})`);
})();
