/* =========================================
   NaluXrp — Account Inspector (Full Page)
   - Full-page inspector for account transaction forensics
   - Prefers shared in-page XRPL connection (no server needed)
   - HTTP fallbacks: DEPLOYED_PROXY (if configured), xrpl.org v2, data.ripple.com, xrpscan
   - Builds canonical SHA-256 Merkle tree over transactions
   - Exports snapshot + per-leaf inclusion proofs (JSON)
   - Verifies proofs client-side
   - Simple summary visuals (type counts, top counterparties)
   ========================================= */

(function () {
  // CONFIG - set DEPLOYED_PROXY if you have an HTTPS proxy deployed
  // Example: const DEPLOYED_PROXY = "https://naluxrp-proxy.onrender.com";
  const DEPLOYED_PROXY = ""; // <-- set to your proxy URL (optional)
  const PUBLIC_TX_API = "https://api.xrpl.org/v2/accounts";
  const MAX_FETCH_PAGES = 200;
  const PAGE_LIMIT = 100;
  const MAX_TXS = 2000; // safety cap to avoid browser OOM
  const SHARED_WAIT_MS = 8000; // wait up to 8s for shared connection

  // State
  let currentSnapshot = null;

  /* -------------------------
     RENDER: full-page UI
  ------------------------- */
  function ensureInspectorPage() {
    let page = document.getElementById("inspector");
    if (!page) {
      page = document.createElement("section");
      page.id = "inspector";
      page.className = "page-section";
      const main = document.getElementById("main") || document.getElementById("dashboard")?.parentElement || document.body;
      main.appendChild(page);
    }
    return page;
  }

  function renderInspectorPage() {
    const page = ensureInspectorPage();
    page.innerHTML = `
      <div class="chart-section" style="padding:20px;">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px;">
          <h2 style="margin:0">🔎 Account Inspector</h2>
          <div style="opacity:.9">Merkle snapshots • proofs • simple analytics</div>
        </div>

        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
          <input id="aiAddress" placeholder="r... address" aria-label="Account address" style="flex:1;min-width:260px;padding:10px;border-radius:8px;border:1px solid var(--accent-tertiary);background:transparent;color:var(--text-primary)"/>
          <input id="aiStart" type="date" aria-label="Start date" style="padding:8px;border-radius:8px;border:1px solid var(--accent-tertiary);background:transparent;color:var(--text-primary)"/>
          <input id="aiEnd" type="date" aria-label="End date" style="padding:8px;border-radius:8px;border:1px solid var(--accent-tertiary);background:transparent;color:var(--text-primary)"/>
          <button id="aiFetch" class="nav-btn" style="padding:10px 14px;border-radius:8px;background:linear-gradient(135deg,#50fa7b,#2ecc71);border:none;color:#000;font-weight:700;">Build Snapshot</button>
          <button id="aiClear" class="nav-btn" style="padding:10px 14px;border-radius:8px;background:#ffb86c;border:none;color:#000;">Clear</button>
        </div>

        <div id="aiStatus" style="margin-bottom:12px;color:var(--text-secondary)">Ready</div>

        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px;">
          <div id="aiOverview" style="flex:1;min-width:280px"></div>
          <div id="aiVisuals" style="flex:1;min-width:280px"></div>
        </div>

        <div id="aiTxList" style="margin-bottom:12px;max-height:380px;overflow:auto;border-radius:8px;border:1px solid rgba(255,255,255,0.04);padding:10px;background:var(--card-bg);"></div>

        <div style="display:flex;gap:8px;margin-top:8px;">
          <button id="aiExport" class="nav-btn" style="display:none;padding:10px 14px;border-radius:8px;background:#50a8ff;border:none;color:#000;">Export Snapshot</button>
          <button id="aiVerify" class="nav-btn" style="padding:10px 14px;border-radius:8px;background:#ffd166;border:none;color:#000;">Verify Proof #0</button>
        </div>

        <div id="aiRaw" style="white-space:pre-wrap;margin-top:12px;font-size:12px;color:var(--text-secondary)"></div>
      </div>
    `;

    // Wire controls
    document.getElementById("aiFetch").addEventListener("click", onBuild);
    document.getElementById("aiClear").addEventListener("click", clearUI);
    document.getElementById("aiExport").addEventListener("click", exportSnapshot);
    document.getElementById("aiVerify").addEventListener("click", async () => {
      if (!currentSnapshot) { setStatus("No snapshot to verify"); return; }
      const ok = await verifyExample(0);
      setStatus(ok ? "Proof #0 verified OK" : "Proof #0 verification FAILED");
    });

    const addrInput = document.getElementById("aiAddress");
    addrInput.addEventListener("keypress", (e) => { if (e.key === "Enter") onBuild(); });
  }

  function setStatus(txt) { const el = document.getElementById("aiStatus"); if (el) el.textContent = txt; }
  function setOverview(html) { const el = document.getElementById("aiOverview"); if (el) el.innerHTML = html; }
  function setVisuals(html) { const el = document.getElementById("aiVisuals"); if (el) el.innerHTML = html; }
  function setTxList(html) { const el = document.getElementById("aiTxList"); if (el) el.innerHTML = html; }
  function setRaw(txt) { const el = document.getElementById("aiRaw"); if (el) el.innerText = txt; }
  function clearUI() { setStatus("Ready"); setOverview(""); setVisuals(""); setTxList(""); setRaw(""); currentSnapshot = null; document.getElementById("aiExport").style.display = "none"; }

  /* -------------------------
     Canonical JSON + Hash helpers
  ------------------------- */
  function canonicalize(obj) {
    if (obj === null || typeof obj !== "object") return obj;
    if (Array.isArray(obj)) return obj.map(canonicalize);
    const out = {};
    for (const k of Object.keys(obj).sort()) out[k] = canonicalize(obj[k]);
    return out;
  }

  async function hashUtf8Hex(text) {
    const enc = new TextEncoder();
    const data = enc.encode(text);
    const h = await crypto.subtle.digest("SHA-256", data);
    const a = Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, "0")).join("");
    return a;
  }

  /* -------------------------
     Merkle tree & proofs
  ------------------------- */
  async function buildMerkleTreeAsync(leafHexes) {
    if (!leafHexes || !leafHexes.length) return { root: null, layers: [] };
    let layer = leafHexes.slice();
    const layers = [layer.slice()]; // leaves at last index
    while (layer.length > 1) {
      const next = [];
      for (let i = 0; i < layer.length; i += 2) {
        const left = layer[i];
        const right = (i + 1 < layer.length) ? layer[i + 1] : layer[i];
        const combined = await hashUtf8Hex(left + right);
        next.push(combined);
      }
      layer = next;
      layers.unshift(layer.slice()); // root at layers[0]
    }
    return { root: layers[0][0], layers };
  }

  function getMerkleProof(layers, leafIndex) {
    const proof = [];
    let idx = leafIndex;
    for (let li = layers.length - 1; li > 0; li--) {
      const layer = layers[li];
      const isRight = idx % 2 === 1;
      const pair = isRight ? idx - 1 : idx + 1;
      const sibling = pair < layer.length ? layer[pair] : layer[idx];
      proof.push({ sibling, position: isRight ? "left" : "right" });
      idx = Math.floor(idx / 2);
    }
    return proof;
  }

  async function verifyMerkleProof(leafHex, proof, rootHex) {
    let hash = leafHex;
    for (const step of proof) {
      if (step.position === "left") hash = await hashUtf8Hex(step.sibling + hash);
      else hash = await hashUtf8Hex(hash + step.sibling);
    }
    return hash === rootHex;
  }

  /* -------------------------
     Network helpers
  ------------------------- */
  function waitForSharedXRPLConnection(timeoutMs = SHARED_WAIT_MS) {
    return new Promise((resolve) => {
      try {
        if (window.XRPL && window.XRPL.connected) return resolve(true);
        if (typeof window.requestXrpl === 'function') return resolve(true);
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

  /* -------------------------
     Fetch transactions (robust)
     Strategy:
       1) use shared connection (requestXrpl or XRPL.client)
       2) if DEPLOYED_PROXY configured -> proxy endpoint (supports /accounts/{addr}/transactions)
       3) xrpl.org v2 (follow markers)
       4) data.ripple.com (one page)
       5) xrpscan (one page)
  ------------------------- */
  async function fetchAccountTxs(address, startIso, endIso) {
    setStatus('Resolving data source...');
    const collected = [];

    // 1) Shared client (fast, preferred)
    const sharedReady = await waitForSharedXRPLConnection();
    if (sharedReady) {
      setStatus('Querying shared XRPL connection...');
      try {
        // requestXrpl wrapper (preferred)
        if (typeof window.requestXrpl === 'function') {
          let marker;
          for (let page = 0; page < MAX_FETCH_PAGES; page++) {
            const payload = { command: 'account_tx', account: address, limit: PAGE_LIMIT, ledger_index_min: -1, ledger_index_max: -1 };
            if (marker) payload.marker = marker;
            const res = await window.requestXrpl(payload, { timeoutMs: 10000 });
            const entries = res.transactions || res.results || res;
            if (Array.isArray(entries)) collected.push(...entries);
            if (!res.marker) break;
            marker = res.marker;
            if (collected.length >= MAX_TXS) break;
          }
          if (collected.length) return collected.slice(0, MAX_TXS);
        }

        // direct XRPL.client.request fallback
        if (window.XRPL && window.XRPL.client && typeof window.XRPL.client.request === 'function') {
          let marker;
          for (let page = 0; page < MAX_FETCH_PAGES; page++) {
            const resp = await window.XRPL.client.request({ command: 'account_tx', account: address, limit: PAGE_LIMIT, ledger_index_min: -1, ledger_index_max: -1, marker });
            const res = resp.result || resp;
            const entries = res.transactions || res;
            if (Array.isArray(entries)) collected.push(...entries);
            if (!res.marker) break;
            marker = res.marker;
            if (collected.length >= MAX_TXS) break;
          }
          if (collected.length) return collected.slice(0, MAX_TXS);
        }
      } catch (e) {
        console.warn('Shared client fetch failed', e && e.message ? e.message : e);
        // fall through to HTTP fallbacks
      }
    } else {
      setStatus('Shared XRPL connection not ready; falling back to HTTP APIs...');
    }

    // Helper to follow xrpl.org markers (full pagination)
    async function fetchFromXrplOrg() {
      let next = `${PUBLIC_TX_API}/${encodeURIComponent(address)}/transactions?limit=${PAGE_LIMIT}`;
      if (startIso) next += `&start=${encodeURIComponent(startIso)}`;
      if (endIso) next += `&end=${encodeURIComponent(endIso)}`;
      let pages = 0;
      while (pages++ < MAX_FETCH_PAGES) {
        setStatus(`xrpl.org page ${pages}...`);
        const j = await tryFetchUrl(next, 10000);
        if (!j) break;
        const arr = j.result || j.transactions || j.data || j;
        if (Array.isArray(arr)) collected.push(...arr);
        const marker = j.marker || j.result?.marker;
        if (!marker) break;
        next = `${PUBLIC_TX_API}/${encodeURIComponent(address)}/transactions?marker=${encodeURIComponent(marker)}&limit=${PAGE_LIMIT}`;
        if (collected.length >= MAX_TXS) break;
      }
      return collected;
    }

    // 2) DEPLOYED_PROXY
    if (DEPLOYED_PROXY && DEPLOYED_PROXY.startsWith('http')) {
      setStatus('Fetching via deployed proxy...');
      try {
        let proxyUrl = `${DEPLOYED_PROXY.replace(/\/+$/,'')}/accounts/${encodeURIComponent(address)}/transactions?limit=${PAGE_LIMIT}`;
        if (startIso) proxyUrl += `&start=${encodeURIComponent(startIso)}`;
        if (endIso) proxyUrl += `&end=${encodeURIComponent(endIso)}`;
        // Try first page only (proxy may implement pagination)
        const j = await tryFetchUrl(proxyUrl, 10000);
        if (j) {
          const arr = j.result || j.transactions || j.data || j;
          if (Array.isArray(arr) && arr.length) {
            collected.push(...arr);
            return collected.slice(0, MAX_TXS);
          }
        }
      } catch (e) { console.warn('Proxy fetch failed', e && e.message ? e.message : e); }
    }

    // 3) xrpl.org v2 (preferred public API)
    try {
      await fetchFromXrplOrg();
      if (collected.length) return collected.slice(0, MAX_TXS);
    } catch (e) { console.warn('xrpl.org fetch failed', e && e.message ? e.message : e); }

    // 4) data.ripple.com (one page)
    try {
      setStatus('Trying data.ripple.com...');
      let url = `https://data.ripple.com/v2/accounts/${encodeURIComponent(address)}/transactions?limit=${PAGE_LIMIT}`;
      if (startIso) url += `&start=${encodeURIComponent(startIso)}`;
      if (endIso) url += `&end=${encodeURIComponent(endIso)}`;
      const j = await tryFetchUrl(url, 9000);
      if (j && Array.isArray(j.transactions) && j.transactions.length) {
        collected.push(...j.transactions);
        return collected.slice(0, MAX_TXS);
      }
    } catch (e) { console.warn('data.ripple.com failed', e && e.message ? e.message : e); }

    // 5) xrpscan (fallback)
    try {
      setStatus('Trying xrpscan...');
      const url = `https://api.xrpscan.com/api/v1/accounts/${encodeURIComponent(address)}/transactions?limit=${PAGE_LIMIT}`;
      const j = await tryFetchUrl(url, 9000);
      if (j && Array.isArray(j.data) && j.data.length) {
        collected.push(...j.data);
        return collected.slice(0, MAX_TXS);
      }
    } catch (e) { console.warn('xrpscan failed', e && e.message ? e.message : e); }

    throw new Error('Failed to fetch transactions from any available source');
  }

  /* -------------------------
     Snapshot builder & UI integration
  ------------------------- */
  async function buildSnapshot(address, startIso, endIso) {
    setStatus('Gathering transactions...');
    clearUI();
    let raw;
    try {
      raw = await fetchAccountTxs(address, startIso, endIso);
    } catch (e) {
      setStatus('Error fetching transactions: ' + (e && e.message ? e.message : e));
      throw e;
    }

    if (!raw || !raw.length) {
      setStatus('No transactions returned for that range');
      return null;
    }

    // Normalize (unwrap common envelopes)
    const normalized = raw.map(r => r.tx || r.transaction || r);

    setStatus(`Hashing ${normalized.length} transactions...`);
    const leaves = [];
    for (let i = 0; i < normalized.length; i++) {
      const json = JSON.stringify(canonicalize(normalized[i]));
      const h = await hashUtf8Hex(json);
      leaves.push(h);
      if (i % 50 === 0) setStatus(`Hashed ${i}/${normalized.length}...`);
    }

    setStatus('Building Merkle tree...');
    const tree = await buildMerkleTreeAsync(leaves);

    currentSnapshot = {
      address, startIso, endIso, createdAt: new Date().toISOString(),
      txCount: normalized.length, root: tree.root, layers: tree.layers, leaves, txs: normalized
    };

    document.getElementById('aiExport').style.display = 'inline-block';
    setStatus('Snapshot ready • root: ' + currentSnapshot.root);
    renderSummary(currentSnapshot);
    return currentSnapshot;
  }

  function renderSummary(snap) {
    // Types and top counterparties
    const types = {};
    const parties = {};
    for (const t of snap.txs) {
      const ty = t.TransactionType || t.type || 'Unknown';
      types[ty] = (types[ty] || 0) + 1;
      const other = t.Destination || t.Account || t.destination || t.account;
      if (other) parties[other] = (parties[other] || 0) + 1;
    }

    const typesHtml = Object.entries(types).map(([k,v]) => `<div><strong>${k}</strong>: ${v}</div>`).join('');
    const topParties = Object.entries(parties).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([k,v]) => `<div style="font-size:13px">${k} (${v})</div>`).join('');

    setOverview(`
      <div style="padding:10px;background:rgba(255,255,255,0.02);border-radius:8px;">
        <div><strong>Address:</strong> ${escapeHtml(snap.address)}</div>
        <div><strong>Tx Count:</strong> ${snap.txCount}</div>
        <div style="margin-top:8px;"><strong>Types</strong>${typesHtml}</div>
      </div>
    `);

    setVisuals(`
      <div style="padding:10px;background:rgba(255,255,255,0.02);border-radius:8px;">
        <div style="margin-bottom:8px;"><strong>Top Counterparties</strong></div>
        ${topParties || '<div style="opacity:.7">None</div>'}
      </div>
    `);

    // tx list (compact)
    const txHtml = snap.txs.map((t,i) => {
      const hash = t.hash || t.tx?.hash || t.transaction?.hash || `#${i}`;
      const ledger = t.ledger_index || t.tx?.LedgerIndex || t.transaction?.ledger_index || '';
      const amt = t.Amount || t.delivered_amount || t.tx?.Amount || '';
      return `<div style="padding:8px;border-bottom:1px dashed rgba(255,255,255,0.03)"><div style="font-size:12px"><strong>${escapeHtml(String(hash))}</strong> ${ledger ? `<span style="opacity:.75">ledger ${escapeHtml(String(ledger))}</span>` : ''}</div><div style="font-size:12px;opacity:.85">${escapeHtml(String(amt))}</div></div>`;
    }).join('');
    setTxList(txHtml);
    setRaw(JSON.stringify({ root: snap.root, txCount: snap.txCount }, null, 2));
  }

  /* -------------------------
     UI handlers: build, export, verify
  ------------------------- */
  async function onBuild() {
    const addr = (document.getElementById('aiAddress') || {}).value?.trim();
    const start = (document.getElementById('aiStart') || {}).value || null;
    const end = (document.getElementById('aiEnd') || {}).value || null;
    if (!addr || !/^r[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(addr)) { setStatus('Please enter a valid XRP address'); return; }
    try {
      const s = start ? new Date(start).toISOString() : null;
      const e = end ? new Date(end).toISOString() : null;
      await buildSnapshot(addr, s, e);
    } catch (e) {
      console.error(e);
      setStatus('Snapshot failed: ' + (e && e.message ? e.message : e));
    }
  }

  async function exportSnapshot() {
    if (!currentSnapshot) { setStatus('No snapshot to export'); return; }
    setStatus('Preparing export...');
    const proofs = [];
    for (let i = 0; i < currentSnapshot.leaves.length; i++) proofs.push(getMerkleProof(currentSnapshot.layers, i));
    const out = {
      meta: { address: currentSnapshot.address, createdAt: currentSnapshot.createdAt, txCount: currentSnapshot.txCount },
      root: currentSnapshot.root,
      leaves: currentSnapshot.leaves,
      proofs,
      txs: currentSnapshot.txs
    };
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `naluxrp-snapshot-${currentSnapshot.address}-${Date.now()}.json`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    setStatus('Export complete');
  }

  async function verifyExample(index = 0) {
    if (!currentSnapshot) { setStatus('No snapshot'); return false; }
    const leaf = currentSnapshot.leaves[index];
    const proof = getMerkleProof(currentSnapshot.layers, index);
    const ok = await verifyMerkleProof(leaf, proof, currentSnapshot.root);
    setStatus(ok ? 'Proof OK' : 'Proof FAILED');
    return ok;
  }

  /* -------------------------
     Utilities
  ------------------------- */
  function escapeHtml(s) { if (s == null) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  /* -------------------------
     Initialize UI (called on load or when inspector route activated)
  ------------------------- */
  function initInspector() { renderInspectorPage(); setTimeout(()=>{ const el = document.getElementById('aiAddress'); if (el) el.focus(); },150); }

  // Expose API for ui.js PAGE_INIT_MAP
  window.initInspector = initInspector;
  window.AccountInspector = {
    getSnapshot: () => currentSnapshot,
    verifyProof: verifyMerkleProof
  };

  // Auto init when script loads (if inspector page is present and active, ui.js will call initInspector)
  console.log('🛡️ Account Inspector module ready');
})();
