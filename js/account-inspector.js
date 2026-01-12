/* =========================================
   NaluXrp — Account Inspector (Full Page, Enhanced)
   - Full-page inspector with robust filters
   - Prefers shared in-page XRPL connection (no server needed)
   - HTTP fallbacks: DEPLOYED_PROXY (optional), xrpl.org v2, data.ripple.com, xrpscan
   - Deterministic canonical leaf schema
   - Chunked Merkle tree (per-day or fixed-size chunks) + top-level tree
   - Per-leaf and global inclusion proofs (leaf->chunk->top)
   - Export snapshot (JSON) with schemaVersion, chunks, topRoot, leaves, txs
   - Per-tx proof / verify UI
   - Progress UI and safeguards for large histories
   ========================================= */

(function () {
  // -------- CONFIG --------
  const DEPLOYED_PROXY = ""; // e.g. "https://naluxrp-proxy.onrender.com" (optional)
  const PUBLIC_TX_API = "https://api.xrpl.org/v2/accounts";
  const MAX_FETCH_PAGES = 200;
  const PAGE_LIMIT = 100;
  const MAX_TXS = 5000;        // safety cap (adjust if needed)
  const SHARED_WAIT_MS = 8000; // how long to wait for shared XRPL connection
  const SCHEMA_VERSION = "1.0";

  // -------- STATE --------
  let snapshot = null; // structured snapshot object
  let building = false;

  // -------- UTIL: DOM helpers --------
  function $(id) { return document.getElementById(id); }
  function el(tag, props = {}, children = []) {
    const e = document.createElement(tag);
    for (const k in props) {
      if (k === "style") Object.assign(e.style, props[k]);
      else if (k === "text") e.textContent = props[k];
      else e.setAttribute(k, props[k]);
    }
    for (const c of children) {
      if (typeof c === "string") e.appendChild(document.createTextNode(c));
      else e.appendChild(c);
    }
    return e;
  }

  // -------- INIT UI (full-page) --------
  function ensurePage() {
    let page = $("inspector");
    if (!page) {
      page = document.createElement("section");
      page.id = "inspector";
      page.className = "page-section";
      const main = document.getElementById("main") || document.getElementById("dashboard")?.parentElement || document.body;
      main.appendChild(page);
    }
    return page;
  }

  function renderPage() {
    const page = ensurePage();
    page.innerHTML = `
      <div class="chart-section" style="padding:18px;">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px;">
          <h2 style="margin:0">🔎 Account Inspector</h2>
          <div style="opacity:.9">Filters • chunked Merkle snapshots • proofs • export</div>
        </div>

        <div id="ai-controls" style="display:grid;grid-template-columns: 1fr 420px; gap:12px;align-items:start;margin-bottom:12px;">
          <div style="display:flex;flex-direction:column;gap:8px;">
            <div style="display:flex;gap:8px;">
              <input id="aiAddress" placeholder="r... address" style="flex:1;padding:10px;border-radius:8px;border:1px solid var(--accent-tertiary);background:transparent;color:var(--text-primary)"/>
              <select id="aiDirection" title="Direction" style="padding:8px;border-radius:8px;border:1px solid var(--accent-tertiary);background:transparent;">
                <option value="both">Both</option>
                <option value="out">Sent</option>
                <option value="in">Received</option>
                <option value="self">Self</option>
              </select>
            </div>

            <div style="display:flex;gap:8px;">
              <input id="aiStart" type="date" style="padding:8px;border-radius:8px;border:1px solid var(--accent-tertiary);"/>
              <input id="aiEnd" type="date" style="padding:8px;border-radius:8px;border:1px solid var(--accent-tertiary);"/>
              <input id="aiMinAmt" type="number" placeholder="Min amt" style="width:110px;padding:8px;border-radius:8px;border:1px solid var(--accent-tertiary);"/>
            </div>

            <div style="display:flex;gap:8px;align-items:center;">
              <label style="font-size:13px;">Tx Types</label>
              <div id="aiTypes" style="display:flex;gap:8px;flex-wrap:wrap;">
                <label><input type="checkbox" value="Payment" checked/>Payment</label>
                <label><input type="checkbox" value="OfferCreate"/>OfferCreate</label>
                <label><input type="checkbox" value="OfferCancel"/>OfferCancel</label>
                <label><input type="checkbox" value="TrustSet"/>TrustSet</label>
                <label><input type="checkbox" value="NFTokenMint"/>NFT</label>
              </div>
            </div>

            <div style="display:flex;gap:8px;align-items:center;">
              <label style="font-size:13px;">Chunking</label>
              <select id="aiChunkMode" style="padding:8px;border-radius:8px;border:1px solid var(--accent-tertiary);">
                <option value="auto">Auto (per-day if date range set, else fixed)</option>
                <option value="per-day">Per-day</option>
                <option value="fixed">Fixed-size</option>
              </select>
              <input id="aiChunkSize" type="number" value="500" min="50" step="50" style="width:110px;padding:8px;border-radius:8px;border:1px solid var(--accent-tertiary);"/>
              <label style="margin-left:auto;font-size:13px;">Max txs: <input id="aiMaxT" type="number" value="${MAX_TXS}" style="width:90px;padding:6px;border-radius:6px;border:1px solid var(--accent-tertiary)"/></label>
            </div>

            <div style="display:flex;gap:8px;">
              <button id="aiFetch" class="nav-btn" style="padding:10px 14px;border-radius:8px;background:linear-gradient(135deg,#50fa7b,#2ecc71);border:none;color:#000;font-weight:700;">Build Snapshot</button>
              <button id="aiClear" class="nav-btn" style="padding:10px 14px;border-radius:8px;background:#ffb86c;border:none;color:#000;">Clear</button>
              <button id="aiExport" class="nav-btn" style="padding:10px 14px;border-radius:8px;background:#50a8ff;border:none;color:#000;display:none;">Export Snapshot</button>
            </div>

            <div id="aiProgress" style="margin-top:8px;height:10px;background:rgba(255,255,255,0.04);border-radius:6px;overflow:hidden;display:none;">
              <div id="aiProgressBar" style="height:100%;width:0%;background:linear-gradient(90deg,#50fa7b,#2ecc71)"></div>
            </div>

            <div id="aiStatus" style="margin-top:8px;color:var(--text-secondary)">Ready</div>
          </div>

          <div style="display:flex;flex-direction:column;gap:8px;">
            <div id="aiOverview" style="padding:10px;background:rgba(255,255,255,0.02);border-radius:8px;min-height:120px;">No snapshot</div>
            <div id="aiChunkInfo" style="padding:10px;background:rgba(255,255,255,0.02);border-radius:8px;min-height:120px;">Chunks: —</div>
          </div>
        </div>

        <div id="aiTxList" style="max-height:440px;overflow:auto;border-radius:8px;border:1px solid rgba(255,255,255,0.04);padding:10px;background:var(--card-bg);"></div>

        <div id="aiRaw" style="white-space:pre-wrap;margin-top:12px;font-size:12px;color:var(--text-secondary)"></div>
      </div>

      <!-- modal for proofs/details -->
      <div id="aiModalOverlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);align-items:center;justify-content:center;z-index:12000;">
        <div id="aiModal" style="width:min(900px,95%);max-height:80vh;overflow:auto;background:var(--bg-secondary);padding:14px;border-radius:10px;border:1px solid var(--accent-tertiary);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <strong id="aiModalTitle">Details</strong>
            <button id="aiModalClose">✕</button>
          </div>
          <pre id="aiModalBody" style="white-space:pre-wrap;font-size:13px;color:var(--text-primary);"></pre>
        </div>
      </div>
    `;

    // wire events
    $("aiFetch").addEventListener("click", onBuild);
    $("aiClear").addEventListener("click", () => { clearAll(); setStatus("Ready"); });
    $("aiExport").addEventListener("click", exportSnapshot);
    $("aiModalClose").addEventListener("click", () => { $("aiModalOverlay").style.display = "none"; });

    const addr = $("aiAddress");
    if (addr) addr.addEventListener("keypress", (e) => { if (e.key === "Enter") onBuild(); });
  }

  // -------- helpers --------
  function setStatus(s) { const el = $("aiStatus"); if (el) el.textContent = s; }
  function setProgress(p) { const wrap = $("aiProgress"); const bar = $("aiProgressBar"); if (!wrap || !bar) return; wrap.style.display = (p >= 0 && p < 1) ? "block" : "none"; bar.style.width = `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`; }
  function setOverviewHtml(html) { const el = $("aiOverview"); if (el) el.innerHTML = html; }
  function setChunkInfo(html) { const el = $("aiChunkInfo"); if (el) el.innerHTML = html; }
  function setTxListHtml(html) { const el = $("aiTxList"); if (el) el.innerHTML = html; }
  function setRaw(txt) { const el = $("aiRaw"); if (el) el.innerText = txt; }
  function escapeHtml(s) { if (s == null) return ""; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // canonicalize function
  function canonicalize(obj) {
    if (obj === null || typeof obj !== "object") return obj;
    if (Array.isArray(obj)) return obj.map(canonicalize);
    const out = {};
    for (const k of Object.keys(obj).sort()) out[k] = canonicalize(obj[k]);
    return out;
  }

  async function hashUtf8Hex(input) {
    const enc = new TextEncoder();
    const data = enc.encode(input);
    const hash = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,'0')).join('');
  }

  // parse amount helper
  function parseAmount(amount) {
    if (amount == null) return { value: 0, currency: "XRP", issuer: null };
    if (typeof amount === "string") {
      const v = Number(amount);
      return { value: Number.isFinite(v) ? v / 1_000_000 : 0, currency: "XRP", issuer: null };
    }
    if (typeof amount === "object" && amount.value != null) {
      const v = Number(amount.value);
      return { value: Number.isFinite(v) ? v : 0, currency: amount.currency || "XRP", issuer: amount.issuer || null };
    }
    if (typeof amount === "number") return { value: amount, currency: "XRP", issuer: null };
    return { value: 0, currency: "XRP", issuer: null };
  }

  // ---------------------------
  // Canonical leaf builder (deterministic)
  // ---------------------------
  async function buildLeafForTx(tx, inspectedAccount) {
    const txHash = String(tx.hash || tx.tx?.hash || tx.transaction?.hash || "");
    const ledgerIndex = Number(tx.ledger_index ?? tx.tx?.LedgerIndex ?? tx.transaction?.ledger_index ?? 0);
    const dateISO = tx.date || tx.close_time || tx.date_close || tx.tx?.date || tx.transaction?.date
      ? new Date(tx.date || tx.close_time || tx.tx?.date || tx.transaction?.date).toISOString()
      : null;
    const account = tx.Account || tx.tx?.Account || tx.transaction?.Account || null;
    const dest = tx.Destination || tx.tx?.Destination || tx.transaction?.Destination || null;

    let direction = "other";
    if (account && dest) {
      if (account === inspectedAccount && dest === inspectedAccount) direction = "self";
      else if (account === inspectedAccount) direction = "out";
      else if (dest === inspectedAccount) direction = "in";
      else direction = "other";
    } else if (account && account === inspectedAccount) direction = "out";
    else if (dest && dest === inspectedAccount) direction = "in";

    const type = tx.TransactionType || tx.tx?.TransactionType || tx.transaction?.TransactionType || tx.type || "Unknown";

    const rawAmount = tx.Amount ?? tx.delivered_amount ?? tx.tx?.Amount ?? tx.transaction?.Amount ?? null;
    const amount = parseAmount(rawAmount);

    const result = tx.meta?.TransactionResult || tx.engine_result || tx.tx?.meta?.TransactionResult || null;

    const leaf = {
      tx_hash: txHash,
      ledger_index: ledgerIndex,
      date: dateISO,
      account: account || null,
      counterparty: dest || null,
      direction,
      type,
      amount,
      result,
      meta: {
        delivered_amount: tx.delivered_amount || tx.meta?.delivered_amount || null
      }
    };

    const canon = canonicalize(leaf);
    const json = JSON.stringify(canon);
    const leafHash = await hashUtf8Hex(json);
    return { leaf, leafHash, json };
  }

  // ---------------------------
  // Merkle tree builder (layers with root at index 0)
  // ---------------------------
  async function buildMerkleTreeAsync(leafHexes) {
    if (!leafHexes || !leafHexes.length) return { root: null, layers: [] };
    let layer = leafHexes.slice();
    const layers = [layer.slice()]; // leaves at last index
    while (layer.length > 1) {
      const next = [];
      for (let i = 0; i < layer.length; i += 2) {
        const left = layer[i];
        const right = (i + 1 < layer.length) ? layer[i + 1] : layer[i]; // duplicate if odd
        const combined = await hashUtf8Hex(left + right);
        next.push(combined);
      }
      layer = next;
      layers.unshift(layer.slice());
    }
    return { root: layers[0][0], layers };
  }

  function getMerkleProof(layers, leafIndex) {
    // layers: root @ 0, leaves @ last index
    const proof = [];
    let idx = leafIndex;
    for (let li = layers.length - 1; li > 0; li--) {
      const layer = layers[li];
      const isRight = (idx % 2) === 1;
      const pair = isRight ? idx - 1 : idx + 1;
      const sibling = pair < layer.length ? layer[pair] : layer[idx];
      proof.push({ sibling, position: isRight ? "left" : "right" });
      idx = Math.floor(idx / 2);
    }
    return proof;
  }

  async function verifyMerkleProof(leafHex, proof, rootHex) {
    let h = leafHex;
    for (const step of proof) {
      h = step.position === "left" ? await hashUtf8Hex(step.sibling + h) : await hashUtf8Hex(h + step.sibling);
    }
    return h === rootHex;
  }

  // global proof: leaf -> chunk root -> top root
  function getGlobalProof(chunks, topTree, globalIndex) {
    const chunkIdx = chunks.findIndex(c => globalIndex >= c.startIndex && globalIndex <= c.endIndex);
    if (chunkIdx < 0) return null;
    const chunk = chunks[chunkIdx];
    const localIndex = globalIndex - chunk.startIndex;
    const proofToChunk = getMerkleProof(chunk.layers, localIndex);
    const proofChunkToTop = getMerkleProof(topTree.layers, chunkIdx);
    return {
      chunkIndex: chunkIdx,
      localIndex,
      proofToChunk,
      proofChunkToTop,
      chunkRoot: chunk.root,
      topRoot: topTree.root
    };
  }

  async function verifyGlobalProof(leafHex, proofObj) {
    const ok1 = await verifyMerkleProof(leafHex, proofObj.proofToChunk, proofObj.chunkRoot);
    if (!ok1) return false;
    const ok2 = await verifyMerkleProof(proofObj.chunkRoot, proofObj.proofChunkToTop, proofObj.topRoot);
    return ok1 && ok2;
  }

  // ---------------------------
  // Data fetching: prefer shared client, then proxy (if configured), then public APIs
  // ---------------------------
  function waitForSharedConn(timeoutMs = SHARED_WAIT_MS) {
    return new Promise((resolve) => {
      try {
        if ((window.XRPL && window.XRPL.connected) || typeof window.requestXrpl === 'function') return resolve(true);
        const onConn = (ev) => {
          const d = ev && ev.detail;
          if (d && d.connected) {
            window.removeEventListener('xrpl-connection', onConn);
            clearTimeout(t);
            resolve(true);
          }
        };
        window.addEventListener('xrpl-connection', onConn);
        const t = setTimeout(() => { window.removeEventListener('xrpl-connection', onConn); resolve(false); }, timeoutMs);
      } catch (e) { resolve(false); }
    });
  }

  async function tryFetchUrl(url, timeoutMs = 9000) {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeoutMs);
      const resp = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
      clearTimeout(id);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.json();
    } catch (err) {
      console.warn('tryFetchUrl failed', url, err && err.message ? err.message : err);
      return null;
    }
  }

  async function fetchAccountTxs(address, startIso, endIso, maxTxsCap = MAX_TXS) {
    setStatus('Resolving data source...');
    const collected = [];

    // 1) Shared client
    const sharedReady = await waitForSharedConn();
    if (sharedReady) {
      setStatus('Querying shared XRPL connection...');
      try {
        // requestXrpl wrapper first
        if (typeof window.requestXrpl === 'function') {
          let marker;
          for (let p = 0; p < MAX_FETCH_PAGES; p++) {
            const payload = { command: 'account_tx', account: address, limit: PAGE_LIMIT, ledger_index_min: -1, ledger_index_max: -1 };
            if (marker) payload.marker = marker;
            const res = await window.requestXrpl(payload, { timeoutMs: 10000 });
            const entries = res.transactions || res.results || res;
            if (Array.isArray(entries)) collected.push(...entries);
            if (!res.marker) break;
            marker = res.marker;
            setProgress(collected.length / maxTxsCap);
            if (collected.length >= maxTxsCap) break;
          }
          if (collected.length) return collected.slice(0, maxTxsCap);
        }
        // XRPL.client fallback
        if (window.XRPL && window.XRPL.client && typeof window.XRPL.client.request === 'function') {
          let marker;
          for (let p = 0; p < MAX_FETCH_PAGES; p++) {
            const resp = await window.XRPL.client.request({ command: 'account_tx', account: address, limit: PAGE_LIMIT, ledger_index_min: -1, ledger_index_max: -1, marker });
            const res = resp.result || resp;
            const entries = res.transactions || res;
            if (Array.isArray(entries)) collected.push(...entries);
            if (!res.marker) break;
            marker = res.marker;
            setProgress(collected.length / maxTxsCap);
            if (collected.length >= maxTxsCap) break;
          }
          if (collected.length) return collected.slice(0, maxTxsCap);
        }
      } catch (e) {
        console.warn('Shared client fetch failed', e && e.message ? e.message : e);
      }
    } else {
      setStatus('Shared connection not ready; falling back to HTTP APIs...');
    }

    // 2) DEPLOYED_PROXY (optional)
    if (DEPLOYED_PROXY && DEPLOYED_PROXY.startsWith('http')) {
      setStatus('Trying deployed proxy...');
      try {
        let url = `${DEPLOYED_PROXY.replace(/\/+$/,'')}/accounts/${encodeURIComponent(address)}/transactions?limit=${PAGE_LIMIT}`;
        if (startIso) url += `&start=${encodeURIComponent(startIso)}`;
        if (endIso) url += `&end=${encodeURIComponent(endIso)}`;
        let page = 0;
        while (page++ < MAX_FETCH_PAGES) {
          setStatus(`Proxy page ${page}...`);
          const j = await tryFetchUrl(url, 10000);
          if (!j) break;
          const arr = j.result || j.transactions || j.data || j;
          if (Array.isArray(arr)) collected.push(...arr);
          const marker = j.marker || j.result?.marker;
          if (!marker) break;
          url = `${DEPLOYED_PROXY.replace(/\/+$/,'')}/accounts/${encodeURIComponent(address)}/transactions?marker=${encodeURIComponent(marker)}&limit=${PAGE_LIMIT}`;
          setProgress(collected.length / maxTxsCap);
          if (collected.length >= maxTxsCap) break;
        }
        if (collected.length) return collected.slice(0, maxTxsCap);
      } catch (e) { console.warn('Proxy fetch failed', e && e.message ? e.message : e); }
    }

    // 3) xrpl.org v2 (pagination supported)
    try {
      setStatus('Trying xrpl.org (public API)...');
      let url = `${PUBLIC_TX_API}/${encodeURIComponent(address)}/transactions?limit=${PAGE_LIMIT}`;
      if (startIso) url += `&start=${encodeURIComponent(startIso)}`;
      if (endIso) url += `&end=${encodeURIComponent(endIso)}`;
      let p = 0;
      while (p++ < MAX_FETCH_PAGES) {
        setStatus(`xrpl.org page ${p}...`);
        const j = await tryFetchUrl(url, 10000);
        if (!j) break;
        const arr = j.result || j.transactions || j.data || j;
        if (Array.isArray(arr)) collected.push(...arr);
        const marker = j.marker || j.result?.marker;
        if (!marker) break;
        url = `${PUBLIC_TX_API}/${encodeURIComponent(address)}/transactions?marker=${encodeURIComponent(marker)}&limit=${PAGE_LIMIT}`;
        setProgress(collected.length / maxTxsCap);
        if (collected.length >= maxTxsCap) break;
      }
      if (collected.length) return collected.slice(0, maxTxsCap);
    } catch (e) { console.warn('xrpl.org failed', e && e.message ? e.message : e); }

    // 4) data.ripple.com (one page)
    try {
      setStatus('Trying data.ripple.com...');
      let url = `https://data.ripple.com/v2/accounts/${encodeURIComponent(address)}/transactions?limit=${PAGE_LIMIT}`;
      if (startIso) url += `&start=${encodeURIComponent(startIso)}`;
      if (endIso) url += `&end=${encodeURIComponent(endIso)}`;
      const j = await tryFetchUrl(url, 9000);
      if (j && Array.isArray(j.transactions) && j.transactions.length) {
        collected.push(...j.transactions);
        return collected.slice(0, maxTxsCap);
      }
    } catch (e) { console.warn('data.ripple.com failed', e && e.message ? e.message : e); }

    // 5) xrpscan
    try {
      setStatus('Trying xrpscan...');
      const url = `https://api.xrpscan.com/api/v1/accounts/${encodeURIComponent(address)}/transactions?limit=${PAGE_LIMIT}`;
      const j = await tryFetchUrl(url, 9000);
      if (j && Array.isArray(j.data) && j.data.length) {
        collected.push(...j.data);
        return collected.slice(0, maxTxsCap);
      }
    } catch (e) { console.warn('xrpscan failed', e && e.message ? e.message : e); }

    throw new Error('No transaction source succeeded (check network or deploy proxy)');
  }

  // ---------------------------
  // Chunked merkle snapshot builder
  // ---------------------------
  async function buildChunkedSnapshot(txs, strategy, chunkSize, inspectedAccount) {
    // txs: array in descending or incoming order — we will preserve the order provided
    // strategy: "per-day" or "fixed"
    setStatus('Building leaves (canonicalization & hashing)...');
    const leaves = [];
    const leafJsons = []; // store canonical JSON for UI/proofs
    for (let i = 0; i < txs.length; i++) {
      const tx = txs[i];
      const { leaf, leafHash, json } = await buildLeafForTx(tx, inspectedAccount);
      leaves.push(leafHash);
      leafJsons.push({ leaf, json, txIndex: i });
      if (i % 50 === 0) setProgress(i / txs.length);
    }
    setProgress(-1);

    // Group into chunks
    const chunks = [];
    if (strategy === 'per-day') {
      // group by date (YYYY-MM-DD) based on leaf.date
      const map = new Map();
      for (let i = 0; i < leafJsons.length; i++) {
        const d = leafJsons[i].leaf.date ? leafJsons[i].leaf.date.slice(0,10) : 'unknown';
        if (!map.has(d)) map.set(d, []);
        map.get(d).push({ index: leafJsons[i].txIndex, hash: leaves[i] });
      }
      // preserve chronological order of keys (sort descending by date presence)
      const keys = Array.from(map.keys()).sort((a,b) => b.localeCompare(a));
      let runningIndex = 0;
      for (const k of keys) {
        const arr = map.get(k);
        const hashes = arr.map(x => x.hash);
        const tree = await buildMerkleTreeAsync(hashes);
        chunks.push({
          key: k,
          startIndex: runningIndex,
          endIndex: runningIndex + hashes.length - 1,
          count: hashes.length,
          root: tree.root,
          layers: tree.layers,
          leafHashes: hashes
        });
        runningIndex += hashes.length;
      }
    } else {
      // fixed-size chunking
      let runningIndex = 0;
      for (let i = 0; i < leaves.length; i += chunkSize) {
        const slice = leaves.slice(i, i + chunkSize);
        const tree = await buildMerkleTreeAsync(slice);
        chunks.push({
          startIndex: i,
          endIndex: i + slice.length - 1,
          count: slice.length,
          root: tree.root,
          layers: tree.layers,
          leafHashes: slice
        });
      }
    }

    // Top-level tree over chunk roots
    const chunkRoots = chunks.map(c => c.root);
    const topTree = await buildMerkleTreeAsync(chunkRoots);

    return { leaves, leafJsons, chunks, topTree };
  }

  // ---------------------------
  // UI Build flow
  // ---------------------------
  async function onBuild() {
    if (building) return;
    building = true;
    setStatus('Starting snapshot build...');
    setProgress(0);
    try {
      const addr = ($('aiAddress') || {}).value?.trim();
      if (!addr || !/^r[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(addr)) { setStatus('Enter a valid XRP address'); building = false; setProgress(-1); return; }
      const start = ($('aiStart') || {}).value || null;
      const end = ($('aiEnd') || {}).value || null;
      const dir = ($('aiDirection') || {}).value || 'both';
      const minAmt = Number(($('aiMinAmt') || {}).value || 0);
      const types = Array.from(($('aiTypes') || {}).querySelectorAll('input[type=checkbox]:checked')).map(i => i.value);
      const chunkMode = ($('aiChunkMode') || {}).value || 'auto';
      const chunkSize = Number(($('aiChunkSize') || {}).value || 500);
      const maxT = Number(($('aiMaxT') || {}).value || MAX_TXS);

      setStatus('Fetching transactions (this may take a while)...');
      const rawTxs = await fetchAccountTxs(addr, start, end, maxT);
      if (!rawTxs || !rawTxs.length) { setStatus('No transactions returned'); building = false; setProgress(-1); return; }

      // Filter by types, direction, minAmt
      setStatus('Filtering transactions...');
      const filtered = [];
      for (const tx of rawTxs) {
        const tObj = tx.tx || tx.transaction || tx;
        const txType = tObj.TransactionType || tObj.type || '';
        if (types.length && !types.includes(txType) && types.indexOf('') === -1) {
          // if none of selected types match, skip; if user kept Payment only but txType may be e.g. OfferCreate, skip
          if (!types.includes(txType)) continue;
        }
        // direction filter
        const acc = tObj.Account || tObj.account;
        const dst = tObj.Destination || tObj.destination;
        let direction = 'other';
        if (acc && dst) {
          if (acc === addr && dst === addr) direction = 'self';
          else if (acc === addr) direction = 'out';
          else if (dst === addr) direction = 'in';
        } else if (acc && acc === addr) direction = 'out';
        else if (dst && dst === addr) direction = 'in';
        if (dir !== 'both' && direction !== dir) continue;

        // min amount check (convert to XRP)
        const rawAmount = tObj.Amount || tObj.delivered_amount || null;
        const amt = parseAmount(rawAmount).value || 0;
        if (minAmt > 0 && amt < minAmt) continue;

        filtered.push(tObj);
        if (filtered.length >= maxT) break;
      }

      setStatus(`Building canonical leaves for ${filtered.length} tx(s)...`);
      const strategy = (chunkMode === 'auto' ? (start && end ? 'per-day' : 'fixed') : chunkMode);
      const actualChunkSize = Math.max(50, Math.min(2000, chunkSize || 500));

      const { leaves, leafJsons, chunks, topTree } = await buildChunkedSnapshot(filtered, strategy, actualChunkSize, addr);

      snapshot = {
        schemaVersion: SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        mode: strategy,
        chunkSize: actualChunkSize,
        address: addr,
        dateRange: { start, end },
        txCount: filtered.length,
        leaves,
        leafJsons,
        chunks,
        topTree
      };

      // Render UI summary
      setOverviewHtml(`<div><strong>Address:</strong> ${escapeHtml(addr)}<br/><strong>Txs:</strong> ${snapshot.txCount}<br/><strong>Top Root:</strong> <code>${snapshot.topTree.root}</code></div>`);
      setChunkInfo(`<div><strong>Chunks:</strong> ${snapshot.chunks.length} • Avg size: ${Math.round((snapshot.leaves.length / Math.max(1, snapshot.chunks.length))*10)/10}</div>`);
      // tx list with proof buttons
      const txListHtml = snapshot.leafJsons.map((l, idx) => {
        const h = snapshot.leaves[idx];
        const short = h.slice(0,10) + '…' + h.slice(-6);
        return `<div style="padding:8px;border-bottom:1px dashed rgba(255,255,255,0.04);display:flex;justify-content:space-between;align-items:center;">
          <div style="font-size:13px;">
            <div><strong>#${idx}</strong> <code style="font-family:monospace;">${short}</code></div>
            <div style="font-size:12px;opacity:.8;">${escapeHtml(String(l.leaf.type || ''))} • ${escapeHtml(String(l.leaf.date || ''))}</div>
          </div>
          <div style="display:flex;gap:8px;">
            <button data-idx="${idx}" class="ai-btn-show" style="padding:6px 8px;border-radius:6px;border:1px solid var(--accent-tertiary);background:transparent;cursor:pointer;">Details</button>
            <button data-idx="${idx}" class="ai-btn-proof" style="padding:6px 8px;border-radius:6px;border:none;background:linear-gradient(135deg,#ffd166,#ffb86c);cursor:pointer;">Proof</button>
          </div>
        </div>`;
      }).join('');
      setTxListHtml(txListHtml);
      setRaw(JSON.stringify({ topRoot: snapshot.topTree.root, chunks: snapshot.chunks.map(c => ({ start: c.startIndex, end: c.endIndex, root: c.root })) }, null, 2));

      // attach handlers for details/proof
      Array.from(document.querySelectorAll('.ai-btn-show')).forEach(btn => {
        btn.addEventListener('click', (e) => {
          const idx = Number(btn.getAttribute('data-idx'));
          showTxDetails(idx);
        });
      });
      Array.from(document.querySelectorAll('.ai-btn-proof')).forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const idx = Number(btn.getAttribute('data-idx'));
          await showProofForIndex(idx);
        });
      });

      $('aiExport').style.display = 'inline-block';
      setStatus('Snapshot built successfully');
      setProgress(-1);
    } catch (err) {
      console.error(err);
      setStatus('Build failed: ' + (err && err.message ? err.message : String(err)));
      setProgress(-1);
    } finally {
      building = false;
    }
  }

  // show tx details modal
  function showTxDetails(idx) {
    if (!snapshot) return;
    const info = snapshot.leafJsons[idx];
    const body = $('aiModalBody');
    const title = $('aiModalTitle');
    title.textContent = `Tx #${idx} details`;
    body.textContent = JSON.stringify({ canonicalLeaf: info.leaf, canonicalJson: info.json }, null, 2);
    $('aiModalOverlay').style.display = 'flex';
  }

  // show proof modal and verify
  async function showProofForIndex(idx) {
    if (!snapshot) return;
    const info = snapshot.leafJsons[idx];
    const leafHex = snapshot.leaves[idx];
    const proof = getGlobalProof(snapshot.chunks, snapshot.topTree, idx);
    if (!proof) {
      $('aiModalTitle').textContent = 'Proof';
      $('aiModalBody').textContent = 'No proof found for this index';
      $('aiModalOverlay').style.display = 'flex';
      return;
    }
    const verifyOk = await verifyGlobalProof(leafHex, { ...proof, topRoot: snapshot.topTree.root, chunkRoot: proof.chunkRoot ?? snapshot.chunks[proof.chunkIndex].root });
    const out = {
      index: idx,
      leafHash: leafHex,
      chunkIndex: proof.chunkIndex,
      localIndex: proof.localIndex,
      proofToChunk: proof.proofToChunk,
      proofChunkToTop: proof.proofChunkToTop,
      chunkRoot: snapshot.chunks[proof.chunkIndex].root,
      topRoot: snapshot.topTree.root,
      verified: verifyOk
    };
    $('aiModalTitle').textContent = `Proof for tx #${idx} • verified: ${verifyOk ? 'OK' : 'FAIL'}`;
    $('aiModalBody').textContent = JSON.stringify(out, null, 2);
    $('aiModalOverlay').style.display = 'flex';
  }

  // export snapshot full JSON
  function exportSnapshot() {
    if (!snapshot) { setStatus('No snapshot'); return; }
    setStatus('Exporting snapshot...');
    // Compose export object (you may remove heavy txs or leafJsons if you prefer compact)
    const exportObj = {
      schemaVersion: snapshot.schemaVersion,
      generatedAt: snapshot.generatedAt,
      address: snapshot.address,
      dateRange: snapshot.dateRange,
      txCount: snapshot.txCount,
      mode: snapshot.mode,
      chunkSize: snapshot.chunkSize,
      topRoot: snapshot.topTree.root,
      chunks: snapshot.chunks.map(c => ({ startIndex: c.startIndex, endIndex: c.endIndex, count: c.count, root: c.root, leafHashes: c.leafHashes })),
      leaves: snapshot.leaves,
      txs: snapshot.txs ? snapshot.txs : snapshot.leafJsons.map(l => l.leaf),
    };
    const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `naluxrp-snapshot-${snapshot.address}-${Date.now()}.json`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    setStatus('Export complete');
  }

  // clear everything
  function clearAll() {
    snapshot = null;
    clearUI();
    setOverviewHtml('No snapshot');
    setChunkInfo('Chunks: —');
  }

  // initial UI render and expose API
  renderPage();
  window.initInspector = function() { renderPage(); };
  window.AccountInspector = {
    buildSnapshot: onBuild,
    getSnapshot: () => snapshot,
    getGlobalProof: (idx) => snapshot ? getGlobalProof(snapshot.chunks, snapshot.topTree, idx) : null,
    verifyGlobalProof: verifyGlobalProof
  };

  console.log('🛡️ Account Inspector (enhanced) loaded');
})();
