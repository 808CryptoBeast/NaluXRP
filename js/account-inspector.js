/* =========================================
   NaluXrp — Account Inspector (Full Page, Forensics + Merkle)
   - Full-page inspector with filters, canonical leaf schema
   - Chunked Merkle snapshot (per-day / fixed-size)
   - Account summary: domain, logo (Clearbit), address, activated_by, initial balance
   - Issuer detection heuristic, dominance metrics, pathway flags (fan-out / dominated)
   - Per-tx details and inclusion proofs (leaf->chunk->top)
   - Uses shared XRPL client (preferred) and can reuse dashboard in-memory txs to avoid CORS/fallbacks
   ========================================= */

(function () {
  // -------- CONFIG --------
  // Allow runtime override via window.NALU_DEPLOYED_PROXY (useful for ngrok/dev)
  const DEPLOYED_PROXY = (typeof window !== "undefined" && window.NALU_DEPLOYED_PROXY) ? window.NALU_DEPLOYED_PROXY : "";
  const PUBLIC_TX_API = "https://api.xrpl.org/v2/accounts";
  const PUBLIC_ACCT_API = "https://api.xrpl.org/v2/accounts";
  const MAX_FETCH_PAGES = 200;
  const PAGE_LIMIT = 100;
  const MAX_TXS_DEFAULT = 2000;  // default safety cap (user-adjustable in UI)
  const SHARED_WAIT_MS = 8000;
  const SCHEMA_VERSION = "1.0";

  // -------- STATE --------
  let snapshot = null;
  let building = false;

  // -------- DOM helpers --------
  const $ = id => document.getElementById(id);
  function el(tag, props = {}, ...children) {
    const e = document.createElement(tag);
    for (const k in props) {
      if (k === "style") Object.assign(e.style, props[k]);
      else if (k === "text") e.textContent = props[k];
      else e.setAttribute(k, props[k]);
    }
    for (const c of children) {
      if (typeof c === "string") e.appendChild(document.createTextNode(c));
      else if (c instanceof Node) e.appendChild(c);
    }
    return e;
  }

  // -------- UI render (full page) --------
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
          <div style="opacity:.9">Address summary • chunked Merkle snapshots • proofs • pathway flags</div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 420px;gap:12px;margin-bottom:12px;align-items:start;">
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
              <input id="aiMinAmt" type="number" placeholder="Min amt (XRP)" style="width:110px;padding:8px;border-radius:8px;border:1px solid var(--accent-tertiary);"/>
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
              <label>Chunking</label>
              <select id="aiChunkMode" style="padding:8px;border-radius:8px;border:1px solid var(--accent-tertiary);">
                <option value="auto">Auto (per-day if date range set)</option>
                <option value="per-day">Per-day</option>
                <option value="fixed">Fixed-size</option>
              </select>
              <input id="aiChunkSize" type="number" value="500" min="50" step="50" style="width:110px;padding:8px;border-radius:8px;border:1px solid var(--accent-tertiary);"/>
              <label style="margin-left:auto;font-size:13px;">Max txs:
                <input id="aiMaxT" type="number" value="${MAX_TXS_DEFAULT}" style="width:90px;padding:6px;border-radius:6px;border:1px solid var(--accent-tertiary)"/>
              </label>
            </div>

            <div style="display:flex;gap:8px;">
              <button id="aiFetch" class="nav-btn" style="padding:10px 14px;border-radius:8px;background:linear-gradient(135deg,#50fa7b,#2ecc71);border:none;color:#000;font-weight:700;">Build Snapshot</button>
              <button id="aiUseDashboard" class="nav-btn" style="padding:10px 14px;border-radius:8px;background:#ffd1a9;border:none;color:#000;">Use Dashboard Data</button>
              <button id="aiClear" class="nav-btn" style="padding:10px 14px;border-radius:8px;background:#ffb86c;border:none;color:#000;">Clear</button>
              <button id="aiExport" class="nav-btn" style="padding:10px 14px;border-radius:8px;background:#50a8ff;border:none;color:#000;display:none;">Export Snapshot</button>
            </div>

            <div id="aiProgress" style="margin-top:8px;height:10px;background:rgba(255,255,255,0.04);border-radius:6px;overflow:hidden;display:none;">
              <div id="aiProgressBar" style="height:100%;width:0%;background:linear-gradient(90deg,#50fa7b,#2ecc71)"></div>
            </div>

            <div id="aiStatus" style="margin-top:8px;color:var(--text-secondary)">Ready</div>
          </div>

          <div style="display:flex;flex-direction:column;gap:8px;">
            <div id="aiSummary" style="padding:10px;background:rgba(255,255,255,0.02);border-radius:8px;min-height:120px;">
              <div style="opacity:.8">Account summary will appear here after snapshot.</div>
            </div>
            <div id="aiChunkInfo" style="padding:10px;background:rgba(255,255,255,0.02);border-radius:8px;min-height:120px;">
              <div><strong>Chunks:</strong> —</div>
            </div>
          </div>
        </div>

        <div id="aiTxList" style="max-height:440px;overflow:auto;border-radius:8px;border:1px solid rgba(255,255,255,0.04);padding:10px;background:var(--card-bg);"></div>

        <div id="aiRaw" style="white-space:pre-wrap;margin-top:12px;font-size:12px;color:var(--text-secondary)"></div>
      </div>

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

    // wire controls
    $("aiFetch").addEventListener("click", onBuild);
    $("aiUseDashboard").addEventListener("click", handleUseDashboard);
    $("aiClear").addEventListener("click", () => { clearAll(); setStatus("Ready"); });
    $("aiExport").addEventListener("click", exportSnapshot);
    $("aiModalClose").addEventListener("click", () => { $("aiModalOverlay").style.display = "none"; });
    const addr = $("aiAddress");
    if (addr) addr.addEventListener("keypress", (e) => { if (e.key === "Enter") onBuild(); });
  }

  // -------- small helpers --------
  function setStatus(s) { const el = $("aiStatus"); if (el) el.textContent = s; }
  function setProgress(p) { const wrap = $("aiProgress"); const bar = $("aiProgressBar"); if (!wrap || !bar) return; if (p < 0) { wrap.style.display = "none"; bar.style.width = "0%"; } else { wrap.style.display = "block"; bar.style.width = `${Math.round(Math.max(0, Math.min(1, p))*100)}%`; } }
  function setSummaryHtml(html) { const el = $("aiSummary"); if (el) el.innerHTML = html; }
  function setChunkInfoHtml(html) { const el = $("aiChunkInfo"); if (el) el.innerHTML = html; }
  function setTxListHtml(html) { const el = $("aiTxList"); if (el) el.innerHTML = html; }
  function setRaw(txt) { const el = $("aiRaw"); if (el) el.innerText = txt; }
  function escapeHtml(s) { if (s == null) return ""; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // canonicalize and hashing
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
    const h = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2,'0')).join('');
  }

  // parse amount helper (normalize to numeric XRP when possible)
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

  // -------- canonical leaf builder --------
  async function buildLeafForTx(tx, inspectedAccount) {
    const t = tx.tx || tx.transaction || tx;
    const txHash = String(t.hash || t.tx?.hash || t.transaction?.hash || "");
    const ledgerIndex = Number(t.ledger_index ?? t.tx?.LedgerIndex ?? t.transaction?.ledger_index ?? 0);
    const date = t.date || t.close_time || t.tx?.date || t.transaction?.date ? new Date(t.date || t.close_time || t.tx?.date || t.transaction?.date).toISOString() : null;
    const account = t.Account || t.account || null;
    const dest = t.Destination || t.destination || null;
    let direction = "other";
    if (account && dest) {
      if (account === inspectedAccount && dest === inspectedAccount) direction = "self";
      else if (account === inspectedAccount) direction = "out";
      else if (dest === inspectedAccount) direction = "in";
    } else if (account && account === inspectedAccount) direction = "out";
    else if (dest && dest === inspectedAccount) direction = "in";

    const type = t.TransactionType || t.type || "Unknown";
    const rawAmount = t.Amount ?? t.delivered_amount ?? null;
    const amount = parseAmount(rawAmount);
    const result = t.meta?.TransactionResult || t.engine_result || null;

    const leaf = {
      tx_hash: txHash,
      ledger_index: ledgerIndex,
      date,
      account: account || null,
      counterparty: dest || null,
      direction,
      type,
      amount,
      result,
      meta: {
        delivered_amount: t.delivered_amount || t.meta?.delivered_amount || null
      }
    };

    const canon = canonicalize(leaf);
    const json = JSON.stringify(canon);
    const leafHash = await hashUtf8Hex(json);
    return { leaf, leafHash, json, raw: t };
  }

  // -------- Merkle helpers --------
  async function buildMerkleTreeAsync(leafHexes) {
    if (!leafHexes || !leafHexes.length) return { root: null, layers: [] };
    let layer = leafHexes.slice();
    const layers = [layer.slice()];
    while (layer.length > 1) {
      const next = [];
      for (let i = 0; i < layer.length; i += 2) {
        const left = layer[i];
        const right = (i + 1 < layer.length) ? layer[i + 1] : layer[i];
        next.push(await hashUtf8Hex(left + right));
      }
      layer = next;
      layers.unshift(layer.slice());
    }
    return { root: layers[0][0], layers };
  }
  function getMerkleProof(layers, leafIndex) {
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

  // -------- Network fetching helpers --------
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

  // fetch account_info (domain decode, balance)
  async function fetchAccountInfo(address) {
    // Try shared client first
    try {
      if (typeof window.requestXrpl === 'function') {
        const res = await window.requestXrpl({ command: 'account_info', account: address }, { timeoutMs: 8000 });
        const info = res.result?.account_data || res.account_data || res;
        return info || null;
      } else if (window.XRPL && window.XRPL.client && typeof window.XRPL.client.request === 'function') {
        const resp = await window.XRPL.client.request({ command: 'account_info', account: address });
        return resp.result?.account_data || resp.account_data || resp;
      }
    } catch (e) {
      console.warn('Shared account_info failed', e && e.message ? e.message : e);
    }

    // Fallback to xrpl.org v2
    try {
      const url = `${PUBLIC_ACCT_API}/${encodeURIComponent(address)}`;
      const j = await tryFetchUrl(url, 9000);
      if (j && (j.result || j.account)) {
        // xrpl.org v2 shape: result.account or result
        return (j.result?.account || j.account || j.result || j);
      }
    } catch (e) {
      console.warn('xrpl.org account fetch failed', e && e.message ? e.message : e);
    }
    return null;
  }

  // fetch transactions - prefer shared client, proxy, then public APIs
  async function fetchAccountTxs(address, startIso, endIso, maxTxsCap = MAX_TXS_DEFAULT) {
    setStatus('Resolving data source...');
    const collected = [];
    const sharedReady = await waitForSharedConn();
    if (sharedReady) {
      setStatus('Querying shared XRPL connection...');
      try {
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
      setStatus('Shared XRPL connection not ready; using HTTP APIs...');
    }

    // Proxy
    if (DEPLOYED_PROXY && DEPLOYED_PROXY.startsWith('http')) {
      try {
        setStatus('Fetching via deployed proxy...');
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

    // xrpl.org v2
    try {
      setStatus('Fetching from xrpl.org (public API)...');
      let url = `${PUBLIC_TX_API}/${encodeURIComponent(address)}/transactions?limit=${PAGE_LIMIT}`;
      if (startIso) url += `&start=${encodeURIComponent(startIso)}`;
      if (endIso) url += `&end=${encodeURIComponent(endIso)}`;
      let page = 0;
      while (page++ < MAX_FETCH_PAGES) {
        setStatus(`xrpl.org page ${page}...`);
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

    // data.ripple.com
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

    // xrpscan
    try {
      setStatus('Trying xrpscan...');
      const url = `https://api.xrpscan.com/api/v1/accounts/${encodeURIComponent(address)}/transactions?limit=${PAGE_LIMIT}`;
      const j = await tryFetchUrl(url, 9000);
      if (j && Array.isArray(j.data) && j.data.length) {
        collected.push(...j.data);
        return collected.slice(0, maxTxsCap);
      }
    } catch (e) { console.warn('xrpscan failed', e && e.message ? e.message : e); }

    throw new Error('Failed to fetch transactions from any source');
  }

  // -------- Chunked snapshot builder (leaves + chunks + topTree) --------
  async function buildChunkedSnapshot(txs, strategy, chunkSize, inspectedAccount) {
    setStatus('Canonicalizing & hashing leaves...');
    const leaves = [];
    const leafJsons = [];
    for (let i = 0; i < txs.length; i++) {
      const { leaf, leafHash, json, raw } = await buildLeafForTx(txs[i], inspectedAccount);
      leaves.push(leafHash);
      leafJsons.push({ leaf, json, raw, txIndex: i });
      if (i % 50 === 0) setProgress(i / txs.length);
    }
    setProgress(-1);

    const chunks = [];
    if (strategy === 'per-day') {
      const map = new Map();
      for (let i = 0; i < leafJsons.length; i++) {
        const d = leafJsons[i].leaf.date ? leafJsons[i].leaf.date.slice(0,10) : 'unknown';
        if (!map.has(d)) map.set(d, []);
        map.get(d).push({ index: leafJsons[i].txIndex, hash: leaves[i] });
      }
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

    const chunkRoots = chunks.map(c => c.root);
    const topTree = await buildMerkleTreeAsync(chunkRoots);

    return { leaves, leafJsons, chunks, topTree };
  }

  // -------- Analysis helpers (activation, issuer detection, dominance & flags) --------
  function analyzeSnapshotBasic(inspectedAddress, txLeafJsons) {
    const types = {};
    const counterparties = {};
    let totalAmt = 0;
    let nonXrpCount = 0;
    for (const entry of txLeafJsons) {
      const t = entry.leaf;
      types[t.type] = (types[t.type] || 0) + 1;
      const other = (t.direction === 'out') ? t.counterparty : t.account;
      if (other) counterparties[other] = (counterparties[other] || 0) + 1;
      if (t.amount && t.amount.currency !== 'XRP') nonXrpCount++;
      totalAmt += (t.amount && t.amount.value) || 0;
    }
    const topCounterparty = Object.entries(counterparties).sort((a,b)=>b[1]-a[1])[0] || [null,0];
    const dominance = txLeafJsons.length ? (topCounterparty[1] / txLeafJsons.length) : 0;
    const fanOut = (Object.keys(counterparties).length / Math.max(1, txLeafJsons.length)) > 0.6 && txLeafJsons.length > 10;
    const dominatedBySingle = dominance > 0.6;
    return {
      typeCounts: types,
      counterparties,
      topCounterparty: { address: topCounterparty[0], count: topCounterparty[1], dominance },
      flags: {
        fanOut: !!fanOut,
        dominatedBySingle: !!dominatedBySingle,
        likelyIssuer: nonXrpCount > 0
      },
      avgAmount: txLeafJsons.length ? totalAmt / txLeafJsons.length : 0
    };
  }

  function findActivationInTxs(inspectedAddress, txLeafJsons) {
    const incoming = txLeafJsons.filter(x => x.leaf.type === 'Payment' && x.leaf.counterparty === inspectedAddress);
    if (!incoming.length) return null;
    const earliest = incoming.reduce((a,b) => ( (a.leaf.ledger_index || 1e12) < (b.leaf.ledger_index || 1e12) ? a : b ));
    return { activatedBy: earliest.leaf.account, amount: earliest.leaf.amount, date: earliest.leaf.date };
  }

  // -------- Account info fetch + domain decode + logo --------
  function hexToAscii(hex) {
    try {
      if (!hex) return null;
      if (typeof hex !== 'string') return String(hex);
      const clean = hex.replace(/^0x/i, '');
      let str = '';
      for (let i = 0; i < clean.length; i += 2) {
        const code = parseInt(clean.slice(i, i+2), 16);
        if (!code) continue;
        str += String.fromCharCode(code);
      }
      return str || null;
    } catch (e) {
      return null;
    }
  }

  async function getAccountSummary(address, txLeafJsons) {
    let info = null;
    try { info = await fetchAccountInfo(address); } catch (e) { console.warn('account_info failed', e); }
    let domain = null;
    let balance = null;
    let sequence = null;
    let ownerCount = null;
    if (info) {
      domain = info.domain ? (typeof info.domain === 'string' ? info.domain : hexToAscii(info.domain)) : (hexToAscii(info.Domain) || null);
      const balVal = info.balance || info.Balance || (info.account && info.account.balance);
      if (balVal != null) {
        const asNum = Number(balVal);
        balance = Number.isFinite(asNum) ? (asNum > 10000 ? (asNum / 1_000_000) : asNum) : String(balVal);
      } else if (info.account && info.account.xrp_balance) {
        balance = Number(info.account.xrp_balance);
      }
      sequence = info.Sequence || info.sequence || info.account?.sequence || null;
      ownerCount = info.OwnerCount || info.owner_count || info.account?.owner_count || null;
    }

    let logoUrl = null;
    if (domain) {
      try { logoUrl = `https://logo.clearbit.com/${domain}`; } catch (e) { logoUrl = null; }
    }

    const activation = findActivationInTxs(address, txLeafJsons);
    const analysis = analyzeSnapshotBasic(address, txLeafJsons);

    return {
      domain,
      logoUrl,
      balance,
      sequence,
      ownerCount,
      activation,
      analysis
    };
  }

  // fetch account_info wrapper (shared + xrpl.org)
  async function fetchAccountInfo(address) {
    try {
      if (typeof window.requestXrpl === 'function') {
        const r = await window.requestXrpl({ command: 'account_info', account: address }, { timeoutMs: 8000 });
        const data = r.result?.account_data || r.account_data || r;
        return data;
      } else if (window.XRPL && window.XRPL.client && typeof window.XRPL.client.request === 'function') {
        const resp = await window.XRPL.client.request({ command: 'account_info', account: address });
        return resp.result?.account_data || resp.account_data || resp;
      }
    } catch (e) {
      console.warn('shared account_info failed', e && e.message ? e.message : e);
    }
    try {
      const url = `${PUBLIC_ACCT_API}/${encodeURIComponent(address)}`;
      const j = await tryFetchUrl(url, 8000);
      return j.result?.account || j.account || j;
    } catch (e) {
      console.warn('xrpl.org account fetch failed', e && e.message ? e.message : e);
    }
    return null;
  }

  // -------- Use Dashboard Data integration --------
  function getTransactionsFromDashboard() {
    try {
      // Prefer the XRPL module's recentTransactions
      const xr = window.XRPL?.state?.recentTransactions;
      if (Array.isArray(xr) && xr.length) return xr.slice().reverse(); // oldest-first if possible

      // Dashboard recentTransactions field
      if (window.NaluDashboard && Array.isArray(window.NaluDashboard.recentTransactions) && window.NaluDashboard.recentTransactions.length) {
        return window.NaluDashboard.recentTransactions.slice().reverse();
      }

      // Dashboard module's replayHistory (flatten txs is not guaranteed; fallback)
      if (window.NaluDashboard && Array.isArray(window.NaluDashboard.replayHistory) && window.NaluDashboard.replayHistory.length) {
        // replayHistory contains ledger summaries; not ideal. Return empty to indicate not found.
        return null;
      }

      // fallback global stores
      if (Array.isArray(window.replayHistory) && window.replayHistory.length) return window.replayHistory.slice();

      return null;
    } catch (e) {
      console.warn("getTransactionsFromDashboard error", e);
      return null;
    }
  }

  async function handleUseDashboard() {
    setStatus("Importing dashboard transactions...");
    setProgress(0);
    const imported = getTransactionsFromDashboard();
    if (!imported || !imported.length) {
      setStatus("No dashboard transactions found. Ensure the dashboard is running and has recent txs.");
      setProgress(-1);
      return;
    }

    const maxT = Number(($('aiMaxT') || {}).value || MAX_TXS_DEFAULT);
    const sliced = imported.slice(0, maxT);

    // infer or use provided address
    let addr = ($('aiAddress') || {}).value?.trim();
    if (!addr || !/^r[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(addr)) {
      const counts = {};
      for (const tx of sliced) {
        const a = tx.Account || tx.account; if (a) counts[a] = (counts[a]||0)+1;
        const d = tx.Destination || tx.destination; if (d) counts[d] = (counts[d]||0)+1;
      }
      const most = Object.entries(counts).sort((a,b)=>b[1]-a[1])[0];
      if (most && most[0]) {
        addr = most[0];
        ($('aiAddress') || {}).value = addr;
        setStatus(`Guessed inspected address: ${addr}`);
      } else {
        setStatus("Unable to infer inspected address — paste an r... address into the input.");
        setProgress(-1);
        return;
      }
    }

    // apply filters
    const types = Array.from(($('aiTypes') || {}).querySelectorAll('input[type=checkbox]:checked')).map(i=>i.value);
    const dir = ($('aiDirection') || {}).value || 'both';
    const minAmt = Number(($('aiMinAmt') || {}).value || 0);

    const filtered = [];
    for (const tRaw of sliced) {
      const t = tRaw.tx || tRaw.transaction || tRaw;
      if (!t) continue;
      const txType = t.TransactionType || t.type || '';
      if (types.length && !types.includes(txType)) continue;

      const acc = t.Account || t.account; const dst = t.Destination || t.destination;
      let direction = 'other';
      if (acc && dst) {
        if (acc === addr && dst === addr) direction = 'self';
        else if (acc === addr) direction = 'out';
        else if (dst === addr) direction = 'in';
      } else if (acc && acc === addr) direction = 'out';
      else if (dst && dst === addr) direction = 'in';
      if (dir !== 'both' && direction !== dir) continue;

      const rawAmount = t.Amount ?? t.delivered_amount ?? null;
      const amt = parseAmount(rawAmount).value || 0;
      if (minAmt > 0 && amt < minAmt) continue;

      filtered.push(t);
      if (filtered.length >= maxT) break;
    }

    if (!filtered.length) {
      setStatus("No dashboard transactions remain after filters.");
      setProgress(-1);
      return;
    }

    setStatus(`Building snapshot from ${filtered.length} imported txs...`);
    const chunkMode = ($('aiChunkMode') || {}).value || 'auto';
    const strategy = (chunkMode === 'auto' ? ( ($('aiStart')?.value && $('aiEnd')?.value) ? 'per-day' : 'fixed' ) : chunkMode);
    const chunkSize = Number(($('aiChunkSize') || {}).value || 500);

    const { leaves, leafJsons, chunks, topTree } = await buildChunkedSnapshot(filtered, strategy, chunkSize, addr);

    snapshot = {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      mode: strategy,
      chunkSize,
      address: addr,
      dateRange: { start: ($('aiStart')||{}).value || null, end: ($('aiEnd')||{}).value || null },
      txCount: filtered.length,
      leaves,
      leafJsons,
      chunks,
      topTree,
      txs: filtered
    };

    const summary = await getAccountSummary(addr, snapshot.leafJsons);
    renderSummaryUI(snapshot, summary);

    // Build tx list and proof buttons
    const txHtml = snapshot.leafJsons.map((l, idx) => {
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
    setTxListHtml(txHtml);
    setRaw(JSON.stringify({ topRoot: snapshot.topTree.root, chunks: snapshot.chunks.map(c => ({ start: c.startIndex, end: c.endIndex, root: c.root })) }, null, 2));

    Array.from(document.querySelectorAll('.ai-btn-show')).forEach(btn => btn.addEventListener('click', (e) => {
      const idx = Number(btn.getAttribute('data-idx')); showTxDetails(idx);
    }));
    Array.from(document.querySelectorAll('.ai-btn-proof')).forEach(btn => btn.addEventListener('click', async (e) => {
      const idx = Number(btn.getAttribute('data-idx')); await showProofForIndex(idx);
    }));

    $('aiExport').style.display = 'inline-block';
    setStatus('Snapshot built from dashboard data');
    setProgress(-1);
  }

  // -------- Build and render snapshot flow (from remote or shared client) --------
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
      const maxT = Number(($('aiMaxT') || {}).value || MAX_TXS_DEFAULT);

      setStatus('Fetching transactions...');
      const raw = await fetchAccountTxs(addr, start, end, maxT);
      if (!raw || !raw.length) { setStatus('No transactions'); building = false; setProgress(-1); return; }

      // normalize tx objects and filter per UI
      setStatus('Filtering transactions...');
      const filtered = [];
      for (const r of raw) {
        const t = r.tx || r.transaction || r;
        const txType = t.TransactionType || t.type || '';
        if (types.length && !types.includes(txType)) {
          if (!types.includes(txType)) continue;
        }
        const acc = t.Account || t.account;
        const dst = t.Destination || t.destination;
        let direction = 'other';
        if (acc && dst) {
          if (acc === addr && dst === addr) direction = 'self';
          else if (acc === addr) direction = 'out';
          else if (dst === addr) direction = 'in';
        } else if (acc && acc === addr) direction = 'out';
        else if (dst && dst === addr) direction = 'in';
        if (dir !== 'both' && direction !== dir) continue;

        const rawAmount = t.Amount ?? t.delivered_amount ?? null;
        const amt = parseAmount(rawAmount).value || 0;
        if (minAmt > 0 && amt < minAmt) continue;

        filtered.push(t);
        if (filtered.length >= maxT) break;
      }

      setStatus(`Canonicalizing ${filtered.length} transactions and building Merkle chunks...`);
      const strategy = (chunkMode === 'auto' ? (start && end ? 'per-day' : 'fixed') : chunkMode);
      const actualChunk = Math.max(50, Math.min(2000, chunkSize || 500));
      const { leaves, leafJsons, chunks, topTree } = await buildChunkedSnapshot(filtered, strategy, actualChunk, addr);

      snapshot = {
        schemaVersion: SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        mode: strategy,
        chunkSize: actualChunk,
        address: addr,
        dateRange: { start, end },
        txCount: filtered.length,
        leaves,
        leafJsons,
        chunks,
        topTree,
        txs: filtered
      };

      // analyze & fetch account info (domain & balance)
      const summary = await getAccountSummary(addr, snapshot.leafJsons);
      // render summary
      renderSummaryUI(snapshot, summary);

      // render tx list (compact)
      const txHtml = snapshot.leafJsons.map((l, idx) => {
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
      setTxListHtml(txHtml);
      setRaw(JSON.stringify({ topRoot: snapshot.topTree.root, chunks: snapshot.chunks.map(c => ({ start: c.startIndex, end: c.endIndex, root: c.root })) }, null, 2));
      // attach handlers
      Array.from(document.querySelectorAll('.ai-btn-show')).forEach(btn => btn.addEventListener('click', (e) => {
        const idx = Number(btn.getAttribute('data-idx')); showTxDetails(idx);
      }));
      Array.from(document.querySelectorAll('.ai-btn-proof')).forEach(btn => btn.addEventListener('click', async (e) => {
        const idx = Number(btn.getAttribute('data-idx')); await showProofForIndex(idx);
      }));

      $('aiExport').style.display = 'inline-block';
      setStatus('Snapshot built');
      setProgress(-1);
    } catch (err) {
      console.error(err);
      setStatus('Build failed: ' + (err && err.message ? err.message : String(err)));
      setProgress(-1);
    } finally {
      building = false;
    }
  }

  // -------- render summary UI --------
  function renderSummaryUI(snap, summary) {
    const domain = summary.domain || '—';
    const logoUrl = summary.logoUrl;
    const balance = summary.balance != null ? `${summary.balance} XRP` : '—';
    const ownerCount = summary.ownerCount ?? '—';
    const seq = summary.sequence ?? '—';
    const activated = summary.activation ? `${summary.activation.activatedBy} • ${summary.activation.amount && summary.activation.amount.value ? summary.activation.amount.value + ' ' + (summary.activation.amount.currency || 'XRP') : '—'} • ${summary.activation.date || '—'}` : 'Not found in snapshot (expand range)';
    const { typeCounts, topCounterparty, flags } = summary.analysis;

    const typesHtml = Object.entries(typeCounts || {}).map(([k,v]) => `<div style="font-size:13px">${k}: ${v}</div>`).join('');
    const counterpartyHtml = topCounterparty.address ? `<div style="font-size:13px">${topCounterparty.address} (${Math.round(topCounterparty.dominance*100)}%)</div>` : '<div style="opacity:.7">None</div>';
    const flagList = [];
    if (flags.fanOut) flagList.push('Fan-out pattern');
    if (flags.dominatedBySingle) flagList.push('Dominated by single counterparty');
    if (flags.likelyIssuer) flagList.push('Likely issuing address (non-XRP txs observed)');

    const html = `
      <div style="display:flex;gap:12px;align-items:center;">
        <div style="width:68px;height:68px;border-radius:8px;background:rgba(255,255,255,0.03);display:flex;align-items:center;justify-content:center;">
          ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="logo" style="max-width:64px;max-height:64px;border-radius:6px"/>` : `<div style="opacity:.6">No logo</div>`}
        </div>
        <div>
          <div><strong>Address</strong>: ${escapeHtml(snap.address)}</div>
          <div><strong>Domain</strong>: ${escapeHtml(domain)}</div>
          <div><strong>Balance</strong>: ${escapeHtml(balance)} • Seq: ${escapeHtml(String(seq))} • Owners: ${escapeHtml(String(ownerCount))}</div>
          <div style="margin-top:6px"><strong>Activated by</strong>: ${escapeHtml(activated)}</div>
        </div>
      </div>

      <div style="margin-top:8px;display:flex;gap:12px;flex-wrap:wrap;">
        <div style="padding:8px;border-radius:8px;background:rgba(255,255,255,0.02)">
          <div><strong>Top counterparty</strong></div>
          ${counterpartyHtml}
        </div>

        <div style="padding:8px;border-radius:8px;background:rgba(255,255,255,0.02)">
          <div><strong>Top types</strong></div>
          ${typesHtml}
        </div>

        <div style="padding:8px;border-radius:8px;background:rgba(255,255,255,0.02);min-width:220px">
          <div><strong>Flags</strong></div>
          <div>${flagList.length ? flagList.map(f => `<div style="font-size:13px">${escapeHtml(f)}</div>`).join('') : '<div style="opacity:.7">None</div>'}</div>
        </div>
      </div>

      <div style="margin-top:10px;padding:8px;border-radius:8px;background:rgba(255,255,255,0.01)">
        <div><strong>Merkle</strong></div>
        <div>Top root: <code style="font-family:monospace;">${snap.topTree.root}</code></div>
        <div>Chunks: ${snap.chunks.length} • Leaves: ${snap.leaves.length}</div>
      </div>
    `;
    setSummaryHtml(html);

    // chunk info
    const chunkInfoHtml = snap.chunks.map((c, idx) => {
      const key = c.key ? `date:${c.key}` : `chunk:${idx}`;
      return `<div style="padding:8px;border-bottom:1px dashed rgba(255,255,255,0.04)"><strong>${key}</strong> • ${c.count} txs • root: <code>${c.root.slice(0,12)}…</code></div>`;
    }).join('');
    setChunkInfoHtml(`<div style="max-height:240px;overflow:auto;">${chunkInfoHtml}</div>`);
  }

  // -------- Details / proof modal --------
  function showTxDetails(idx) {
    if (!snapshot) return;
    const info = snapshot.leafJsons[idx];
    const title = $('aiModalTitle'); const body = $('aiModalBody');
    title.textContent = `Tx #${idx} details`;
    body.textContent = JSON.stringify({ canonicalLeaf: info.leaf, canonicalJson: info.json, rawTx: info.raw }, null, 2);
    $('aiModalOverlay').style.display = 'flex';
  }

  async function showProofForIndex(idx) {
    if (!snapshot) return;
    const info = snapshot.leafJsons[idx];
    const leafHex = snapshot.leaves[idx];
    const proof = getGlobalProof(snapshot.chunks, snapshot.topTree, idx);
    if (!proof) {
      $('aiModalTitle').textContent = 'Proof';
      $('aiModalBody').textContent = 'No proof available';
      $('aiModalOverlay').style.display = 'flex';
      return;
    }
    const proofObj = { proofToChunk: proof.proofToChunk, proofChunkToTop: proof.proofChunkToTop, chunkRoot: snapshot.chunks[proof.chunkIndex].root, topRoot: snapshot.topTree.root };
    const verified = await verifyGlobalProof(leafHex, proofObj);
    const out = { index: idx, leafHash: leafHex, proofObj, verified };
    $('aiModalTitle').textContent = `Proof #${idx} • verified: ${verified ? 'OK' : 'FAIL'}`;
    $('aiModalBody').textContent = JSON.stringify(out, null, 2);
    $('aiModalOverlay').style.display = 'flex';
  }

  // -------- export snapshot (full) --------
  function exportSnapshot() {
    if (!snapshot) { setStatus('No snapshot'); return; }
    setStatus('Exporting snapshot...');
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
      txs: snapshot.txs
    };
    const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `naluxrp-snapshot-${snapshot.address}-${Date.now()}.json`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    setStatus('Export complete');
  }

  // -------- clear & init --------
  function clearAll() {
    snapshot = null;
    setSummaryHtml('<div style="opacity:.8">Account summary will appear here after snapshot.</div>');
    setChunkInfoHtml('<div><strong>Chunks:</strong> —</div>');
    setTxListHtml('');
    setRaw('');
    setStatus('Ready');
    setProgress(-1);
    $('aiExport').style.display = 'none';
  }

  // -------- init & expose API --------
  renderPage();
  window.initInspector = () => renderPage();
  window.AccountInspector = {
    buildSnapshot: onBuild,
    getSnapshot: () => snapshot,
    getGlobalProof: (idx) => snapshot ? getGlobalProof(snapshot.chunks, snapshot.topTree, idx) : null,
    verifyGlobalProof
  };

  console.log('🛡️ Account Inspector (full page enhanced) loaded');
})();
