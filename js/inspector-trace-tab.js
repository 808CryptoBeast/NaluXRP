/* =========================================================
   FILE: js/inspector-trace-tab.js
   NaluXrp 🌊 — Inspector Trace Tab (Stable Mount + No ReferenceErrors)

   Purpose:
   - Renders the "Trace" tab UI inside a mount element (default: #inspectorTraceMount)
   - Provides hop-by-hop tracing from a seed account using public XRPL APIs
   - Integrates with Unified Inspector via:
       window.initInspectorTraceTab({ mountId })
       window.InspectorTraceTab.setSeedAddress(address)

   Fixes (required):
   - Prevents "runTrace is not defined" by using function declarations (hoisted)
   - Safe transport wrapper: WS → wrapper → HTTP JSON-RPC fallback
   - Handles NotConnectedError by falling back to HTTP and/or requesting reconnect

   Notes:
   - Client-side only; no secrets stored.
   - Minimal dependencies: uses xrpl-connection.js if present, otherwise falls back to JSON-RPC.
   ========================================================= */

(function () {
  "use strict";

  const MODULE_VERSION = "inspector-trace-tab@1.4.1-stable";

  // ---------------- CONFIG ----------------
  const DEPLOYED_PROXY =
    typeof window !== "undefined" && window.NALU_DEPLOYED_PROXY
      ? String(window.NALU_DEPLOYED_PROXY)
      : "";

  // Prefer known working JSON-RPC endpoints (set window.NALU_RPC_HTTP to override)
  const RPC_HTTP_ENDPOINTS = ["https://xrplcluster.com/", "https://xrpl.ws/"];
  const RPC_HTTP_OVERRIDE =
    typeof window !== "undefined" && window.NALU_RPC_HTTP
      ? String(window.NALU_RPC_HTTP)
      : "";

  const PAGE_LIMIT = 200;
  const MAX_PAGES_PER_ACCOUNT = 60; // keep sane (trace should be quick)
  const DEFAULT_HOPS = 3;
  const DEFAULT_PER_NODE = 80;
  const DEFAULT_MAX_NODES = 400;
  const DEFAULT_MAX_EDGES = 2500;

  // ---------------- STATE ----------------
  const state = {
    mountId: "inspectorTraceMount",
    mounted: false,
    seedAddress: "",
    busy: false,
    lastError: null,
    transport: {
      lastSource: "—",
      wsConnected: false,
      lastError: null
    },
    graph: {
      builtAt: null,
      seed: null,
      params: null,
      nodes: new Map(), // addr -> { address, level, outCount, inCount }
      edges: [] // { from,to,type,amount,currency,issuer,ledger_index,date,tx_hash,kind }
    }
  };

  // ---------------- HELPERS ----------------
  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function isValidXrpAddress(addr) {
    return /^r[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(String(addr || "").trim());
  }

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
        currency: amount.currency || "???",
        issuer: amount.issuer || null,
        raw: amount
      };
    }
    if (typeof amount === "number") return { value: amount, currency: "XRP", issuer: null, raw: amount };
    return { value: 0, currency: "XRP", issuer: null, raw: amount };
  }

  function formatAmountPretty(cur, val, issuer) {
    const n = Number(val);
    const vv = Number.isFinite(n) ? n : 0;
    if (cur === "XRP") return `${vv.toFixed(6)} XRP`;
    return `${vv} ${cur}${issuer ? ` • ${String(issuer).slice(0, 6)}…` : ""}`;
  }

  function explorerLinks(txHash) {
    if (!txHash) return { xrpscan: null, bithomp: null };
    return {
      xrpscan: `https://xrpscan.com/tx/${encodeURIComponent(txHash)}`,
      bithomp: `https://bithomp.com/explorer/${encodeURIComponent(txHash)}`
    };
  }

  // ---------------- TRANSPORT (WS → HTTP fallback) ----------------
  function computeWsConnected() {
    try {
      if (typeof window.isXRPLConnected === "function") return !!window.isXRPLConnected();
      if (window.XRPL?.connected) return true;
      if (window.XRPL?.client && typeof window.XRPL.client.isConnected === "function") return !!window.XRPL.client.isConnected();
    } catch (_) {}
    return false;
  }

  function setTransportLastSource(src) {
    state.transport.lastSource = src || "—";
    state.transport.wsConnected = computeWsConnected();
    updateTransportBadge();
  }

  function requestSharedReconnect(reason) {
    try {
      state.transport.lastError = reason || "reconnect requested";
      if (typeof window.reconnectXRPL === "function") window.reconnectXRPL();
      else if (typeof window.connectXRPL === "function") window.connectXRPL();
    } catch (e) {
      state.transport.lastError = e?.message ? e.message : String(e);
    }
    updateTransportBadge();
  }

  async function tryFetchJson(url, { method = "GET", body = null, timeoutMs = 15000 } = {}) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, {
        method,
        headers: {
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {})
        },
        body: body ? JSON.stringify(body) : null,
        signal: controller.signal
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.json();
    } finally {
      clearTimeout(id);
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
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const j = await tryFetchJson(url, { method: "POST", body, timeoutMs });
          const out = unwrapRpcResult(j);
          if (out) {
            setTransportLastSource(base.includes("localhost") ? "local_proxy_http_rpc" : "http_rpc");
            state.transport.lastError = null;
            return out;
          }
        } catch (e) {
          state.transport.lastError = e?.message ? e.message : String(e);
        }
        if (attempt < retries) await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
      }
    }
    return null;
  }

  async function xrplRequest(payload, { timeoutMs = 20000, allowHttpFallback = true } = {}) {
    // Preferred: UnifiedInspector wrapper (shares logic + metrics)
    if (window.UnifiedInspector && typeof window.UnifiedInspector.request === "function") {
      try {
        const out = await window.UnifiedInspector.request(payload, { timeoutMs, allowHttpFallback });
        setTransportLastSource("UnifiedInspector.request");
        state.transport.lastError = null;
        return out;
      } catch (e) {
        state.transport.lastError = e?.message ? e.message : String(e);
      }
    }

    // Next: requestXrpl wrapper, if present
    if (typeof window.requestXrpl === "function") {
      try {
        const r = await window.requestXrpl(payload, { timeoutMs });
        setTransportLastSource(computeWsConnected() ? "shared_ws" : "shared_wrapper_http_fallback");
        state.transport.lastError = null;
        return r?.result || r;
      } catch (e) {
        state.transport.lastError = e?.message ? e.message : String(e);
      }
    }

    // Direct WS client (guarded; fall back on NotConnected)
    if (window.XRPL?.client?.request) {
      try {
        const out = await window.XRPL.client.request(payload);
        setTransportLastSource("direct_ws_client");
        state.transport.lastError = null;
        return out?.result || out;
      } catch (e) {
        const msg = e?.message ? e.message : String(e);
        state.transport.lastError = msg;
        // Common in xrpl.js when socket dropped
        if (/NotConnected/i.test(msg) || /closed/i.test(msg)) {
          requestSharedReconnect("ws NotConnected — falling back");
        }
      }
    }

    if (allowHttpFallback) {
      const out = await rpcCall(payload.command, { ...payload }, { timeoutMs, retries: 2 });
      if (out) return out;
    }

    throw new Error("No XRPL transport available");
  }

  // ---------------- TX NORMALIZATION ----------------
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

  function extractCounterparty(tx) {
    const type = tx.TransactionType || tx.type || "Unknown";

    if (type === "Payment") {
      const to = tx.Destination || tx.destination || null;
      if (to && isValidXrpAddress(to)) return { counterparty: to, kind: "Destination" };
      return null;
    }

    if (type === "TrustSet") {
      const lim = tx.LimitAmount || tx.limit_amount || null;
      const issuer = lim && typeof lim === "object" ? lim.issuer : null;
      if (issuer && isValidXrpAddress(issuer)) return { counterparty: issuer, kind: "LimitAmount.issuer" };
      return null;
    }

    if (type === "OfferCreate") {
      const a = tx.TakerGets || tx.taker_gets || null;
      const b = tx.TakerPays || tx.taker_pays || null;
      const issuers = [];
      if (a && typeof a === "object" && a.issuer && isValidXrpAddress(a.issuer)) issuers.push(a.issuer);
      if (b && typeof b === "object" && b.issuer && isValidXrpAddress(b.issuer)) issuers.push(b.issuer);
      if (issuers.length) return { counterparty: issuers[0], kind: "OfferCreate.issuer" };
      return null;
    }

    return null;
  }

  async function fetchAccountTxPaged(address, { marker, limit, forward, ledgerMin, ledgerMax }) {
    const payload = {
      command: "account_tx",
      account: address,
      limit: limit || PAGE_LIMIT,
      forward: !!forward,
      ledger_index_min: ledgerMin == null ? -1 : ledgerMin,
      ledger_index_max: ledgerMax == null ? -1 : ledgerMax
    };
    if (marker) payload.marker = marker;

    const out = await xrplRequest(payload, { timeoutMs: 20000, allowHttpFallback: true });
    const txs = Array.isArray(out?.transactions) ? out.transactions : [];
    const nextMarker = out?.marker || null;
    return { txs, marker: nextMarker };
  }

  // ---------------- UI RENDER ----------------
  function render(mountId) {
    state.mountId = mountId || state.mountId;

    const host = document.getElementById(state.mountId);
    if (!host) return;

    host.innerHTML = `
      <div class="chart-section" style="padding:16px;">
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
          <h2 style="margin:0;">🧭 Trace</h2>
          <div style="opacity:.75;">hop-by-hop graph</div>
          <div style="opacity:.55;font-size:12px;">${escapeHtml(MODULE_VERSION)}</div>

          <div id="traceConnBadge" style="margin-left:auto;display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:999px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.10);">
            <div id="traceConnDot" style="width:10px;height:10px;border-radius:999px;background:rgba(255,255,255,0.25);"></div>
            <div id="traceConnText" style="font-weight:900;font-size:12px;">—</div>
            <button id="traceRetryWs" style="padding:6px 10px;border-radius:999px;border:1px solid rgba(255,255,255,0.18);background:transparent;color:var(--text-primary);cursor:pointer;">Retry</button>
          </div>
        </div>

        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;">
          <input id="traceSeed" placeholder="Seed address (r...)" style="min-width:320px;flex:1;padding:10px;border-radius:12px;border:1px solid var(--accent-tertiary);background:transparent;color:var(--text-primary);" />
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;opacity:.85;">
            hops
            <input id="traceHops" type="number" min="1" max="8" value="${DEFAULT_HOPS}" style="width:70px;padding:8px;border-radius:10px;border:1px solid var(--accent-tertiary);" />
          </label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;opacity:.85;">
            per-node
            <input id="tracePerNode" type="number" min="10" max="300" value="${DEFAULT_PER_NODE}" style="width:90px;padding:8px;border-radius:10px;border:1px solid var(--accent-tertiary);" />
          </label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;opacity:.85;">
            max nodes
            <input id="traceMaxNodes" type="number" min="50" max="4000" value="${DEFAULT_MAX_NODES}" style="width:110px;padding:8px;border-radius:10px;border:1px solid var(--accent-tertiary);" />
          </label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;opacity:.85;">
            max edges
            <input id="traceMaxEdges" type="number" min="100" max="20000" value="${DEFAULT_MAX_EDGES}" style="width:110px;padding:8px;border-radius:10px;border:1px solid var(--accent-tertiary);" />
          </label>
          <button id="traceRun" class="nav-btn" type="button"
            style="padding:10px 14px;border-radius:12px;border:none;background:#50fa7b;color:#000;font-weight:900;">
            Run Trace
          </button>
        </div>

        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;align-items:center;">
          <label style="font-size:12px;opacity:.85;">Min XRP</label>
          <input id="traceMinXrp" type="number" placeholder="0" style="width:120px;padding:8px;border-radius:10px;border:1px solid var(--accent-tertiary);" />
          <label style="font-size:12px;opacity:.85;">Ledger min/max</label>
          <input id="traceLedgerMin" type="number" placeholder="min" style="width:130px;padding:8px;border-radius:10px;border:1px solid var(--accent-tertiary);" />
          <input id="traceLedgerMax" type="number" placeholder="max" style="width:130px;padding:8px;border-radius:10px;border:1px solid var(--accent-tertiary);" />
          <label style="font-size:12px;opacity:.85;">Date</label>
          <input id="traceStart" type="date" style="padding:8px;border-radius:10px;border:1px solid var(--accent-tertiary);" />
          <input id="traceEnd" type="date" style="padding:8px;border-radius:10px;border:1px solid var(--accent-tertiary);" />

          <button id="traceExport" type="button" class="nav-btn"
            style="margin-left:auto;padding:10px 12px;border-radius:12px;border:none;background:#50a8ff;color:#000;font-weight:900;">
            Export JSON
          </button>
        </div>

        <div id="traceProgressWrap" style="margin-top:10px;height:10px;background:rgba(255,255,255,0.04);border-radius:8px;overflow:hidden;display:none;">
          <div id="traceProgress" style="height:100%;width:0%;background:linear-gradient(90deg,#50fa7b,#2ecc71)"></div>
        </div>

        <div id="traceStatus" style="margin-top:10px;color:var(--text-secondary)">Ready</div>

        <div style="display:grid;grid-template-columns:1fr 420px;gap:12px;margin-top:12px;align-items:start;">
          <div style="padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,0.06);background:rgba(0,0,0,0.12);">
            <div style="font-weight:900;">Edges</div>
            <div id="traceEdges" style="margin-top:10px;max-height:560px;overflow:auto;border-radius:10px;border:1px solid rgba(255,255,255,0.06);"></div>
          </div>

          <div style="display:flex;flex-direction:column;gap:12px;">
            <div style="padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,0.06);background:rgba(255,255,255,0.02);">
              <div style="font-weight:900;">Summary</div>
              <div id="traceSummary" style="margin-top:10px;opacity:.9;">—</div>
            </div>

            <div style="padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,0.06);background:rgba(255,255,255,0.02);">
              <div style="font-weight:900;">Top recipients (by edge count)</div>
              <div id="traceTop" style="margin-top:10px;max-height:240px;overflow:auto;border-radius:10px;border:1px solid rgba(255,255,255,0.06);"></div>
            </div>
          </div>
        </div>
      </div>
    `;

    // Bind events (IMPORTANT: runTrace is a function declaration; no TDZ issues)
    const runBtn = $("traceRun");
    if (runBtn) runBtn.addEventListener("click", runTrace);

    const retryBtn = $("traceRetryWs");
    if (retryBtn) {
      retryBtn.addEventListener("click", function () {
        requestSharedReconnect("manual retry");
        setStatus("Retry requested.");
      });
    }

    const exportBtn = $("traceExport");
    if (exportBtn) exportBtn.addEventListener("click", exportGraphJson);

    // Restore seed from state
    const seedEl = $("traceSeed");
    if (seedEl && state.seedAddress) seedEl.value = state.seedAddress;

    state.mounted = true;
    updateTransportBadge();
  }

  function setStatus(msg) {
    const el = $("traceStatus");
    if (el) el.textContent = msg || "";
  }

  function setProgress(p) {
    const wrap = $("traceProgressWrap");
    const bar = $("traceProgress");
    if (!wrap || !bar) return;
    if (p == null || p < 0) {
      wrap.style.display = "none";
      bar.style.width = "0%";
      return;
    }
    wrap.style.display = "block";
    const clamped = Math.max(0, Math.min(1, Number(p) || 0));
    bar.style.width = `${Math.round(clamped * 100)}%`;
  }

  function updateTransportBadge() {
    const badge = $("traceConnBadge");
    const text = $("traceConnText");
    const dot = $("traceConnDot");
    if (!badge || !text || !dot) return;

    state.transport.wsConnected = computeWsConnected();

    if (state.transport.wsConnected) {
      badge.style.background = "linear-gradient(135deg,#50fa7b,#2ecc71)";
      badge.style.color = "#000";
      dot.style.background = "rgba(0,0,0,0.35)";
      text.textContent = `WS live • last: ${state.transport.lastSource || "—"}`;
    } else {
      badge.style.background = "rgba(255,255,255,0.10)";
      badge.style.color = "var(--text-primary)";
      dot.style.background = "rgba(255,255,255,0.25)";
      const err = state.transport.lastError ? ` • ${state.transport.lastError}` : "";
      text.textContent = `WS offline • last: ${state.transport.lastSource || "—"}${err}`;
    }
  }

  // ---------------- CONSTRAINTS ----------------
  function parseNullableInt(v) {
    const s = String(v ?? "").trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? Math.floor(n) : null;
  }

  function getConstraintsFromUI() {
    const startDate = $("traceStart")?.value ? new Date($("traceStart").value).toISOString() : null;
    const endDate = $("traceEnd")?.value ? new Date($("traceEnd").value).toISOString() : null;
    const ledgerMin = parseNullableInt($("traceLedgerMin")?.value);
    const ledgerMax = parseNullableInt($("traceLedgerMax")?.value);
    const minXrp = Number($("traceMinXrp")?.value || 0);
    return { startDate, endDate, ledgerMin, ledgerMax, minXrp };
  }

  function withinConstraints(tx, constraints) {
    const l = Number(tx.ledger_index || 0);

    if (constraints.ledgerMin != null && l < constraints.ledgerMin) return false;
    if (constraints.ledgerMax != null && l > constraints.ledgerMax) return false;

    if (constraints.startDate && tx._iso && tx._iso < constraints.startDate) return false;
    if (constraints.endDate && tx._iso && tx._iso > constraints.endDate) return false;

    if (constraints.minXrp) {
      const amt = parseAmount(tx.Amount ?? tx.delivered_amount ?? tx._meta?.delivered_amount ?? null);
      if (amt.currency === "XRP" && amt.value < constraints.minXrp) return false;
    }

    return true;
  }

  // ---------------- TRACE ENGINE ----------------
  function ensureNode(levels, addr, level) {
    if (!state.graph.nodes.has(addr)) {
      state.graph.nodes.set(addr, { address: addr, level, outCount: 0, inCount: 0 });
    } else {
      const n = state.graph.nodes.get(addr);
      n.level = Math.min(n.level, level);
    }
    if (!levels.has(addr)) levels.set(addr, level);
  }

  function addEdge(e) {
    state.graph.edges.push(e);
    const a = state.graph.nodes.get(e.from);
    const b = state.graph.nodes.get(e.to);
    if (a) a.outCount += 1;
    if (b) b.inCount += 1;
  }

  async function collectOutgoingMostRecent(address, needCount, constraints) {
    const collected = [];
    let marker = null;
    let pages = 0;

    const ledgerMin = constraints.ledgerMin == null ? -1 : constraints.ledgerMin;
    const ledgerMax = constraints.ledgerMax == null ? -1 : constraints.ledgerMax;

    while (pages < MAX_PAGES_PER_ACCOUNT) {
      pages += 1;
      const resp = await fetchAccountTxPaged(address, {
        marker,
        limit: PAGE_LIMIT,
        forward: false,
        ledgerMin,
        ledgerMax
      });

      const txs = Array.isArray(resp.txs) ? resp.txs : [];
      if (!txs.length) break;

      for (const entry of txs) {
        const tx = normalizeTxEntry(entry);
        if (!tx) continue;
        if (!withinConstraints(tx, constraints)) continue;

        const from = tx.Account || tx.account;
        if (from !== address) continue;

        collected.push(tx);
        if (collected.length >= needCount) break;
      }

      if (collected.length >= needCount) break;
      marker = resp.marker;
      if (!marker) break;
    }

    // Sort ASC for readability (older->newer)
    collected.sort((a, b) => {
      const la = Number(a.ledger_index || 0);
      const lb = Number(b.ledger_index || 0);
      if (la !== lb) return la - lb;
      const da = a._iso ? new Date(a._iso).getTime() : 0;
      const db = b._iso ? new Date(b._iso).getTime() : 0;
      return da - db;
    });

    return { txs: collected.slice(0, needCount), pages };
  }

  async function runTrace() {
    if (state.busy) return;

    const seed = String($("traceSeed")?.value || "").trim();
    if (!isValidXrpAddress(seed)) {
      setStatus("Enter a valid XRPL address (r...).");
      return;
    }

    // Save seed for external callers
    state.seedAddress = seed;

    const hops = Math.max(1, Math.min(8, Number($("traceHops")?.value || DEFAULT_HOPS)));
    const perNode = Math.max(10, Math.min(300, Number($("tracePerNode")?.value || DEFAULT_PER_NODE)));
    const maxNodes = Math.max(50, Math.min(4000, Number($("traceMaxNodes")?.value || DEFAULT_MAX_NODES)));
    const maxEdges = Math.max(100, Math.min(20000, Number($("traceMaxEdges")?.value || DEFAULT_MAX_EDGES)));

    const constraints = getConstraintsFromUI();

    state.busy = true;
    state.lastError = null;
    setProgress(0);
    setStatus(`Tracing from ${seed.slice(0, 6)}…`);

    // ensure WS tries to come back if available
    if (!computeWsConnected()) requestSharedReconnect("trace started");

    // Reset graph
    state.graph = {
      builtAt: null,
      seed,
      params: { hops, perNode, maxNodes, maxEdges, constraints },
      nodes: new Map(),
      edges: []
    };

    const levels = new Map();
    ensureNode(levels, seed, 0);

    const queue = [{ addr: seed, level: 0 }];
    const seen = new Set([seed]);
    let processed = 0;

    const denom = () => Math.max(1, Math.min(maxNodes, processed + queue.length));

    try {
      while (queue.length) {
        const { addr, level } = queue.shift();
        processed += 1;

        setStatus(
          `Tracing… nodes:${processed}/${Math.min(maxNodes, processed + queue.length)} • edges:${state.graph.edges.length} • ${addr.slice(0, 6)}… lvl ${level}/${hops}`
        );
        setProgress(processed / denom());

        if (level >= hops) continue;
        if (state.graph.nodes.size >= maxNodes) break;
        if (state.graph.edges.length >= maxEdges) break;

        const res = await collectOutgoingMostRecent(addr, perNode, constraints);

        for (const tx of res.txs) {
          if (state.graph.edges.length >= maxEdges) break;

          const from = tx.Account || tx.account;
          if (!from || from !== addr) continue;

          const cp = extractCounterparty(tx);
          if (!cp?.counterparty) continue;

          const to = cp.counterparty;
          const kind = cp.kind;

          const amt = parseAmount(tx.Amount ?? tx.delivered_amount ?? tx._meta?.delivered_amount ?? null);

          ensureNode(levels, to, level + 1);
          ensureNode(levels, from, level);

          addEdge({
            from,
            to,
            ledger_index: Number(tx.ledger_index || 0),
            date: tx._iso || null,
            amount: amt.value,
            currency: amt.currency,
            issuer: amt.issuer || null,
            tx_hash: String(tx.hash || ""),
            type: tx.TransactionType || tx.type || "Unknown",
            kind
          });

          if (!seen.has(to) && state.graph.nodes.size < maxNodes) {
            seen.add(to);
            queue.push({ addr: to, level: level + 1 });
          }
        }
      }

      state.graph.builtAt = new Date().toISOString();
      setProgress(-1);
      setStatus(`Trace complete: ${state.graph.nodes.size} nodes • ${state.graph.edges.length} edges`);

      renderSummaryAndEdges();
    } catch (e) {
      state.lastError = e?.message ? e.message : String(e);
      setProgress(-1);
      setStatus(`Trace failed: ${state.lastError}`);
      console.error(e);
    } finally {
      state.busy = false;
    }
  }

  function renderSummaryAndEdges() {
    const g = state.graph;

    const summaryEl = $("traceSummary");
    const edgesEl = $("traceEdges");
    const topEl = $("traceTop");

    const nodes = g.nodes.size;
    const edges = g.edges.length;

    if (summaryEl) {
      summaryEl.innerHTML = `
        <div>Seed: <code>${escapeHtml(g.seed || "—")}</code></div>
        <div style="margin-top:6px;">Nodes: <strong>${escapeHtml(nodes)}</strong> • Edges: <strong>${escapeHtml(edges)}</strong></div>
        <div style="margin-top:6px;opacity:.8;font-size:12px;">Built: ${escapeHtml(g.builtAt || "—")}</div>
      `;
    }

    // Top recipients
    const recipCounts = new Map();
    for (const e of g.edges) recipCounts.set(e.to, (recipCounts.get(e.to) || 0) + 1);
    const top = Array.from(recipCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 40);

    if (topEl) {
      topEl.innerHTML =
        top
          .map(([addr, c]) => {
            return `
              <div style="padding:8px;border-bottom:1px dashed rgba(255,255,255,0.08);font-size:12px;">
                <div><code>${escapeHtml(addr)}</code></div>
                <div style="opacity:.85;margin-top:4px;">edges in: <strong>${escapeHtml(c)}</strong></div>
                <div style="margin-top:6px;">
                  <button class="traceSetSeed" data-addr="${escapeHtml(addr)}"
                    style="padding:6px 10px;border-radius:10px;border:1px solid rgba(255,255,255,0.14);background:transparent;color:var(--text-primary);cursor:pointer;">
                    Set as seed
                  </button>
                </div>
              </div>
            `;
          })
          .join("") || `<div style="padding:10px;opacity:.75;font-size:12px;">No edges.</div>`;

      Array.from(document.querySelectorAll(".traceSetSeed")).forEach((btn) =>
        btn.addEventListener("click", function () {
          const addr = btn.getAttribute("data-addr");
          setSeedAddress(addr);
        })
      );
    }

    // Edges list
    if (edgesEl) {
      const slice = g.edges.slice(-600); // show last 600 (most recent discovered)
      edgesEl.innerHTML =
        slice
          .map((e) => {
            const shortHash = e.tx_hash ? String(e.tx_hash).slice(0, 10) + "…" : "";
            const amt = formatAmountPretty(e.currency, e.amount, e.issuer);
            const links = e.tx_hash ? explorerLinks(e.tx_hash) : null;
            const txLink = links?.xrpscan
              ? `<a href="${escapeHtml(links.xrpscan)}" target="_blank" rel="noopener noreferrer">tx</a>`
              : "";
            return `
              <div style="padding:8px;border-bottom:1px dashed rgba(255,255,255,0.08);font-size:12px;">
                <div><code>${escapeHtml(String(e.from).slice(0, 10))}…</code> → <code>${escapeHtml(String(e.to).slice(0, 10))}…</code>
                  • ${escapeHtml(e.type)} <span style="opacity:.7">(${escapeHtml(e.kind || "—")})</span>
                  • ledger ${escapeHtml(e.ledger_index)}
                </div>
                <div style="margin-top:4px;opacity:.85;">${escapeHtml(amt)} • ${escapeHtml(e.date || "—")} • ${txLink} <span style="opacity:.6;">${escapeHtml(shortHash)}</span></div>
              </div>
            `;
          })
          .join("") || `<div style="padding:10px;opacity:.75;font-size:12px;">No edges collected. Try increasing per-node or relaxing filters.</div>`;
    }
  }

  function exportGraphJson() {
    try {
      const g = state.graph;
      if (!g || !g.seed) {
        setStatus("Nothing to export yet. Run a trace first.");
        return;
      }

      const obj = {
        version: MODULE_VERSION,
        exported_at: new Date().toISOString(),
        transport: { ...state.transport },
        graph: {
          seed: g.seed,
          builtAt: g.builtAt,
          params: g.params,
          nodes: Array.from(g.nodes.values()),
          edges: g.edges
        }
      };

      const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `naluxrp-trace-${g.seed}-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setStatus("Exported JSON.");
    } catch (e) {
      setStatus(`Export failed: ${e?.message ? e.message : String(e)}`);
    }
  }

  // ---------------- PUBLIC API ----------------
  function initInspectorTraceTab(opts) {
    const mountId = (opts && opts.mountId) ? String(opts.mountId) : "inspectorTraceMount";
    render(mountId);
  }

  function setSeedAddress(addr) {
    const a = String(addr || "").trim();
    state.seedAddress = a;
    const input = $("traceSeed");
    if (input) input.value = a;
    setStatus(a ? `Seed set: ${a.slice(0, 6)}…` : "Seed cleared.");
  }

  window.InspectorTraceTab = {
    version: MODULE_VERSION,
    init: initInspectorTraceTab,
    setSeedAddress,
    run: runTrace,
    getState: () => ({
      ...state,
      graph: {
        builtAt: state.graph.builtAt,
        seed: state.graph.seed,
        params: state.graph.params,
        nodes: state.graph.nodes ? Array.from(state.graph.nodes.values()) : [],
        edges: state.graph.edges || []
      }
    })
  };

  window.initInspectorTraceTab = initInspectorTraceTab;

  // Keep badge updated if connection events exist
  if (typeof window !== "undefined") {
    window.addEventListener("xrpl-connection", function () {
      state.transport.wsConnected = computeWsConnected();
      updateTransportBadge();
    });
  }

  console.log(`✅ Trace tab loaded (${MODULE_VERSION})`);
})();
