/* =========================================================
   FILE: js/inspector/inspector-trace-tab-enhanced.js
   Enhanced Trace Tab with NFT, AMM, LP, DEX Support
   
   NEW FEATURES:
   ✅ Multi-transaction type tracing (Payment, NFT, AMM, DEX)
   ✅ NFT floor manipulation detection
   ✅ AMM rug pull detection
   ✅ LP sandwich attack detection
   ✅ Wash trading across all asset types
   ✅ Fake volume detection
   ========================================================= */

(function () {
  "use strict";

  const VERSION = "inspector-trace-tab@4.0.0-multi-asset";
  const DEFAULTS = {
    maxHops: 4,
    perAccountTxLimit: 60,
    maxEdges: 400,
    ledgerMin: -1,
    ledgerMax: -1,
    traceTypes: {
      payment: true,
      nft: true,
      amm: true,
      dex: true,
      escrow: false,
      check: false
    }
  };

  // Transaction type categories
  const TX_TYPES = {
    PAYMENT: ['Payment'],
    NFT: ['NFTokenMint', 'NFTokenBurn', 'NFTokenCreateOffer', 'NFTokenAcceptOffer', 'NFTokenCancelOffer'],
    AMM: ['AMMCreate', 'AMMDeposit', 'AMMWithdraw', 'AMMVote', 'AMMBid', 'AMMDelete'],
    DEX: ['OfferCreate', 'OfferCancel'],
    ESCROW: ['EscrowCreate', 'EscrowFinish', 'EscrowCancel'],
    CHECK: ['CheckCreate', 'CheckCash', 'CheckCancel'],
    TRUST: ['TrustSet']
  };

  let traceRunning = false;
  let traceCancelled = false;
  let lastResult = null;
  let currentMount = null;

  // ---------------- UTILS ----------------
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

  function $(id) {
    return currentMount ? currentMount.querySelector(`#${CSS.escape(id)}`) : document.getElementById(id);
  }

  function trimFloat(n) {
    const s = String(n);
    if (s.includes("e") || s.includes("E")) return n.toFixed(6);
    const fixed = n.toFixed(6);
    return fixed.replace(/\.?0+$/, "");
  }

  // ---------------- XRPL REQUEST WRAPPER ----------------
  function getXRPLRequester() {
    if (window.UnifiedInspector && typeof window.UnifiedInspector.request === "function") {
      return async (payload) => {
        const r = await window.UnifiedInspector.request(payload, { timeoutMs: 20000 });
        return r?.result || r;
      };
    }

    if (typeof window.requestXrpl === "function") {
      return async (payload) => {
        const r = await window.requestXrpl(payload, { timeoutMs: 20000 });
        return r?.result || r;
      };
    }

    if (window.xrplConnection && typeof window.xrplConnection.request === "function") {
      return (payload) => window.xrplConnection.request(payload);
    }
    
    if (window.xrplClient && typeof window.xrplClient.request === "function") {
      return (payload) => window.xrplClient.request(payload);
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

  // ---------------- INSPECTOR SEED DETECTION ----------------
  function getBestSeedFromInspectorUI() {
    const quick = document.getElementById("uiQuickAddr");
    const target = document.getElementById("uiTarget");
    const issuerSel = document.getElementById("uiIssuerSelect");

    const candidates = [
      quick?.value,
      target?.value,
      issuerSel?.value
    ].map(v => String(v || "").trim()).filter(Boolean);

    for (const v of candidates) {
      if (isXRPLAccount(v)) return v;
    }
    return "";
  }

  // ---------------- MAIN RENDER ----------------
  function renderInto(mountEl) {
    currentMount = mountEl;
    lastResult = null;

    mountEl.innerHTML = `
      <div class="nalu-trace-wrap inspector-panel">
        <div class="nalu-trace-head">
          <div class="nalu-trace-title">🔬 Enhanced Multi-Asset Trace <span style="opacity:.65;font-weight:800;font-size:.85rem;">(Payment • NFT • AMM • DEX)</span></div>
          <button class="nalu-btn ghost" type="button" id="traceHelpBtnInInspector" aria-expanded="false">
            <span>How it works</span> <span class="about-acc-chevron">▾</span>
          </button>
        </div>

        <div class="nalu-trace-sub">
          Track <strong>all asset flows</strong> including XRP payments, NFT trades, AMM operations, and DEX activity. Detect manipulation across all transaction types.
        </div>

        <div class="nalu-trace-help" id="traceHelpBodyInInspector" hidden>
          <ul>
            <li><strong>Multi-Asset:</strong> Traces Payments, NFTs, AMM, DEX simultaneously</li>
            <li><strong>NFT Detection:</strong> Wash sales, floor manipulation, fake volume</li>
            <li><strong>AMM Detection:</strong> Rug pulls, liquidity drains, sandwich attacks</li>
            <li><strong>BFS Algorithm:</strong> Hop-by-hop exploration of all connections</li>
            <li><strong>Tip:</strong> Enable only relevant transaction types for faster scans</li>
          </ul>
        </div>

        <div class="nalu-trace-form">
          <div class="nalu-field nalu-col-12">
            <label class="nalu-label">Target Account</label>
            <input id="traceVictimInInspector" class="nalu-input" type="text" placeholder="r..." />
          </div>

          <!-- Transaction Type Filters -->
          <div class="nalu-field nalu-col-12" style="border: 1px solid rgba(255,255,255,0.1); padding: 12px; border-radius: 10px; margin-bottom: 12px;">
            <label class="nalu-label" style="margin-bottom: 8px;">Transaction Types to Trace</label>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px;">
              <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                <input type="checkbox" id="traceTypePayment" checked style="width: 18px; height: 18px;">
                <span>💸 Payments</span>
              </label>
              <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                <input type="checkbox" id="traceTypeNFT" checked style="width: 18px; height: 18px;">
                <span>🎨 NFTs</span>
              </label>
              <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                <input type="checkbox" id="traceTypeAMM" checked style="width: 18px; height: 18px;">
                <span>💧 AMM/LP</span>
              </label>
              <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                <input type="checkbox" id="traceTypeDEX" checked style="width: 18px; height: 18px;">
                <span>📊 DEX Offers</span>
              </label>
              <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                <input type="checkbox" id="traceTypeEscrow" style="width: 18px; height: 18px;">
                <span>🔒 Escrows</span>
              </label>
              <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                <input type="checkbox" id="traceTypeCheck" style="width: 18px; height: 18px;">
                <span>✓ Checks</span>
              </label>
            </div>
          </div>

          <div class="nalu-field nalu-col-3">
            <label class="nalu-label">Max hops</label>
            <input id="traceHopsInInspector" class="nalu-input" type="number" min="1" max="10" value="${DEFAULTS.maxHops}" />
          </div>

          <div class="nalu-field nalu-col-3">
            <label class="nalu-label">Ledger min</label>
            <input id="traceLedgerMinInInspector" class="nalu-input" type="number" value="${DEFAULTS.ledgerMin}" />
          </div>

          <div class="nalu-field nalu-col-3">
            <label class="nalu-label">Ledger max</label>
            <input id="traceLedgerMaxInInspector" class="nalu-input" type="number" value="${DEFAULTS.ledgerMax}" />
          </div>

          <div class="nalu-field nalu-col-3">
            <label class="nalu-label">Per-account tx</label>
            <input id="tracePerAcctInInspector" class="nalu-input" type="number" min="10" max="400" value="${DEFAULTS.perAccountTxLimit}" />
          </div>

          <div class="nalu-field nalu-col-3">
            <label class="nalu-label">Max edges</label>
            <input id="traceMaxEdgesInInspector" class="nalu-input" type="number" min="50" max="5000" value="${DEFAULTS.maxEdges}" />
          </div>
        </div>

        <div class="nalu-trace-actions">
          <button id="traceUseCurrentAccount" class="nalu-btn" type="button">Use inspector seed</button>
          <button id="traceRunInInspector" class="nalu-btn primary" type="button">Start Enhanced Trace</button>
          <button id="traceCancelInInspector" class="nalu-btn danger" type="button">Cancel</button>
          <button id="traceExportJsonInInspector" class="nalu-btn" type="button" disabled>Export JSON</button>
          <button id="traceExportCsvInInspector" class="nalu-btn" type="button" disabled>Export CSV</button>
        </div>

        <div id="traceStatusInInspector" class="nalu-trace-status"></div>
        <div id="traceResultsInInspector" class="nalu-trace-results"></div>
      </div>
    `;

    bindUI();
    
    const seed = getBestSeedFromInspectorUI();
    if (seed && $("traceVictimInInspector")) {
      $("traceVictimInInspector").value = seed;
    }
  }

  function bindUI() {
    const runBtn = $("traceRunInInspector");
    if (runBtn && runBtn.__bound) return;
    if (runBtn) runBtn.__bound = true;

    $("traceHelpBtnInInspector")?.addEventListener("click", () => {
      const body = $("traceHelpBodyInInspector");
      const btn = $("traceHelpBtnInInspector");
      if (!body || !btn) return;

      const open = !body.hidden;
      body.hidden = open;
      btn.setAttribute("aria-expanded", open ? "false" : "true");

      const chev = btn.querySelector(".about-acc-chevron");
      if (chev) chev.textContent = open ? "▾" : "▴";
    });

    $("traceUseCurrentAccount")?.addEventListener("click", () => {
      const seed = getBestSeedFromInspectorUI();
      if (seed && $("traceVictimInInspector")) {
        $("traceVictimInInspector").value = seed;
      } else {
        setTraceStatus("⚠️ No seed detected yet. Paste an account (r...) above.", false);
      }
    });

    $("traceRunInInspector")?.addEventListener("click", runTrace);
    $("traceCancelInInspector")?.addEventListener("click", cancelTrace);
  }

  function setTraceStatus(msg, isError) {
    const out = $("traceStatusInInspector");
    if (!out) return;
    out.style.color = isError ? "#ff6e6e" : "var(--text-secondary, rgba(255,255,255,0.78))";
    out.innerHTML = msg;
  }

  function disableTraceControls(disabled) {
    ["traceRunInInspector", "traceUseCurrentAccount"].forEach((id) => {
      const b = $(id);
      if (b) b.disabled = !!disabled;
    });

    const cancelBtn = $("traceCancelInInspector");
    if (cancelBtn) cancelBtn.disabled = false;

    const ej = $("traceExportJsonInInspector");
    const ec = $("traceExportCsvInInspector");
    if (ej) ej.disabled = true;
    if (ec) ec.disabled = true;
  }

  function clearResults() {
    const r = $("traceResultsInInspector");
    if (r) r.innerHTML = "";
  }

  // ---------------- TRACE ENGINE (MULTI-ASSET BFS) ----------------
  async function runTrace() {
    if (traceRunning) return;

    const victim = ($("traceVictimInInspector")?.value || "").trim();
    if (!isXRPLAccount(victim)) {
      setTraceStatus("❌ Please enter a valid XRPL account (r...).", true);
      return;
    }

    const maxHops = clampInt($("traceHopsInInspector")?.value, 1, 10, DEFAULTS.maxHops);
    const ledgerMin = parseInt($("traceLedgerMinInInspector")?.value ?? DEFAULTS.ledgerMin, 10);
    const ledgerMax = parseInt($("traceLedgerMaxInInspector")?.value ?? DEFAULTS.ledgerMax, 10);
    const perAcct = clampInt($("tracePerAcctInInspector")?.value, 10, 400, DEFAULTS.perAccountTxLimit);
    const maxEdges = clampInt($("traceMaxEdgesInInspector")?.value, 50, 5000, DEFAULTS.maxEdges);

    // Get enabled transaction types
    const traceTypes = {
      payment: $("traceTypePayment")?.checked ?? true,
      nft: $("traceTypeNFT")?.checked ?? true,
      amm: $("traceTypeAMM")?.checked ?? true,
      dex: $("traceTypeDEX")?.checked ?? true,
      escrow: $("traceTypeEscrow")?.checked ?? false,
      check: $("traceTypeCheck")?.checked ?? false
    };

    traceRunning = true;
    traceCancelled = false;
    lastResult = null;

    setTraceStatus("⏳ Starting enhanced multi-asset trace…", false);
    disableTraceControls(true);
    clearResults();

    try {
      const result = await traceMultiAssetBFS({
        victim,
        maxHops,
        ledgerMin: Number.isFinite(ledgerMin) ? ledgerMin : -1,
        ledgerMax: Number.isFinite(ledgerMax) ? ledgerMax : -1,
        perAccountTxLimit: perAcct,
        maxEdges,
        traceTypes
      });

      if (traceCancelled) {
        setTraceStatus("🟡 Trace cancelled.", false);
        return;
      }

      lastResult = result;
      
      // Store globally for pattern detection
      window._currentTraceData = {
        origin: result.victim,
        edges: result.edges,
        nodes: result.nodes,
        nftData: result.nftData,
        ammData: result.ammData,
        params: {
          maxHops: result.maxHops,
          ledgerMin: result.ledgerMin,
          ledgerMax: result.ledgerMax,
          traceTypes: result.traceTypes
        }
      };

      renderTraceResults(result);
      wireExportButtons(result);
      
      // Initialize integrations after results are rendered
      initializeIntegrations();

      const typeCounts = result.typeBreakdown;
      setTraceStatus(
        `✅ Trace complete: ${result.edges.length} edges (💸${typeCounts.payment} 🎨${typeCounts.nft} 💧${typeCounts.amm} 📊${typeCounts.dex}) • ${result.nodes.size} accounts • depth ${result.maxDepthReached}`,
        false
      );
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

  async function traceMultiAssetBFS(opts) {
    const { victim, maxHops, ledgerMin, ledgerMax, perAccountTxLimit, maxEdges, traceTypes } = opts;

    const visited = new Set();
    const nodes = new Set();
    const edges = [];
    const nftData = []; // NFT-specific data
    const ammData = []; // AMM-specific data
    const queue = [{ account: victim, depth: 0 }];

    visited.add(victim);
    nodes.add(victim);

    let maxDepthReached = 0;
    const typeBreakdown = { payment: 0, nft: 0, amm: 0, dex: 0, escrow: 0, check: 0, other: 0 };

    while (queue.length) {
      if (traceCancelled) break;
      if (edges.length >= maxEdges) break;

      const { account, depth } = queue.shift();
      maxDepthReached = Math.max(maxDepthReached, depth);

      setTraceStatus(
        `🔍 Depth ${depth}/${maxHops} • edges ${edges.length}/${maxEdges} • ${escapeHtml(shortAddr(account))} • [💸${typeBreakdown.payment} 🎨${typeBreakdown.nft} 💧${typeBreakdown.amm} 📊${typeBreakdown.dex}]`,
        false
      );

      if (depth >= maxHops) continue;

      const { edges: outgoing, nfts, amms } = await fetchMultiAssetEdges(account, {
        ledgerMin,
        ledgerMax,
        perAccountTxLimit,
        traceTypes
      });

      for (const e of outgoing) {
        if (traceCancelled) break;

        edges.push(e);
        
        // Track type breakdown
        const category = categorizeEdgeType(e);
        typeBreakdown[category] = (typeBreakdown[category] || 0) + 1;
        
        nodes.add(e.from);
        if (e.to) nodes.add(e.to);

        if (e.to && !visited.has(e.to)) {
          visited.add(e.to);
          queue.push({ account: e.to, depth: depth + 1 });
        }

        if (edges.length >= maxEdges) break;
      }

      // Store NFT/AMM specific data
      nftData.push(...nfts);
      ammData.push(...amms);

      await sleep(80);
    }

    return {
      victim,
      maxHops,
      ledgerMin,
      ledgerMax,
      perAccountTxLimit,
      maxEdges,
      traceTypes,
      maxDepthReached,
      nodes,
      edges,
      nftData,
      ammData,
      typeBreakdown,
      createdAt: new Date().toISOString()
    };
  }

  async function fetchMultiAssetEdges(account, params) {
    const { ledgerMin, ledgerMax, perAccountTxLimit, traceTypes } = params;

    const edges = [];
    const nfts = [];
    const amms = [];
    let marker = undefined;
    let fetched = 0;

    // Build enabled types list
    const enabledTypes = [];
    if (traceTypes.payment) enabledTypes.push(...TX_TYPES.PAYMENT);
    if (traceTypes.nft) enabledTypes.push(...TX_TYPES.NFT);
    if (traceTypes.amm) enabledTypes.push(...TX_TYPES.AMM);
    if (traceTypes.dex) enabledTypes.push(...TX_TYPES.DEX);
    if (traceTypes.escrow) enabledTypes.push(...TX_TYPES.ESCROW);
    if (traceTypes.check) enabledTypes.push(...TX_TYPES.CHECK);

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

      const rr = res?.result ? res.result : res;
      const txs = rr?.transactions || [];
      fetched += txs.length;

      for (const item of txs) {
        const tx = item?.tx || item;
        const meta = item?.meta || item?.metaData;
        const txType = tx?.TransactionType;

        if (!tx || !enabledTypes.includes(txType)) continue;
        if (tx.Account !== account) continue;

        // Parse based on type
        const edge = parseTransactionToEdge(tx, meta, item);
        if (edge) {
          edges.push(edge);

          // Store type-specific data
          if (TX_TYPES.NFT.includes(txType)) {
            nfts.push(extractNFTData(tx, meta, item));
          } else if (TX_TYPES.AMM.includes(txType)) {
            amms.push(extractAMMData(tx, meta, item));
          }
        }

        if (edges.length >= perAccountTxLimit) break;
      }

      marker = rr?.marker;
      if (!marker) break;
    }

    return { edges, nfts, amms };
  }

  function parseTransactionToEdge(tx, meta, item) {
    const txType = tx.TransactionType;
    const from = tx.Account;
    const hash = item?.hash || tx?.hash || null;
    const ledger = item?.ledger_index ?? tx?.ledger_index ?? null;
    const validated = !!item?.validated;

    let to = null;
    let amount = null;
    let currency = null;
    let issuer = null;
    let nftID = null;
    let ammID = null;
    let metadata = {};

    // Payment
    if (txType === 'Payment') {
      to = tx.Destination;
      const delivered = meta?.delivered_amount ?? meta?.DeliveredAmount ?? tx.Amount;
      const parsed = parseAmount(delivered);
      amount = parsed.display;
      currency = parsed.currency;
      issuer = parsed.issuer;
    }

    // NFT Transactions
    else if (TX_TYPES.NFT.includes(txType)) {
      nftID = tx.NFTokenID || tx.NFToken || null;
      
      if (txType === 'NFTokenAcceptOffer') {
        // Buyer/Seller from metadata
        const nodes = meta?.AffectedNodes || [];
        for (const node of nodes) {
          const modNode = node.ModifiedNode || node.CreatedNode || node.DeletedNode;
          if (modNode?.LedgerEntryType === 'NFTokenOffer') {
            to = modNode.FinalFields?.Destination || modNode.FinalFields?.Owner;
            amount = modNode.FinalFields?.Amount;
            break;
          }
        }
      } else if (txType === 'NFTokenCreateOffer') {
        to = tx.Destination || tx.Owner;
        amount = tx.Amount;
      } else if (txType === 'NFTokenMint') {
        to = from; // Minter
      } else if (txType === 'NFTokenBurn') {
        to = null;
      }

      if (amount) {
        const parsed = parseAmount(amount);
        amount = parsed.display;
        currency = parsed.currency;
        issuer = parsed.issuer;
      }

      metadata = {
        nftID,
        uri: tx.URI ? hexToString(tx.URI) : null,
        transferFee: tx.TransferFee,
        flags: tx.Flags
      };
    }

    // AMM Transactions
    else if (TX_TYPES.AMM.includes(txType)) {
      ammID = tx.Asset || tx.Asset2 || null;
      to = tx.Account; // Usually self-referencing
      
      if (txType === 'AMMDeposit' || txType === 'AMMWithdraw') {
        amount = tx.Amount || tx.Amount2;
        if (amount) {
          const parsed = parseAmount(amount);
          amount = parsed.display;
          currency = parsed.currency;
          issuer = parsed.issuer;
        }
      }

      metadata = {
        ammID,
        asset: tx.Asset,
        asset2: tx.Asset2,
        lpTokens: tx.LPTokenOut || tx.LPTokenIn,
        tradingFee: tx.TradingFee
      };
    }

    // DEX Offers
    else if (TX_TYPES.DEX.includes(txType)) {
      if (txType === 'OfferCreate') {
        const takerGets = tx.TakerGets;
        const takerPays = tx.TakerPays;
        
        // Extract counterparty from issuer
        if (typeof takerGets === 'object' && takerGets.issuer) {
          to = takerGets.issuer;
        } else if (typeof takerPays === 'object' && takerPays.issuer) {
          to = takerPays.issuer;
        }

        amount = takerPays;
        if (amount) {
          const parsed = parseAmount(amount);
          amount = parsed.display;
          currency = parsed.currency;
          issuer = parsed.issuer;
        }

        metadata = {
          takerGets: takerGets,
          takerPays: takerPays,
          offerSequence: tx.OfferSequence
        };
      }
    }

    // Escrow
    else if (TX_TYPES.ESCROW.includes(txType)) {
      to = tx.Destination;
      amount = tx.Amount;
      if (amount) {
        const parsed = parseAmount(amount);
        amount = parsed.display;
        currency = parsed.currency;
        issuer = parsed.issuer;
      }
      metadata = {
        finishAfter: tx.FinishAfter,
        cancelAfter: tx.CancelAfter,
        condition: tx.Condition
      };
    }

    // Check
    else if (TX_TYPES.CHECK.includes(txType)) {
      to = tx.Destination;
      amount = tx.SendMax || tx.Amount;
      if (amount) {
        const parsed = parseAmount(amount);
        amount = parsed.display;
        currency = parsed.currency;
        issuer = parsed.issuer;
      }
      metadata = {
        checkID: tx.CheckID,
        invoiceID: tx.InvoiceID
      };
    }

    if (!to) to = from; // Self-referencing transactions

    return {
      from,
      to,
      type: txType,
      amount,
      currency,
      issuer,
      nftID,
      ammID,
      tx_hash: hash,
      ledger_index: ledger,
      validated,
      metadata
    };
  }

  function extractNFTData(tx, meta, item) {
    return {
      nftID: tx.NFTokenID || tx.NFToken,
      type: tx.TransactionType,
      account: tx.Account,
      destination: tx.Destination || tx.Owner,
      amount: tx.Amount,
      uri: tx.URI ? hexToString(tx.URI) : null,
      transferFee: tx.TransferFee,
      flags: tx.Flags,
      offerID: tx.NFTokenSellOffer || tx.NFTokenBuyOffer,
      tx_hash: item?.hash || tx?.hash,
      ledger_index: item?.ledger_index ?? tx?.ledger_index,
      date: item?.date ?? tx?.date
    };
  }

  function extractAMMData(tx, meta, item) {
    return {
      ammID: tx.Asset || tx.Asset2,
      type: tx.TransactionType,
      account: tx.Account,
      asset: tx.Asset,
      asset2: tx.Asset2,
      amount: tx.Amount,
      amount2: tx.Amount2,
      lpTokens: tx.LPTokenOut || tx.LPTokenIn,
      tradingFee: tx.TradingFee,
      tx_hash: item?.hash || tx?.hash,
      ledger_index: item?.ledger_index ?? tx?.ledger_index,
      date: item?.date ?? tx?.date
    };
  }

  function hexToString(hex) {
    try {
      const clean = hex.replace(/^0x/i, '');
      let str = '';
      for (let i = 0; i < clean.length; i += 2) {
        const code = parseInt(clean.slice(i, i + 2), 16);
        if (code) str += String.fromCharCode(code);
      }
      return str || null;
    } catch {
      return null;
    }
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

  function categorizeEdgeType(edge) {
    const type = edge.type;
    if (TX_TYPES.PAYMENT.includes(type)) return 'payment';
    if (TX_TYPES.NFT.includes(type)) return 'nft';
    if (TX_TYPES.AMM.includes(type)) return 'amm';
    if (TX_TYPES.DEX.includes(type)) return 'dex';
    if (TX_TYPES.ESCROW.includes(type)) return 'escrow';
    if (TX_TYPES.CHECK.includes(type)) return 'check';
    return 'other';
  }

  // ---------------- RESULTS RENDERING ----------------
  function renderTraceResults(result) {
    const r = $("traceResultsInInspector");
    if (!r) return;

    const summary = summarizeEdges(result.edges, result.victim);
    const typeCounts = result.typeBreakdown;

    r.innerHTML = `
      <div class="inspector-panel">
        <div class="nalu-trace-head">
          <div class="nalu-trace-title">📌 Multi-Asset Summary</div>
          <div class="nalu-trace-sub">All transaction types</div>
        </div>

        <div class="nalu-kv">
          <div><strong>Target:</strong> <span class="addr">${escapeHtml(result.victim)}</span></div>
          <div><strong>Total Edges:</strong> ${result.edges.length}</div>
          <div><strong>Accounts:</strong> ${result.nodes.size}</div>
          <div><strong>Depth:</strong> ${result.maxDepthReached}</div>
        </div>

        <div style="margin-top: 16px; display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px;">
          <div style="padding: 12px; background: rgba(80, 250, 123, 0.15); border-radius: 10px; border: 1px solid rgba(80, 250, 123, 0.3);">
            <div style="font-size: 24px; font-weight: 900; color: #50fa7b;">${typeCounts.payment}</div>
            <div style="font-size: 12px; opacity: 0.9;">💸 Payments</div>
          </div>
          <div style="padding: 12px; background: rgba(189, 147, 249, 0.15); border-radius: 10px; border: 1px solid rgba(189, 147, 249, 0.3);">
            <div style="font-size: 24px; font-weight: 900; color: #bd93f9;">${typeCounts.nft}</div>
            <div style="font-size: 12px; opacity: 0.9;">🎨 NFTs</div>
          </div>
          <div style="padding: 12px; background: rgba(0, 212, 255, 0.15); border-radius: 10px; border: 1px solid rgba(0, 212, 255, 0.3);">
            <div style="font-size: 24px; font-weight: 900; color: #00d4ff;">${typeCounts.amm}</div>
            <div style="font-size: 12px; opacity: 0.9;">💧 AMM/LP</div>
          </div>
          <div style="padding: 12px; background: rgba(255, 184, 108, 0.15); border-radius: 10px; border: 1px solid rgba(255, 184, 108, 0.3);">
            <div style="font-size: 24px; font-weight: 900; color: #ffb86c;">${typeCounts.dex}</div>
            <div style="font-size: 12px; opacity: 0.9;">📊 DEX</div>
          </div>
        </div>

        ${summary.topDests.length > 0 ? `
          <div class="nalu-trace-sub" style="margin-top: 16px;">Top destinations (by count)</div>
          <div class="nalu-mini-list">
            ${summary.topDests.slice(0, 10).map(d => `
              <div class="nalu-mini-item">
                <span class="addr">${escapeHtml(d.to)} <span style="opacity:.75;">(${escapeHtml(shortAddr(d.to))})</span></span>
                <span style="font-weight:950;">${d.count}</span>
              </div>
            `).join("")}
          </div>
        ` : ''}

        ${summary.nftStats.uniqueNFTs > 0 ? `
          <div style="margin-top: 16px; padding: 14px; background: rgba(189, 147, 249, 0.1); border-radius: 10px; border: 1px solid rgba(189, 147, 249, 0.2);">
            <div style="font-weight: 900; margin-bottom: 8px;">🎨 NFT Activity</div>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; font-size: 13px;">
              <div><strong>Unique NFTs:</strong> ${summary.nftStats.uniqueNFTs}</div>
              <div><strong>Mints:</strong> ${summary.nftStats.mints}</div>
              <div><strong>Trades:</strong> ${summary.nftStats.trades}</div>
              <div><strong>Burns:</strong> ${summary.nftStats.burns}</div>
            </div>
          </div>
        ` : ''}

        ${summary.ammStats.uniquePools > 0 ? `
          <div style="margin-top: 16px; padding: 14px; background: rgba(0, 212, 255, 0.1); border-radius: 10px; border: 1px solid rgba(0, 212, 255, 0.2);">
            <div style="font-weight: 900; margin-bottom: 8px;">💧 AMM/LP Activity</div>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; font-size: 13px;">
              <div><strong>Unique Pools:</strong> ${summary.ammStats.uniquePools}</div>
              <div><strong>Deposits:</strong> ${summary.ammStats.deposits}</div>
              <div><strong>Withdrawals:</strong> ${summary.ammStats.withdrawals}</div>
              <div><strong>Creates:</strong> ${summary.ammStats.creates}</div>
            </div>
          </div>
        ` : ''}
      </div>

      <div class="inspector-panel">
        <div class="nalu-trace-head">
          <div class="nalu-trace-title">🧾 All Transaction Edges</div>
          <div class="nalu-trace-sub">${result.edges.length} rows</div>
        </div>

        <div class="nalu-table-wrap">
          ${renderEdgesTable(result.edges)}
        </div>

        ${result.edges.length > 1200 ? `<div class="nalu-trace-sub">Showing first 1200 edges. Export for full data.</div>` : ""}
      </div>
    `;
  }

  function summarizeEdges(edges, victim) {
    const destCount = new Map();
    const nftStats = {
      uniqueNFTs: new Set(),
      mints: 0,
      trades: 0,
      burns: 0
    };
    const ammStats = {
      uniquePools: new Set(),
      deposits: 0,
      withdrawals: 0,
      creates: 0
    };

    for (const e of edges) {
      if (e.to) {
        destCount.set(e.to, (destCount.get(e.to) || 0) + 1);
      }

      // NFT stats
      if (e.nftID) {
        nftStats.uniqueNFTs.add(e.nftID);
        if (e.type === 'NFTokenMint') nftStats.mints++;
        if (e.type === 'NFTokenAcceptOffer') nftStats.trades++;
        if (e.type === 'NFTokenBurn') nftStats.burns++;
      }

      // AMM stats
      if (e.ammID) {
        ammStats.uniquePools.add(e.ammID);
        if (e.type === 'AMMDeposit') ammStats.deposits++;
        if (e.type === 'AMMWithdraw') ammStats.withdrawals++;
        if (e.type === 'AMMCreate') ammStats.creates++;
      }
    }

    nftStats.uniqueNFTs = nftStats.uniqueNFTs.size;
    ammStats.uniquePools = ammStats.uniquePools.size;

    const topDests = Array.from(destCount.entries())
      .map(([to, count]) => ({ to, count }))
      .sort((a, b) => b.count - a.count);

    return { topDests, nftStats, ammStats };
  }

  function renderEdgesTable(edges) {
    const rows = edges.slice(0, 1200).map((e) => {
      const typeIcon = getTypeIcon(e.type);
      return `
        <tr>
          <td>${typeIcon} ${escapeHtml(e.type)}</td>
          <td>${escapeHtml(shortAddr(e.from))}</td>
          <td>${escapeHtml(shortAddr(e.to || 'N/A'))}</td>
          <td>${escapeHtml(e.amount || 'N/A')}</td>
          <td>${escapeHtml(String(e.ledger_index ?? ""))}</td>
          <td style="color: var(--text-secondary, rgba(255,255,255,0.78));">${escapeHtml((e.tx_hash || "").slice(0, 12) + (e.tx_hash ? "…" : ""))}</td>
        </tr>
      `;
    }).join("");

    return `
      <table class="nalu-trace-table">
        <thead>
          <tr>
            <th>Type</th>
            <th>From</th>
            <th>To</th>
            <th>Amount</th>
            <th>Ledger</th>
            <th>Tx</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  function getTypeIcon(type) {
    if (TX_TYPES.PAYMENT.includes(type)) return '💸';
    if (TX_TYPES.NFT.includes(type)) return '🎨';
    if (TX_TYPES.AMM.includes(type)) return '💧';
    if (TX_TYPES.DEX.includes(type)) return '📊';
    if (TX_TYPES.ESCROW.includes(type)) return '🔒';
    if (TX_TYPES.CHECK.includes(type)) return '✓';
    return '📄';
  }

  // ---------------- INTEGRATIONS ----------------
  function initializeIntegrations() {
    setTimeout(() => {
      addPatternDetectionSection();
      console.log('✅ Enhanced trace tab integrations initialized');
    }, 100);
  }

  function addPatternDetectionSection() {
    const resultsContainer = $("traceResultsInInspector");
    if (!resultsContainer || document.getElementById('trace-pattern-section')) return;
    
    const patternSection = document.createElement('div');
    patternSection.id = 'trace-pattern-section';
    patternSection.style.cssText = `
      margin-top: 24px;
      padding: 20px;
      background: rgba(0, 0, 0, 0.35);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 18px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.08);
    `;
    
    patternSection.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; flex-wrap: wrap; gap: 12px;">
        <div>
          <h3 style="margin: 0 0 4px 0; font-size: 20px; font-weight: 900; color: #ff6b6b;">
            🚨 Advanced Pattern Detection
          </h3>
          <p style="margin: 0; opacity: 0.8; font-size: 13px;">
            Multi-asset manipulation detection: NFT wash sales, AMM rug pulls, LP sandwich attacks, floor manipulation
          </p>
        </div>
        
        <button id="runPatternDetection" class="nav-btn" style="padding: 10px 18px; border-radius: 12px; background: linear-gradient(135deg, #ff6b6b, #ff5252); border: none; color: #000; font-weight: 900; font-size: 13px; cursor: pointer; box-shadow: 0 4px 15px rgba(255, 107, 107, 0.4);">
          🔍 Analyze All Patterns
        </button>
      </div>
      
      <div id="pattern-results" style="min-height: 80px;">
        <div style="opacity: 0.7; text-align: center; padding: 20px;">
          Click "Analyze All Patterns" to scan for suspicious activity across all asset types
        </div>
      </div>
    `;
    
    resultsContainer.appendChild(patternSection);
    
    document.getElementById('runPatternDetection')?.addEventListener('click', async () => {
      await analyzeCurrentTraceForPatterns();
    });
  }

  async function analyzeCurrentTraceForPatterns() {
    const resultsEl = document.getElementById('pattern-results');
    if (!resultsEl) return;
    
    if (!lastResult || !lastResult.edges || lastResult.edges.length === 0) {
      resultsEl.innerHTML = `
        <div style="padding: 20px; text-align: center; color: #ffb86c;">
          ⚠️ No trace data available. Build a trace first.
        </div>
      `;
      return;
    }
    
    resultsEl.innerHTML = `
      <div style="padding: 20px; text-align: center;">
        <div style="display: inline-block; width: 40px; height: 40px; border: 4px solid rgba(255, 107, 107, 0.3); border-top-color: #ff6b6b; border-radius: 50%; animation: spin 1s linear infinite;"></div>
        <div style="margin-top: 12px; font-weight: 700;">Analyzing multi-asset patterns...</div>
      </div>
      <style>
        @keyframes spin { to { transform: rotate(360deg); } }
      </style>
    `;
    
    try {
      if (!window.EnhancedPatternDetector) {
        throw new Error('EnhancedPatternDetector not loaded. Please ensure enhanced-pattern-detector.js is included.');
      }

      const findings = await window.EnhancedPatternDetector.analyze(window._currentTraceData);
      const report = window.EnhancedPatternDetector.generateReport(findings);
      
      displayPatternFindings(report);
    } catch (error) {
      console.error('Pattern detection error:', error);
      resultsEl.innerHTML = `
        <div style="padding: 20px; text-align: center; color: #ff6b6b;">
          ❌ Error analyzing patterns: ${escapeHtml(error.message)}
        </div>
      `;
    }
  }

  function displayPatternFindings(report) {
    const resultsEl = document.getElementById('pattern-results');
    if (!resultsEl) return;
    
    const { summary, findings } = report;
    
    if (findings.length === 0) {
      resultsEl.innerHTML = `
        <div style="padding: 20px; text-align: center; color: #50fa7b;">
          ✅ No suspicious patterns detected across all asset types!
        </div>
      `;
      return;
    }
    
    const severityColors = {
      HIGH: '#ff6b6b',
      MEDIUM: '#ffb86c',
      LOW: '#f1fa8c'
    };
    
    resultsEl.innerHTML = `
      <div style="padding: 16px; background: rgba(255, 107, 107, 0.1); border: 2px solid rgba(255, 107, 107, 0.3); border-radius: 12px; margin-bottom: 16px;">
        <div style="font-weight: 900; font-size: 16px; margin-bottom: 12px;">
          🚨 Found ${summary.total} Suspicious Pattern${summary.total !== 1 ? 's' : ''} Across All Assets
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px;">
          <div style="padding: 10px; background: rgba(255, 107, 107, 0.2); border-radius: 8px; text-align: center;">
            <div style="font-size: 24px; font-weight: 900; color: ${severityColors.HIGH};">${summary.high}</div>
            <div style="font-size: 12px; opacity: 0.8;">HIGH Severity</div>
          </div>
          <div style="padding: 10px; background: rgba(255, 184, 108, 0.2); border-radius: 8px; text-align: center;">
            <div style="font-size: 24px; font-weight: 900; color: ${severityColors.MEDIUM};">${summary.medium}</div>
            <div style="font-size: 12px; opacity: 0.8;">MEDIUM Severity</div>
          </div>
          <div style="padding: 10px; background: rgba(241, 250, 140, 0.2); border-radius: 8px; text-align: center;">
            <div style="font-size: 24px; font-weight: 900; color: ${severityColors.LOW};">${summary.low}</div>
            <div style="font-size: 12px; opacity: 0.8;">LOW Severity</div>
          </div>
        </div>
      </div>
      
      <div style="max-height: 600px; overflow-y: auto;">
        ${findings.map((finding) => `
          <div style="padding: 16px; margin-bottom: 12px; background: rgba(0, 0, 0, 0.3); border-left: 4px solid ${severityColors[finding.severity]}; border-radius: 10px;">
            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px; flex-wrap: wrap; gap: 8px;">
              <div>
                <span style="background: ${severityColors[finding.severity]}33; color: ${severityColors[finding.severity]}; padding: 4px 10px; border-radius: 6px; font-weight: 900; font-size: 11px; letter-spacing: 0.5px;">
                  ${finding.severity}
                </span>
                <span style="margin-left: 8px; opacity: 0.7; font-size: 12px;">
                  ${(finding.confidence * 100).toFixed(0)}% confidence
                </span>
              </div>
              <div style="font-weight: 900; font-size: 13px; color: ${severityColors[finding.severity]};">
                ${getTypeIcon(finding.assetType || 'other')} ${finding.type.replace(/_/g, ' ')}
              </div>
            </div>
            
            <div style="font-size: 14px; line-height: 1.6; margin-bottom: 8px;">
              ${escapeHtml(finding.description)}
            </div>
            
            ${finding.recommendation ? `
              <div style="margin-top: 8px; padding: 8px; background: rgba(0, 255, 240, 0.1); border-radius: 6px; font-size: 12px;">
                💡 <strong>Recommendation:</strong> ${escapeHtml(finding.recommendation)}
              </div>
            ` : ''}
            
            ${finding.edges && finding.edges.length > 0 ? `
              <details style="margin-top: 10px;">
                <summary style="cursor: pointer; font-weight: 700; font-size: 12px; opacity: 0.8; padding: 8px; background: rgba(255, 255, 255, 0.05); border-radius: 6px;">
                  📊 View ${finding.edges.length} Related Transaction${finding.edges.length !== 1 ? 's' : ''}
                </summary>
                <div style="margin-top: 8px; padding: 10px; background: rgba(0, 0, 0, 0.3); border-radius: 6px; max-height: 200px; overflow-y: auto;">
                  ${finding.edges.slice(0, 5).map(e => `
                    <div style="padding: 6px; margin: 4px 0; background: rgba(255, 255, 255, 0.03); border-radius: 4px; font-size: 11px; font-family: 'JetBrains Mono', monospace;">
                      <div>${getTypeIcon(e.type)} <strong>${escapeHtml(shortAddr(e.from))}</strong> → <strong>${escapeHtml(shortAddr(e.to || 'N/A'))}</strong></div>
                      <div style="opacity: 0.7; margin-top: 2px;">${escapeHtml(e.amount || 'N/A')} • Ledger ${e.ledger_index || 'N/A'}</div>
                    </div>
                  `).join('')}
                  ${finding.edges.length > 5 ? `<div style="text-align: center; opacity: 0.6; margin-top: 8px; font-size: 11px;">+ ${finding.edges.length - 5} more</div>` : ''}
                </div>
              </details>
            ` : ''}
          </div>
        `).join('')}
      </div>
      
      <div style="margin-top: 16px; padding: 12px; background: rgba(0, 255, 240, 0.1); border: 1px solid rgba(0, 255, 240, 0.3); border-radius: 10px; font-size: 12px; opacity: 0.9;">
        💡 <strong>Multi-Asset Detection:</strong> Patterns analyzed across Payments, NFTs, AMM/LP, and DEX operations for comprehensive fraud detection.
      </div>
    `;
  }

  // ---------------- EXPORT FUNCTIONS ----------------
  function wireExportButtons(result) {
    const ej = $("traceExportJsonInInspector");
    const ec = $("traceExportCsvInInspector");

    if (ej) {
      ej.disabled = false;
      ej.onclick = () => downloadJSON(serializeResult(result), `nalu_enhanced_trace_${result.victim}_${Date.now()}.json`);
    }
    if (ec) {
      ec.disabled = false;
      ec.onclick = () => downloadCSV(result.edges, `nalu_enhanced_trace_edges_${result.victim}_${Date.now()}.csv`);
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
        maxEdges: result.maxEdges,
        traceTypes: result.traceTypes
      },
      nodes: Array.from(result.nodes),
      edges: result.edges,
      nftData: result.nftData,
      ammData: result.ammData,
      typeBreakdown: result.typeBreakdown
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
    const headers = ["type", "from", "to", "amount", "currency", "issuer", "nftID", "ammID", "ledger_index", "tx_hash", "validated"];
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

  // ---------------- PUBLIC API ----------------
  function initInspectorTraceTab({ mountId } = {}) {
    const id = String(mountId || "inspectorTraceMount");
    const mount = document.getElementById(id);
    if (!mount) {
      console.warn("Trace mount not found:", id);
      return;
    }
    
    renderInto(mount);
    
    console.log(`✅ ${VERSION} mounted into #${id}`);
  }

  function setSeedAddress(addr) {
    const v = String(addr || "").trim();
    if (!isXRPLAccount(v)) return false;
    const input = $("traceVictimInInspector") || document.getElementById("traceVictimInInspector");
    if (input) input.value = v;
    return true;
  }

  function getTraceData() {
    if (!lastResult) return null;
    return {
      origin: lastResult.victim,
      edges: lastResult.edges,
      nodes: lastResult.nodes,
      nftData: lastResult.nftData,
      ammData: lastResult.ammData,
      params: {
        maxHops: lastResult.maxHops,
        ledgerMin: lastResult.ledgerMin,
        ledgerMax: lastResult.ledgerMax,
        traceTypes: lastResult.traceTypes
      }
    };
  }

  // Export public API
  window.initInspectorTraceTab = initInspectorTraceTab;
  window.InspectorTraceTab = {
    version: VERSION,
    setSeedAddress,
    getLastResult: () => lastResult,
    getTraceData
  };

  console.log(`✅ ${VERSION} loaded - Multi-Asset Support Enabled`);
})();
