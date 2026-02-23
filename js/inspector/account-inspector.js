/* =========================================================
   FILE: js/inspector/account-inspector.js
   NanaKilo - Core Forensic Engine
   NaluLF (Nalu Ledger Forensics)

   Deep Observation • Deeper Insights

   FEATURES:
   ✅ Flow Analysis (Issuer Tree)
   ✅ Multi-Asset Tracing
   ✅ Pattern Detection
   ✅ Token/IOU Support
   ✅ Quick Inspection

   ARCHITECTURE:
   - Client-side only (no secrets stored)
   - Public XRPL WS endpoints via shared xrpl.js Client
   - LocalStorage for cache/preferences

   ✅ FIX v3.0.1: Added initialization guard + always clear before render

   🔧 TRANSPORT FIX (2026-02-23):
   - Removed invalid HTTP JSON-RPC fallback to https://xrplcluster.com
     (xrplcluster.com is WS, not HTTP JSON-RPC).
   - All requests now go through WebSocket clients:
       1) window.sharedXrplClient (preferred)
       2) window.XRPL.client (fallback, if available)
   ========================================================= */

(function () {
  "use strict";

  // ---------------- CONFIG ----------------
  const MODULE_VERSION = "nanakilo-forensics@3.0.1-FIXED-WS-ONLY";

  const LOCAL_KEY_ISSUER_LIST = "nanakilo_issuerList";
  const LOCAL_KEY_ACTIVE_ISSUER = "nanakilo_activeIssuer";
  const LOCAL_KEY_GRAPH_CACHE = "nanakilo_graphCache_";

  const SHARED_WAIT_MS = 8000;
  const DEFAULT_ISSUER_LIST = [];

  // Shared transport
  let transportState = {
    wsConnected: false,
    lastSource: "—"
  };

  // Issuer registry
  const issuerRegistry = new Map();
  let activeIssuer = null;
  let buildingTree = false;

  // Caches
  const activationCache = new Map();
  const accountInfoCache = new Map();
  const tokenSummaryCache = new Map();

  // Constants for scanning
  const PAGE_LIMIT = 200;
  const MAX_PAGES_TREE_SCAN = 200;
  const MAX_TX_SCAN_PER_NODE = 50_000;
  const DEFAULT_DEPTH = 2;
  const DEFAULT_PER_NODE = 100;
  const DEFAULT_MAX_ACCTS = 250;
  const DEFAULT_MAX_EDGES = 1600;
  const ACTIVATION_PAGE_LIMIT = 200;
  const ACTIVATION_MAX_PAGES = 2000;
  const ACTIVATION_MAX_TX_SCAN = 350_000;

  // ---------------- UTILITY HELPERS ----------------
  const $ = (id) => document.getElementById(id);

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

  function safeGetStorage(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function safeSetStorage(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      console.warn("localStorage write failed:", e);
    }
  }

  function setStatus(s) {
    const el = $("uiStatus");
    if (el) el.textContent = s;
  }

  function setProgress(p) {
    const bar = $("uiProgressBar");
    if (bar) bar.style.width = Math.max(0, Math.min(100, p)) + "%";
  }

  function setBuildBusy(busy, label) {
    const btn = $("uiBuild");
    if (!btn) return;
    btn.disabled = busy;
    btn.textContent = busy ? label || "Building..." : "🌳 Build Flow Analysis";
  }

  function openModal(title, html) {
    const overlay = $("uiModalOverlay");
    if (!overlay) return;
    overlay.style.display = "flex";
    const content = overlay.querySelector("div");
    if (content) {
      content.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <h3 style="margin:0;font-size:20px;font-weight:900;color:var(--inspector-primary);">${escapeHtml(
            title
          )}</h3>
          <button id="uiModalClose" style="padding:8px 12px;border-radius:10px;border:2px solid rgba(255,0,0,0.3);background:rgba(255,0,0,0.15);color:#ff6b6b;cursor:pointer;font-weight:900;font-size:16px;line-height:1;">✕</button>
        </div>
        <div style="max-height:70vh;overflow-y:auto;">${html}</div>
      `;
      $("uiModalClose").onclick = closeModal;
    }
  }

  function closeModal() {
    const o = $("uiModalOverlay");
    if (o) o.style.display = "none";
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  function downloadText(text, filename, mime = "text/plain") {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function explorerLinks(txHash) {
    return `
      <a href="https://livenet.xrpl.org/transactions/${txHash}" target="_blank" rel="noopener">XRPL.org</a> • 
      <a href="https://xrpscan.com/tx/${txHash}" target="_blank" rel="noopener">XRPScan</a> • 
      <a href="https://bithomp.com/explorer/${txHash}" target="_blank" rel="noopener">Bithomp</a>
    `;
  }

  // ---------------- TIME / INPUT HELPERS ----------------
  function safeToIso(x) {
    try {
      if (!x) return "";
      const d = new Date(x);
      return isNaN(d) ? "" : d.toISOString();
    } catch {
      return "";
    }
  }

  function parseNullableInt(v) {
    const n = parseInt(v, 10);
    return isNaN(n) ? null : n;
  }

  function clampInt(n, min, max) {
    if (n == null || isNaN(n)) return null;
    return Math.max(min, Math.min(max, n));
  }

  // ---------------- XRPL AMOUNT ----------------
  function parseAmount(amount) {
    if (typeof amount === "string") {
      return { currency: "XRP", value: parseFloat(amount) / 1_000_000, issuer: null };
    }
    if (typeof amount === "object" && amount && amount.value) {
      return {
        currency: amount.currency || "???",
        value: parseFloat(amount.value || 0),
        issuer: amount.issuer || null
      };
    }
    return {
      currency: "XRP",
      value: 0,
      issuer: null
    };
  }

  function formatAmountPretty(cur, val, issuer) {
    const v = Number(val) || 0;
    if (cur === "XRP") return `${v.toFixed(6)} XRP`;
    const iss = issuer ? ` (${issuer.slice(0, 8)}...)` : "";
    return `${v.toFixed(6)} ${cur}${iss}`;
  }

  // ---------------- TRANSPORT (WS ONLY) ----------------
  function getWsClient() {
    // Prefer the shared client if present
    if (window.sharedXrplClient) return window.sharedXrplClient;

    // Fallback: use the dashboard XRPL module's client if exposed/connected
    if (window.XRPL && window.XRPL.client) return window.XRPL.client;

    return null;
  }

  function computeWsConnected() {
    const c = getWsClient();
    if (!c) return false;

    // xrpl.js Client has isConnected()
    if (typeof c.isConnected === "function") return c.isConnected();

    // If some other client implementation, best-effort:
    return !!window.XRPL?.connected;
  }

  function setTransportLastSource(src) {
    transportState.lastSource = src || "—";
    updateConnBadge();
  }

  function updateConnBadge() {
    transportState.wsConnected = computeWsConnected();
    const dot = $("uiConnDot");
    const text = $("uiConnText");

    if (dot) {
      if (transportState.wsConnected) dot.classList.add("connected");
      else dot.classList.remove("connected");
    }

    if (text) {
      const status = transportState.wsConnected ? "WS" : "OFFLINE";
      text.textContent = `${status} • ${transportState.lastSource}`;
    }
  }

  async function waitForSharedConn(timeoutMs = SHARED_WAIT_MS) {
    if (!window.sharedXrplClient) {
      throw new Error("sharedXrplClient not available");
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        window.sharedXrplClient.removeListener("connected", onConn);
        reject(new Error("WS connection timeout"));
      }, timeoutMs);

      const onConn = () => {
        clearTimeout(timer);
        window.sharedXrplClient.removeListener("connected", onConn);
        resolve();
      };

      if (window.sharedXrplClient.isConnected()) {
        clearTimeout(timer);
        resolve();
      } else {
        window.sharedXrplClient.on("connected", onConn);
      }
    });
  }

  function attemptSharedReconnect(reason) {
    console.log("🔄 NanaKilo: Reconnecting...", reason);
    if (window.sharedXrplClient && typeof window.sharedXrplClient.connect === "function") {
      window.sharedXrplClient.connect().catch((err) => {
        console.warn("Reconnect failed:", err);
      });
      return;
    }

    // Fallback: if the dashboard module exposes connectXRPL
    if (typeof window.connectXRPL === "function") {
      window.connectXRPL();
    }
  }

  // ---------------- HTTP JSON-RPC (DISABLED) ----------------
  // NOTE: xrplcluster.com is NOT an HTTP JSON-RPC endpoint.
  // Leaving helper in place (unused) for future *valid* HTTP endpoints, if you add one.
  async function tryFetchJson(
    url,
    { method = "GET", body = null, timeoutMs = 15000, headers = {} } = {}
  ) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const opts = { method, headers, signal: controller.signal };
      if (body) opts.body = typeof body === "string" ? body : JSON.stringify(body);

      const res = await fetch(url, opts);
      clearTimeout(timer);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      clearTimeout(timer);
      throw e;
    }
  }

  function unwrapRpcResult(json) {
    if (json.result) return json.result;
    if (json.error) throw new Error(json.error.message || "RPC error");
    return json;
  }

  async function rpcCall(method, paramsObj, { timeoutMs = 15000, retries = 2 } = {}) {
    // Disabled by design to prevent invalid calls that cause ERR_CONNECTION_RESET.
    // If you later add a real XRPL HTTP JSON-RPC endpoint, wire it here.
    void timeoutMs;
    void retries;
    throw new Error(
      `HTTP JSON-RPC is disabled (no valid public HTTP endpoint configured). Tried method=${method}`
    );
  }

  async function xrplRequest(payload, { timeoutMs = 20000, allowHttpFallback = false } = {}) {
    void timeoutMs;

    // 1) sharedXrplClient (preferred)
    if (window.sharedXrplClient) {
      if (!window.sharedXrplClient.isConnected()) {
        // try waiting briefly (helps on page-switch)
        try {
          setTransportLastSource("WS (waiting)");
          await waitForSharedConn(SHARED_WAIT_MS);
        } catch (e) {
          // continue to fallback checks below
        }
      }

      if (window.sharedXrplClient.isConnected()) {
        try {
          setTransportLastSource("shared WS");
          const result = await window.sharedXrplClient.request(payload);
          transportState.wsConnected = true;
          updateConnBadge();
          return result;
        } catch (e) {
          console.warn("shared WS request failed:", e);
          // continue to try window.XRPL.client
        }
      }
    }

    // 2) window.XRPL.client (dashboard module client)
    if (window.XRPL && window.XRPL.client && window.XRPL.connected) {
      try {
        setTransportLastSource("XRPL WS");
        const result = await window.XRPL.client.request(payload);
        transportState.wsConnected = true;
        updateConnBadge();
        return result;
      } catch (e) {
        console.warn("XRPL WS request failed:", e);
      }
    }

    // 3) Optional HTTP fallback (kept off by default)
    if (allowHttpFallback) {
      return await rpcCall(payload.command, payload, { timeoutMs });
    }

    updateConnBadge();
    throw new Error("No XRPL WebSocket connection available");
  }

  // ---------------- TX NORMALIZATION ----------------
  function normalizeTxEntry(entry) {
    const tx = entry.tx || entry.transaction || entry;
    const meta = entry.meta || entry.metaData || tx.meta || tx.metaData || {};

    return {
      hash: tx.hash || entry.hash,
      ledger_index: tx.ledger_index || entry.ledger_index,
      date: tx.date || entry.date,
      TransactionType: tx.TransactionType || tx.type,
      Account: tx.Account || tx.account,
      Destination: tx.Destination || tx.destination,
      Amount: tx.Amount,
      Fee: tx.Fee,
      _meta: meta,
      _iso: safeToIso(tx.date || entry.date),
      validated: entry.validated ?? true
    };
  }

  function normalizeAndSortTxsAsc(entries) {
    return entries
      .map(normalizeTxEntry)
      .sort((a, b) => (a.ledger_index || 0) - (b.ledger_index || 0));
  }

  function withinConstraints(tx, constraints) {
    const { ledgerMin, ledgerMax, startDate, endDate, minXrp } = constraints;
    const ledger = tx.ledger_index || 0;

    if (ledgerMin != null && ledger < ledgerMin) return false;
    if (ledgerMax != null && ledger > ledgerMax) return false;

    if (startDate && tx._iso && tx._iso < startDate) return false;
    if (endDate && tx._iso && tx._iso > endDate) return false;

    if (minXrp) {
      const amt = parseAmount(tx.Amount);
      if (amt.currency === "XRP" && amt.value < minXrp) return false;
    }

    return true;
  }

  async function fetchAccountTxPaged(address, { marker, limit, forward, ledgerMin, ledgerMax }) {
    const params = {
      command: "account_tx",
      account: address,
      limit: limit || PAGE_LIMIT,
      forward: !!forward,
      ledger_index_min: ledgerMin == null ? -1 : ledgerMin,
      ledger_index_max: ledgerMax == null ? -1 : ledgerMax
    };

    if (marker) params.marker = marker;

    const result = await xrplRequest(params);
    return {
      txs: result.transactions || [],
      marker: result.marker || null
    };
  }

  // ---------------- ACCOUNT INFO ----------------
  function hexToAscii(hex) {
    if (!hex) return "";
    let str = "";
    for (let i = 0; i < hex.length; i += 2) {
      const code = parseInt(hex.substr(i, 2), 16);
      if (code) str += String.fromCharCode(code);
    }
    return str;
  }

  function normalizeAccountInfo(info) {
    const balanceDrops = info.Balance || "0";
    const balanceXrp = parseFloat(balanceDrops) / 1_000_000;

    return {
      address: info.Account,
      balanceXrp,
      sequence: info.Sequence,
      flags: info.Flags,
      ownerCount: info.OwnerCount,
      previousTxn: info.PreviousTxnID,
      domain: hexToAscii(info.Domain || "")
    };
  }

  async function fetchAccountInfo(address) {
    if (!isValidXrpAddress(address)) return null;
    if (accountInfoCache.has(address)) return accountInfoCache.get(address);

    try {
      const result = await xrplRequest({
        command: "account_info",
        account: address,
        ledger_index: "validated"
      });
      const normalized = normalizeAccountInfo(result.account_data);
      accountInfoCache.set(address, normalized);
      return normalized;
    } catch (e) {
      console.warn("fetchAccountInfo failed:", e);
      return null;
    }
  }

  // ---------------- ACCOUNT LINES + ISSUED TOKENS ----------------
  async function fetchAccountLinesAll(address) {
    if (!isValidXrpAddress(address)) return [];

    const allLines = [];
    let marker = null;
    let pages = 0;
    const maxPages = 50;

    do {
      pages++;
      const params = { command: "account_lines", account: address, limit: 400 };
      if (marker) params.marker = marker;

      const result = await xrplRequest(params);
      if (result.lines) allLines.push(...result.lines);
      marker = result.marker;
    } while (marker && pages < maxPages);

    return allLines;
  }

  async function fetchGatewayBalances(address) {
    try {
      const result = await xrplRequest({
        command: "gateway_balances",
        account: address,
        ledger_index: "validated"
      });
      return result;
    } catch {
      return null;
    }
  }

  function buildTokenSummaryFromLines(address, linesResp, gatewayResp) {
    const holding = [];
    const issued = [];

    if (Array.isArray(linesResp)) {
      linesResp.forEach((line) => {
        const val = parseFloat(line.balance);
        if (val > 0) {
          holding.push({
            currency: line.currency,
            value: val,
            issuer: line.account,
            peer: line.account,
            balance: val
          });
        } else if (val < 0) {
          issued.push({
            currency: line.currency,
            value: Math.abs(val),
            holder: line.account,
            holders: 1,
            outstanding: Math.abs(val)
          });
        }
      });
    }

    if (gatewayResp?.obligations) {
      Object.entries(gatewayResp.obligations).forEach(([cur, val]) => {
        issued.push({
          currency: cur,
          value: parseFloat(val),
          holder: "various",
          holders: 0,
          outstanding: parseFloat(val)
        });
      });
    }

    return {
      address,
      trustlineCount: linesResp ? linesResp.length : 0,
      linesPages: 0,
      linesComplete: true,
      source: "unknown",
      holding,
      issuedEstimated: issued,
      topTrustlines: holding.slice(0, 18),
      gatewayObligations: gatewayResp?.obligations || null
    };
  }

  async function getTokenSummary(address) {
    const addr = String(address || "").trim();
    if (!isValidXrpAddress(addr)) return null;
    if (tokenSummaryCache.has(addr)) return tokenSummaryCache.get(addr);

    const [lines, gateway] = await Promise.all([
      fetchAccountLinesAll(addr),
      fetchGatewayBalances(addr)
    ]);

    const summary = buildTokenSummaryFromLines(addr, lines, gateway);
    tokenSummaryCache.set(addr, summary);
    return summary;
  }

  // ---------------- ACTIVATION (activated_by) ----------------
  async function getActivatedByStrict(address, constraints) {
    if (!isValidXrpAddress(address)) {
      return { activator: null, complete: false, scanned: 0, pages: 0, source: "invalid" };
    }

    if (activationCache.has(address)) {
      const cached = activationCache.get(address);
      if (cached.complete) return cached;
    }

    try {
      const fetchResp = await fetchAccountTxPaged(address, {
        limit: ACTIVATION_PAGE_LIMIT,
        forward: true,
        ledgerMin: constraints.ledgerMin,
        ledgerMax: constraints.ledgerMax,
        marker: null
      });

      const txs = normalizeAndSortTxsAsc(fetchResp.txs);
      const first = txs.find(
        (t) =>
          t.TransactionType === "Payment" &&
          t.Destination === address &&
          withinConstraints(t, constraints)
      );

      if (first) {
        const activation = {
          activator: first.Account,
          complete: true,
          scanned: txs.length,
          pages: 1,
          source: transportState.lastSource || "unknown"
        };
        activationCache.set(address, activation);
        return activation;
      }

      const activation = {
        activator: null,
        complete: true,
        scanned: txs.length,
        pages: 1,
        source: transportState.lastSource || "unknown"
      };
      activationCache.set(address, activation);
      return activation;
    } catch (e) {
      console.warn("getActivatedByStrict failed:", e);
      return {
        activator: null,
        complete: false,
        scanned: 0,
        pages: 0,
        source: "error"
      };
    }
  }

  // ---------------- COUNTERPARTY EXTRACTION (for edges) ----------------
  function extractCounterparty(tx) {
    if (!tx) return null;

    const type = (tx.TransactionType || "").toLowerCase();

    if (type === "payment") {
      return tx.Destination || null;
    }

    if (type === "offercreate" || type === "offercancel") {
      const taker = tx.TakerGets || tx.TakerPays;
      if (taker && typeof taker === "object" && taker.issuer) return taker.issuer;
      return null;
    }

    if (type === "trustset") {
      const lim = tx.LimitAmount;
      if (lim && typeof lim === "object" && lim.issuer) return lim.issuer;
      return null;
    }

    if (tx.Destination) return tx.Destination;
    if (tx.Owner) return tx.Owner;

    return null;
  }

  // ---------------- OUTGOING COLLECTION (MOST RECENT) ----------------
  async function collectOutgoingTxsMostRecent(address, needCount, constraints) {
    if (!isValidXrpAddress(address)) {
      return { txs: [], scanned: 0, pages: 0, complete: false, source: "invalid" };
    }

    const collected = [];
    let marker = null;
    let pages = 0;
    let scanned = 0;

    while (collected.length < needCount && pages < MAX_PAGES_TREE_SCAN) {
      pages++;

      const result = await fetchAccountTxPaged(address, {
        marker,
        limit: PAGE_LIMIT,
        forward: false,
        ledgerMin: constraints.ledgerMin,
        ledgerMax: constraints.ledgerMax
      });

      const txs = normalizeAndSortTxsAsc(result.txs);
      scanned += txs.length;

      for (const tx of txs) {
        if (tx.Account === address && withinConstraints(tx, constraints)) {
          collected.push(tx);
          if (collected.length >= needCount) break;
        }
      }

      marker = result.marker;
      if (!marker) break;
    }

    return {
      txs: collected,
      scanned,
      pages,
      complete: !marker,
      source: transportState.lastSource || "unknown"
    };
  }

  // ---------------- GRAPH (ISSUER TREE) ----------------
  function makeGraph(issuer, params) {
    return {
      issuer,
      params,
      nodes: new Map(),
      edges: [],
      stats: { totalScanned: 0, totalPages: 0, processedAccounts: 0 },
      builtAt: new Date().toISOString()
    };
  }

  function ensureNode(g, addr, level) {
    if (!isValidXrpAddress(addr)) return null;
    if (g.nodes.has(addr)) return g.nodes.get(addr);

    const n = {
      addr,
      level,
      activatedBy: null,
      activatedBySource: "pending",
      acctInfo: null,
      outTxs: [],
      outScanned: 0,
      outPages: 0,
      outComplete: false,
      outCount: 0
    };

    g.nodes.set(addr, n);
    return n;
  }

  function addEdge(g, e) {
    g.edges.push(e);
  }

  async function buildIssuerTree(g) {
    const { issuer, params } = g;
    const depth = clampInt(params.depth, 1, 10) || DEFAULT_DEPTH;
    const perNode = clampInt(params.perNode, 1, 500) || DEFAULT_PER_NODE;
    const maxAccounts = clampInt(params.maxAccounts, 1, 2000) || DEFAULT_MAX_ACCTS;
    const maxEdges = clampInt(params.maxEdges, 1, 20000) || DEFAULT_MAX_EDGES;

    const constraints = {
      ledgerMin: params.ledgerMin || null,
      ledgerMax: params.ledgerMax || null,
      startDate: params.startDate || null,
      endDate: params.endDate || null,
      minXrp: params.minXrp || null
    };

    ensureNode(g, issuer, 0);

    const q = [{ addr: issuer, level: 0 }];
    let processed = 0;

    while (q.length > 0 && processed < maxAccounts && g.edges.length < maxEdges) {
      const item = q.shift();
      const { addr, level } = item;
      const node = g.nodes.get(addr);
      if (!node || node.outComplete) continue;

      processed += 1;
      g.stats.processedAccounts = processed;

      const denom = () => Math.max(1, Math.min(maxAccounts, processed + q.length));
      setProgress(((processed + q.length * 0.5) / denom()) * 100);
      setStatus(`🔍 ${processed}/${maxAccounts} • ${q.length} queued • ${g.edges.length} edges`);

      try {
        if (!node.acctInfo) {
          const inf = await fetchAccountInfo(addr);
          node.acctInfo = inf;
        }
      } catch (e) {
        console.warn(`fetchAccountInfo failed for ${addr}:`, e?.message || e);
      }

      try {
        if (level === 0 || !node.activatedBy) {
          const actRes = await getActivatedByStrict(addr, constraints);
          node.activatedBy = actRes.activator;
          node.activatedBySource = actRes.source || "unknown";
        }
      } catch (e) {
        console.warn(`getActivatedByStrict failed for ${addr}:`, e?.message || e);
      }

      try {
        const res = await collectOutgoingTxsMostRecent(addr, perNode, constraints);
        node.outTxs = res.txs;
        node.outScanned = res.scanned;
        node.outPages = res.pages;
        node.outComplete = res.complete;
        node.outCount = res.txs.length;

        g.stats.totalScanned += res.scanned;
        g.stats.totalPages += res.pages;

        for (const t of res.txs) {
          const cp = extractCounterparty(t);
          if (!cp || !isValidXrpAddress(cp)) continue;

          const amt = parseAmount(t.Amount || null);

          addEdge(g, {
            from: addr,
            to: cp,
            type: t.TransactionType || "unknown",
            hash: t.hash || null,
            ledger_index: t.ledger_index || null,
            date: t._iso || null,
            amount: amt.value,
            currency: amt.currency,
            issuer: amt.issuer || null
          });

          if (level + 1 < depth && !g.nodes.has(cp)) {
            ensureNode(g, cp, level + 1);
            q.push({ addr: cp, level: level + 1 });
          }
        }
      } catch (e) {
        console.warn(`collectOutgoingTxsMostRecent failed for ${addr}:`, e?.message || e);
      }

      if (g.edges.length >= maxEdges) {
        setStatus(`⚠️ Max edges (${maxEdges}) reached. Stopping build.`);
        break;
      }
    }

    setProgress(0);
  }

  // ---------------- PATH ----------------
  function findShortestPath(g, src, dst) {
    if (!g || !g.nodes.has(src) || !g.nodes.has(dst)) return null;

    const adj = new Map();
    g.edges.forEach((e) => {
      if (!adj.has(e.from)) adj.set(e.from, []);
      adj.get(e.from).push(e);
    });

    const q = [{ node: src, path: [] }];
    const visited = new Set([src]);

    while (q.length > 0) {
      const { node, path } = q.shift();
      if (node === dst) return path;

      const neighbors = adj.get(node) || [];
      for (const e of neighbors) {
        const next = e.to;
        if (!visited.has(next) && g.nodes.has(next)) {
          visited.add(next);
          q.push({ node: next, path: [...path, e] });
        }
      }
    }

    return null;
  }

  // ---------------- PATTERNS ----------------
  function runPatternScanFull(g) {
    const adj = new Map();
    g.edges.forEach((e) => {
      if (!adj.has(e.from)) adj.set(e.from, []);
      adj.get(e.from).push(e.to);
    });

    const cycles = [];
    const maxCycles = 60;

    function canonicalizeCycle(path) {
      const minIdx = path.indexOf(Math.min(...path));
      return [...path.slice(minIdx), ...path.slice(0, minIdx)].join("→");
    }

    function dfs(start, cur, depthLeft, stack, visited) {
      if (cycles.length >= maxCycles) return;
      if (depthLeft === 0) return;

      const neighbors = adj.get(cur) || [];
      for (const nxt of neighbors) {
        if (nxt === start && stack.length >= 2) {
          const can = canonicalizeCycle([...stack, nxt]);
          if (!cycles.some((c) => c.canonical === can)) {
            cycles.push({ canonical: can, path: [...stack, nxt] });
          }
          continue;
        }

        if (visited.has(nxt)) continue;
        visited.add(nxt);
        dfs(start, nxt, depthLeft - 1, [...stack, nxt], visited);
        visited.delete(nxt);
      }
    }

    const starts = Array.from(adj.keys()).slice(0, 30);
    for (const s of starts) {
      if (cycles.length >= maxCycles) break;
      const visited = new Set([s]);
      dfs(s, s, 8, [s], visited);
    }

    return cycles.map((c) => c.path);
  }

  // ---------------- ISSUER LIST ----------------
  function normalizeIssuerListText(text) {
    return text
      .split(/[\n,;]+/)
      .map((line) => line.trim())
      .filter((line) => line && isValidXrpAddress(line));
  }

  function getIssuerList() {
    const raw = safeGetStorage(LOCAL_KEY_ISSUER_LIST);
    if (!raw) return DEFAULT_ISSUER_LIST;

    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : DEFAULT_ISSUER_LIST;
    } catch {
      return DEFAULT_ISSUER_LIST;
    }
  }

  function setIssuerList(list) {
    safeSetStorage(LOCAL_KEY_ISSUER_LIST, JSON.stringify(list));
  }

  function hydrateIssuerSelect() {
    const sel = $("uiIssuerSelect");
    if (!sel) return;

    sel.innerHTML = '<option value="">-- Select Issuer --</option>';

    const list = getIssuerList();
    list.forEach((addr) => {
      const opt = document.createElement("option");
      opt.value = addr;
      opt.textContent = `${addr.slice(0, 12)}...${addr.slice(-8)}`;
      sel.appendChild(opt);
    });

    const last = safeGetStorage(LOCAL_KEY_ACTIVE_ISSUER);
    if (last && list.includes(last)) {
      sel.value = last;
      activeIssuer = last;
    }
  }

  function onIssuerSelected(issuer, { autoBuildIfMissing } = { autoBuildIfMissing: false }) {
    activeIssuer = issuer;
    safeSetStorage(LOCAL_KEY_ACTIVE_ISSUER, issuer);

    if (issuerRegistry.has(issuer)) {
      renderAll(issuerRegistry.get(issuer));
    } else {
      clearViews();
      if (autoBuildIfMissing) {
        buildTreeClicked();
      }
    }
  }

  // ---------------- TABS ----------------
  function bindInspectorTabs() {
    const tabs = document.querySelectorAll(".inspector-tab-btn");
    const panes = document.querySelectorAll(".inspector-tab-pane");

    function activate(name) {
      tabs.forEach((btn) => {
        if (btn.dataset.tab === name) {
          btn.classList.add("is-active");
          btn.setAttribute("aria-selected", "true");
        } else {
          btn.classList.remove("is-active");
          btn.setAttribute("aria-selected", "false");
        }
      });

      panes.forEach((pane) => {
        pane.style.display = pane.dataset.tab === name ? "block" : "none";
      });
    }

    tabs.forEach((btn) => {
      btn.addEventListener("click", () => {
        activate(btn.dataset.tab);
      });
    });

    activate("flow");
  }

  function switchToTraceTab() {
    const btn = document.querySelector('.inspector-tab-btn[data-tab="trace"]');
    if (btn) btn.click();
  }

  function switchToTraceAndSetSeed(addr) {
    switchToTraceTab();
    if (window.NanaKiloTrace && window.NanaKiloTrace.setOrigin) {
      window.NanaKiloTrace.setOrigin(addr);
    }
  }

  // ---------------- RENDER ----------------
  function ensurePage() {
    let page = $("inspector");

    if (!page) {
      page = document.createElement("section");
      page.id = "inspector";
      page.className = "page-section";
      const main = document.querySelector("main") || document.body;
      main.appendChild(page);
    }

    page.innerHTML = "";

    page.innerHTML = `
    <div class="chart-section" style="font-family: 'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
        <h2 style="font-family: 'MedievalSharp', serif !important; letter-spacing: 1px;">👁️‍🗨️ NanaKilo • Account Forensics</h2>
        <div style="margin-bottom:2rem; font-family:  'MedievalSharp', serif;">
          <strong>NLF (Nana Ledger Forensics)</strong> • Build issuer trees • Path analysis • Token tracking • Quick inspect
        </div>
        <div style="font-size:12px;opacity:0.7;margin-bottom:1.5rem;font-family: 'Outfit', sans-serif;">${MODULE_VERSION}</div>

        <!-- Connection Badge -->
        <div id="uiConnBadge" style="display:inline-flex;align-items:center;gap:10px;margin-bottom:1.5rem;">
          <div id="uiConnDot" style="width:10px;height:10px;border-radius:50%;background:#666;"></div>
          <div id="uiConnText">Initializing…</div>
          <button id="uiRetryWs">Reconnect</button>
        </div>

        <!-- Tabs -->
        <div class="inspector-tabs">
          <button class="inspector-tab-btn is-active" data-tab="flow">🌊 Flow Analysis</button>
          <button class="inspector-tab-btn" data-tab="trace">🔍 Trace</button>
        </div>

        <!-- TAB: FLOW ANALYSIS -->
        <div class="inspector-tab-pane" data-tab="flow" style="display:block;">
          <!-- Issuer Management -->
          <div style="margin-bottom:2rem;">
            <h3>📋 Issuer List</h3>
            <textarea id="uiIssuerListText" placeholder="Paste XRP addresses (one per line)…" style="width:100%;min-height:100px;margin-bottom:10px;"></textarea>
            <button id="uiSaveList">💾 Save List</button>
            <button id="uiClearCache">🗑️ Clear Cache</button>
          </div>

          <!-- Quick Inspect -->
          <div style="margin-bottom:2rem;">
            <h3>⚡ Quick Inspect</h3>
            <div class="quick-inspect-row">
              <input id="uiQuickAddr" type="text" placeholder="Enter any XRP address…" />
              <button id="uiQuickInspectBtn">🔎 Inspect</button>
            </div>
          </div>

          <!-- Issuer Selector & Build -->
          <div style="margin-bottom:2rem;">
            <h3>🌳 Build Tree</h3>
            <label>Issuer:</label>
            <select id="uiIssuerSelect"></select>

            <div style="margin-top:1rem;display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;">
              <div>
                <label>Depth:</label>
                <input id="uiDepth" type="number" min="1" max="10" value="${DEFAULT_DEPTH}" />
              </div>
              <div>
                <label>Per Node:</label>
                <input id="uiPerNode" type="number" min="1" max="500" value="${DEFAULT_PER_NODE}" />
              </div>
              <div>
                <label>Max Accounts:</label>
                <input id="uiMaxAccounts" type="number" min="1" max="2000" value="${DEFAULT_MAX_ACCTS}" />
              </div>
              <div>
                <label>Max Edges:</label>
                <input id="uiMaxEdges" type="number" min="1" max="20000" value="${DEFAULT_MAX_EDGES}" />
              </div>
            </div>

            <details style="margin-top:1rem;">
              <summary style="cursor:pointer;font-weight:700;">🔧 Advanced Filters</summary>
              <div style="padding:1rem;margin-top:0.5rem;display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;">
                <div>
                  <label>Ledger Min:</label>
                  <input id="uiLedgerMin" type="number" placeholder="optional" />
                </div>
                <div>
                  <label>Ledger Max:</label>
                  <input id="uiLedgerMax" type="number" placeholder="optional" />
                </div>
                <div>
                  <label>Start Date:</label>
                  <input id="uiStartDate" type="date" />
                </div>
                <div>
                  <label>End Date:</label>
                  <input id="uiEndDate" type="date" />
                </div>
                <div>
                  <label>Min XRP:</label>
                  <input id="uiMinXrp" type="number" step="0.000001" placeholder="optional" />
                </div>
              </div>
            </details>

            <div style="margin-top:1rem;">
              <button id="uiBuild">🚀 Build Tree</button>
              <button id="uiFindPath">🗺️ Find Path</button>
              <button id="uiPatterns">🔄 Patterns</button>
              <button id="uiExportGraph">💾 Export</button>
            </div>

            <div id="uiProgress" style="display:block;margin-top:12px;background:#333;border-radius:4px;height:8px;overflow:hidden;">
              <div id="uiProgressBar" style="width:0%;height:100%;background:#50fa7b;transition:width 0.3s;"></div>
            </div>
            <div id="uiStatus" style="margin-top:12px;">Ready</div>
          </div>

          <!-- Summary -->
          <div id="uiSummary" style="margin-bottom:2rem;"></div>

          <!-- Tree View -->
          <div style="margin-bottom:2rem;">
            <h3>🌳 Tree</h3>
            <div id="uiTree"></div>
          </div>

          <!-- Edge Filter -->
          <div style="margin-bottom:2rem;">
            <h3>🔗 Edge Filter</h3>
            <div id="uiEdgeFilter"></div>
            <div id="uiEdgeList"></div>
          </div>
        </div>

        <!-- TAB: TRACE (rendered by inspector-trace-tab.js) -->
        <div class="inspector-tab-pane" data-tab="trace" style="display:none;">
          <div id="trace-mount-point"></div>
        </div>
      </div>

      <!-- Modal -->
      <div id="uiModalOverlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:10000;align-items:center;justify-content:center;">
        <div style="position:relative;width:auto;max-width:900px;background:#1a1a1a;padding:24px;border-radius:12px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;">
            <h2 id="uiModalTitle" style="margin:0;"></h2>
            <button id="uiModalClose">✖</button>
          </div>
          <div id="uiModalBody"></div>
        </div>
      </div>
    `;
  }

  function renderPage() {
    ensurePage();

    hydrateIssuerSelect();
    bindInspectorTabs();

    // Issuer List
    $("uiSaveList").onclick = () => {
      const text = $("uiIssuerListText").value;
      const list = normalizeIssuerListText(text);
      setIssuerList(list);
      hydrateIssuerSelect();
      setStatus(`✅ Saved ${list.length} issuer(s)`);
    };

    $("uiClearCache").onclick = () => {
      issuerRegistry.clear();
      activationCache.clear();
      accountInfoCache.clear();
      tokenSummaryCache.clear();
      activeIssuer = null;
      clearViews();
      setStatus("Cache cleared");
    };

    // Quick Inspect
    $("uiQuickInspectBtn").onclick = async () => {
      const addr = ($("uiQuickAddr").value || "").trim();
      if (!isValidXrpAddress(addr)) {
        alert("Invalid XRP address");
        return;
      }
      await quickInspectAddress(addr);
    };

    // Issuer Selector
    $("uiIssuerSelect").onchange = (e) => {
      const iss = e.target.value || "";
      onIssuerSelected(iss, { autoBuildIfMissing: false });
    };

    // Buttons
    $("uiBuild").onclick = buildTreeClicked;
    $("uiFindPath").onclick = findPathClicked;
    $("uiPatterns").onclick = patternsClicked;
    $("uiExportGraph").onclick = exportActiveGraph;

    // Modal
    $("uiModalClose").onclick = closeModal;
    $("uiModalOverlay").onclick = (e) => {
      if (e.target === e.currentTarget) closeModal();
    };

    // Connection Badge Retry
    $("uiRetryWs").onclick = () => attemptSharedReconnect("user retry");

    updateConnBadge();
    setInterval(updateConnBadge, 2500);
  }

  function clearViews() {
    $("uiSummary").innerHTML = "";
    $("uiTree").innerHTML = "";
    $("uiEdgeFilter").innerHTML = "";
    $("uiEdgeList").innerHTML = "";
  }

  function renderAll(g) {
    if (!g) {
      clearViews();
      return;
    }
    renderSummary(g);
    renderTree(g);
    renderEdgeFilter(g);
  }

  function renderSummary(g) {
    const nodes = g.nodes.size;
    const edges = g.edges.length;
    const scanned = g.stats.totalScanned;
    const pages = g.stats.totalPages;
    const processed = g.stats.processedAccounts;

    const html = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;">
        <div style="padding:12px;background:rgba(255,255,255,0.05);border-radius:10px;">
          <div style="opacity:0.7;font-size:11px;">NODES</div>
          <div style="font-size:24px;font-weight:900;">${nodes}</div>
        </div>
        <div style="padding:12px;background:rgba(255,255,255,0.05);border-radius:10px;">
          <div style="opacity:0.7;font-size:11px;">EDGES</div>
          <div style="font-size:24px;font-weight:900;">${edges}</div>
        </div>
        <div style="padding:12px;background:rgba(255,255,255,0.05);border-radius:10px;">
          <div style="opacity:0.7;font-size:11px;">SCANNED</div>
          <div style="font-size:24px;font-weight:900;">${scanned.toLocaleString()}</div>
        </div>
        <div style="padding:12px;background:rgba(255,255,255,0.05);border-radius:10px;">
          <div style="opacity:0.7;font-size:11px;">PAGES</div>
          <div style="font-size:24px;font-weight:900;">${pages}</div>
        </div>
        <div style="padding:12px;background:rgba(255,255,255,0.05);border-radius:10px;">
          <div style="opacity:0.7;font-size:11px;">PROCESSED</div>
          <div style="font-size:24px;font-weight:900;">${processed}</div>
        </div>
      </div>
    `;

    $("uiSummary").innerHTML = html;
  }

  function renderTree(g) {
    const tree = $("uiTree");
    if (!g || g.nodes.size === 0) {
      tree.innerHTML = `<div style="opacity:0.7;padding:20px;text-align:center;">No tree built yet</div>`;
      return;
    }

    function activationLine(entry) {
      const { activatedBy, activatedBySource } = entry;
      if (!activatedBy) return `<div style="opacity:0.5;font-size:11px;">no activation found (${activatedBySource})</div>`;
      return `<div style="font-size:11px;opacity:0.7;">activated_by: <code>${escapeHtml(
        activatedBy
      )}</code> • src: ${escapeHtml(activatedBySource)}</div>`;
    }

    function nodeRow(addr) {
      const n = g.nodes.get(addr);
      if (!n) return "";

      const short = addr.slice(0, 8) + "..." + addr.slice(-6);
      const bal =
        n.acctInfo?.balanceXrp != null ? n.acctInfo.balanceXrp.toFixed(6) + " XRP" : "—";
      const dom = n.acctInfo?.domain ? escapeHtml(n.acctInfo.domain).slice(0, 24) : "—";

      const btnExpand = `<button class="uiToggle" data-addr="${escapeHtml(addr)}">+</button>`;
      const btnInspect = `<button class="uiNode" data-addr="${escapeHtml(addr)}">🔍</button>`;
      const btnTrace = `<button class="uiTraceMini" data-addr="${escapeHtml(addr)}">🌊</button>`;

      return `
        <div style="margin-bottom:0.5rem;padding:10px;background:rgba(255,255,255,0.03);border-radius:10px;border-left:3px solid #50fa7b;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;">
            ${btnExpand}
            <strong style="font-family:'JetBrains Mono',monospace;font-size:13px;">${escapeHtml(short)}</strong>
            <span style="opacity:0.7;font-size:11px;">L${n.level}</span>
            ${btnInspect}
            ${btnTrace}
          </div>
          <div style="font-size:12px;margin-bottom:4px;">
            <strong>Balance:</strong> ${escapeHtml(bal)} • 
            <strong>Domain:</strong> ${escapeHtml(dom)}
          </div>
          <div style="font-size:12px;margin-bottom:4px;">
            <strong>Out:</strong> ${n.outCount} txs (scanned: ${n.outScanned}, pages: ${n.outPages}, complete: ${
        n.outComplete ? "✅" : "⚠️"
      })
          </div>
          ${activationLine(n)}
          <div class="uiChildrenContainer" data-addr="${escapeHtml(
            addr
          )}" style="display:none;margin-top:8px;"></div>
        </div>
      `;
    }

    function renderRec(addr, indentPx) {
      const children = Array.from(g.nodes.values()).filter((x) => x.activatedBy === addr);
      if (children.length === 0) return "";

      const inner = children
        .map((c) => nodeRow(c.addr) + renderRec(c.addr, indentPx + 24))
        .join("");
      return `<div style="margin-left:${indentPx}px;">${inner}</div>`;
    }

    const root = g.issuer;
    const html = nodeRow(root) + renderRec(root, 24);
    tree.innerHTML = html;

    // expand/collapse
    tree.querySelectorAll(".uiToggle").forEach((btn) => {
      btn.onclick = () => {
        const addr = btn.dataset.addr;
        const cont = tree.querySelector(`.uiChildrenContainer[data-addr="${addr}"]`);
        if (!cont) return;
        if (cont.style.display === "none") {
          cont.style.display = "block";
          btn.textContent = "−";
        } else {
          cont.style.display = "none";
          btn.textContent = "+";
        }
      };
    });

    // quick inspect
    tree.querySelectorAll(".uiNode").forEach((btn) => {
      btn.onclick = async () => {
        const addr = btn.dataset.addr;
        await quickInspectAddress(addr);
      };
    });

    // trace
    tree.querySelectorAll(".uiTraceMini").forEach((btn) => {
      btn.onclick = () => {
        const addr = btn.dataset.addr;
        switchToTraceAndSetSeed(addr);
      };
    });
  }

  function renderEdgeFilter(g) {
    const filter = $("uiEdgeFilter");
    if (!g || g.edges.length === 0) {
      filter.innerHTML = "";
      $("uiEdgeList").innerHTML = "";
      return;
    }

    const types = [...new Set(g.edges.map((e) => e.type))].sort();
    const currencies = [...new Set(g.edges.map((e) => e.currency))].sort();

    let html = `<div style="margin-bottom:1rem;">`;
    html += `<label style="margin-right:10px;">Type:</label><select id="uiTypeFilter" style="margin-right:20px;"><option value="">All</option>`;
    types.forEach((t) => {
      html += `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`;
    });
    html += `</select>`;

    html += `<label style="margin-right:10px;">Currency:</label><select id="uiCurrencyFilter"><option value="">All</option>`;
    currencies.forEach((c) => {
      html += `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`;
    });
    html += `</select>`;
    html += `</div>`;

    filter.innerHTML = html;

    const typeSelect = $("uiTypeFilter");
    const currencySelect = $("uiCurrencyFilter");

    const updateList = () => renderEdgeFilterActive();

    typeSelect.onchange = updateList;
    currencySelect.onchange = updateList;

    renderEdgeFilterActive();
  }

  function renderEdgeFilterActive() {
    const g = activeIssuer ? issuerRegistry.get(activeIssuer) : null;
    if (!g || g.edges.length === 0) {
      $("uiEdgeList").innerHTML = "";
      return;
    }

    const typeSelect = $("uiTypeFilter");
    const currencySelect = $("uiCurrencyFilter");
    const typeVal = typeSelect ? typeSelect.value : "";
    const currencyVal = currencySelect ? currencySelect.value : "";

    let filtered = g.edges;
    if (typeVal) filtered = filtered.filter((e) => e.type === typeVal);
    if (currencyVal) filtered = filtered.filter((e) => e.currency === currencyVal);

    if (filtered.length === 0) {
      $("uiEdgeList").innerHTML = `<div style="opacity:0.7;padding:20px;text-align:center;">No edges match filter</div>`;
      return;
    }

    const shown = filtered.slice(0, 200);
    let html = `<div style="font-size:12px;margin-bottom:10px;opacity:0.8;">Showing ${shown.length} of ${filtered.length} edges</div>`;

    shown.forEach((e) => {
      const amt = formatAmountPretty(e.currency, e.amount, e.issuer);

      html += `
        <div style="padding:10px;margin-bottom:6px;background:rgba(255,255,255,0.03);border-radius:8px;border-left:3px solid #50fa7b;">
          <div style="font-weight:700;margin-bottom:4px;">${escapeHtml(e.type)}</div>
          <div style="font-size:11px;font-family:'JetBrains Mono',monospace;margin-bottom:4px;">
            ${escapeHtml(e.from.slice(0, 8))}… → ${escapeHtml(e.to.slice(0, 8))}…
          </div>
          <div style="font-size:12px;margin-bottom:4px;"><strong>Amount:</strong> ${escapeHtml(amt)}</div>
          <div style="font-size:11px;opacity:0.7;">
            Ledger: ${e.ledger_index || "—"} • 
            ${e.date ? escapeHtml(e.date.slice(0, 10)) : "no date"}
            ${e.hash ? ` • ${explorerLinks(e.hash)}` : ""}
          </div>
        </div>
      `;
    });

    $("uiEdgeList").innerHTML = html;
  }

  // ---------------- QUICK INSPECT ----------------
  function getCurrentConstraintsFromUI() {
    const ledgerMin = parseNullableInt($("uiLedgerMin")?.value);
    const ledgerMax = parseNullableInt($("uiLedgerMax")?.value);
    const startDate = ($("uiStartDate")?.value || "").trim() || null;
    const endDate = ($("uiEndDate")?.value || "").trim() || null;
    const minXrp = $("uiMinXrp")?.value ? Number($("uiMinXrp").value) : null;

    return { ledgerMin, ledgerMax, startDate, endDate, minXrp };
  }

  function renderTokenSummaryBlock(summary) {
    if (!summary || summary.trustlineCount === 0) {
      return `<div style="opacity:0.7;padding:10px;">No trustlines found</div>`;
    }

    let html = `
      <h3 style="margin:1rem 0 0.5rem 0;">🪙 Token Summary</h3>
      <div style="margin-bottom:1rem;font-size:13px;">
        <strong>Trustlines:</strong> ${summary.trustlineCount}
      </div>
    `;

    if (summary.issuedEstimated && summary.issuedEstimated.length > 0) {
      html += `<h4 style="margin:1rem 0 0.5rem 0;">📊 Issued (estimated via negative balances)</h4>`;
      summary.issuedEstimated.slice(0, 10).forEach((row) => {
        html += `
          <div style="padding:8px;margin-bottom:6px;background:rgba(0,0,0,0.3);border-radius:8px;">
            <div style="font-weight:700;">${escapeHtml(row.currency)}</div>
            <div style="font-size:12px;">Holders: ${row.holders} • Outstanding: ${row.outstanding.toFixed(6)}</div>
          </div>
        `;
      });
    }

    if (summary.topTrustlines && summary.topTrustlines.length > 0) {
      html += `<h4 style="margin:1rem 0 0.5rem 0;">🔗 Top Trustlines</h4>`;
      summary.topTrustlines.slice(0, 10).forEach((t) => {
        html += `
          <div style="padding:8px;margin-bottom:6px;background:rgba(0,0,0,0.3);border-radius:8px;">
            <div style="font-weight:700;">${escapeHtml(t.currency)}</div>
            <div style="font-size:11px;font-family:'JetBrains Mono',monospace;">Peer: ${escapeHtml(
              t.peer ? t.peer.slice(0, 10) + "…" : "—"
            )}</div>
            <div style="font-size:12px;">Balance: ${t.balance.toFixed(6)}</div>
          </div>
        `;
      });
    }

    return html;
  }

  async function quickInspectAddress(address, { perNode = 120 } = {}) {
    const addr = String(address || "").trim();
    if (!isValidXrpAddress(addr)) {
      alert("Invalid XRP address");
      return;
    }

    openModal("⚡ Quick Inspect", `<div style="padding:20px;text-align:center;">Loading ${escapeHtml(addr)}…</div>`);

    try {
      const constraints = getCurrentConstraintsFromUI();

      const [acctInfo, tokenSummary, outgoingRes] = await Promise.all([
        fetchAccountInfo(addr),
        getTokenSummary(addr),
        collectOutgoingTxsMostRecent(addr, perNode, constraints)
      ]);

      const outgoing = outgoingRes.txs || [];

      let html = `<div style="max-height:70vh;overflow-y:auto;">`;

      html += `<h3 style="margin:0 0 1rem 0;">Account: ${escapeHtml(addr)}</h3>`;

      if (acctInfo) {
        html += `
          <div style="padding:12px;margin-bottom:1rem;background:rgba(255,255,255,0.05);border-radius:12px;">
            <div style="margin-bottom:8px;"><strong>Balance:</strong> ${
              acctInfo.balanceXrp != null ? acctInfo.balanceXrp.toFixed(6) + " XRP" : "—"
            }</div>
            <div style="margin-bottom:8px;"><strong>Domain:</strong> ${escapeHtml(acctInfo.domain || "—")}</div>
            <div style="margin-bottom:8px;"><strong>Sequence:</strong> ${acctInfo.sequence ?? "—"}</div>
            <div><strong>Owner Count:</strong> ${acctInfo.ownerCount ?? "—"}</div>
          </div>
        `;
      }

      html += renderTokenSummaryBlock(tokenSummary);

      html += `<h3 style="margin:1.5rem 0 0.5rem 0;">📤 Outgoing Transactions (${outgoing.length})</h3>`;
      html += `
        <div style="margin-bottom:1rem;font-size:13px;">
          Scanned: ${outgoingRes.scanned} • Pages: ${outgoingRes.pages} • Complete: ${outgoingRes.complete ? "✅" : "⚠️"}
        </div>
      `;

      html += `
        <div style="margin-bottom:1rem;">
          <button id="qiCopyAddr">📋 Copy Address</button>
          <button id="qiCopyHashes">📋 Copy Hashes</button>
          <button id="qiExportCsv">💾 Export CSV</button>
          <button id="qiExportJson">💾 Export JSON</button>
          <button id="qiTraceFrom">🌊 Trace From</button>
        </div>
      `;

      if (outgoing.length === 0) {
        html += `<div style="opacity:0.7;padding:20px;text-align:center;">No outgoing transactions found</div>`;
      } else {
        outgoing.slice(0, 50).forEach((t) => {
          const amt = parseAmount(t.Amount || null);
          const cp = extractCounterparty(t);

          html += `
            <div style="padding:10px;margin-bottom:8px;background:rgba(0,0,0,0.35);border-radius:10px;border-left:3px solid #50fa7b;">
              <div style="font-weight:700;margin-bottom:4px;">${escapeHtml(t.TransactionType || "unknown")}</div>
              <div style="font-size:11px;font-family:'JetBrains Mono',monospace;margin-bottom:4px;">
                ${t.hash ? escapeHtml(t.hash.slice(0, 12) + "…") : "no hash"}
              </div>
              <div style="font-size:12px;margin-bottom:4px;"><strong>Amount:</strong> ${escapeHtml(
                formatAmountPretty(amt.currency, amt.value, amt.issuer)
              )}</div>
              ${cp ? `<div style="font-size:11px;opacity:0.7;">To: ${escapeHtml(cp.slice(0, 10))}…</div>` : ""}
              <div style="font-size:11px;opacity:0.7;">
                Ledger: ${t.ledger_index || "—"} • 
                ${t._iso ? escapeHtml(t._iso.slice(0, 10)) : "no date"}
                ${t.hash ? ` • ${explorerLinks(t.hash)}` : ""}
              </div>
            </div>
          `;
        });

        if (outgoing.length > 50) {
          html += `<div style="opacity:0.7;padding:10px;text-align:center;">Showing first 50 of ${outgoing.length} transactions</div>`;
        }
      }

      html += `</div>`;

      openModal("⚡ Quick Inspect", html);

      $("qiCopyAddr").onclick = async () => {
        const ok = await copyToClipboard(addr);
        alert(ok ? "✅ Address copied" : "❌ Failed to copy");
      };

      $("qiCopyHashes").onclick = async () => {
        const hashes = outgoing.map((t) => t.hash).filter(Boolean);
        const ok = await copyToClipboard(hashes.join("\n"));
        alert(ok ? `✅ ${hashes.length} hashes copied` : "❌ Failed to copy");
      };

      const csv = [
        "hash,type,ledger_index,date,amount,currency,issuer,counterparty",
        ...outgoing.map((t) => {
          const amt = parseAmount(t.Amount || null);
          const cp = extractCounterparty(t) || "";
          return `"${t.hash || ""}","${t.TransactionType || ""}",${t.ledger_index || ""},"${t._iso || ""}",${amt.value},"${amt.currency}","${
            amt.issuer || ""
          }","${cp}"`;
        })
      ].join("\n");

      $("qiExportCsv").onclick = () =>
        downloadText(
          csv,
          `nanakilo-quickinspect-${addr}-outgoing-${outgoing.length}-txs.csv`,
          "text/csv"
        );

      $("qiExportJson").onclick = () => {
        const data = {
          address: addr,
          accountInfo: acctInfo,
          tokenSummary,
          outgoing: outgoing,
          exportedAt: new Date().toISOString(),
          source: "NanaKilo Quick Inspect"
        };
        downloadText(
          JSON.stringify(data, null, 2),
          `nanakilo-quickinspect-${addr}.json`,
          "application/json"
        );
      };

      $("qiTraceFrom").onclick = () => {
        closeModal();
        switchToTraceAndSetSeed(addr);
      };
    } catch (e) {
      openModal("⚠️ Error", `<div style="padding:20px;color:#ff5555;">${escapeHtml(e?.message || String(e))}</div>`);
    }
  }

  // ---------------- EXPORT GRAPH ----------------
  function exportActiveGraph() {
    const g = activeIssuer ? issuerRegistry.get(activeIssuer) : null;
    if (!g) {
      alert("No active graph to export");
      return;
    }

    const data = {
      issuer: g.issuer,
      params: g.params,
      stats: g.stats,
      builtAt: g.builtAt,
      nodes: Array.from(g.nodes.values()),
      edges: g.edges,
      exportedAt: new Date().toISOString(),
      source: "NanaKilo Account Inspector"
    };

    const json = JSON.stringify(data, null, 2);
    downloadText(json, `nanakilo-tree-${g.issuer}-${g.edges.length}edges.json`, "application/json");
    setStatus(`✅ Exported ${g.edges.length} edges`);
  }

  // ---------------- BUTTON HANDLERS ----------------
  async function buildTreeClicked() {
    if (!activeIssuer || !isValidXrpAddress(activeIssuer)) {
      alert("Select a valid issuer first");
      return;
    }

    if (buildingTree) {
      alert("Already building…");
      return;
    }

    buildingTree = true;
    setBuildBusy(true, "Building…");

    try {
      const depth = clampInt($("uiDepth").value, 1, 10);
      const perNode = clampInt($("uiPerNode").value, 1, 500);
      const maxAccounts = clampInt($("uiMaxAccounts").value, 1, 2000);
      const maxEdges = clampInt($("uiMaxEdges").value, 1, 20000);

      const ledgerMin = parseNullableInt($("uiLedgerMin")?.value);
      const ledgerMax = parseNullableInt($("uiLedgerMax")?.value);
      const startDate = ($("uiStartDate")?.value || "").trim() || null;
      const endDate = ($("uiEndDate")?.value || "").trim() || null;
      const minXrp = $("uiMinXrp")?.value ? Number($("uiMinXrp").value) : null;

      const g = makeGraph(activeIssuer, {
        depth,
        perNode,
        maxAccounts,
        maxEdges,
        ledgerMin,
        ledgerMax,
        startDate,
        endDate,
        minXrp
      });

      await buildIssuerTree(g);

      issuerRegistry.set(activeIssuer, g);
      renderAll(g);
      setStatus(`✅ Tree built: ${g.edges.length} edges, ${g.nodes.size} nodes`);
    } catch (e) {
      setStatus(`❌ Error: ${e?.message || String(e)}`);
      console.error(e);
    } finally {
      buildingTree = false;
      setBuildBusy(false, "Build");
      setProgress(0);
    }
  }

  function findPathClicked() {
    const g = activeIssuer ? issuerRegistry.get(activeIssuer) : null;
    if (!g) {
      alert("No graph built");
      return;
    }

    const src = prompt("Source address:");
    if (!src || !isValidXrpAddress(src)) return;

    const dst = prompt("Destination address:");
    if (!dst || !isValidXrpAddress(dst)) return;

    const path = findShortestPath(g, src, dst);
    if (!path) {
      alert("No path found");
      return;
    }

    let html = `<h3>Path: ${path.length} hops</h3>`;
    path.forEach((e, i) => {
      html += `
        <div style="padding:10px;margin-bottom:8px;background:rgba(0,0,0,0.35);border-radius:10px;">
          <div style="font-weight:700;">Hop ${i + 1}: ${escapeHtml(e.type)}</div>
          <div style="font-size:11px;font-family:'JetBrains Mono',monospace;">
            ${escapeHtml(e.from.slice(0, 10))}… → ${escapeHtml(e.to.slice(0, 10))}…
          </div>
          <div style="font-size:12px;">Amount: ${escapeHtml(formatAmountPretty(e.currency, e.amount, e.issuer))}</div>
          <div style="font-size:11px;opacity:0.7;">Ledger: ${e.ledger_index || "—"}</div>
        </div>
      `;
    });

    openModal("🗺️ Shortest Path", html);
  }

  function patternsClicked() {
    const g = activeIssuer ? issuerRegistry.get(activeIssuer) : null;
    if (!g) {
      alert("No graph built");
      return;
    }

    const cycles = runPatternScanFull(g);

    if (cycles.length === 0) {
      alert("No cycles found");
      return;
    }

    let html = `<h3>🔄 Cycles Found: ${cycles.length}</h3>`;
    cycles.slice(0, 30).forEach((cycle, i) => {
      html += `
        <div style="padding:10px;margin-bottom:8px;background:rgba(0,0,0,0.35);border-radius:10px;">
          <div style="font-weight:700;">Cycle ${i + 1}: ${cycle.length} hops</div>
          <div style="font-size:11px;font-family:'JetBrains Mono',monospace;">
            ${cycle.map((a) => escapeHtml(a.slice(0, 6))).join(" → ")}
          </div>
        </div>
      `;
    });

    if (cycles.length > 30) {
      html += `<div style="opacity:0.7;padding:10px;text-align:center;">Showing first 30 of ${cycles.length} cycles</div>`;
    }

    openModal("🔄 Pattern Scan", html);
  }

  // ---------------- INIT ----------------
  function initInspector() {
    if (window._naluInspectorInitialized) {
      console.log("⚠️ Inspector already initialized, skipping duplicate call");
      return;
    }

    window._naluInspectorInitialized = true;
    console.log("🔧 Inspector initializing...");

    setTimeout(() => {
      window._naluInspectorInitialized = false;
      console.log("🔓 Inspector lock released");
    }, 1000);

    renderPage();
    setStatus("Ready");

    console.log("✅ Inspector initialized");
  }

  // ---------------- PUBLIC API ----------------
  window.NanaKilo = {
    version: MODULE_VERSION,
    init: initInspector,
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

  window.initInspector = initInspector;

  window.UnifiedInspector = {
    quickInspect: (addr) => quickInspectAddress(addr, { perNode: 160 })
  };

  console.log(`✅ ${MODULE_VERSION} loaded`);
})();
