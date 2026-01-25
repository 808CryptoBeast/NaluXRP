/* =========================================================
   FILE: js/account-inspector.js
   NaluXrp — Unified Inspector (Tabs + Tree + Quick Inspect + Token/IOU Support)

   WHAT'S NEW (v3):
   ✅ Tabs added: "Issuer Tree" + "Trace"
   ✅ Trace mount point added (inspector-trace-tab.js renders inside it)
   ✅ Quick Inspect modal (works for ANY address, no tree needed)
   ✅ Issued Tokens / Trustlines support:
      - account_lines aggregation
      - issuer-side "outstanding issued" estimation (negative balances)
      - optional gateway_balances attempt (best effort)
   ✅ Public API expanded:
      window.UnifiedInspector.quickInspect(address)
      window.UnifiedInspector.request(payload, opts)
      window.UnifiedInspector.getTokenSummary(address)
      window.UnifiedInspector.getTransportState()
      window.UnifiedInspector.switchToTrace(address)

   NOTES:
   - No secrets are stored here.
   - All analysis is client-side, using public XRPL RPC/WS via your connection module.

   ========================================================= */

(function () {
  "use strict";

  // ---------------- CONFIG ----------------
  const DEPLOYED_PROXY =
    typeof window !== "undefined" && window.NALU_DEPLOYED_PROXY ? String(window.NALU_DEPLOYED_PROXY) : "";

  // Prefer known working JSON-RPC endpoints (set window.NALU_RPC_HTTP to override)
  const RPC_HTTP_ENDPOINTS = ["https://xrplcluster.com/", "https://xrpl.ws/"];
  const RPC_HTTP_OVERRIDE = typeof window !== "undefined" && window.NALU_RPC_HTTP ? String(window.NALU_RPC_HTTP) : "";

  const SHARED_WAIT_MS = 8000;

  // paging / caps
  const PAGE_LIMIT = 200;

  // Tree scan caps (keep sane)
  const MAX_PAGES_TREE_SCAN = 200;
  const MAX_TX_SCAN_PER_NODE = 50_000;

  const DEFAULT_DEPTH = 2;
  const DEFAULT_PER_NODE = 100;
  const DEFAULT_MAX_ACCTS = 250;
  const DEFAULT_MAX_EDGES = 1600;

  // activation lookup caps (earliest-forward scan)
  const ACTIVATION_PAGE_LIMIT = 200;
  const ACTIVATION_MAX_PAGES = 2000;
  const ACTIVATION_MAX_TX_SCAN = 350_000;

  // account_lines caps
  const LINES_PAGE_LIMIT = 400;
  const LINES_MAX_PAGES = 50;

  // localStorage keys
  const LOCAL_KEY_ISSUER_LIST = "naluxrp_issuer_list";
  const LOCAL_KEY_SELECTED_ISSUER = "naluxrp_selected_issuer";

  // auto-retry
  const SHARED_RETRY_COOLDOWN_MS = 10_000;

  const MODULE_VERSION = "unified-inspector@3.0.0-tabs-trace-quickinspect-tokens";

  // ---------------- STATE ----------------
  let buildingTree = false;
  let activeIssuer = null;

  const issuerRegistry = new Map(); // issuer -> graph
  const activationCache = new Map(); // addr -> { act|null, complete:boolean, scanned:number, pages:number, source:string }
  const accountInfoCache = new Map(); // addr -> { domain, balanceXrp, sequence, ownerCount }
  const tokenSummaryCache = new Map(); // addr -> token summary

  const transportState = {
    wsConnected: false,
    lastSource: "—",
    lastError: null,
    lastSharedReconnectAttemptAt: 0
  };

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
    if (el) el.textContent = s;
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
      if (typeof window.reconnectXRPL === "function") window.reconnectXRPL();
      else if (typeof window.connectXRPL === "function") window.connectXRPL();
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

  // Prefer shared WS request wrapper
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

    const rr = await xrplRequest(payload, { timeoutMs: 20000, allowHttpFallback: true });

    const txs = Array.isArray(rr?.transactions) ? rr.transactions : [];
    const nextMarker = rr?.marker || null;
    return { txs, marker: nextMarker, source: transportState.lastSource || "unknown" };
  }

  // ---------------- ACCOUNT INFO ----------------
  function hexToAscii(hex) {
    try {
      if (!hex) return null;
      const clean = String(hex).replace(/^0x/i, "");
      let str = "";
      for (let i = 0; i < clean.length; i += 2) {
        const code = parseInt(clean.slice(i, i + 2), 16);
        if (!code) continue;
        str += String.fromCharCode(code);
      }
      return str || null;
    } catch (_) {
      return null;
    }
  }

  function normalizeAccountInfo(info) {
    if (!info || typeof info !== "object") return null;

    const dom = info.Domain || info.domain || null;
    const domain = dom
      ? String(dom).startsWith("http")
        ? String(dom)
        : (hexToAscii(dom) || String(dom))
      : null;

    const balDrops = info.Balance ?? info.balance ?? null;
    const balanceXrp = balDrops != null && Number.isFinite(Number(balDrops)) ? Number(balDrops) / 1_000_000 : null;

    return {
      domain: domain || null,
      balanceXrp: balanceXrp != null ? balanceXrp : null,
      sequence: info.Sequence ?? info.sequence ?? null,
      ownerCount: info.OwnerCount ?? info.owner_count ?? null
    };
  }

  async function fetchAccountInfo(address) {
    if (!isValidXrpAddress(address)) return null;
    if (accountInfoCache.has(address)) return accountInfoCache.get(address);

    const out = await xrplRequest({ command: "account_info", account: address, ledger_index: "validated" }, { timeoutMs: 12000 });
    const data = out?.account_data || out?.result?.account_data || null;
    const normalized = normalizeAccountInfo(data);
    accountInfoCache.set(address, normalized);
    return normalized;
  }

  // ---------------- ACCOUNT LINES + ISSUED TOKENS ----------------
  async function fetchAccountLinesAll(address) {
    if (!isValidXrpAddress(address)) return { lines: [], pages: 0, complete: true, source: "invalid" };

    let marker = null;
    let pages = 0;
    const lines = [];

    while (pages < LINES_MAX_PAGES) {
      pages += 1;

      const payload = {
        command: "account_lines",
        account: address,
        ledger_index: "validated",
        limit: LINES_PAGE_LIMIT
      };
      if (marker) payload.marker = marker;

      const out = await xrplRequest(payload, { timeoutMs: 20000, allowHttpFallback: true });
      const got = Array.isArray(out?.lines) ? out.lines : [];
      got.forEach((x) => lines.push(x));

      marker = out?.marker || null;
      if (!marker) break;
    }

    return {
      lines,
      pages,
      complete: !marker,
      source: transportState.lastSource || "unknown"
    };
  }

  async function fetchGatewayBalances(address) {
    try {
      const out = await xrplRequest(
        {
          command: "gateway_balances",
          account: address,
          ledger_index: "validated"
        },
        { timeoutMs: 20000, allowHttpFallback: true }
      );
      return out || null;
    } catch (e) {
      return null;
    }
  }

  function buildTokenSummaryFromLines(address, linesResp, gatewayResp) {
    const lines = linesResp?.lines || [];
    const trustlines = lines.map((l) => {
      const bal = Number(l.balance);
      return {
        peer: l.account || null,
        currency: l.currency || "???",
        balance: Number.isFinite(bal) ? bal : 0,
        limit: l.limit != null ? Number(l.limit) : null,
        limit_peer: l.limit_peer != null ? Number(l.limit_peer) : null,
        quality_in: l.quality_in ?? null,
        quality_out: l.quality_out ?? null
      };
    });

    // issuer-side estimate (negative balances on issuer line = others holding positive)
    const issuedMap = new Map(); // currency -> { holders, outstanding }
    for (const t of trustlines) {
      if (!t.currency) continue;
      if (t.balance < 0) {
        const cur = t.currency;
        if (!issuedMap.has(cur)) issuedMap.set(cur, { currency: cur, holders: 0, outstanding: 0 });
        const row = issuedMap.get(cur);
        row.holders += 1;
        row.outstanding += Math.abs(t.balance);
      }
    }

    const issuedEstimated = Array.from(issuedMap.values()).sort((a, b) => b.outstanding - a.outstanding);

    const obligations = gatewayResp?.obligations ? gatewayResp.obligations : null;

    const topTrust = trustlines
      .slice()
      .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))
      .slice(0, 18);

    return {
      address,
      source: linesResp?.source || "unknown",
      linesPages: linesResp?.pages ?? 0,
      linesComplete: linesResp?.complete ?? true,
      trustlineCount: trustlines.length,
      topTrustlines: topTrust,
      issuedEstimated,
      gatewayObligations: obligations
    };
  }

  async function getTokenSummary(address) {
    const addr = String(address || "").trim();
    if (!isValidXrpAddress(addr)) return null;
    if (tokenSummaryCache.has(addr)) return tokenSummaryCache.get(addr);

    const lines = await fetchAccountLinesAll(addr);
    const gateway = await fetchGatewayBalances(addr);

    const summary = buildTokenSummaryFromLines(addr, lines, gateway);
    tokenSummaryCache.set(addr, summary);
    return summary;
  }

  // ---------------- ACTIVATION (activated_by) ----------------
  async function getActivatedByStrict(address, constraints) {
    if (!isValidXrpAddress(address)) return { act: null, complete: true, scanned: 0, pages: 0, source: "invalid" };
    if (activationCache.has(address)) return activationCache.get(address);

    const ledgerMin = constraints.ledgerMin == null ? -1 : constraints.ledgerMin;
    const ledgerMax = constraints.ledgerMax == null ? -1 : constraints.ledgerMax;

    let marker = null;
    let pages = 0;
    let scanned = 0;
    let source = "unknown";
    let complete = true;

    while (pages < ACTIVATION_MAX_PAGES && scanned < ACTIVATION_MAX_TX_SCAN) {
      pages += 1;

      const resp = await fetchAccountTxPaged(address, {
        marker,
        limit: ACTIVATION_PAGE_LIMIT,
        forward: true,
        ledgerMin,
        ledgerMax
      });

      source = resp.source || source;

      if (!resp.txs.length) {
        complete = !resp.marker;
        break;
      }

      scanned += resp.txs.length;

      for (const item of resp.txs) {
        const tx = normalizeTxEntry(item);
        if (!tx) continue;
        if (!withinConstraints(tx, constraints)) continue;

        const type = tx.TransactionType || tx.type;
        if (type !== "Payment") continue;

        const dst = tx.Destination || tx.destination;
        const src = tx.Account || tx.account;
        if (dst !== address || !src) continue;

        const amt = parseAmount(tx.Amount ?? tx.delivered_amount ?? tx._meta?.delivered_amount ?? null);
        const act = {
          activatedBy: src,
          date: tx._iso || null,
          ledger_index: Number(tx.ledger_index || 0),
          amount: amt.currency === "XRP" ? amt.value : null,
          currency: amt.currency,
          tx_hash: String(tx.hash || "")
        };

        const entry = { act, complete: true, scanned, pages, source: `activation_${source}` };
        activationCache.set(address, entry);
        return entry;
      }

      marker = resp.marker;
      if (!marker) break;

      if (pages % 50 === 0) setStatus(`Activation scan ${address.slice(0, 6)}… pages:${pages} scanned:${scanned}`);
    }

    const entry = { act: null, complete, scanned, pages, source: `activation_${source}` };
    activationCache.set(address, entry);
    return entry;
  }

  // ---------------- COUNTERPARTY EXTRACTION (for edges) ----------------
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

  // ---------------- OUTGOING COLLECTION (MOST RECENT) ----------------
  async function collectOutgoingTxsMostRecent(address, needCount, constraints) {
    const collected = [];
    let marker = null;
    let pages = 0;
    let scanned = 0;

    const ledgerMin = constraints.ledgerMin == null ? -1 : constraints.ledgerMin;
    const ledgerMax = constraints.ledgerMax == null ? -1 : constraints.ledgerMax;

    while (pages < MAX_PAGES_TREE_SCAN && scanned < MAX_TX_SCAN_PER_NODE) {
      pages += 1;

      const resp = await fetchAccountTxPaged(address, {
        marker,
        limit: PAGE_LIMIT,
        forward: false,
        ledgerMin,
        ledgerMax
      });

      if (!resp.txs.length) break;
      scanned += resp.txs.length;

      for (const entry of resp.txs) {
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

      if (pages % 10 === 0) setStatus(`Scanning recent outgoing ${address.slice(0, 6)}… pages:${pages} found:${collected.length}`);
    }

    const picked = normalizeAndSortTxsAsc(collected.slice(0, needCount));

    return {
      txs: picked,
      meta: { pages, scanned, outgoingFound: collected.length, mode: "most_recent" }
    };
  }

  // ---------------- GRAPH (ISSUER TREE) ----------------
  function makeGraph(issuer, params) {
    return {
      issuer,
      builtAt: null,
      params,
      nodes: new Map(),
      edges: [],
      adjacency: new Map(),
      parentChoice: new Map()
    };
  }

  function ensureNode(g, addr, level) {
    if (!g.nodes.has(addr)) {
      g.nodes.set(addr, {
        address: addr,
        level,
        outCount: 0,
        inCount: 0,
        outXrp: 0,
        inXrp: 0,
        activation: null,
        acctInfo: null,
        outgoingFirst: [],
        outgoingMeta: null
      });
    } else {
      const n = g.nodes.get(addr);
      n.level = Math.min(n.level, level);
    }
  }

  function addEdge(g, e) {
    const idx = g.edges.length;
    g.edges.push(e);

    if (!g.adjacency.has(e.from)) g.adjacency.set(e.from, []);
    g.adjacency.get(e.from).push(idx);

    ensureNode(g, e.from, g.nodes.get(e.from)?.level ?? 99);
    ensureNode(g, e.to, g.nodes.get(e.to)?.level ?? 99);

    if (!g.parentChoice.has(e.to)) g.parentChoice.set(e.to, e.from);

    const a = g.nodes.get(e.from);
    a.outCount += 1;
    if (e.currency === "XRP") a.outXrp += Number(e.amount || 0);

    const b = g.nodes.get(e.to);
    b.inCount += 1;
    if (e.currency === "XRP") b.inXrp += Number(e.amount || 0);
  }

  async function buildIssuerTree(g) {
    const { depth, perNode, maxAccounts, maxEdges, constraints } = g.params;

    ensureNode(g, g.issuer, 0);

    g.nodes.get(g.issuer).acctInfo = await fetchAccountInfo(g.issuer);
    g.nodes.get(g.issuer).activation = await getActivatedByStrict(g.issuer, constraints);

    const q = [{ addr: g.issuer, level: 0 }];
    const seen = new Set([g.issuer]);
    let processed = 0;

    const denom = () => Math.max(1, Math.min(maxAccounts, processed + q.length));

    while (q.length) {
      const { addr, level } = q.shift();
      processed += 1;

      setStatus(`Building… nodes:${processed}/${Math.min(maxAccounts, processed + q.length)} • edges:${g.edges.length} • ${addr.slice(0, 6)}… lvl ${level}/${depth}`);
      setProgress(processed / denom());

      if (level >= depth) continue;
      if (g.nodes.size >= maxAccounts) break;
      if (g.edges.length >= maxEdges) break;

      const res = await collectOutgoingTxsMostRecent(addr, perNode, constraints);
      const txs = res.txs;

      const node = g.nodes.get(addr);
      node.outgoingMeta = res.meta || null;

      node.outgoingFirst = txs.map((tx) => {
        const type = tx.TransactionType || tx.type || "Unknown";
        const cp = extractCounterparty(tx);
        const amt = parseAmount(tx.Amount ?? tx.delivered_amount ?? tx._meta?.delivered_amount ?? null);
        return {
          tx_hash: String(tx.hash || ""),
          type,
          counterparty: cp?.counterparty || null,
          counterpartyKind: cp?.kind || null,
          ledger_index: Number(tx.ledger_index || 0),
          date: tx._iso || null,
          amount: amt.value,
          currency: amt.currency,
          issuer: amt.issuer || null
        };
      });

      for (const tx of txs) {
        if (g.edges.length >= maxEdges) break;

        const from = tx.Account || tx.account;
        if (!from || from !== addr) continue;

        const type = tx.TransactionType || tx.type || "Unknown";
        const cp = extractCounterparty(tx);
        if (!cp?.counterparty) continue;

        const to = cp.counterparty;
        const kind = cp.kind;

        const amt = parseAmount(tx.Amount ?? tx.delivered_amount ?? tx._meta?.delivered_amount ?? null);

        addEdge(g, {
          from,
          to,
          ledger_index: Number(tx.ledger_index || 0),
          date: tx._iso || null,
          amount: amt.value,
          currency: amt.currency,
          issuer: amt.issuer || null,
          tx_hash: String(tx.hash || ""),
          type,
          kind
        });

        if (!seen.has(to) && g.nodes.size < maxAccounts) {
          seen.add(to);
          ensureNode(g, to, level + 1);

          g.nodes.get(to).acctInfo = await fetchAccountInfo(to);
          g.nodes.get(to).activation = await getActivatedByStrict(to, constraints);

          q.push({ addr: to, level: level + 1 });
        }
      }
    }

    g.builtAt = new Date().toISOString();
    setProgress(-1);
  }

  // ---------------- PATH ----------------
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

  // ---------------- PATTERNS ----------------
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

  // ---------------- TABS ----------------
  function bindInspectorTabs() {
    const tabs = document.querySelectorAll(".inspector-tab-btn[data-tab]");
    const panels = document.querySelectorAll(".inspector-tab-panel[data-panel]");
    if (!tabs.length || !panels.length) return;

    function activate(name) {
      tabs.forEach((t) => {
        const on = t.getAttribute("data-tab") === name;
        t.classList.toggle("is-active", on);
        t.setAttribute("aria-selected", on ? "true" : "false");
      });
      panels.forEach((p) => {
        const on = p.getAttribute("data-panel") === name;
        p.style.display = on ? "block" : "none";
      });

      if (name === "trace" && typeof window.initInspectorTraceTab === "function") {
        window.initInspectorTraceTab({ mountId: "inspectorTraceMount" });
      }
    }

    tabs.forEach((t) => t.addEventListener("click", () => activate(t.getAttribute("data-tab"))));
    activate("tree");
  }

  function switchToTraceTab() {
    const btn = document.querySelector('.inspector-tab-btn[data-tab="trace"]');
    if (btn) btn.click();
  }

  function switchToTraceAndSetSeed(addr) {
    switchToTraceTab();
    if (window.InspectorTraceTab && typeof window.InspectorTraceTab.setSeedAddress === "function") {
      window.InspectorTraceTab.setSeedAddress(addr);
    }
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

    page.innerHTML = `
      <div class="chart-section" style="padding:18px;">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
          <h2 style="margin:0">Unified Inspector</h2>
          <div style="opacity:.85">tree • trace • token-aware • investigation-first</div>
          <div style="opacity:.65;font-size:12px;">${escapeHtml(MODULE_VERSION)}</div>

          <div id="uiConnBadge" style="margin-left:auto;display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:999px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.10);">
            <div id="uiConnDot" style="width:10px;height:10px;border-radius:999px;background:rgba(255,255,255,0.25);"></div>
            <div id="uiConnText" style="font-weight:900;font-size:12px;">—</div>
            <button id="uiRetryWs" style="padding:6px 10px;border-radius:999px;border:1px solid rgba(255,255,255,0.18);background:transparent;color:var(--text-primary);cursor:pointer;">Retry</button>
          </div>
        </div>

        <!-- Tabs -->
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;">
          <button class="nav-btn inspector-tab-btn is-active" data-tab="tree" aria-selected="true" type="button"
            style="padding:10px 14px;border-radius:12px;border:1px solid rgba(255,255,255,0.14);background:rgba(0,0,0,0.35);">
            🌳 Issuer Tree
          </button>
          <button class="nav-btn inspector-tab-btn" data-tab="trace" aria-selected="false" type="button"
            style="padding:10px 14px;border-radius:12px;border:1px solid rgba(255,255,255,0.14);background:rgba(0,0,0,0.35);">
            🧭 Trace
          </button>

          <div style="margin-left:auto;display:flex;gap:10px;flex-wrap:wrap;">
            <input id="uiQuickAddr" placeholder="Quick inspect address (paste r...)" style="min-width:280px;padding:10px;border-radius:12px;border:1px solid var(--accent-tertiary);background:transparent;color:var(--text-primary);" />
            <button id="uiQuickInspectBtn" class="nav-btn" type="button"
              style="padding:10px 14px;border-radius:12px;border:none;background:#50fa7b;color:#000;font-weight:900;">
              Quick Inspect
            </button>
          </div>
        </div>

        <!-- Panels -->
        <div class="inspector-tab-panel" data-panel="tree" style="display:block;margin-top:12px;">
          <div style="display:grid;grid-template-columns:1fr 360px;gap:12px;align-items:start;">
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
                    <textarea id="uiIssuerList" placeholder="Paste issuers (one per line or comma-separated)" style="width:100%;min-height:86px;padding:10px;border-radius:10px;border:1px solid var(--accent-tertiary);background:transparent;color:var(--text-primary);resize:vertical;"></textarea>
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
                  <input id="uiStart" type="date" style="padding:8px;border-radius:10px;border:1px solid var(--accent-tertiary);" />
                  <input id="uiEnd" type="date" style="padding:8px;border-radius:10px;border:1px solid var(--accent-tertiary);" />
                  <label style="font-size:13px;margin-left:8px;">Ledger</label>
                  <input id="uiLedgerMin" type="number" placeholder="min" style="width:110px;padding:8px;border-radius:10px;border:1px solid var(--accent-tertiary);" />
                  <input id="uiLedgerMax" type="number" placeholder="max" style="width:110px;padding:8px;border-radius:10px;border:1px solid var(--accent-tertiary);" />
                  <input id="uiMinXrp" type="number" placeholder="Min XRP" style="width:110px;padding:8px;border-radius:10px;border:1px solid var(--accent-tertiary);" />
                </div>

                <div id="uiProgress" style="margin-top:10px;height:10px;background:rgba(255,255,255,0.04);border-radius:8px;overflow:hidden;display:none;">
                  <div id="uiProgressBar" style="height:100%;width:0%;background:linear-gradient(90deg,#50fa7b,#2ecc71)"></div>
                </div>

                <div id="uiStatus" style="margin-top:8px;color:var(--text-secondary)">Ready</div>
              </div>

              <div style="padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,0.06);background:var(--card-bg);">
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                  <div style="font-weight:900;">Issuer Tree</div>
                  <input id="uiSearch" placeholder="Search edges..." style="margin-left:auto;flex:1;min-width:260px;padding:10px;border-radius:10px;border:1px solid var(--accent-tertiary);background:transparent;color:var(--text-primary)"/>
                </div>

                <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
                  <input id="uiTarget" placeholder="Target address (path optional)" style="flex:1;min-width:260px;padding:10px;border-radius:10px;border:1px solid var(--accent-tertiary);background:transparent;color:var(--text-primary)"/>
                  <button id="uiFindPath" class="nav-btn" style="padding:10px 12px;border-radius:10px;background:#ffd1a9;border:none;color:#000;font-weight:900;">Path</button>
                  <button id="uiPatterns" class="nav-btn" style="padding:10px 12px;border-radius:10px;background:#bd93f9;border:none;color:#000;font-weight:900;">Patterns</button>
                </div>

                <div id="uiTree" style="margin-top:10px;max-height:520px;overflow:auto;border-radius:10px;border:1px solid rgba(255,255,255,0.05);padding:10px;background:rgba(0,0,0,0.12);"></div>
              </div>
            </div>

            <div style="display:flex;flex-direction:column;gap:10px;">
              <div id="uiSummary" style="padding:12px;background:rgba(255,255,255,0.02);border-radius:12px;min-height:180px;border:1px solid rgba(255,255,255,0.06);">
                <div style="opacity:.8">Tree summary appears here.</div>
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
        </div>

        <div class="inspector-tab-panel" data-panel="trace" style="display:none;margin-top:12px;">
          <div id="inspectorTraceMount"></div>
        </div>

        <div id="uiModalOverlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);align-items:center;justify-content:center;z-index:12000;">
          <div style="width:min(980px,95%);max-height:80vh;overflow:auto;background:var(--bg-secondary);padding:14px;border-radius:10px;border:1px solid var(--accent-tertiary);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <strong id="uiModalTitle">Details</strong>
              <button id="uiModalClose">✕</button>
            </div>
            <div id="uiModalBody"></div>
          </div>
        </div>
      </div>
    `;

    $("uiModalClose").addEventListener("click", closeModal);

    $("uiRetryWs").addEventListener("click", () => {
      attemptSharedReconnect("manual retry");
      setStatus("Retry requested.");
    });

    $("uiQuickInspectBtn").addEventListener("click", () => {
      const addr = ($("uiQuickAddr")?.value || "").trim();
      quickInspectAddress(addr, { perNode: 160 });
    });

    updateConnBadge();
    window.addEventListener("xrpl-connection", () => updateConnBadge());
    setInterval(updateConnBadge, 1500);

    const list = getIssuerList();
    $("uiIssuerList").value = list.join("\n");
    hydrateIssuerSelect();

    $("uiIssuerSelect").addEventListener("change", () => onIssuerSelected($("uiIssuerSelect").value));
    $("uiSaveList").addEventListener("click", () => {
      const arr = normalizeIssuerListText($("uiIssuerList").value);
      setIssuerList(arr);
      hydrateIssuerSelect();
      setStatus(`Saved issuer list (${arr.length})`);
    });
    $("uiClearCache").addEventListener("click", () => {
      issuerRegistry.clear();
      activationCache.clear();
      accountInfoCache.clear();
      tokenSummaryCache.clear();
      clearViews();
      setStatus("Cache cleared");
    });

    $("uiBuild").addEventListener("click", () => buildTreeClicked().catch(() => {}));
    $("uiSearch").addEventListener("input", renderEdgeFilterActive);
    $("uiFindPath").addEventListener("click", findPathClicked);
    $("uiPatterns").addEventListener("click", patternsClicked);
    $("uiExportGraph").addEventListener("click", exportActiveGraph);

    bindInspectorTabs();
  }

  function clearViews() {
    if ($("uiTree")) $("uiTree").innerHTML = "";
    if ($("uiSummary")) $("uiSummary").innerHTML = `<div style="opacity:.8">Tree summary appears here.</div>`;
    if ($("uiResults")) $("uiResults").innerHTML = `<div style="opacity:.8">Path + patterns appear here.</div>`;
    if ($("uiEdgeItems")) $("uiEdgeItems").innerHTML = "";
  }

  function renderAll(g) {
    renderSummary(g);
    renderTree(g);
    renderEdgeFilter(g);
  }

  function renderSummary(g) {
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
          const links = act.tx_hash ? explorerLinks(act.tx_hash) : null;
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

    $("uiSummary").innerHTML = `
      <div><strong>Issuer</strong>: <code>${escapeHtml(issuer)}</code></div>
      <div style="margin-top:8px;"><strong>Domain</strong>: ${domain}</div>
      <div style="margin-top:6px;"><strong>Balance</strong>: ${escapeHtml(bal)} • Seq: ${escapeHtml(info?.sequence ?? "—")} • Owners: ${escapeHtml(info?.ownerCount ?? "—")}</div>
      ${actHtml}
      <div style="margin-top:10px;">Accounts: <strong>${escapeHtml(accounts)}</strong> • Edges: <strong>${escapeHtml(edges)}</strong></div>
      <div style="margin-top:6px;opacity:.8;font-size:12px;">Built: ${escapeHtml(g.builtAt || "—")}</div>
      <div style="margin-top:10px;padding:10px;border-radius:12px;border:1px solid rgba(255,255,255,0.08);background:rgba(0,0,0,0.12);font-size:12px;opacity:.85;">
        Tip: For drain-style tracking, use the <strong>Trace</strong> tab (hop-by-hop graph).
      </div>
    `;
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
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
          <div>
            <div><code>${escapeHtml(addr)}</code> <span style="opacity:.7">lvl ${escapeHtml(lvl)}</span></div>
            ${activationLine(n?.activation)}
            <div style="opacity:.75;font-size:12px;margin-top:4px;">
              edges out:${escapeHtml(n?.outCount ?? 0)} (XRP ${(n?.outXrp ?? 0).toFixed(2)}) •
              edges in:${escapeHtml(n?.inCount ?? 0)} (XRP ${(n?.inXrp ?? 0).toFixed(2)}) •
              recent outgoing loaded:${escapeHtml(firstN)}
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
            <button class="uiNode" data-addr="${escapeHtml(addr)}" style="padding:6px 10px;border-radius:10px;border:none;background:#50fa7b;color:#000;cursor:pointer;font-weight:900;">Inspect</button>
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
                ? `<button class="uiToggle" data-target="${escapeHtml(sectionId)}" style="width:28px;height:28px;border-radius:10px;border:1px solid var(--accent-tertiary);background:transparent;cursor:pointer;">▾</button>`
                : `<div style="width:28px;height:28px;opacity:.35;display:flex;align-items:center;justify-content:center;">•</div>`
            }
            <div style="flex:1;">${nodeRow(addr)}</div>
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
      btn.addEventListener("click", () => {
        const addr = btn.getAttribute("data-addr");
        quickInspectAddress(addr, { perNode: 180 });
      })
    );
  }

  function renderEdgeFilter(g) {
    const q = String(($("uiSearch") || {}).value || "").trim().toLowerCase();
    const items = $("uiEdgeItems");
    if (!items) return;

    const filtered = q
      ? g.edges.filter((e) => {
          const hay = `${e.from} ${e.to} ${e.tx_hash} ${e.type} ${e.kind} ${e.currency} ${e.issuer || ""} ${e.amount} ${e.ledger_index} ${e.date || ""}`.toLowerCase();
          return hay.includes(q);
        })
      : g.edges;

    const slice = filtered.slice(0, 300);
    items.innerHTML =
      slice
        .map((e) => {
          const shortHash = e.tx_hash ? e.tx_hash.slice(0, 10) + "…" : "";
          const cur = e.currency === "XRP" ? "XRP" : `${e.currency}${e.issuer ? ` • ${e.issuer.slice(0, 6)}…` : ""}`;
          return `<div style="padding:8px;border-bottom:1px dashed rgba(255,255,255,0.05);font-size:12px;">
            <div><code>${escapeHtml(e.from.slice(0, 8))}…</code> → <code>${escapeHtml(e.to.slice(0, 8))}…</code>
              • ${escapeHtml(e.type)} <span style="opacity:.7">(${escapeHtml(e.kind)})</span>
              • ledger ${escapeHtml(e.ledger_index)}
              • ${escapeHtml(cur)} ${escapeHtml(e.amount)}
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

  // ---------------- QUICK INSPECT ----------------
  function getCurrentConstraintsFromUI() {
    const startDate = ($("uiStart") || {}).value ? new Date(($("uiStart") || {}).value).toISOString() : null;
    const endDate = ($("uiEnd") || {}).value ? new Date(($("uiEnd") || {}).value).toISOString() : null;
    const ledgerMin = parseNullableInt(($("uiLedgerMin") || {}).value);
    const ledgerMax = parseNullableInt(($("uiLedgerMax") || {}).value);
    const minXrp = Number(($("uiMinXrp") || {}).value || 0);
    return { startDate, endDate, ledgerMin, ledgerMax, minXrp };
  }

  function renderTokenSummaryBlock(summary) {
    if (!summary) return `<div style="opacity:.75;">Token data unavailable.</div>`;

    const topTrust = (summary.topTrustlines || []).slice(0, 12);
    const issued = (summary.issuedEstimated || []).slice(0, 10);

    const obligations = summary.gatewayObligations
      ? Object.entries(summary.gatewayObligations)
          .slice(0, 10)
          .map(([cur, amt]) => `<div style="font-size:12px;"><strong>${escapeHtml(cur)}</strong>: ${escapeHtml(String(amt))}</div>`)
          .join("")
      : "";

    return `
      <details style="margin-top:12px;padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,0.08);background:rgba(0,0,0,0.12);">
        <summary style="cursor:pointer;font-weight:900;">Trustlines & Issued Tokens</summary>

        <div style="margin-top:10px;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;">
          <div style="font-size:12px;opacity:.8;">lines: ${escapeHtml(summary.trustlineCount)} • src: ${escapeHtml(summary.source)}</div>
          <div style="font-size:12px;opacity:.75;">pages: ${escapeHtml(summary.linesPages)} • complete: ${escapeHtml(String(summary.linesComplete))}</div>
        </div>

        ${
          issued.length
            ? `
              <div style="margin-top:10px;">
                <div style="font-weight:900;font-size:13px;">Estimated outstanding (issuer-side heuristic)</div>
                <div style="margin-top:6px;display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;">
                  ${issued
                    .map(
                      (x) => `
                      <div style="padding:8px;border-radius:10px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.02);">
                        <div><strong>${escapeHtml(x.currency)}</strong></div>
                        <div style="font-size:12px;opacity:.85;">holders: ${escapeHtml(x.holders)}</div>
                        <div style="font-size:12px;opacity:.85;">outstanding: ${escapeHtml(String(x.outstanding))}</div>
                      </div>
                    `
                    )
                    .join("")}
                </div>
              </div>
            `
            : `
              <div style="margin-top:10px;opacity:.85;font-size:12px;">
                No issuer-style outstanding balances detected from account_lines (may not be an issuer).
              </div>
            `
        }

        ${
          obligations
            ? `
              <div style="margin-top:10px;">
                <div style="font-weight:900;font-size:13px;">Gateway obligations (if available)</div>
                <div style="margin-top:6px;opacity:.9;">${obligations}</div>
              </div>
            `
            : `
              <div style="margin-top:10px;opacity:.75;font-size:12px;">
                gateway_balances not available (some nodes restrict this). Estimate above comes from account_lines.
              </div>
            `
        }

        <div style="margin-top:10px;">
          <div style="font-weight:900;font-size:13px;">Top trustlines (largest abs balances)</div>
          <div style="margin-top:6px;max-height:220px;overflow:auto;border-radius:10px;border:1px solid rgba(255,255,255,0.06);">
            ${
              topTrust.length
                ? topTrust
                    .map(
                      (t) => `
                      <div style="padding:8px;border-bottom:1px dashed rgba(255,255,255,0.08);font-size:12px;">
                        <div><strong>${escapeHtml(t.currency)}</strong> • peer: <code>${escapeHtml((t.peer || "").slice(0, 10))}…</code></div>
                        <div style="opacity:.85;margin-top:4px;">balance: ${escapeHtml(String(t.balance))} • limit: ${escapeHtml(String(t.limit ?? "—"))}</div>
                      </div>
                    `
                    )
                    .join("")
                : `<div style="padding:10px;opacity:.75;font-size:12px;">No trustlines found.</div>`
            }
          </div>
        </div>

        <div style="margin-top:10px;opacity:.75;font-size:12px;">
          Note: issued-token totals are heuristics. DEX/AMM routing may move value without obvious Payment edges.
        </div>
      </details>
    `;
  }

  async function quickInspectAddress(address, { perNode = 120 } = {}) {
    const addr = String(address || "").trim();
    if (!isValidXrpAddress(addr)) {
      setStatus("Quick inspect: invalid address.");
      return;
    }

    try {
      setStatus(`Quick inspect: ${addr.slice(0, 6)}…`);
      setProgress(0.1);

      waitForSharedConn(1200).then((ok) => {
        if (!ok) attemptSharedReconnect("quick inspect requested but ws offline");
      });

      const constraints = getCurrentConstraintsFromUI();

      const info = await fetchAccountInfo(addr);
      setProgress(0.25);

      const activation = await getActivatedByStrict(addr, constraints);
      setProgress(0.45);

      const res = await collectOutgoingTxsMostRecent(addr, clampInt(perNode, 10, 300), constraints);
      setProgress(0.65);

      let tokenSummary = null;
      try {
        tokenSummary = await getTokenSummary(addr);
      } catch (_) {
        tokenSummary = null;
      }
      setProgress(0.85);

      const outgoing = (res.txs || []).map((tx) => {
        const type = tx.TransactionType || tx.type || "Unknown";
        const cp = extractCounterparty(tx);
        const amt = parseAmount(tx.Amount ?? tx.delivered_amount ?? tx._meta?.delivered_amount ?? null);
        return {
          tx_hash: String(tx.hash || ""),
          type,
          counterparty: cp?.counterparty || null,
          counterpartyKind: cp?.kind || null,
          ledger_index: Number(tx.ledger_index || 0),
          date: tx._iso || null,
          amount: amt.value,
          currency: amt.currency,
          issuer: amt.issuer || null
        };
      });

      const hashesOnly = outgoing.map((x) => x.tx_hash).filter(Boolean).join("\n");

      // ✅ THIS IS WHERE YOUR FILE CUT OFF — finished cleanly:
      const csv = [
        ["tx_hash", "type", "counterparty", "counterpartyKind", "ledger_index", "date", "amount", "currency", "issuer"].join(","),
        ...outgoing.map((x) =>
          [
            `"${String(x.tx_hash || "").replace(/"/g, '""')}"`,
            `"${String(x.type || "").replace(/"/g, '""')}"`,
            `"${String(x.counterparty || "").replace(/"/g, '""')}"`,
            `"${String(x.counterpartyKind || "").replace(/"/g, '""')}"`,
            Number(x.ledger_index || 0),
            `"${String(x.date || "").replace(/"/g, '""')}"`,
            Number.isFinite(Number(x.amount)) ? Number(x.amount) : "",
            `"${String(x.currency || "").replace(/"/g, '""')}"`,
            `"${String(x.issuer || "").replace(/"/g, '""')}"`,
          ].join(",")
        )
      ].join("\n");

      const domain = info?.domain || null;
      const balance = info?.balanceXrp != null ? info.balanceXrp.toFixed(6) : null;

      const act = activation?.act || null;
      const actLinks = act?.tx_hash ? explorerLinks(act.tx_hash) : null;

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
              <span style="opacity:.7;">(${escapeHtml(activation.source || "unknown")})</span>
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
            <div style="margin-top:6px;opacity:.85;">— <span style="opacity:.7;">(${escapeHtml(activation?.source || "unknown")}${
              activation && !activation.complete ? ", incomplete" : ""
            })</span></div>
          </div>
        `;

      const metaLine = res?.meta
        ? `<div style="margin-top:10px;opacity:.8;font-size:12px;">scan: pages=${escapeHtml(res.meta.pages)} • scanned=${escapeHtml(
            res.meta.scanned
          )} • mode=${escapeHtml(res.meta.mode)}</div>`
        : "";

      const rows = outgoing
        .slice(0, 220)
        .map((x, i) => {
          const links = x.tx_hash ? explorerLinks(x.tx_hash) : null;
          const cp = x.counterparty ? `<code>${escapeHtml(x.counterparty)}</code>` : `<span style="opacity:.6;">—</span>`;
          const cpKind = x.counterpartyKind ? `<span style="opacity:.7;">${escapeHtml(x.counterpartyKind)}</span>` : "";
          const amt = formatAmountPretty(x.currency, x.amount, x.issuer);
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

      const tokenBlock = renderTokenSummaryBlock(tokenSummary);

      const html = `
        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start;">
          <div style="flex:1;min-width:320px;padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.02);">
            <div style="font-weight:900;">Account</div>
            <div style="margin-top:6px;"><code>${escapeHtml(addr)}</code></div>
            <div style="margin-top:8px;opacity:.9;"><strong>Domain</strong>: ${domain ? escapeHtml(domain) : "—"}</div>
            <div style="margin-top:6px;opacity:.9;"><strong>Balance</strong>: ${balance != null ? escapeHtml(balance) + " XRP" : "—"} • Seq: ${escapeHtml(info?.sequence ?? "—")} • Owners: ${escapeHtml(info?.ownerCount ?? "—")}</div>
            ${actBlock}
            ${metaLine}
            ${tokenBlock}
          </div>

          <div style="width:340px;min-width:280px;padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.02);">
            <div style="font-weight:900;">Actions</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
              <button id="qiCopyAddr" style="padding:8px 10px;border-radius:10px;border:none;background:#50a8ff;color:#000;font-weight:900;cursor:pointer;">Copy address</button>
              <button id="qiCopyHashes" style="padding:8px 10px;border-radius:10px;border:none;background:#50a8ff;color:#000;font-weight:900;cursor:pointer;">Copy hashes</button>
              <button id="qiExportCsv" style="padding:8px 10px;border-radius:10px;border:none;background:#ffd166;color:#000;font-weight:900;cursor:pointer;">Export CSV</button>
              <button id="qiExportJson" style="padding:8px 10px;border-radius:10px;border:none;background:#bd93f9;color:#000;font-weight:900;cursor:pointer;">Export JSON</button>
              <button id="qiTraceFrom" style="padding:8px 10px;border-radius:10px;border:1px solid var(--accent-tertiary);background:transparent;color:var(--text-primary);cursor:pointer;">Trace from here</button>
            </div>
            <div style="margin-top:10px;opacity:.85;font-size:12px;">
              outgoing loaded: <strong>${escapeHtml(outgoing.length)}</strong>
            </div>
            <div style="margin-top:6px;opacity:.75;font-size:12px;">
              note: issuer-tree edges only exist when counterparty exists (Payment/TrustSet/OfferCreate issuer).
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

      openModal(`Quick Inspect: ${addr}`, html);
      setProgress(-1);
      setStatus("Ready");

      $("qiCopyAddr").onclick = async () => {
        const ok = await copyToClipboard(addr);
        $("qiCopyAddr").textContent = ok ? "Copied ✅" : "Copy failed ❌";
        setTimeout(() => ($("qiCopyAddr").textContent = "Copy address"), 1200);
      };

      $("qiCopyHashes").onclick = async () => {
        const ok = await copyToClipboard(hashesOnly || "");
        $("qiCopyHashes").textContent = ok ? "Copied ✅" : "Copy failed ❌";
        setTimeout(() => ($("qiCopyHashes").textContent = "Copy hashes"), 1200);
      };

      $("qiExportCsv").onclick = () => downloadText(csv, `naluxrp-quickinspect-${addr}-outgoing-${outgoing.length}-txs.csv`, "text/csv");

      $("qiExportJson").onclick = () => {
        const obj = {
          version: MODULE_VERSION,
          address: addr,
          fetched_at: new Date().toISOString(),
          transport: { ...transportState },
          accountInfo: info || null,
          activation: activation || null,
          tokenSummary: tokenSummary || null,
          outgoing,
          outgoingMeta: res?.meta || null
        };
        downloadText(JSON.stringify(obj, null, 2), `naluxrp-quickinspect-${addr}-${Date.now()}.json`, "application/json");
      };

      $("qiTraceFrom").onclick = () => {
        closeModal();
        switchToTraceAndSetSeed(addr);
      };
    } catch (e) {
      console.error(e);
      setProgress(-1);
      setStatus(`Quick inspect failed: ${e?.message ? e.message : String(e)}`);
    }
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
        inXrp: Number(n.inXrp.toFixed(6)),
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

  // ---------------- BUTTON HANDLERS ----------------
  async function buildTreeClicked() {
    const issuer = $("uiIssuerSelect").value;
    if (!issuer || !isValidXrpAddress(issuer)) {
      setStatus("Pick a valid issuer.");
      return;
    }

    if (buildingTree) return;
    buildingTree = true;

    try {
      setBuildBusy(true, "Building…");
      setProgress(0);
      setStatus("Starting build…");

      activeIssuer = issuer;

      $("uiTree").innerHTML = `<div style="padding:12px;opacity:.85;">Building tree…</div>`;
      $("uiEdgeItems").innerHTML = `<div style="padding:12px;opacity:.7;">Edges will populate as nodes expand…</div>`;

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
        if (!ok) attemptSharedReconnect("build requested but ws offline");
      });

      await buildIssuerTree(g);

      issuerRegistry.set(issuer, g);
      renderAll(g);

      setStatus(`Tree built: ${g.nodes.size} accounts • ${g.edges.length} edges`);
      setProgress(-1);
    } catch (e) {
      console.error(e);
      setStatus(`Build failed: ${e?.message ? e.message : String(e)}`);
      setProgress(-1);
    } finally {
      buildingTree = false;
      setBuildBusy(false, "Build");
    }
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
      $("uiResults").innerHTML = `<div>No path found (within current tree).</div>`;
      return;
    }
    $("uiResults").innerHTML = `
      <div><strong>Shortest path</strong> (${escapeHtml(path.length - 1)} hops)</div>
      <div style="margin-top:8px;">${path
        .map(
          (p) => `<div style="display:flex;align-items:center;gap:8px;">
            <code>${escapeHtml(p)}</code>
            <button class="uiNodeMini" data-addr="${escapeHtml(p)}" style="padding:4px 8px;border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:transparent;color:var(--text-primary);cursor:pointer;">Inspect</button>
            <button class="uiTraceMini" data-addr="${escapeHtml(p)}" style="padding:4px 8px;border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:transparent;color:var(--text-primary);cursor:pointer;">Trace</button>
          </div>`
        )
        .join("")}</div>
    `;

    Array.from(document.querySelectorAll(".uiNodeMini")).forEach((btn) =>
      btn.addEventListener("click", () => quickInspectAddress(btn.getAttribute("data-addr"), { perNode: 160 }))
    );
    Array.from(document.querySelectorAll(".uiTraceMini")).forEach((btn) =>
      btn.addEventListener("click", () => switchToTraceAndSetSeed(btn.getAttribute("data-addr")))
    );
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

  // ---------------- INIT ----------------
  function initInspector() {
    renderPage();
    setStatus("Ready");
  }

  window.initInspector = initInspector;

  // ✅ Public API for Trace Tab + others
  window.UnifiedInspector = {
    version: MODULE_VERSION,
    request: (payload, opts) => xrplRequest(payload, opts || {}),
    quickInspect: (addr) => quickInspectAddress(addr, { perNode: 160 }),
    getTokenSummary: (addr) => getTokenSummary(addr),
    getTransportState: () => ({ ...transportState }),
    attemptSharedReconnect,
    exportActiveGraph,
    buildActive: () => buildTreeClicked(),
    getGraph: () => issuerRegistry.get(activeIssuer) || null,
    switchToTrace: (addr) => switchToTraceAndSetSeed(addr)
  };

  console.log(`✅ Unified Inspector loaded (${MODULE_VERSION})`);
})();
