/* =========================================
   NaluXrp — Account Inspector (Full Page)
   - Full-page route: 'inspector'
   - Renders into #inspector page section
   - Uses shared XRPL client or public API
   - Builds Merkle snapshots; export & verify proofs
   ========================================= */

(function () {
  // CONFIG
  const PUBLIC_TX_API = "https://api.xrpl.org/v2/accounts";
  const MAX_FETCH_PAGES = 200;
  const PAGE_LIMIT = 100;

  // Module state
  let currentSnapshot = null;

  // Ensure page element exists (this should be called when the app navigates to the inspector page)
  function ensureInspectorPage() {
    let page = document.getElementById("inspector");
    if (!page) {
      // Create page section if it doesn't exist
      page = document.createElement("section");
      page.id = "inspector";
      page.className = "page-section";
      // Insert into main container if present
      const root = document.getElementById("main") || document.body;
      root.appendChild(page);
    }
    return page;
  }

  // Render the full-page UI
  function renderInspectorPage() {
    const page = ensureInspectorPage();
    page.innerHTML = `
      <div class="chart-section" style="padding:20px;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap;">
          <h2 style="margin:0 8px 0 0">🔎 Account Inspector</h2>
          <small style="opacity:.8">Build Merkle snapshots of an account's transactions</small>
        </div>

        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:18px;">
          <input id="aiAddress" placeholder="r... address" style="flex:1;min-width:260px;padding:10px;border-radius:8px;border:1px solid var(--accent-tertiary);background:transparent;color:var(--text-primary)"/>
          <label style="display:flex;gap:8px;align-items:center;">
            <span style="font-size:13px;opacity:.9">Start</span>
            <input id="aiStart" type="date" style="padding:8px;border-radius:8px;border:1px solid var(--accent-tertiary);background:transparent;color:var(--text-primary)"/>
          </label>
          <label style="display:flex;gap:8px;align-items:center;">
            <span style="font-size:13px;opacity:.9">End</span>
            <input id="aiEnd" type="date" style="padding:8px;border-radius:8px;border:1px solid var(--accent-tertiary);background:transparent;color:var(--text-primary)"/>
          </label>
        </div>

        <div style="display:flex;gap:12px;margin-bottom:16px;">
          <button id="aiFetch" class="nav-btn" style="background:linear-gradient(135deg,#50fa7b,#2ecc71);border:none;color:#000;padding:10px 14px;border-radius:8px;font-weight:700;">Build Snapshot</button>
          <button id="aiClear" class="nav-btn" style="background:#ffb86c;border:none;color:#000;padding:10px 14px;border-radius:8px;">Clear</button>
          <button id="aiExport" class="nav-btn" style="display:none;background:#50a8ff;border:none;color:#000;padding:10px 14px;border-radius:8px;">Export Snapshot</button>
          <button id="aiVerify" class="nav-btn" style="background:#ffd166;border:none;color:#000;padding:10px 14px;border-radius:8px;">Verify Example Proof</button>
        </div>

        <div id="aiStatus" style="margin-bottom:12px;color:var(--text-secondary)"></div>

        <div id="aiStats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:18px;"></div>

        <div id="aiTxList" style="margin-bottom:18px;max-height:360px;overflow:auto;border-radius:8px;border:1px solid rgba(255,255,255,0.04);padding:10px;background:var(--card-bg);"></div>

        <div id="aiRaw" style="white-space:pre-wrap;font-size:12px;color:var(--text-secondary)"></div>
      </div>
    `;

    // Hook events
    document.getElementById("aiFetch").addEventListener("click", onBuild);
    document.getElementById("aiClear").addEventListener("click", clearUI);
    document.getElementById("aiExport").addEventListener("click", exportSnapshot);
    document.getElementById("aiVerify").addEventListener("click", async () => {
      if (!currentSnapshot) { setStatus("No snapshot to verify"); return; }
      const ok = await verifyExample(0);
      setStatus(ok ? "Proof verified OK" : "Proof verification FAILED");
    });

    const addrInput = document.getElementById("aiAddress");
    addrInput.addEventListener("keypress", (e) => { if (e.key === "Enter") onBuild(); });
  }

  // UI helpers
  function setStatus(msg) { const el = document.getElementById("aiStatus"); if (el) el.textContent = msg; }
  function setStats(html) { const el = document.getElementById("aiStats"); if (el) el.innerHTML = html; }
  function setTxList(html) { const el = document.getElementById("aiTxList"); if (el) el.innerHTML = html; }
  function setRaw(html) { const el = document.getElementById("aiRaw"); if (el) el.innerText = html; }
  function clearUI() { setStatus(""); setStats(""); setTxList(""); setRaw(""); currentSnapshot = null; document.getElementById("aiExport").style.display = "none"; }

  // Hashing & canonicalization
  function canonicalize(obj) {
    if (obj === null || typeof obj !== "object") return obj;
    if (Array.isArray(obj)) return obj.map(canonicalize);
    const keys = Object.keys(obj).sort();
    const out = {};
    for (const k of keys) out[k] = canonicalize(obj[k]);
    return out;
  }

  async function hashUtf8Hex(input) {
    const enc = new TextEncoder();
    const data = enc.encode(input);
    const hash = await crypto.subtle.digest("SHA-256", data);
    return bufferToHex(hash);
  }

  function bufferToHex(buf) { const b = new Uint8Array(buf); return Array.from(b).map(x => x.toString(16).padStart(2, "0")).join(""); }

  // Merkle helpers
  async function buildMerkleTreeAsync(leafHexes) {
    if (!leafHexes || !leafHexes.length) return { root: null, layers: [] };
    let layer = leafHexes.slice();
    const layers = [layer.slice()];
    while (layer.length > 1) {
      const next = [];
      for (let i = 0; i < layer.length; i += 2) {
        const left = layer[i];
        const right = (i + 1 < layer.length) ? layer[i + 1] : layer[i];
        const combinedHex = await hashUtf8Hex(left + right);
        next.push(combinedHex);
      }
      layer = next;
      layers.unshift(layer.slice());
    }
    return { root: layers[0][0], layers };
  }

  function getMerkleProof(layers, leafIndex) {
    const proof = [];
    let index = leafIndex;
    for (let li = layers.length - 1; li > 0; li--) {
      const layer = layers[li];
      const isRight = (index % 2) === 1;
      const pairIndex = isRight ? index - 1 : index + 1;
      const sibling = pairIndex < layer.length ? layer[pairIndex] : layer[index];
      proof.push({ sibling, position: isRight ? "left" : "right" });
      index = Math.floor(index / 2);
    }
    return proof;
  }

  async function verifyMerkleProof(leafHex, proof, rootHex) {
    let hash = leafHex;
    for (const step of proof) {
      if (step.position === "left") {
        hash = await hashUtf8Hex(step.sibling + hash);
      } else {
        hash = await hashUtf8Hex(hash + step.sibling);
      }
    }
    return hash === rootHex;
  }

  // Fetch transactions (shared client first)
  async function tryFetchUrl(url, timeoutMs = 8000) {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeoutMs);
      const resp = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
      clearTimeout(id);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.json();
    } catch (e) {
      console.warn("tryFetchUrl failed:", e && e.message ? e.message : e);
      return null;
    }
  }

  async function fetchAccountTxs(address, startIso, endIso) {
    setStatus("Fetching transactions...");
    const collected = [];

    // shared client
    try {
      if (typeof window.requestXrpl === "function") {
        let marker; let pages = 0;
        while (pages++ < MAX_FETCH_PAGES) {
          const payload = { command: "account_tx", account: address, limit: PAGE_LIMIT, ledger_index_min: -1, ledger_index_max: -1 };
          if (marker) payload.marker = marker;
          const res = await window.requestXrpl(payload, { timeoutMs: 10000 });
          const entries = res.transactions || res.results || res;
          if (Array.isArray(entries)) collected.push(...entries);
          if (!res.marker) break;
          marker = res.marker;
        }
        if (collected.length) return collected;
      }
      if (window.XRPL && window.XRPL.client && typeof window.XRPL.client.request === "function") {
        let marker; let pages = 0;
        while (pages++ < MAX_FETCH_PAGES) {
          const resp = await window.XRPL.client.request({ command: "account_tx", account: address, limit: PAGE_LIMIT, ledger_index_min: -1, ledger_index_max: -1, marker });
          const res = resp.result || resp;
          const entries = res.transactions || res;
          if (Array.isArray(entries)) collected.push(...entries);
          if (!res.marker) break;
          marker = res.marker;
        }
        if (collected.length) return collected;
      }
    } catch (e) {
      console.warn("Shared client fetch failed:", e && e.message ? e.message : e);
    }

    // public API fallback
    try {
      let nextUrl = `${PUBLIC_TX_API}/${encodeURIComponent(address)}/transactions?limit=${PAGE_LIMIT}`;
      if (startIso) nextUrl += `&start=${encodeURIComponent(startIso)}`;
      if (endIso) nextUrl += `&end=${encodeURIComponent(endIso)}`;
      let page = 0;
      while (page++ < MAX_FETCH_PAGES) {
        setStatus(`Fetching page ${page}...`);
        const j = await tryFetchUrl(nextUrl, 10000);
        if (!j) break;
        const arr = j.result || j.transactions || j.data || j;
        if (Array.isArray(arr)) collected.push(...arr);
        if (j.marker) nextUrl = `${PUBLIC_TX_API}/${encodeURIComponent(address)}/transactions?marker=${encodeURIComponent(j.marker)}&limit=${PAGE_LIMIT}`;
        else if (j.result?.marker) nextUrl = `${PUBLIC_TX_API}/${encodeURIComponent(address)}/transactions?marker=${encodeURIComponent(j.result.marker)}&limit=${PAGE_LIMIT}`;
        else break;
      }
      if (collected.length) return collected;
    } catch (e) {
      console.warn("Public API fetch failed:", e && e.message ? e.message : e);
    }

    throw new Error("Failed to fetch transactions from any source");
  }

  // Build snapshot workflow
  async function buildSnapshot(address, startIso, endIso) {
    setStatus("Gathering transactions...");
    clearUI();
    const raw = await fetchAccountTxs(address, startIso, endIso);
    if (!raw || !raw.length) { setStatus("No transactions found"); return null; }

    const normalized = raw.map(r => (r.tx || r.transaction || r));
    setStatus(`Hashing ${normalized.length} txs...`);
    const leaves = [];
    for (let i = 0; i < normalized.length; i++) {
      const h = await hashUtf8Hex(JSON.stringify(canonicalize(normalized[i])));
      leaves.push(h);
      if (i % 50 === 0) setStatus(`Hashed ${i}/${normalized.length}...`);
    }

    setStatus("Building Merkle tree...");
    const tree = await buildMerkleTreeAsync(leaves);

    currentSnapshot = {
      address, startIso, endIso, createdAt: new Date().toISOString(),
      txCount: normalized.length, root: tree.root, layers: tree.layers, leaves, txs: normalized
    };

    // update UI
    document.getElementById("aiExport").style.display = "inline-block";
    setStatus(`Snapshot ready • root: ${currentSnapshot.root}`);
    renderStatsAndList(currentSnapshot);

    return currentSnapshot;
  }

  function renderStatsAndList(snap) {
    const types = {};
    const parties = {};
    for (const t of snap.txs) {
      const ty = t.TransactionType || t.type || "Unknown";
      types[ty] = (types[ty] || 0) + 1;
      const other = t.Destination || t.Account || t.destination || t.account;
      if (other) parties[other] = (parties[other] || 0) + 1;
    }
    const typesHtml = Object.entries(types).map(([k, v]) => `<div><strong>${k}</strong>: ${v}</div>`).join("");
    const topParties = Object.entries(parties).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `<div>${k} (${v})</div>`).join("");
    setStats(`
      <div style="padding:12px;background:rgba(255,255,255,0.02);border-radius:8px;">
        <div><strong>Address:</strong> ${escapeHtml(snap.address)}</div>
        <div><strong>Tx Count:</strong> ${snap.txCount}</div>
        <div style="margin-top:8px;"><strong>Types</strong>${typesHtml}</div>
      </div>
      <div style="padding:12px;background:rgba(255,255,255,0.02);border-radius:8px;">
        <div><strong>Top Counterparties</strong></div>
        ${topParties}
      </div>
    `);

    // tx list (compact)
    const txHtml = snap.txs.map((t, i) => {
      const hash = t.hash || t.tx?.hash || t.transaction?.hash || `#${i}`;
      const ledger = t.ledger_index || t.tx?.LedgerIndex || t.transaction?.ledger_index || "";
      const amt = (t.Amount || t.delivered_amount || t.tx?.Amount) || "";
      return `<div style="padding:8px;border-bottom:1px dashed rgba(255,255,255,0.03);"><div style="font-size:12px"><strong>${escapeHtml(hash.toString())}</strong> ${ledger ? `<span style="opacity:.75">ledger ${escapeHtml(String(ledger))}</span>` : ""}</div><div style="font-size:12px;opacity:.85">${escapeHtml(String(amt))}</div></div>`;
    }).join("");
    setTxList(txHtml);
    setRaw(JSON.stringify({ root: snap.root, txCount: snap.txCount }, null, 2));
  }

  // UI actions
  async function onBuild() {
    const addr = (document.getElementById("aiAddress") || {}).value?.trim();
    const start = (document.getElementById("aiStart") || {}).value || null;
    const end = (document.getElementById("aiEnd") || {}).value || null;
    if (!addr || !/^r[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(addr)) { setStatus("Enter a valid XRP address"); return; }
    try {
      const s = start ? new Date(start).toISOString() : null;
      const e = end ? new Date(end).toISOString() : null;
      await buildSnapshot(addr, s, e);
    } catch (e) {
      setStatus("Error: " + (e && e.message ? e.message : String(e)));
      console.error(e);
    }
  }

  async function exportSnapshot() {
    if (!currentSnapshot) { setStatus("No snapshot to export"); return; }
    setStatus("Preparing export...");
    const proofs = [];
    for (let i = 0; i < currentSnapshot.leaves.length; i++) proofs.push(getMerkleProof(currentSnapshot.layers, i));
    const exportObj = { meta: { address: currentSnapshot.address, createdAt: currentSnapshot.createdAt, txCount: currentSnapshot.txCount }, root: currentSnapshot.root, leaves: currentSnapshot.leaves, proofs, txs: currentSnapshot.txs };
    const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `snapshot-${currentSnapshot.address}-${(new Date()).toISOString()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatus("Export complete");
  }

  async function verifyExample(index = 0) {
    if (!currentSnapshot) { setStatus("No snapshot"); return false; }
    const leaf = currentSnapshot.leaves[index];
    const proof = getMerkleProof(currentSnapshot.layers, index);
    const ok = await verifyMerkleProof(leaf, proof, currentSnapshot.root);
    setStatus(ok ? "Proof OK" : "Proof FAILED");
    return ok;
  }

  // Utilities
  function escapeHtml(str) { if (str == null) return ""; return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  // init function (called by UI when navigating to 'inspector' page)
  function initInspector() {
    renderInspectorPage();
    // focus input
    setTimeout(() => { const a = document.getElementById("aiAddress"); if (a) a.focus(); }, 100);
  }

  // expose API
  window.initInspector = initInspector;
  window.AccountInspector = {
    getSnapshot: () => currentSnapshot,
    verifyProof: verifyMerkleProof
  };

  console.log("🛡️ Account Inspector (full page) loaded");
})();
