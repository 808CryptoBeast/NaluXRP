/* =========================================
   NaluXrp — Account Inspector + Merkle Snapshot
   - Paste an XRP (r...) address and pick a date/ledger range
   - Fetch transactions (shared XRPL client preferred, public API fallback)
   - Build Merkle tree over ordered txs (canonical JSON -> SHA-256)
   - Export snapshot and inclusion proofs; verify proofs
   ========================================= */

(function () {
  // CONFIG
  const PUBLIC_TX_API = "https://api.xrpl.org/v2/accounts"; // /{address}/transactions?limit=...
  const MAX_FETCH_PAGES = 200; // safety cap
  const PAGE_LIMIT = 100; // per-request page size for API

  // Module-scoped state (single declaration)
  let currentSnapshot = null;

  /* -------------------------
     UI: inject minimal panel
  ------------------------- */
  function ensurePanel() {
    if (document.getElementById("accountInspector")) return;
    const container = document.createElement("div");
    container.id = "accountInspector";
    container.style.cssText = "position:fixed;right:12px;top:80px;width:360px;max-height:80vh;overflow:auto;z-index:9999;background:rgba(0,0,0,0.8);color:#fff;padding:12px;border-radius:10px;border:1px solid rgba(255,255,255,0.06);font-family:system-ui;font-size:13px";
    container.innerHTML = `
      <h3 style="margin:0 0 8px 0">Account Inspector</h3>
      <div style="display:flex;gap:8px;margin-bottom:8px;">
        <input id="aiAddress" placeholder="r... address" aria-label="Account address" style="flex:1;padding:6px;border-radius:6px;border:1px solid rgba(255,255,255,0.06);background:transparent;color:#fff"/>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:8px;">
        <input id="aiStart" type="date" aria-label="Start date" style="flex:1;padding:6px;border-radius:6px;border:1px solid rgba(255,255,255,0.06);background:transparent;color:#fff"/>
        <input id="aiEnd" type="date" aria-label="End date" style="flex:1;padding:6px;border-radius:6px;border:1px solid rgba(255,255,255,0.06);background:transparent;color:#fff"/>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:8px;">
        <button id="aiFetch" style="flex:1;padding:8px;border-radius:8px;border:none;background:#2ecc71;color:#000;font-weight:700;cursor:pointer">Build Snapshot</button>
        <button id="aiClear" style="padding:8px;border-radius:8px;border:none;background:#ffb86c;color:#000;cursor:pointer">Clear</button>
      </div>
      <div id="aiStatus" style="font-size:12px;opacity:0.9;margin-bottom:8px;">Ready</div>
      <div id="aiSummary" style="font-size:13px"></div>
      <div id="aiActions" style="margin-top:10px;display:flex;gap:8px;">
        <button id="aiExport" style="flex:1;padding:8px;border-radius:8px;border:none;background:#50fa7b;color:#000;cursor:pointer;display:none">Export Snapshot</button>
      </div>
      <div id="aiDetails" style="margin-top:10px;font-size:12px;opacity:0.95;white-space:pre-wrap;"></div>
    `;
    document.body.appendChild(container);

    document.getElementById("aiFetch").addEventListener("click", onBuild);
    document.getElementById("aiClear").addEventListener("click", clearPanel);
    document.getElementById("aiExport").addEventListener("click", exportSnapshot);

    // allow Enter on address to trigger build
    const addrInput = document.getElementById("aiAddress");
    if (addrInput) {
      addrInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") onBuild();
      });
    }
  }

  /* -------------------------
     UI helpers
  ------------------------- */
  function setStatus(msg) { const el = document.getElementById("aiStatus"); if (el) el.textContent = msg; }
  function setDetails(msg) { const el = document.getElementById("aiDetails"); if (el) el.textContent = msg; }
  function setSummary(html) { const el = document.getElementById("aiSummary"); if (el) el.innerHTML = html; }
  function showExportButton(show) { const b = document.getElementById("aiExport"); if (b) b.style.display = show ? "block" : "none"; }
  function clearPanel() { setStatus("Ready"); setSummary(""); setDetails(""); currentSnapshot = null; showExportButton(false); }

  /* -------------------------
     Canonicalization + Hashing
  ------------------------- */
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

  function bufferToHex(buf) {
    const b = new Uint8Array(buf);
    return Array.from(b).map(x => x.toString(16).padStart(2, "0")).join("");
  }

  /* -------------------------
     Merkle tree (async)
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
        const combinedHex = await hashUtf8Hex(left + right);
        next.push(combinedHex);
      }
      layer = next;
      layers.unshift(layer.slice()); // prepend, so root at layers[0]
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

  async function txToLeafHashHex(tx) {
    const canon = canonicalize(tx);
    const json = JSON.stringify(canon);
    return await hashUtf8Hex(json);
  }

  /* -------------------------
     Account transaction fetching
     (shared client preferred, then public API)
  ------------------------- */
  async function tryFetchUrl(url, timeoutMs = 8000) {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeoutMs);

      const resp = await fetch(url, { method: "GET", headers: { Accept: "application/json" }, signal: controller.signal });
      clearTimeout(id);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      return json;
    } catch (err) {
      console.warn("tryFetchUrl failed:", err && err.message ? err.message : err);
      return null;
    }
  }

  async function fetchAccountTxsInRange(address, startIso, endIso) {
    setStatus("Fetching transactions...");
    setDetails("");

    const allTxs = [];

    // (A) Try shared client first
    async function fetchViaSharedClient() {
      try {
        // prefer requestXrpl wrapper if present
        if (typeof window.requestXrpl === "function") {
          let marker = undefined;
          let pages = 0;
          while (pages++ < MAX_FETCH_PAGES) {
            const payload = { command: "account_tx", account: address, ledger_index_min: -1, ledger_index_max: -1, limit: PAGE_LIMIT };
            if (marker) payload.marker = marker;
            const res = await window.requestXrpl(payload, { timeoutMs: 10000 });
            const entries = res.transactions || res.results || res;
            if (Array.isArray(entries)) {
              allTxs.push(...entries);
            } else if (Array.isArray(res)) {
              allTxs.push(...res);
            }
            if (!res.marker) break;
            marker = res.marker;
          }
          return allTxs;
        }

        if (window.XRPL && window.XRPL.client && typeof window.XRPL.client.request === "function") {
          let marker = undefined;
          let pages = 0;
          while (pages++ < MAX_FETCH_PAGES) {
            const payload = { command: "account_tx", account: address, ledger_index_min: -1, ledger_index_max: -1, limit: PAGE_LIMIT };
            if (marker) payload.marker = marker;
            const resp = await window.XRPL.client.request(payload);
            const res = resp.result || resp;
            const entries = res.transactions || res;
            if (Array.isArray(entries)) allTxs.push(...entries);
            if (!res.marker) break;
            marker = res.marker;
          }
          return allTxs;
        }
      } catch (e) {
        console.warn("Shared client fetch failed:", e && e.message ? e.message : e);
        return null;
      }
      return null;
    }

    // (B) Public API fallback (xrpl.org)
    async function fetchViaPublicApi() {
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
          if (Array.isArray(arr)) allTxs.push(...arr);
          else if (Array.isArray(j.transactions)) allTxs.push(...j.transactions);
          else if (Array.isArray(j.result?.transactions)) allTxs.push(...j.result.transactions);

          // paging markers
          if (j.marker) {
            nextUrl = `${PUBLIC_TX_API}/${encodeURIComponent(address)}/transactions?marker=${encodeURIComponent(j.marker)}&limit=${PAGE_LIMIT}`;
          } else if (j.result?.marker) {
            nextUrl = `${PUBLIC_TX_API}/${encodeURIComponent(address)}/transactions?marker=${encodeURIComponent(j.result.marker)}&limit=${PAGE_LIMIT}`;
          } else {
            break;
          }
        }
        return allTxs;
      } catch (e) {
        console.warn("Public API fetch failed:", e && e.message ? e.message : e);
        return null;
      }
    }

    const shared = await fetchViaSharedClient();
    if (shared && shared.length) {
      setStatus(`Fetched ${shared.length} txs via shared client`);
      return shared;
    }
    const pub = await fetchViaPublicApi();
    if (pub && pub.length) {
      setStatus(`Fetched ${pub.length} txs via public API`);
      return pub;
    }

    throw new Error("No transaction sources available (shared client and public API failed)");
  }

  /* -------------------------
     Snapshot builder
  ------------------------- */
  async function buildSnapshot(address, startIso, endIso) {
    setStatus("Gathering transactions...");
    const rawTxs = await fetchAccountTxsInRange(address, startIso, endIso);
    if (!rawTxs || !rawTxs.length) {
      setStatus("No transactions found for that range");
      setDetails("");
      showExportButton(false);
      return null;
    }

    // Normalize tx objects (unwrap common envelope shapes)
    const normalized = rawTxs.map((r) => {
      if (r.tx) return r.tx;
      if (r.transaction) return r.transaction;
      return r;
    });

    setStatus(`Hashing ${normalized.length} transactions...`);
    const leaves = [];
    for (let i = 0; i < normalized.length; i++) {
      const t = canonicalize(normalized[i]);
      const json = JSON.stringify(t);
      const h = await hashUtf8Hex(json);
      leaves.push(h);
      if (i % 50 === 0) setStatus(`Hashed ${i}/${normalized.length}`);
    }

    setStatus("Building Merkle tree...");
    const tree = await buildMerkleTreeAsync(leaves);

    currentSnapshot = {
      address,
      startIso,
      endIso,
      createdAt: new Date().toISOString(),
      txCount: normalized.length,
      root: tree.root,
      layers: tree.layers,
      leaves,
      txs: normalized
    };

    setStatus(`Snapshot built • root: ${currentSnapshot.root}`);
    return currentSnapshot;
  }

  /* -------------------------
     UI handlers
  ------------------------- */
  async function onBuild() {
    ensurePanel();
    const addr = (document.getElementById("aiAddress") || {}).value?.trim();
    const start = (document.getElementById("aiStart") || {}).value || null;
    const end = (document.getElementById("aiEnd") || {}).value || null;
    if (!addr || !/^r[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(addr)) {
      setStatus("Enter a valid XRP address (r... )");
      return;
    }
    setStatus("Starting snapshot...");
    try {
      const s = start ? new Date(start).toISOString() : null;
      const e = end ? new Date(end).toISOString() : null;
      const snap = await buildSnapshot(addr, s, e);
      if (!snap) return;
      setSummary(`<strong>Address:</strong> ${escapeHtml(addr)}<br><strong>Txs:</strong> ${snap.txCount}<br><strong>Root:</strong> ${snap.root}`);
      setDetails(summarizeTxs(snap.txs));
      showExportButton(true);
    } catch (err) {
      setStatus("Error: " + (err && err.message ? err.message : String(err)));
      console.error(err);
    }
  }

  function summarizeTxs(txs) {
    const byType = {};
    const counter = {};
    for (const t of txs) {
      const type = t.TransactionType || t.type || "Unknown";
      byType[type] = (byType[type] || 0) + 1;
      const other = t.Destination || t.Account || t.destination || t.account;
      if (other) counter[other] = (counter[other] || 0) + 1;
    }
    const types = Object.entries(byType).map(([k, v]) => `${k}: ${v}`).join(", ");
    const topParties = Object.entries(counter).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}(${v})`).join(", ");
    return `Types: ${types}\nTop counterparts: ${topParties}`;
  }

  async function exportSnapshot() {
    if (!currentSnapshot) {
      setStatus("No snapshot to export");
      return;
    }
    setStatus("Building proofs...");
    const proofs = [];
    for (let i = 0; i < currentSnapshot.leaves.length; i++) {
      proofs.push(getMerkleProof(currentSnapshot.layers, i));
    }

    const exportObj = {
      meta: { address: currentSnapshot.address, startIso: currentSnapshot.startIso, endIso: currentSnapshot.endIso, createdAt: currentSnapshot.createdAt, txCount: currentSnapshot.txCount },
      root: currentSnapshot.root,
      leaves: currentSnapshot.leaves,
      proofs,
      txs: currentSnapshot.txs
    };

    const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `snapshot-${currentSnapshot.address}-${(new Date()).toISOString()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatus("Snapshot exported");
  }

  /* -------------------------
     Utility helpers
  ------------------------- */
  function escapeHtml(str) { if (str == null) return ""; return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  /* -------------------------
     Public API exposure
  ------------------------- */
  ensurePanel();

  window.AccountInspector = {
    buildSnapshot: async (addr, startIso, endIso) => {
      ensurePanel();
      return await buildSnapshot(addr, startIso, endIso);
    },
    getSnapshot: () => currentSnapshot,
    verifyProof: verifyMerkleProof,
    focus: () => { const el = document.getElementById("aiAddress"); if (el) { el.focus(); el.select(); } }
  };

  console.log("🛡️ Account Inspector module loaded");
})(); 
