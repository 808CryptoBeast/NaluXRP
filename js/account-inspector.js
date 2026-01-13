/* =========================================================
   FILE: js/account-inspector.js
   NaluXrp — Unified Inspector (One Page, Simplified)
   - Issuer list mode (multi-issuer dropdown, cached graphs)
   - Ledger-only defaults: first N outgoing Payments per node (chronological)
   - Tree view (top->bottom), per-node modal includes activated_by + first outgoing list
   - Pattern scan: bursts + split clusters + reconsolidation hubs + dominance + small cycles
   - Transport badge + auto-retry when WS drops
   - Strict first-N proof mode: persist page/marker chain + selected tx hashes per node
   - Transport: prefers shared WS (window.requestXrpl / window.XRPL.client), falls back to CORS HTTP JSON-RPC
   ========================================================= */

(function () {
  "use strict";

  // ---------------- CONFIG ----------------
  const DEPLOYED_PROXY =
    typeof window !== "undefined" && window.NALU_DEPLOYED_PROXY ? String(window.NALU_DEPLOYED_PROXY) : "";

  const RPC_HTTP_ENDPOINTS = ["https://xrplcluster.com/", "https://xrpl.ws/"];

  const RPC_HTTP_OVERRIDE =
    typeof window !== "undefined" && window.NALU_RPC_HTTP ? String(window.NALU_RPC_HTTP) : "";

  const SHARED_WAIT_MS = 8000;

  // paging / caps
  const PAGE_LIMIT = 200;
  const MAX_PAGES_TREE_SCAN = 2500;
  const MAX_TX_SCAN_PER_NODE = 250000;

  const DEFAULT_DEPTH = 2;
  const DEFAULT_PER_NODE = 100;
  const DEFAULT_MAX_ACCTS = 250;
  const DEFAULT_MAX_EDGES = 1600;

  // activation lookup caps
  const ACTIVATION_PAGE_LIMIT = 200;
  const ACTIVATION_MAX_PAGES = 2000;
  const ACTIVATION_MAX_TX_SCAN = 350000;

  // pattern thresholds
  const BURST_HOURLY_MIN_TX = 12;
  const BURST_DAILY_MIN_TX = 40;
  const SPLIT_CLUSTER_MIN = 6;
  const SPLIT_WINDOW_MINUTES = 15;
  const DOMINANCE_CHILD_THRESHOLD = 0.8;

  // localStorage keys
  const LOCAL_KEY_ISSUER_LIST = "naluxrp_issuer_list";
  const LOCAL_KEY_SELECTED_ISSUER = "naluxrp_selected_issuer";

  // auto-retry
  const SHARED_RETRY_COOLDOWN_MS = 10_000;

  // ---------------- STATE ----------------
  let buildingTree = false;
  let activeIssuer = null;

  const issuerRegistry = new Map(); // issuer -> graph
  const activationCache = new Map(); // addr -> { act|null, complete:boolean, scanned:number, pages:number, source:string }
  const accountInfoCache = new Map(); // addr -> { domain, balanceXrp, sequence, ownerCount }

  const transportState = {
    sharedConnected: false,
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
    } else {
      wrap.style.display = "block";
      bar.style.width = `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`;
    }
  }

  function openModal(title, text, actionsHtml = "") {
    $("uiModalTitle").textContent = title || "Details";
    $("uiModalActions").innerHTML = actionsHtml || "";
    $("uiModalBody").textContent = text || "";
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

  // ---------------- TIME HELPERS ----------------
  function safeToIso(x) {
    try {
      if (x == null) return null;
      if (typeof x === "string") {
        const d = new Date(x);
        if (!Number.isNaN(d.getTime())) return d.toISOString();
      }
      if (typeof x === "number") {
        if (x > 10_000_000_000) return new Date(x).toISOString();
        if (x > 1_000_000_000) return new Date(x * 1000).toISOString();
        const rippleEpochMs = Date.UTC(2000, 0, 1);
        return new Date(rippleEpochMs + x * 1000).toISOString();
      }
      const d = new Date(x);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    } catch (_) {}
    return null;
  }

  function parseNullableInt(v) {
    const s = String(v || "").trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  function clampInt(n, min, max) {
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, Math.floor(n)));
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
      return { value: Number.isFinite(v) ? v : 0, currency: amount.currency || "XRP", issuer: amount.issuer || null, raw: amount };
    }
    if (typeof amount === "number") return { value: amount, currency: "XRP", issuer: null, raw: amount };
    return { value: 0, currency: "XRP", issuer: null, raw: amount };
  }

  // ---------------- TRANSPORT BADGE + AUTO-RETRY ----------------
  function computeSharedConnected() {
    if (typeof window.requestXrpl === "function") return true;
    if (window.XRPL?.connected) return true;
    if (window.XRPL?.client && window.XRPL?.client?.isConnected?.()) return true;
    return false;
  }

  function setTransportLastSource(src) {
    transportState.lastSource = src || "—";
    updateConnBadge();
  }

  function updateConnBadge() {
    const badge = $("uiConnBadge");
    const text = $("uiConnText");
    if (!badge || !text) return;

    transportState.sharedConnected = computeSharedConnected();

    if (transportState.sharedConnected) {
      badge.style.background = "linear-gradient(135deg,#50fa7b,#2ecc71)";
      badge.style.color = "#000";
      text.textContent = `WS connected • last: ${transportState.lastSource}`;
    } else {
      badge.style.background = "rgba(255,255,255,0.10)";
      badge.style.color = "var(--text-primary)";
      const err = transportState.lastError ? ` • ${transportState.lastError}` : "";
      text.textContent = `WS offline • last: ${transportState.lastSource}${err}`;
    }
  }

  async function waitForSharedConn(timeoutMs = SHARED_WAIT_MS) {
    return new Promise((resolve) => {
      try {
        if (computeSharedConnected()) return resolve(true);

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
      if (typeof window.XRPL?.connect === "function") {
        window.XRPL.connect();
        transportState.lastError = reason || "reconnect requested";
      } else if (typeof window.initXrplConnection === "function") {
        window.initXrplConnection();
        transportState.lastError = reason || "reconnect requested";
      } else {
        transportState.lastError = reason || "ws unavailable";
      }
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

  function rpcParams(method, paramsObj) {
    return { method, params: [paramsObj] };
  }

  async function rpcCall(method, paramsObj, { timeoutMs = 15000, retries = 2 } = {}) {
    const endpoints = [];
    if (DEPLOYED_PROXY && DEPLOYED_PROXY.startsWith("http")) endpoints.push(DEPLOYED_PROXY);
    if (RPC_HTTP_OVERRIDE && RPC_HTTP_OVERRIDE.startsWith("http")) endpoints.push(RPC_HTTP_OVERRIDE);
    endpoints.push(...RPC_HTTP_ENDPOINTS);

    const body = rpcParams(method, paramsObj);

    for (const base of endpoints) {
      const url = base.endsWith("/") ? base : base + "/";
      let attempt = 0;

      while (attempt <= retries) {
        const j = await tryFetchJson(url, { method: "POST", body, timeoutMs });
        const r = j?.result;

        if (r && !r.error) return r;

        attempt += 1;
        if (attempt <= retries) await new Promise((res) => setTimeout(res, 250 * attempt));
      }
    }

    return null;
  }

  // ---------------- TX NORMALIZATION ----------------
  function normalizeTxEntry(entry) {
    const t0 = entry?.tx || entry?.transaction || entry;
    if (!t0) return null;
    return {
      ...t0,
      _meta: entry?.meta || t0?.meta || null,
      hash: t0.hash || entry?.hash || t0?.tx_hash || null,
      ledger_index: Number(t0.ledger_index ?? t0.LedgerIndex ?? entry?.ledger_index ?? 0),
      _iso: safeToIso(t0.date ?? t0.close_time ?? entry?.date ?? null)
    };
  }

  function normalizeAndSortTxs(entries) {
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
    // Prefer shared WS
    try {
      const sharedReady = await waitForSharedConn();
      if (sharedReady) {
        const payload = {
          command: "account_tx",
          account: address,
          limit: limit || PAGE_LIMIT,
          forward: !!forward,
          ledger_index_min: ledgerMin == null ? -1 : ledgerMin,
          ledger_index_max: ledgerMax == null ? -1 : ledgerMax
        };
        if (marker) payload.marker = marker;

        const res =
          typeof window.requestXrpl === "function"
            ? await window.requestXrpl(payload, { timeoutMs: 20000 })
            : window.XRPL?.client?.request
              ? await window.XRPL.client.request(payload)
              : null;

        const rr = res?.result || res;
        const txs = Array.isArray(rr?.transactions) ? rr.transactions : [];
        const nextMarker = rr?.marker || null;

        setTransportLastSource("shared_ws");
        transportState.lastError = null;
        updateConnBadge();

        return { txs, marker: nextMarker, source: "shared_ws" };
      }

      attemptSharedReconnect("ws offline");
    } catch (e) {
      console.warn("shared account_tx failed", e && e.message ? e.message : e);
      transportState.lastError = e && e.message ? e.message : String(e);
      updateConnBadge();
      attemptSharedReconnect("ws error");
    }

    // HTTP JSON-RPC fallback
    const r = await rpcCall(
      "account_tx",
      {
        account: address,
        limit: limit || PAGE_LIMIT,
        marker: marker || undefined,
        forward: !!forward,
        ledger_index_min: ledgerMin == null ? -1 : ledgerMin,
        ledger_index_max: ledgerMax == null ? -1 : ledgerMax
      },
      { timeoutMs: 20000, retries: 2 }
    );

    const txs = Array.isArray(r?.transactions) ? r.transactions : [];
    const nextMarker = r?.marker || null;

    setTransportLastSource("http_rpc");
    return { txs, marker: nextMarker, source: "http_rpc" };
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
    const domain = dom ? (String(dom).startsWith("http") ? String(dom) : (hexToAscii(dom) || String(dom))) : null;

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

    try {
      const sharedReady = await waitForSharedConn();
      if (sharedReady) {
        if (typeof window.requestXrpl === "function") {
          const r = await window.requestXrpl({ command: "account_info", account: address, ledger_index: "validated" }, { timeoutMs: 12000 });
          const data = r?.result?.account_data || r?.account_data || null;
          const out = normalizeAccountInfo(data);
          accountInfoCache.set(address, out);
          setTransportLastSource("shared_ws");
          return out;
        }
        if (window.XRPL?.client?.request) {
          const r = await window.XRPL.client.request({ command: "account_info", account: address, ledger_index: "validated" });
          const data = r?.result?.account_data || r?.account_data || null;
          const out = normalizeAccountInfo(data);
          accountInfoCache.set(address, out);
          setTransportLastSource("shared_ws");
          return out;
        }
      } else {
        attemptSharedReconnect("ws offline");
      }
    } catch (e) {
      transportState.lastError = e && e.message ? e.message : String(e);
      updateConnBadge();
      attemptSharedReconnect("ws error");
    }

    const res = await rpcCall("account_info", { account: address, ledger_index: "validated" }, { timeoutMs: 15000, retries: 2 });
    const data = res?.account_data || null;
    const out = normalizeAccountInfo(data);
    accountInfoCache.set(address, out);
    setTransportLastSource("http_rpc");
    return out;
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

      if (pages % 50 === 0) setStatus(`Activation scan ${address.slice(0, 6)}… pages:${pages}`);
    }

    const entry = { act: null, complete, scanned, pages, source: `activation_${source}` };
    activationCache.set(address, entry);
    return entry;
  }

  // ---------------- STRICT PROOF MODE ----------------
  function strictProofEnabled() {
    return !!$("uiStrictProof")?.checked;
  }

  function makeStrictProofEnvelope({ address, needCount, constraints, forward }) {
    return {
      version: 1,
      address,
      needCount,
      forward: !!forward,
      constraints: {
        startDate: constraints.startDate || null,
        endDate: constraints.endDate || null,
        ledgerMin: constraints.ledgerMin == null ? null : constraints.ledgerMin,
        ledgerMax: constraints.ledgerMax == null ? null : constraints.ledgerMax,
        minXrp: constraints.minXrp || 0
      },
      pages: [],
      selected: {
        selectedTxHashes: [],
        selectedTxs: []
      },
      sources: [],
      builtAt: new Date().toISOString()
    };
  }

  // ---------------- TREE DATA (first N outgoing, chronological) ----------------
  async function collectOutgoingPaymentsEarliest(address, needCount, constraints, withStrictProof) {
    const collected = [];
    let marker = null;
    let pages = 0;
    let scanned = 0;

    const ledgerMin = constraints.ledgerMin == null ? -1 : constraints.ledgerMin;
    const ledgerMax = constraints.ledgerMax == null ? -1 : constraints.ledgerMax;

    const proof = withStrictProof ? makeStrictProofEnvelope({ address, needCount, constraints, forward: true }) : null;

    while (pages < MAX_PAGES_TREE_SCAN && scanned < MAX_TX_SCAN_PER_NODE) {
      pages += 1;

      const markerIn = marker || null;

      const resp = await fetchAccountTxPaged(address, {
        marker,
        limit: PAGE_LIMIT,
        forward: true,
        ledgerMin,
        ledgerMax
      });

      const markerOut = resp.marker || null;

      if (proof) {
        proof.sources.push(resp.source || "unknown");
        proof.pages.push({
          page: pages,
          markerIn,
          markerOut,
          fetchedCount: resp.txs.length,
          matchedCount: 0,
          matchedTxHashes: []
        });
      }

      if (!resp.txs.length) break;
      scanned += resp.txs.length;

      for (const entry of resp.txs) {
        const tx = normalizeTxEntry(entry);
        if (!tx) continue;
        if (!withinConstraints(tx, constraints)) continue;

        const type = tx.TransactionType || tx.type;
        if (type !== "Payment") continue;

        const from = tx.Account || tx.account;
        const to = tx.Destination || tx.destination;
        if (!from || !to) continue;
        if (from !== address) continue;

        collected.push(tx);

        if (proof) {
          const pageRec = proof.pages[proof.pages.length - 1];
          pageRec.matchedCount += 1;
          if (tx.hash) pageRec.matchedTxHashes.push(String(tx.hash));
        }
      }

      marker = resp.marker;
      if (!marker) break;

      if (collected.length >= needCount + 50) break;
      if (pages % 25 === 0) setStatus(`Scanning ${address.slice(0, 6)}… pages:${pages} outgoing:${collected.length}`);
    }

    const sorted = normalizeAndSortTxs(collected);
    const picked = sorted.slice(0, needCount);

    if (proof) {
      proof.selected.selectedTxHashes = picked.map((t) => String(t.hash || "")).filter(Boolean);
      proof.selected.selectedTxs = picked.map((t) => ({
        tx_hash: String(t.hash || ""),
        ledger_index: Number(t.ledger_index || 0),
        date: t._iso || null,
        to: t.Destination || t.destination || null,
        amount: parseAmount(t.Amount ?? t.delivered_amount ?? t._meta?.delivered_amount ?? null).value,
        currency: parseAmount(t.Amount ?? t.delivered_amount ?? t._meta?.delivered_amount ?? null).currency
      }));
    }

    return {
      txs: picked,
      strictProof: proof,
      meta: {
        pages,
        scanned,
        outgoingFound: collected.length,
        complete: pages < MAX_PAGES_TREE_SCAN && scanned < MAX_TX_SCAN_PER_NODE
      }
    };
  }

  // ---------------- GRAPH ----------------
  function makeGraph(issuer, params) {
    return {
      issuer,
      builtAt: null,
      params,
      nodes: new Map(), // addr -> node
      edges: [], // { from,to,ledger_index,date,amount,currency,tx_hash }
      adjacency: new Map(), // from -> [edgeIdx]
      parentChoice: new Map() // child -> parent (tree)
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
        outgoingProof: null
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
    const strict = strictProofEnabled();

    ensureNode(g, g.issuer, 0);

    g.nodes.get(g.issuer).acctInfo = await fetchAccountInfo(g.issuer);
    g.nodes.get(g.issuer).activation = await getActivatedByStrict(g.issuer, constraints);

    const q = [{ addr: g.issuer, level: 0 }];
    const seen = new Set([g.issuer]);
    let processed = 0;

    while (q.length) {
      const { addr, level } = q.shift();
      processed += 1;

      setStatus(`Tree: ${processed} nodes • edges:${g.edges.length} • ${addr.slice(0, 6)}… (lvl ${level}/${depth})`);
      setProgress(processed / Math.max(1, Math.min(maxAccounts, processed + q.length)));

      if (level >= depth) continue;
      if (g.nodes.size >= maxAccounts) break;
      if (g.edges.length >= maxEdges) break;

      const res = await collectOutgoingPaymentsEarliest(addr, perNode, constraints, strict);
      const txs = res.txs;

      const node = g.nodes.get(addr);
      node.outgoingProof = res.strictProof || null;
      node.outgoingFirst = txs.map((tx) => {
        const to = tx.Destination || tx.destination || null;
        const amt = parseAmount(tx.Amount ?? tx.delivered_amount ?? tx._meta?.delivered_amount ?? null);
        return {
          tx_hash: String(tx.hash || ""),
          to,
          ledger_index: Number(tx.ledger_index || 0),
          date: tx._iso || null,
          amount: amt.value,
          currency: amt.currency
        };
      });

      if (!txs.length) continue;

      for (const tx of txs) {
        if (g.edges.length >= maxEdges) break;

        const from = tx.Account || tx.account;
        const to = tx.Destination || tx.destination;
        if (!from || !to) continue;

        const amt = parseAmount(tx.Amount ?? tx.delivered_amount ?? tx._meta?.delivered_amount ?? null);

        addEdge(g, {
          from,
          to,
          ledger_index: Number(tx.ledger_index || 0),
          date: tx._iso || null,
          amount: amt.value,
          currency: amt.currency,
          tx_hash: String(tx.hash || "")
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
  function findCyclesUpTo4(g, maxOut) {
    const cycles = [];
    const seen = new Set();

    const neigh = new Map();
    for (const [from, idxs] of g.adjacency.entries()) {
      neigh.set(from, idxs.map((i) => g.edges[i].to));
    }

    function addCycle(path) {
      const minIdx = path.reduce((best, _, i) => (String(path[i]) < String(path[best]) ? i : best), 0);
      const rotated = path.slice(minIdx).concat(path.slice(0, minIdx));
      const key = rotated.join("->");
      if (seen.has(key)) return;
      seen.add(key);
      cycles.push({ cycle: rotated });
    }

    const nodes = Array.from(g.nodes.keys()).slice(0, 1200);

    for (const a of nodes) {
      if (cycles.length >= maxOut) break;
      const aN = neigh.get(a) || [];

      for (const b of aN) {
        if (cycles.length >= maxOut) break;
        const bN = neigh.get(b) || [];
        if (bN.includes(a)) addCycle([a, b]);
      }

      for (const b of aN.slice(0, 60)) {
        if (cycles.length >= maxOut) break;
        const bN = neigh.get(b) || [];
        for (const c of bN.slice(0, 60)) {
          if (cycles.length >= maxOut) break;
          if (c === a) continue;
          const cN = neigh.get(c) || [];
          if (cN.includes(a)) addCycle([a, b, c]);
        }
      }

      for (const b of aN.slice(0, 40)) {
        if (cycles.length >= maxOut) break;
        const bN = neigh.get(b) || [];
        for (const c of bN.slice(0, 40)) {
          if (cycles.length >= maxOut) break;
          if (c === a || c === b) continue;
          const cN = neigh.get(c) || [];
          for (const d of cN.slice(0, 40)) {
            if (cycles.length >= maxOut) break;
            if (d === a || d === b || d === c) continue;
            const dN = neigh.get(d) || [];
            if (dN.includes(a)) addCycle([a, b, c, d]);
          }
        }
      }
    }

    return cycles;
  }

  function runPatternScan(g) {
    const outBy = new Map();
    const inBy = new Map();
    for (const e of g.edges) {
      if (!outBy.has(e.from)) outBy.set(e.from, []);
      outBy.get(e.from).push(e);
      if (!inBy.has(e.to)) inBy.set(e.to, []);
      inBy.get(e.to).push(e);
    }

    const domExamples = [];
    const issuerOut = outBy.get(g.issuer) || [];

    {
      const c = new Map();
      for (const e of issuerOut) c.set(e.to, (c.get(e.to) || 0) + 1);
      const top = Array.from(c.entries()).sort((a, b) => b[1] - a[1])[0] || [null, 0];
      const dom = issuerOut.length ? top[1] / issuerOut.length : 0;
      domExamples.push({ scope: "issuer_first_hop", topRecipient: top[0], share: dom, total: issuerOut.length });
    }

    for (const [addr, outs] of outBy.entries()) {
      if (!outs.length) continue;
      const cc = new Map();
      for (const e of outs) cc.set(e.to, (cc.get(e.to) || 0) + 1);
      const top = Array.from(cc.entries()).sort((a, b) => b[1] - a[1])[0];
      if (!top) continue;
      const share = top[1] / outs.length;
      if (share >= DOMINANCE_CHILD_THRESHOLD && outs.length >= 10) {
        domExamples.push({ scope: "node_dominated_child", node: addr, topChild: top[0], share, outCount: outs.length });
      }
    }

    const dominance = {
      summary: [
        `issuer first-hop dominance: ${Math.round((domExamples[0]?.share || 0) * 100)}%`,
        `dominated nodes (≥${Math.round(DOMINANCE_CHILD_THRESHOLD * 100)}%): ${domExamples.filter((x) => x.scope === "node_dominated_child").length}`
      ],
      examples: domExamples.slice(0, 300)
    };

    const burstExamples = [];
    for (const [addr, outs] of outBy.entries()) {
      const withTime = outs.filter((e) => e.date).slice();
      if (withTime.length < 10) continue;

      const hourBuckets = new Map();
      for (const e of withTime) {
        const d = new Date(e.date);
        const key = `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()} ${d.getUTCHours()}:00Z`;
        hourBuckets.set(key, (hourBuckets.get(key) || 0) + 1);
      }
      for (const [k, cnt] of hourBuckets.entries()) {
        if (cnt >= BURST_HOURLY_MIN_TX) burstExamples.push({ addr, window: "hour", bucket: k, txCount: cnt });
      }

      const dayBuckets = new Map();
      for (const e of withTime) {
        const key = e.date.slice(0, 10);
        dayBuckets.set(key, (dayBuckets.get(key) || 0) + 1);
      }
      for (const [k, cnt] of dayBuckets.entries()) {
        if (cnt >= BURST_DAILY_MIN_TX) burstExamples.push({ addr, window: "day", bucket: k, txCount: cnt });
      }
    }

    burstExamples.sort((a, b) => b.txCount - a.txCount);
    const bursts = {
      summary: [
        `hourly bursts (≥${BURST_HOURLY_MIN_TX}/hr): ${burstExamples.filter((x) => x.window === "hour").length}`,
        `daily bursts (≥${BURST_DAILY_MIN_TX}/day): ${burstExamples.filter((x) => x.window === "day").length}`
      ],
      examples: burstExamples.slice(0, 300)
    };

    const hubExamples = [];
    for (const addr of g.nodes.keys()) {
      const ins = inBy.get(addr) || [];
      const outs = outBy.get(addr) || [];
      if (ins.length < 8 || outs.length < 4) continue;

      const parents = new Set(ins.map((e) => e.from));
      const children = new Set(outs.map((e) => e.to));
      if (parents.size < 6) continue;
      if (children.size > 3) continue;

      const cc = new Map();
      for (const e of outs) cc.set(e.to, (cc.get(e.to) || 0) + 1);
      const top = Array.from(cc.entries()).sort((a, b) => b[1] - a[1])[0];
      const share = top ? top[1] / outs.length : 0;
      if (share < 0.7) continue;

      hubExamples.push({
        hub: addr,
        parentCount: parents.size,
        inCount: ins.length,
        childCount: children.size,
        outCount: outs.length,
        topChild: top?.[0] || null,
        topChildShare: share
      });
    }

    hubExamples.sort((a, b) => (b.parentCount - a.parentCount) || (b.inCount - a.inCount));
    const hubs = {
      summary: [`reconsolidation hubs: ${hubExamples.length}`, `top hub parents: ${hubExamples[0]?.parentCount || 0}`],
      examples: hubExamples.slice(0, 200)
    };

    const cycles = {
      summary: [`cycles found (≤4): ${findCyclesUpTo4(g, 200).length}`],
      examples: findCyclesUpTo4(g, 200)
    };

    const splitExamples = [];
    for (const [addr, outs] of outBy.entries()) {
      const xrp = outs.filter((e) => e.currency === "XRP" && Number.isFinite(e.amount) && e.date);
      if (xrp.length < SPLIT_CLUSTER_MIN) continue;

      xrp.sort((a, b) => (a.date < b.date ? -1 : 1));

      let start = 0;
      while (start < xrp.length) {
        let end = start;
        const t0 = new Date(xrp[start].date).getTime();
        while (end < xrp.length) {
          const t1 = new Date(xrp[end].date).getTime();
          const mins = (t1 - t0) / 60000;
          if (mins > SPLIT_WINDOW_MINUTES) break;
          end++;
        }
        const windowEdges = xrp.slice(start, end);
        if (windowEdges.length >= SPLIT_CLUSTER_MIN) {
          const groups = [];
          for (const e of windowEdges) {
            let placed = false;
            for (const g0 of groups) {
              const base = g0.base;
              if (base > 0 && Math.abs(e.amount - base) / base <= 0.01) {
                g0.edges.push(e);
                placed = true;
                break;
              }
            }
            if (!placed) groups.push({ base: e.amount, edges: [e] });
          }
          const big = groups.filter((gg) => gg.edges.length >= SPLIT_CLUSTER_MIN);
          for (const gg of big) {
            splitExamples.push({
              sender: addr,
              windowStart: windowEdges[0].date,
              windowEnd: windowEdges[windowEdges.length - 1].date,
              count: gg.edges.length,
              approxAmount: gg.base,
              recipients: Array.from(new Set(gg.edges.map((e) => e.to))).slice(0, 50)
            });
          }
        }
        start = Math.max(start + 1, end);
      }
    }

    splitExamples.sort((a, b) => b.count - a.count);
    const splits = {
      summary: [
        `split clusters (≥${SPLIT_CLUSTER_MIN} similar within ${SPLIT_WINDOW_MINUTES}m): ${splitExamples.length}`,
        `top split count: ${splitExamples[0]?.count || 0}`
      ],
      examples: splitExamples.slice(0, 200)
    };

    return { dominance, bursts, hubs, cycles, splits };
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

    if (autoBuildIfMissing) {
      buildTreeClicked().catch(() => {});
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
          <div style="opacity:.85">Issuer tree • activated_by • patterns</div>

          <div id="uiConnBadge" style="margin-left:auto;display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:999px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.10);">
            <div style="width:10px;height:10px;border-radius:999px;background:rgba(0,0,0,0.25);"></div>
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
                  <textarea id="uiIssuerList" placeholder="Paste issuers (one per line or comma-separated)" style="width:100%;min-height:86px;padding:10px;border-radius:10px;border:1px solid var(--accent-tertiary);background:transparent;color:var(--text-primary);resize:vertical;"></textarea>
                  <div style="display:flex;flex-direction:column;gap:8px;">
                    <button id="uiSaveList" class="nav-btn" style="padding:10px 12px;border-radius:10px;background:#50a8ff;border:none;color:#000;font-weight:900;">Save</button>
                    <button id="uiClearCache" class="nav-btn" style="padding:10px 12px;border-radius:10px;background:#ffb86c;border:none;color:#000;font-weight:900;">Cache</button>
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

              <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;align-items:center;">
                <label style="font-size:13px;display:flex;align-items:center;gap:8px;cursor:pointer;">
                  <input id="uiStrictProof" type="checkbox" />
                  Strict first-N proof
                </label>
                <div style="opacity:.75;font-size:12px;">stores marker chain + selected tx hashes per node</div>
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
                <strong>Edges</strong>
                <button id="uiExportGraph" class="nav-btn" style="margin-left:auto;padding:8px 10px;border-radius:10px;border:none;background:#50a8ff;color:#000;font-weight:900;cursor:pointer;">Export</button>
              </div>
              <div id="uiEdgeItems" style="margin-top:10px;"></div>
            </div>
          </div>
        </div>

        <div id="uiModalOverlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);align-items:center;justify-content:center;z-index:12000;">
          <div style="width:min(900px,95%);max-height:80vh;overflow:auto;background:var(--bg-secondary);padding:14px;border-radius:10px;border:1px solid var(--accent-tertiary);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <strong id="uiModalTitle">Details</strong>
              <button id="uiModalClose">✕</button>
            </div>
            <div id="uiModalActions" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;"></div>
            <pre id="uiModalBody" style="white-space:pre-wrap;font-size:13px;color:var(--text-primary);"></pre>
          </div>
        </div>
      </div>
    `;

    $("uiModalClose").addEventListener("click", closeModal);

    $("uiRetryWs").addEventListener("click", () => {
      attemptSharedReconnect("manual retry");
      setStatus("Retry requested.");
    });

    // live badge updates
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
      clearViews();
      setStatus("Cache cleared");
    });

    $("uiBuild").addEventListener("click", () => buildTreeClicked().catch(() => {}));
    $("uiSearch").addEventListener("input", renderEdgeFilterActive);
    $("uiFindPath").addEventListener("click", findPathClicked);
    $("uiPatterns").addEventListener("click", patternsClicked);
    $("uiExportGraph").addEventListener("click", exportActiveGraph);
  }

  function clearViews() {
    $("uiTree").innerHTML = "";
    $("uiSummary").innerHTML = `<div style="opacity:.8">Tree summary appears here.</div>`;
    $("uiResults").innerHTML = `<div style="opacity:.8">Path + patterns appear here.</div>`;
    $("uiEdgeItems").innerHTML = "";
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
    const strict = strictProofEnabled() ? "ON" : "OFF";

    const actHtml = act
      ? (() => {
          const links = act.tx_hash ? explorerLinks(act.tx_hash) : null;
          const txLink = links
            ? ` • <a href="${escapeHtml(links.xrpscan)}" target="_blank" rel="noopener noreferrer">XRPScan</a>
                <a href="${escapeHtml(links.bithomp)}" target="_blank" rel="noopener noreferrer" style="margin-left:8px;">Bithomp</a>`
            : "";
          const amt = act.amount != null ? `XRP ${act.amount.toFixed(6)}` : escapeHtml(act.currency || "—");
          return `<div style="margin-top:8px;"><strong>Activated by</strong>: <code>${escapeHtml(act.activatedBy)}</code> • ${escapeHtml(
            amt
          )} • ${escapeHtml(act.date || "—")} <span style="opacity:.7">(${escapeHtml(actEntry.source)})</span>${txLink}</div>`;
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
      <div style="margin-top:8px;opacity:.85;font-size:12px;">Strict proof: <strong>${escapeHtml(strict)}</strong></div>
      <div style="margin-top:6px;opacity:.8;font-size:12px;">Built: ${escapeHtml(g.builtAt || "—")}</div>
    `;
  }

  function renderTree(g) {
    const host = $("uiTree");
    if (!host) return;

    // Determine levels from issuer by BFS within depth.
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

    // Build chosen tree children using first-seen parentChoice.
    const children = new Map();
    for (const addr of levels.keys()) children.set(addr, []);
    for (const [child, parent] of g.parentChoice.entries()) {
      if (!parent) continue;
      if (levels.has(child) && levels.has(parent) && levels.get(child) === levels.get(parent) + 1) {
        if (!children.has(parent)) children.set(parent, []);
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
      const proof = n?.outgoingProof;
      const proofHint = proof ? `<span style="opacity:.7;font-size:12px;">proof: ${escapeHtml(proof.selected.selectedTxHashes.length)}</span>` : "";
      return `
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
          <div>
            <div><code>${escapeHtml(addr)}</code> <span style="opacity:.7">lvl ${escapeHtml(lvl)}</span> ${proofHint}</div>
            ${activationLine(n?.activation)}
            <div style="opacity:.75;font-size:12px;margin-top:4px;">
              out:${escapeHtml(n?.outCount ?? 0)} (XRP ${(n?.outXrp ?? 0).toFixed(2)}) •
              in:${escapeHtml(n?.inCount ?? 0)} (XRP ${(n?.inXrp ?? 0).toFixed(2)})
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
            <button class="uiNode" data-addr="${escapeHtml(addr)}" style="padding:6px 10px;border-radius:10px;border:none;background:#50fa7b;color:#000;cursor:pointer;font-weight:900;">View</button>
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
      btn.addEventListener("click", () => showNodeModal(g, btn.getAttribute("data-addr")))
    );
  }

  function renderEdgeFilter(g) {
    const q = String(($("uiSearch") || {}).value || "").trim().toLowerCase();
    const items = $("uiEdgeItems");
    if (!items) return;

    const filtered = q
      ? g.edges.filter((e) => {
          const hay = `${e.from} ${e.to} ${e.tx_hash} ${e.currency} ${e.amount} ${e.ledger_index} ${e.date || ""}`.toLowerCase();
          return hay.includes(q);
        })
      : g.edges;

    const slice = filtered.slice(0, 250);
    items.innerHTML =
      slice
        .map((e) => {
          const shortHash = e.tx_hash ? e.tx_hash.slice(0, 10) + "…" : "";
          return `<div style="padding:8px;border-bottom:1px dashed rgba(255,255,255,0.05);font-size:12px;">
            <div><code>${escapeHtml(e.from.slice(0, 8))}…</code> → <code>${escapeHtml(e.to.slice(0, 8))}…</code> • ledger ${escapeHtml(
            e.ledger_index
          )} • ${escapeHtml(e.currency)} ${escapeHtml(e.amount)}</div>
            <div style="opacity:.75;">${escapeHtml(e.date || "—")} • ${escapeHtml(shortHash)}</div>
          </div>`;
        })
        .join("") || `<div style="opacity:.7">No edges.</div>`;
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
      ["tx_hash", "to", "ledger_index", "date", "amount", "currency"].join(","),
      ...outgoing.map((x) =>
        [
          `"${String(x.tx_hash || "").replace(/"/g, '""')}"`,
          `"${String(x.to || "").replace(/"/g, '""')}"`,
          Number(x.ledger_index || 0),
          `"${String(x.date || "").replace(/"/g, '""')}"`,
          Number.isFinite(Number(x.amount)) ? Number(x.amount) : "",
          `"${String(x.currency || "").replace(/"/g, '""')}"`
        ].join(",")
      )
    ].join("\n");

    const actLinks = act?.tx_hash ? explorerLinks(act.tx_hash) : null;

    const bodyObj = {
      address: addr,
      level: n.level,
      domain: domain || null,
      balanceXrp: balance != null ? Number(balance) : null,
      activated_by: act
        ? {
            activatedBy: act.activatedBy,
            ledger_index: act.ledger_index,
            date: act.date,
            tx_hash: act.tx_hash,
            xrpscan: actLinks?.xrpscan || null,
            bithomp: actLinks?.bithomp || null
          }
        : null,
      activation_source: actEntry?.source || null,
      activation_complete: actEntry?.complete ?? null,
      stats: {
        outCount: n.outCount,
        outXrp: Number(n.outXrp.toFixed(6)),
        inCount: n.inCount,
        inXrp: Number(n.inXrp.toFixed(6))
      },
      strict_firstN_proof: n.outgoingProof || null,
      first_outgoing_payments: outgoing
    };

    const actionsHtml = `
      <button id="uiCopyHashes" style="padding:8px 10px;border-radius:10px;border:none;background:#50a8ff;color:#000;font-weight:900;cursor:pointer;">Copy tx hashes</button>
      <button id="uiExportCsv" style="padding:8px 10px;border-radius:10px;border:none;background:#ffd166;color:#000;font-weight:900;cursor:pointer;">Export CSV</button>
      <button id="uiExportTxt" style="padding:8px 10px;border-radius:10px;border:1px solid var(--accent-tertiary);background:transparent;color:var(--text-primary);cursor:pointer;">Download hashes</button>
      <button id="uiExportProof" style="padding:8px 10px;border-radius:10px;border:none;background:#bd93f9;color:#000;font-weight:900;cursor:pointer;">Export proof</button>
      <span style="opacity:.75;font-size:12px;display:flex;align-items:center;margin-left:auto;">${escapeHtml(outgoing.length)} txs</span>
    `;

    openModal(`Node: ${addr}`, JSON.stringify(bodyObj, null, 2), actionsHtml);

    $("uiCopyHashes").onclick = async () => {
      const ok = await copyToClipboard(hashesOnly || "");
      $("uiCopyHashes").textContent = ok ? "Copied ✅" : "Copy failed ❌";
      setTimeout(() => ($("uiCopyHashes").textContent = "Copy tx hashes"), 1200);
    };
    $("uiExportCsv").onclick = () => downloadText(csv, `naluxrp-node-${addr}-first-${outgoing.length}-txs.csv`, "text/csv");
    $("uiExportTxt").onclick = () => downloadText(hashesOnly, `naluxrp-node-${addr}-tx-hashes.txt`, "text/plain");
    $("uiExportProof").onclick = () => {
      if (!n.outgoingProof) {
        setStatus("No proof stored (enable Strict proof and rebuild).");
        return;
      }
      downloadText(JSON.stringify(n.outgoingProof, null, 2), `naluxrp-node-${addr}-strict-proof.json`, "application/json");
    };
  }

  // ---------------- EXPORT GRAPH ----------------
  function exportActiveGraph() {
    const g = issuerRegistry.get(activeIssuer);
    if (!g) {
      setStatus("Build a tree first.");
      return;
    }

    const exportObj = {
      issuer: g.issuer,
      builtAt: g.builtAt,
      transport: {
        lastSource: transportState.lastSource,
        sharedConnected: transportState.sharedConnected
      },
      params: {
        ...g.params,
        strictProof: strictProofEnabled()
      },
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
        strict_firstN_proof: n.outgoingProof || null
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
      setProgress(0);
      setStatus("Building tree...");

      activeIssuer = issuer;

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
      <div style="margin-top:8px;">${path.map((p) => `<div><code>${escapeHtml(p)}</code></div>`).join("")}</div>
    `;
  }

  function patternsClicked() {
    const g = issuerRegistry.get(activeIssuer);
    if (!g) {
      setStatus("Build a tree first.");
      return;
    }
    const report = runPatternScan(g);

    const card = (k, title) => {
      const ex = report[k]?.examples || [];
      const lines = (report[k]?.summary || []).map((x) => `<div style="opacity:.9;">${escapeHtml(x)}</div>`).join("");
      return `
        <div style="padding:10px;border-radius:12px;border:1px solid rgba(255,255,255,0.06);background:rgba(255,255,255,0.02);">
          <div style="display:flex;align-items:center;gap:10px;">
            <div style="font-weight:900;">${escapeHtml(title)}</div>
            <div style="opacity:.7;font-size:12px;">examples: ${escapeHtml(ex.length)}</div>
            <button class="uiPatternView" data-key="${escapeHtml(k)}" style="margin-left:auto;padding:8px 10px;border-radius:10px;border:none;background:#50a8ff;color:#000;font-weight:900;cursor:pointer;">View</button>
          </div>
          <div style="margin-top:8px;font-size:13px;">${lines || `<div style="opacity:.7;">—</div>`}</div>
        </div>
      `;
    };

    $("uiResults").innerHTML = `
      <div style="display:flex;flex-direction:column;gap:10px;">
        ${card("dominance", "Dominance")}
        ${card("bursts", "Bursts")}
        ${card("hubs", "Reconsolidation hubs")}
        ${card("cycles", "Cycles (≤4)")}
        ${card("splits", "Split clusters")}
      </div>
    `;

    Array.from(document.querySelectorAll(".uiPatternView")).forEach((btn) =>
      btn.addEventListener("click", () => {
        const key = btn.getAttribute("data-key");
        const payload = report[key]?.examples || [];
        openModal(`Pattern: ${key}`, JSON.stringify(payload, null, 2));
      })
    );
  }

  // ---------------- PUBLIC INIT ----------------
  function initInspector() {
    renderPage();
  }

  window.initInspector = initInspector;

  window.UnifiedInspector = {
    getIssuerList,
    setIssuerList,
    buildActive: () => buildTreeClicked(),
    getGraph: () => issuerRegistry.get(activeIssuer) || null,
    exportActiveGraph,
    attemptSharedReconnect
  };

  console.log("✅ Unified Inspector loaded (transport badge + strict proof enabled)");
})();
