/* =========================================
   NaluXrp — Account Inspector (Full Page, Forensics + Merkle + Issuer Tree)
   - Full-page inspector with filters, canonical leaf schema
   - Chunked Merkle snapshot (per-day / fixed-size)
   - Account summary: domain, logo (Clearbit), address, activated_by, initial balance
   - Issuer tree (ledger-only): first N outgoing txs per node (default 100), BFS depth + caps
   - Pathfinding: issuer -> target within time/ledger constraints
   - Pattern search: fan-out, reconsolidation, cycles, split payments, dominated routes
   - Per-tx details and inclusion proofs (leaf->chunk->top)
   - Uses shared XRPL client (preferred) and can reuse dashboard in-memory txs to avoid CORS/fallbacks
   ========================================= */

(function () {
  // -------- CONFIG --------
  const DEPLOYED_PROXY =
    typeof window !== "undefined" && window.NALU_DEPLOYED_PROXY ? window.NALU_DEPLOYED_PROXY : "";
  const PUBLIC_TX_API = "https://api.xrpl.org/v2/accounts";
  const PUBLIC_ACCT_API = "https://api.xrpl.org/v2/accounts";
  const MAX_FETCH_PAGES = 200;
  const PAGE_LIMIT = 100;
  const MAX_TXS_DEFAULT = 2000;
  const SHARED_WAIT_MS = 8000;
  const SCHEMA_VERSION = "1.1";

  // Issuer tree defaults
  const TREE_DEFAULT_PER_NODE = 100;
  const TREE_DEFAULT_DEPTH = 2;
  const TREE_DEFAULT_MAX_ACCOUNTS = 220;
  const TREE_DEFAULT_MAX_EDGES = 1200;

  // Pattern defaults
  const PATTERN_BURST_LEDGER_WINDOW = 200; // ledgers
  const PATTERN_BURST_TX_THRESHOLD = 30; // tx
  const PATTERN_RECONSOLIDATION_MIN_SENDERS = 5;
  const PATTERN_CYCLE_MAX_LEN = 4;

  // -------- STATE --------
  let snapshot = null;
  let building = false;

  let graphState = {
    builtAt: null,
    issuer: null,
    depth: TREE_DEFAULT_DEPTH,
    perNode: TREE_DEFAULT_PER_NODE,
    maxAccounts: TREE_DEFAULT_MAX_ACCOUNTS,
    maxEdges: TREE_DEFAULT_MAX_EDGES,
    constraints: {
      startDate: null,
      endDate: null,
      ledgerMin: null,
      ledgerMax: null,
      minXrp: 0
    },
    nodes: new Map(), // address -> node summary
    edges: [], // {from,to,ledger_index,date,type,amount,result,tx_hash,currency,issuer}
    adjacency: new Map() // from -> edgeIndexes[]
  };

  // -------- DOM helpers --------
  const $ = (id) => document.getElementById(id);

  function escapeHtml(s) {
    if (s == null) return "";
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // -------- UI render (full page) --------
  function ensurePage() {
    let page = $("inspector");
    if (!page) {
      page = document.createElement("section");
      page.id = "inspector";
      page.className = "page-section";
      const main =
        document.getElementById("main") ||
        document.getElementById("dashboard")?.parentElement ||
        document.body;
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
          <div style="opacity:.9">Ledger-only issuer tree • pattern search • Merkle proofs</div>
        </div>

        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
          <button id="aiTabSnapshot" class="nav-btn" style="padding:10px 14px;border-radius:10px;border:1px solid var(--accent-tertiary);background:rgba(255,255,255,0.04);">Snapshot / Merkle</button>
          <button id="aiTabTree" class="nav-btn" style="padding:10px 14px;border-radius:10px;border:1px solid var(--accent-tertiary);background:transparent;">Issuer Tree (Ledger-only)</button>
        </div>

        <div id="aiPanelSnapshot"></div>
        <div id="aiPanelTree" style="display:none;"></div>

        <div id="aiModalOverlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);align-items:center;justify-content:center;z-index:12000;">
          <div id="aiModal" style="width:min(900px,95%);max-height:80vh;overflow:auto;background:var(--bg-secondary);padding:14px;border-radius:10px;border:1px solid var(--accent-tertiary);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <strong id="aiModalTitle">Details</strong>
              <button id="aiModalClose">✕</button>
            </div>
            <pre id="aiModalBody" style="white-space:pre-wrap;font-size:13px;color:var(--text-primary);"></pre>
          </div>
        </div>
      </div>
    `;

    renderSnapshotPanel();
    renderTreePanel();

    $("aiModalClose").addEventListener("click", () => {
      $("aiModalOverlay").style.display = "none";
    });

    $("aiTabSnapshot").addEventListener("click", () => setTab("snapshot"));
    $("aiTabTree").addEventListener("click", () => setTab("tree"));

    setTab("snapshot");
  }

  function setTab(tab) {
    const snapBtn = $("aiTabSnapshot");
    const treeBtn = $("aiTabTree");
    const snapPanel = $("aiPanelSnapshot");
    const treePanel = $("aiPanelTree");
    if (!snapBtn || !treeBtn || !snapPanel || !treePanel) return;

    if (tab === "tree") {
      snapPanel.style.display = "none";
      treePanel.style.display = "block";
      treeBtn.style.background = "rgba(255,255,255,0.04)";
      snapBtn.style.background = "transparent";
    } else {
      snapPanel.style.display = "block";
      treePanel.style.display = "none";
      snapBtn.style.background = "rgba(255,255,255,0.04)";
      treeBtn.style.background = "transparent";
    }
  }

  function renderSnapshotPanel() {
    const mount = $("aiPanelSnapshot");
    mount.innerHTML = `
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
    `;

    $("aiFetch").addEventListener("click", onBuild);
    $("aiUseDashboard").addEventListener("click", handleUseDashboard);
    $("aiClear").addEventListener("click", () => {
      clearAll();
      setStatus("Ready");
    });
    $("aiExport").addEventListener("click", exportSnapshot);

    const addr = $("aiAddress");
    if (addr) addr.addEventListener("keypress", (e) => (e.key === "Enter" ? onBuild() : null));
  }

  function renderTreePanel() {
    const mount = $("aiPanelTree");
    mount.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 420px;gap:12px;align-items:start;margin-bottom:12px;">
        <div style="display:flex;flex-direction:column;gap:10px;">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <input id="itIssuer" placeholder="Issuer r... (root)" style="flex:1;min-width:280px;padding:10px;border-radius:8px;border:1px solid var(--accent-tertiary);background:transparent;color:var(--text-primary)"/>
            <button id="itGuessIssuer" class="nav-btn" style="padding:10px 12px;border-radius:8px;background:#ffd166;border:none;color:#000;">Guess from Snapshot</button>
          </div>

          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            <label style="font-size:13px;">Depth</label>
            <input id="itDepth" type="number" min="1" max="6" value="${TREE_DEFAULT_DEPTH}" style="width:70px;padding:8px;border-radius:8px;border:1px solid var(--accent-tertiary);"/>
            <label style="font-size:13px;">Per-node tx</label>
            <input id="itPerNode" type="number" min="10" max="500" value="${TREE_DEFAULT_PER_NODE}" style="width:90px;padding:8px;border-radius:8px;border:1px solid var(--accent-tertiary);"/>
            <label style="font-size:13px;">Max accounts</label>
            <input id="itMaxAccounts" type="number" min="20" max="2000" value="${TREE_DEFAULT_MAX_ACCOUNTS}" style="width:100px;padding:8px;border-radius:8px;border:1px solid var(--accent-tertiary);"/>
            <label style="font-size:13px;">Max edges</label>
            <input id="itMaxEdges" type="number" min="50" max="10000" value="${TREE_DEFAULT_MAX_EDGES}" style="width:100px;padding:8px;border-radius:8px;border:1px solid var(--accent-tertiary);"/>
          </div>

          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            <label style="font-size:13px;">Date</label>
            <input id="itStart" type="date" style="padding:8px;border-radius:8px;border:1px solid var(--accent-tertiary);"/>
            <input id="itEnd" type="date" style="padding:8px;border-radius:8px;border:1px solid var(--accent-tertiary);"/>
            <label style="font-size:13px;margin-left:8px;">Ledger</label>
            <input id="itLedgerMin" type="number" placeholder="min" style="width:110px;padding:8px;border-radius:8px;border:1px solid var(--accent-tertiary);"/>
            <input id="itLedgerMax" type="number" placeholder="max" style="width:110px;padding:8px;border-radius:8px;border:1px solid var(--accent-tertiary);"/>
            <input id="itMinXrp" type="number" placeholder="Min XRP" style="width:110px;padding:8px;border-radius:8px;border:1px solid var(--accent-tertiary);"/>
          </div>

          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button id="itBuild" class="nav-btn" style="padding:10px 14px;border-radius:8px;background:linear-gradient(135deg,#50fa7b,#2ecc71);border:none;color:#000;font-weight:700;">Build Issuer Tree</button>
            <button id="itClear" class="nav-btn" style="padding:10px 14px;border-radius:8px;background:#ffb86c;border:none;color:#000;">Clear</button>
            <button id="itExport" class="nav-btn" style="padding:10px 14px;border-radius:8px;background:#50a8ff;border:none;color:#000;">Export Graph</button>
          </div>

          <div id="itProgress" style="height:10px;background:rgba(255,255,255,0.04);border-radius:6px;overflow:hidden;display:none;">
            <div id="itProgressBar" style="height:100%;width:0%;background:linear-gradient(90deg,#50fa7b,#2ecc71)"></div>
          </div>
          <div id="itStatus" style="color:var(--text-secondary)">Ready</div>

          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:6px;">
            <input id="itTarget" placeholder="Target address for path (optional)" style="flex:1;min-width:280px;padding:10px;border-radius:8px;border:1px solid var(--accent-tertiary);background:transparent;color:var(--text-primary)"/>
            <button id="itFindPath" class="nav-btn" style="padding:10px 12px;border-radius:8px;background:#ffd1a9;border:none;color:#000;">Find Path</button>
          </div>

          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            <input id="itSearch" placeholder="Search edges (addr / hash / type / amount)..." style="flex:1;min-width:280px;padding:10px;border-radius:8px;border:1px solid var(--accent-tertiary);background:transparent;color:var(--text-primary)"/>
            <button id="itRunPatterns" class="nav-btn" style="padding:10px 12px;border-radius:8px;background:#bd93f9;border:none;color:#000;">Run Pattern Scan</button>
          </div>

          <div id="itTree" style="max-height:520px;overflow:auto;border-radius:8px;border:1px solid rgba(255,255,255,0.04);padding:10px;background:var(--card-bg);"></div>
        </div>

        <div style="display:flex;flex-direction:column;gap:10px;">
          <div id="itSummary" style="padding:10px;background:rgba(255,255,255,0.02);border-radius:8px;min-height:120px;">
            <div style="opacity:.8">Issuer tree summary will appear here.</div>
          </div>
          <div id="itResults" style="padding:10px;background:rgba(255,255,255,0.02);border-radius:8px;min-height:120px;">
            <div style="opacity:.8">Path + pattern results will appear here.</div>
          </div>
          <div id="itEdgeList" style="padding:10px;background:rgba(255,255,255,0.02);border-radius:8px;min-height:180px;max-height:340px;overflow:auto;">
            <div><strong>Edges</strong> <span style="opacity:.7">(filtered)</span></div>
            <div id="itEdgeItems" style="margin-top:8px;"></div>
          </div>
        </div>
      </div>
    `;

    $("itBuild").addEventListener("click", onBuildIssuerTree);
    $("itClear").addEventListener("click", clearIssuerTree);
    $("itExport").addEventListener("click", exportIssuerGraph);
    $("itFindPath").addEventListener("click", onFindPath);
    $("itRunPatterns").addEventListener("click", onRunPatterns);
    $("itSearch").addEventListener("input", renderEdgeFilter);
    $("itGuessIssuer").addEventListener("click", guessIssuerFromSnapshot);

    const issuer = $("itIssuer");
    if (issuer) issuer.addEventListener("keypress", (e) => (e.key === "Enter" ? onBuildIssuerTree() : null));
  }

  // -------- small helpers --------
  function setStatus(s) {
    const el = $("aiStatus");
    if (el) el.textContent = s;
  }
  function setProgress(p) {
    const wrap = $("aiProgress");
    const bar = $("aiProgressBar");
    if (!wrap || !bar) return;
    if (p < 0) {
      wrap.style.display = "none";
      bar.style.width = "0%";
    } else {
      wrap.style.display = "block";
      bar.style.width = `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`;
    }
  }
  function setSummaryHtml(html) {
    const el = $("aiSummary");
    if (el) el.innerHTML = html;
  }
  function setChunkInfoHtml(html) {
    const el = $("aiChunkInfo");
    if (el) el.innerHTML = html;
  }
  function setTxListHtml(html) {
    const el = $("aiTxList");
    if (el) el.innerHTML = html;
  }
  function setRaw(txt) {
    const el = $("aiRaw");
    if (el) el.innerText = txt;
  }

  function setTreeStatus(s) {
    const el = $("itStatus");
    if (el) el.textContent = s;
  }
  function setTreeProgress(p) {
    const wrap = $("itProgress");
    const bar = $("itProgressBar");
    if (!wrap || !bar) return;
    if (p < 0) {
      wrap.style.display = "none";
      bar.style.width = "0%";
    } else {
      wrap.style.display = "block";
      bar.style.width = `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`;
    }
  }

  // -------- canonicalize and hashing --------
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
    return Array.from(new Uint8Array(h))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  // -------- amount parsing --------
  function parseAmount(amount) {
    if (amount == null) return { value: 0, currency: "XRP", issuer: null, raw: amount };
    if (typeof amount === "string") {
      const v = Number(amount);
      return {
        value: Number.isFinite(v) ? v / 1_000_000 : 0,
        currency: "XRP",
        issuer: null,
        raw: amount
      };
    }
    if (typeof amount === "object" && amount.value != null) {
      const v = Number(amount.value);
      return {
        value: Number.isFinite(v) ? v : 0,
        currency: amount.currency || "XRP",
        issuer: amount.issuer || null,
        raw: amount
      };
    }
    if (typeof amount === "number") return { value: amount, currency: "XRP", issuer: null, raw: amount };
    return { value: 0, currency: "XRP", issuer: null, raw: amount };
  }

  function isValidXrpAddress(addr) {
    return /^r[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(String(addr || "").trim());
  }

  // -------- canonical leaf builder --------
  async function buildLeafForTx(tx, inspectedAccount) {
    const t = tx.tx || tx.transaction || tx;
    const txHash = String(t.hash || t.tx?.hash || t.transaction?.hash || "");
    const ledgerIndex = Number(t.ledger_index ?? t.LedgerIndex ?? t.tx?.LedgerIndex ?? t.transaction?.ledger_index ?? 0);

    const dtRaw = t.date || t.close_time || t.tx?.date || t.transaction?.date || null;
    const date = dtRaw ? safeToIso(dtRaw) : null;

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
    const rawAmount = t.Amount ?? t.delivered_amount ?? t.meta?.delivered_amount ?? null;
    const amount = parseAmount(rawAmount);
    const result = t.meta?.TransactionResult || t.engine_result || t.meta?.transaction_result || null;

    const leaf = {
      tx_hash: txHash,
      ledger_index: ledgerIndex,
      date,
      account: account || null,
      counterparty: dest || null,
      direction,
      type,
      amount: { value: amount.value, currency: amount.currency, issuer: amount.issuer },
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

  function safeToIso(x) {
    try {
      if (typeof x === "string") {
        const d = new Date(x);
        if (!Number.isNaN(d.getTime())) return d.toISOString();
      }
      if (typeof x === "number") {
        // XRPL "date" can be Ripple epoch seconds; also could be unix ms/sec from APIs.
        // Heuristic:
        // - if very large -> ms
        // - if in typical unix sec range -> sec
        // - else treat as Ripple epoch (seconds since 2000-01-01)
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

  // -------- Merkle helpers --------
  async function buildMerkleTreeAsync(leafHexes) {
    if (!leafHexes || !leafHexes.length) return { root: null, layers: [] };
    let layer = leafHexes.slice();
    const layers = [layer.slice()];
    while (layer.length > 1) {
      const next = [];
      for (let i = 0; i < layer.length; i += 2) {
        const left = layer[i];
        const right = i + 1 < layer.length ? layer[i + 1] : layer[i];
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
      const isRight = idx % 2 === 1;
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
      h =
        step.position === "left"
          ? await hashUtf8Hex(step.sibling + h)
          : await hashUtf8Hex(h + step.sibling);
    }
    return h === rootHex;
  }

  function getGlobalProof(chunks, topTree, globalIndex) {
    const chunkIdx = chunks.findIndex((c) => globalIndex >= c.startIndex && globalIndex <= c.endIndex);
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
        if ((window.XRPL && window.XRPL.connected) || typeof window.requestXrpl === "function") return resolve(true);
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
      } catch (e) {
        resolve(false);
      }
    });
  }

  async function tryFetchUrl(url, timeoutMs = 9000) {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeoutMs);
      const resp = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
      clearTimeout(id);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.json();
    } catch (err) {
      console.warn("tryFetchUrl failed", url, err && err.message ? err.message : err);
      return null;
    }
  }

  // ---- Account info ----
  function hexToAscii(hex) {
    try {
      if (!hex) return null;
      if (typeof hex !== "string") return String(hex);
      const clean = hex.replace(/^0x/i, "");
      let str = "";
      for (let i = 0; i < clean.length; i += 2) {
        const code = parseInt(clean.slice(i, i + 2), 16);
        if (!code) continue;
        str += String.fromCharCode(code);
      }
      return str || null;
    } catch (e) {
      return null;
    }
  }

  async function fetchAccountInfo(address) {
    try {
      if (typeof window.requestXrpl === "function") {
        const r = await window.requestXrpl({ command: "account_info", account: address }, { timeoutMs: 8000 });
        return r.result?.account_data || r.account_data || r || null;
      }
      if (window.XRPL && window.XRPL.client && typeof window.XRPL.client.request === "function") {
        const resp = await window.XRPL.client.request({ command: "account_info", account: address });
        return resp.result?.account_data || resp.account_data || resp || null;
      }
    } catch (e) {
      console.warn("shared account_info failed", e && e.message ? e.message : e);
    }

    try {
      const url = `${PUBLIC_ACCT_API}/${encodeURIComponent(address)}`;
      const j = await tryFetchUrl(url, 8000);
      return j?.result?.account || j?.account || j?.result || j || null;
    } catch (e) {
      console.warn("xrpl.org account fetch failed", e && e.message ? e.message : e);
    }
    return null;
  }

  // ---- account_tx (bulk, snapshot mode) ----
  async function fetchAccountTxs(address, startIso, endIso, maxTxsCap = MAX_TXS_DEFAULT) {
    setStatus("Resolving data source...");
    const collected = [];
    const sharedReady = await waitForSharedConn();

    if (sharedReady) {
      setStatus("Querying shared XRPL connection...");
      try {
        if (typeof window.requestXrpl === "function") {
          let marker;
          for (let p = 0; p < MAX_FETCH_PAGES; p++) {
            const payload = {
              command: "account_tx",
              account: address,
              limit: PAGE_LIMIT,
              ledger_index_min: -1,
              ledger_index_max: -1
            };
            if (marker) payload.marker = marker;

            const res = await window.requestXrpl(payload, { timeoutMs: 10000 });
            const entries = res?.result?.transactions || res?.transactions || res?.results || res;
            if (Array.isArray(entries)) collected.push(...entries);
            const m = res?.result?.marker || res?.marker;
            if (!m) break;
            marker = m;
            setProgress(collected.length / maxTxsCap);
            if (collected.length >= maxTxsCap) break;
          }
          if (collected.length) return collected.slice(0, maxTxsCap);
        }

        if (window.XRPL && window.XRPL.client && typeof window.XRPL.client.request === "function") {
          let marker;
          for (let p = 0; p < MAX_FETCH_PAGES; p++) {
            const resp = await window.XRPL.client.request({
              command: "account_tx",
              account: address,
              limit: PAGE_LIMIT,
              ledger_index_min: -1,
              ledger_index_max: -1,
              marker
            });
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
        console.warn("Shared client fetch failed", e && e.message ? e.message : e);
      }
    } else {
      setStatus("Shared XRPL connection not ready; using HTTP APIs...");
    }

    // Proxy
    if (DEPLOYED_PROXY && DEPLOYED_PROXY.startsWith("http")) {
      try {
        setStatus("Fetching via deployed proxy...");
        let url = `${DEPLOYED_PROXY.replace(/\/+$/, "")}/accounts/${encodeURIComponent(
          address
        )}/transactions?limit=${PAGE_LIMIT}`;
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
          url = `${DEPLOYED_PROXY.replace(/\/+$/, "")}/accounts/${encodeURIComponent(
            address
          )}/transactions?marker=${encodeURIComponent(marker)}&limit=${PAGE_LIMIT}`;
          setProgress(collected.length / maxTxsCap);
          if (collected.length >= maxTxsCap) break;
        }
        if (collected.length) return collected.slice(0, maxTxsCap);
      } catch (e) {
        console.warn("Proxy fetch failed", e && e.message ? e.message : e);
      }
    }

    // xrpl.org v2
    try {
      setStatus("Fetching from xrpl.org (public API)...");
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
        url = `${PUBLIC_TX_API}/${encodeURIComponent(address)}/transactions?marker=${encodeURIComponent(
          marker
        )}&limit=${PAGE_LIMIT}`;
        setProgress(collected.length / maxTxsCap);
        if (collected.length >= maxTxsCap) break;
      }
      if (collected.length) return collected.slice(0, maxTxsCap);
    } catch (e) {
      console.warn("xrpl.org failed", e && e.message ? e.message : e);
    }

    // data.ripple.com
    try {
      setStatus("Trying data.ripple.com...");
      let url = `https://data.ripple.com/v2/accounts/${encodeURIComponent(address)}/transactions?limit=${PAGE_LIMIT}`;
      if (startIso) url += `&start=${encodeURIComponent(startIso)}`;
      if (endIso) url += `&end=${encodeURIComponent(endIso)}`;
      const j = await tryFetchUrl(url, 9000);
      if (j && Array.isArray(j.transactions) && j.transactions.length) {
        collected.push(...j.transactions);
        return collected.slice(0, maxTxsCap);
      }
    } catch (e) {
      console.warn("data.ripple.com failed", e && e.message ? e.message : e);
    }

    // xrpscan
    try {
      setStatus("Trying xrpscan...");
      const url = `https://api.xrpscan.com/api/v1/accounts/${encodeURIComponent(address)}/transactions?limit=${PAGE_LIMIT}`;
      const j = await tryFetchUrl(url, 9000);
      if (j && Array.isArray(j.data) && j.data.length) {
        collected.push(...j.data);
        return collected.slice(0, maxTxsCap);
      }
    } catch (e) {
      console.warn("xrpscan failed", e && e.message ? e.message : e);
    }

    throw new Error("Failed to fetch transactions from any source");
  }

  // ---- account_tx (forward, issuer-tree mode) ----
  async function fetchAccountTxsForwardOldestFirst(address, maxTxsCap, opts) {
    const out = [];
    const sharedReady = await waitForSharedConn();

    const ledgerMin = opts?.ledgerMin ?? -1;
    const ledgerMax = opts?.ledgerMax ?? -1;

    const allowShared = sharedReady && (typeof window.requestXrpl === "function" || window.XRPL?.client?.request);
    if (allowShared) {
      try {
        let marker;
        for (let p = 0; p < MAX_FETCH_PAGES; p++) {
          const payload = {
            command: "account_tx",
            account: address,
            limit: PAGE_LIMIT,
            forward: true,
            ledger_index_min: ledgerMin === null || ledgerMin === undefined ? -1 : ledgerMin,
            ledger_index_max: ledgerMax === null || ledgerMax === undefined ? -1 : ledgerMax
          };
          if (marker) payload.marker = marker;

          const res =
            typeof window.requestXrpl === "function"
              ? await window.requestXrpl(payload, { timeoutMs: 12000 })
              : await window.XRPL.client.request(payload);

          const rr = res?.result || res;
          const entries = rr?.transactions || rr?.results || rr;
          if (Array.isArray(entries)) out.push(...entries);

          const m = rr?.marker || res?.marker;
          if (!m) break;
          marker = m;

          if (out.length >= maxTxsCap) break;
        }
      } catch (e) {
        console.warn("forward account_tx (shared) failed", e && e.message ? e.message : e);
      }
    }

    if (out.length) return normalizeAndSortTxs(out).slice(0, maxTxsCap);

    // HTTP fallbacks: no guarantee of ordering -> sort.
    const raw = await fetchAccountTxs(address, null, null, Math.min(MAX_TXS_DEFAULT, maxTxsCap));
    return normalizeAndSortTxs(raw).slice(0, maxTxsCap);
  }

  function normalizeAndSortTxs(arr) {
    const txs = (arr || [])
      .map((r) => r?.tx || r?.transaction || r)
      .filter(Boolean)
      .map((t) => ({
        ...t,
        ledger_index: Number(t.ledger_index ?? t.LedgerIndex ?? t.tx?.LedgerIndex ?? t.transaction?.ledger_index ?? 0),
        _iso: safeToIso(t.date || t.close_time || t.tx?.date || t.transaction?.date || null)
      }));

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
    if (constraints.ledgerMin != null && Number.isFinite(constraints.ledgerMin) && l < constraints.ledgerMin) return false;
    if (constraints.ledgerMax != null && Number.isFinite(constraints.ledgerMax) && l > constraints.ledgerMax) return false;

    const iso = tx._iso || safeToIso(tx.date || tx.close_time || null);
    if (constraints.startDate && iso && iso < constraints.startDate) return false;
    if (constraints.endDate && iso && iso > constraints.endDate) return false;

    const amt = parseAmount(tx.Amount ?? tx.delivered_amount ?? tx.meta?.delivered_amount ?? null);
    if (constraints.minXrp && amt.currency === "XRP" && amt.value < constraints.minXrp) return false;

    return true;
  }

  // -------- Chunked snapshot builder (leaves + chunks + topTree) --------
  async function buildChunkedSnapshot(txs, strategy, chunkSize, inspectedAccount) {
    setStatus("Canonicalizing & hashing leaves...");
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
    if (strategy === "per-day") {
      const map = new Map();
      for (let i = 0; i < leafJsons.length; i++) {
        const d = leafJsons[i].leaf.date ? leafJsons[i].leaf.date.slice(0, 10) : "unknown";
        if (!map.has(d)) map.set(d, []);
        map.get(d).push({ index: leafJsons[i].txIndex, hash: leaves[i] });
      }
      const keys = Array.from(map.keys()).sort((a, b) => b.localeCompare(a));
      let runningIndex = 0;
      for (const k of keys) {
        const arr = map.get(k);
        const hashes = arr.map((x) => x.hash);
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

    const chunkRoots = chunks.map((c) => c.root);
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
      const other = t.direction === "out" ? t.counterparty : t.account;
      if (other) counterparties[other] = (counterparties[other] || 0) + 1;
      if (t.amount && t.amount.currency !== "XRP") nonXrpCount++;
      totalAmt += (t.amount && t.amount.value) || 0;
    }

    const topCounterparty = Object.entries(counterparties).sort((a, b) => b[1] - a[1])[0] || [null, 0];
    const dominance = txLeafJsons.length ? topCounterparty[1] / txLeafJsons.length : 0;
    const fanOut = Object.keys(counterparties).length / Math.max(1, txLeafJsons.length) > 0.6 && txLeafJsons.length > 10;
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
    const incoming = txLeafJsons.filter((x) => x.leaf.type === "Payment" && x.leaf.counterparty === inspectedAddress);
    if (!incoming.length) return null;
    const earliest = incoming.reduce((a, b) =>
      (a.leaf.ledger_index || 1e12) < (b.leaf.ledger_index || 1e12) ? a : b
    );
    return { activatedBy: earliest.leaf.account, amount: earliest.leaf.amount, date: earliest.leaf.date };
  }

  function guessIssuerFromLeafJsons(leafJsons) {
    // Heuristic: most common "amount.issuer" across non-XRP payments,
    // else look for TrustSet LimitAmount.issuer in raw tx.
    const counts = new Map();
    for (const e of leafJsons || []) {
      const l = e.leaf;
      if (l?.amount?.currency && l.amount.currency !== "XRP" && l.amount.issuer) {
        counts.set(l.amount.issuer, (counts.get(l.amount.issuer) || 0) + 1);
      }
      const raw = e.raw || {};
      if (raw.TransactionType === "TrustSet") {
        const la = raw.LimitAmount || raw.limit_amount;
        if (la && la.issuer) counts.set(la.issuer, (counts.get(la.issuer) || 0) + 1);
      }
    }
    const best = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0];
    return best ? best[0] : null;
  }

  // -------- Account summary: domain decode + logo --------
  async function getAccountSummary(address, txLeafJsons) {
    let info = null;
    try {
      info = await fetchAccountInfo(address);
    } catch (e) {
      console.warn("account_info failed", e);
    }

    let domain = null;
    let balance = null;
    let sequence = null;
    let ownerCount = null;

    if (info) {
      domain =
        info.domain
          ? typeof info.domain === "string"
            ? info.domain
            : hexToAscii(info.domain)
          : hexToAscii(info.Domain) || null;

      const balVal = info.balance || info.Balance || info.account?.balance;
      if (balVal != null) {
        const asNum = Number(balVal);
        balance = Number.isFinite(asNum) ? (asNum > 10000 ? asNum / 1_000_000 : asNum) : String(balVal);
      } else if (info.account && info.account.xrp_balance) {
        balance = Number(info.account.xrp_balance);
      }

      sequence = info.Sequence || info.sequence || info.account?.sequence || null;
      ownerCount = info.OwnerCount || info.owner_count || info.account?.owner_count || null;
    }

    let logoUrl = null;
    if (domain) logoUrl = `https://logo.clearbit.com/${domain}`;

    const activation = findActivationInTxs(address, txLeafJsons);
    const analysis = analyzeSnapshotBasic(address, txLeafJsons);

    return { domain, logoUrl, balance, sequence, ownerCount, activation, analysis };
  }

  // -------- Use Dashboard Data integration --------
  function getTransactionsFromDashboard() {
    try {
      const xr = window.XRPL?.state?.recentTransactions;
      if (Array.isArray(xr) && xr.length) return xr.slice().reverse();

      if (
        window.NaluDashboard &&
        Array.isArray(window.NaluDashboard.recentTransactions) &&
        window.NaluDashboard.recentTransactions.length
      ) {
        return window.NaluDashboard.recentTransactions.slice().reverse();
      }

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

    const maxT = Number(($("aiMaxT") || {}).value || MAX_TXS_DEFAULT);
    const sliced = imported.slice(0, maxT);

    let addr = ($("aiAddress") || {}).value?.trim();
    if (!addr || !isValidXrpAddress(addr)) {
      const counts = {};
      for (const tx of sliced) {
        const t = tx.tx || tx.transaction || tx;
        const a = t.Account || t.account;
        if (a) counts[a] = (counts[a] || 0) + 1;
        const d = t.Destination || t.destination;
        if (d) counts[d] = (counts[d] || 0) + 1;
      }
      const most = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      if (most && most[0]) {
        addr = most[0];
        ($("aiAddress") || {}).value = addr;
        setStatus(`Guessed inspected address: ${addr}`);
      } else {
        setStatus("Unable to infer inspected address — paste an r... address into the input.");
        setProgress(-1);
        return;
      }
    }

    const types = Array.from(($("aiTypes") || {}).querySelectorAll("input[type=checkbox]:checked")).map(
      (i) => i.value
    );
    const dir = ($("aiDirection") || {}).value || "both";
    const minAmt = Number(($("aiMinAmt") || {}).value || 0);

    const filtered = [];
    for (const tRaw of sliced) {
      const t = tRaw.tx || tRaw.transaction || tRaw;
      if (!t) continue;

      const txType = t.TransactionType || t.type || "";
      if (types.length && !types.includes(txType)) continue;

      const acc = t.Account || t.account;
      const dst = t.Destination || t.destination;
      let direction = "other";
      if (acc && dst) {
        if (acc === addr && dst === addr) direction = "self";
        else if (acc === addr) direction = "out";
        else if (dst === addr) direction = "in";
      } else if (acc && acc === addr) direction = "out";
      else if (dst && dst === addr) direction = "in";

      if (dir !== "both" && direction !== dir) continue;

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
    const chunkMode = ($("aiChunkMode") || {}).value || "auto";
    const strategy = chunkMode === "auto" ? (($("aiStart")?.value && $("aiEnd")?.value) ? "per-day" : "fixed") : chunkMode;
    const chunkSize = Number(($("aiChunkSize") || {}).value || 500);

    const { leaves, leafJsons, chunks, topTree } = await buildChunkedSnapshot(filtered, strategy, chunkSize, addr);

    snapshot = {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      mode: strategy,
      chunkSize,
      address: addr,
      dateRange: { start: ($("aiStart") || {}).value || null, end: ($("aiEnd") || {}).value || null },
      txCount: filtered.length,
      leaves,
      leafJsons,
      chunks,
      topTree,
      txs: filtered
    };

    const summary = await getAccountSummary(addr, snapshot.leafJsons);
    renderSummaryUI(snapshot, summary);

    renderTxList(snapshot);
    $("aiExport").style.display = "inline-block";
    setStatus("Snapshot built from dashboard data");
    setProgress(-1);
  }

  // -------- Build and render snapshot flow (remote/shared) --------
  async function onBuild() {
    if (building) return;
    building = true;
    setStatus("Starting snapshot build...");
    setProgress(0);

    try {
      const addr = ($("aiAddress") || {}).value?.trim();
      if (!addr || !isValidXrpAddress(addr)) {
        setStatus("Enter a valid XRP address");
        setProgress(-1);
        return;
      }

      const start = ($("aiStart") || {}).value || null;
      const end = ($("aiEnd") || {}).value || null;
      const dir = ($("aiDirection") || {}).value || "both";
      const minAmt = Number(($("aiMinAmt") || {}).value || 0);
      const types = Array.from(($("aiTypes") || {}).querySelectorAll("input[type=checkbox]:checked")).map(
        (i) => i.value
      );
      const chunkMode = ($("aiChunkMode") || {}).value || "auto";
      const chunkSize = Number(($("aiChunkSize") || {}).value || 500);
      const maxT = Number(($("aiMaxT") || {}).value || MAX_TXS_DEFAULT);

      setStatus("Fetching transactions...");
      const raw = await fetchAccountTxs(addr, start, end, maxT);
      if (!raw || !raw.length) {
        setStatus("No transactions");
        setProgress(-1);
        return;
      }

      setStatus("Filtering transactions...");
      const filtered = [];
      for (const r of raw) {
        const t = r.tx || r.transaction || r;
        const txType = t.TransactionType || t.type || "";
        if (types.length && !types.includes(txType)) continue;

        const acc = t.Account || t.account;
        const dst = t.Destination || t.destination;
        let direction = "other";
        if (acc && dst) {
          if (acc === addr && dst === addr) direction = "self";
          else if (acc === addr) direction = "out";
          else if (dst === addr) direction = "in";
        } else if (acc && acc === addr) direction = "out";
        else if (dst && dst === addr) direction = "in";
        if (dir !== "both" && direction !== dir) continue;

        const rawAmount = t.Amount ?? t.delivered_amount ?? null;
        const amt = parseAmount(rawAmount).value || 0;
        if (minAmt > 0 && amt < minAmt) continue;

        filtered.push(t);
        if (filtered.length >= maxT) break;
      }

      setStatus(`Canonicalizing ${filtered.length} txs and building Merkle chunks...`);
      const strategy = chunkMode === "auto" ? (start && end ? "per-day" : "fixed") : chunkMode;
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

      const summary = await getAccountSummary(addr, snapshot.leafJsons);
      renderSummaryUI(snapshot, summary);

      renderTxList(snapshot);
      $("aiExport").style.display = "inline-block";
      setStatus("Snapshot built");
      setProgress(-1);
    } catch (err) {
      console.error(err);
      setStatus("Build failed: " + (err && err.message ? err.message : String(err)));
      setProgress(-1);
    } finally {
      building = false;
    }
  }

  function renderTxList(snap) {
    const txHtml = snap.leafJsons
      .map((l, idx) => {
        const h = snap.leaves[idx];
        const short = h.slice(0, 10) + "…" + h.slice(-6);
        return `<div style="padding:8px;border-bottom:1px dashed rgba(255,255,255,0.04);display:flex;justify-content:space-between;align-items:center;">
          <div style="font-size:13px;">
            <div><strong>#${idx}</strong> <code style="font-family:monospace;">${short}</code></div>
            <div style="font-size:12px;opacity:.8;">${escapeHtml(String(l.leaf.type || ""))} • ${escapeHtml(
          String(l.leaf.date || "")
        )}</div>
          </div>
          <div style="display:flex;gap:8px;">
            <button data-idx="${idx}" class="ai-btn-show" style="padding:6px 8px;border-radius:6px;border:1px solid var(--accent-tertiary);background:transparent;cursor:pointer;">Details</button>
            <button data-idx="${idx}" class="ai-btn-proof" style="padding:6px 8px;border-radius:6px;border:none;background:linear-gradient(135deg,#ffd166,#ffb86c);cursor:pointer;">Proof</button>
          </div>
        </div>`;
      })
      .join("");

    setTxListHtml(txHtml);
    setRaw(
      JSON.stringify(
        { topRoot: snap.topTree.root, chunks: snap.chunks.map((c) => ({ start: c.startIndex, end: c.endIndex, root: c.root })) },
        null,
        2
      )
    );

    Array.from(document.querySelectorAll(".ai-btn-show")).forEach((btn) =>
      btn.addEventListener("click", () => showTxDetails(Number(btn.getAttribute("data-idx"))))
    );
    Array.from(document.querySelectorAll(".ai-btn-proof")).forEach((btn) =>
      btn.addEventListener("click", async () => showProofForIndex(Number(btn.getAttribute("data-idx"))))
    );
  }

  // -------- render summary UI --------
  function renderSummaryUI(snap, summary) {
    const domain = summary.domain || "—";
    const logoUrl = summary.logoUrl;
    const balance = summary.balance != null ? `${summary.balance} XRP` : "—";
    const ownerCount = summary.ownerCount ?? "—";
    const seq = summary.sequence ?? "—";
    const activated = summary.activation
      ? `${summary.activation.activatedBy} • ${
          summary.activation.amount && summary.activation.amount.value
            ? summary.activation.amount.value + " " + (summary.activation.amount.currency || "XRP")
            : "—"
        } • ${summary.activation.date || "—"}`
      : "Not found in snapshot (expand range)";

    const { typeCounts, topCounterparty, flags } = summary.analysis;

    const typesHtml = Object.entries(typeCounts || {})
      .map(([k, v]) => `<div style="font-size:13px">${escapeHtml(k)}: ${escapeHtml(v)}</div>`)
      .join("");
    const counterpartyHtml = topCounterparty.address
      ? `<div style="font-size:13px">${escapeHtml(topCounterparty.address)} (${Math.round(topCounterparty.dominance * 100)}%)</div>`
      : '<div style="opacity:.7">None</div>';

    const flagList = [];
    if (flags.fanOut) flagList.push("Fan-out pattern");
    if (flags.dominatedBySingle) flagList.push("Dominated by single counterparty");
    if (flags.likelyIssuer) flagList.push("Likely issuing address (non-XRP txs observed)");

    const html = `
      <div style="display:flex;gap:12px;align-items:center;">
        <div style="width:68px;height:68px;border-radius:8px;background:rgba(255,255,255,0.03);display:flex;align-items:center;justify-content:center;">
          ${
            logoUrl
              ? `<img src="${escapeHtml(logoUrl)}" alt="logo" style="max-width:64px;max-height:64px;border-radius:6px"/>`
              : `<div style="opacity:.6">No logo</div>`
          }
        </div>
        <div>
          <div><strong>Address</strong>: ${escapeHtml(snap.address)}</div>
          <div><strong>Domain</strong>: ${escapeHtml(domain)}</div>
          <div><strong>Balance</strong>: ${escapeHtml(balance)} • Seq: ${escapeHtml(String(seq))} • Owners: ${escapeHtml(
      String(ownerCount)
    )}</div>
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
          <div>${
            flagList.length
              ? flagList.map((f) => `<div style="font-size:13px">${escapeHtml(f)}</div>`).join("")
              : '<div style="opacity:.7">None</div>'
          }</div>
        </div>
      </div>

      <div style="margin-top:10px;padding:8px;border-radius:8px;background:rgba(255,255,255,0.01)">
        <div><strong>Merkle</strong></div>
        <div>Top root: <code style="font-family:monospace;">${escapeHtml(snap.topTree.root)}</code></div>
        <div>Chunks: ${escapeHtml(snap.chunks.length)} • Leaves: ${escapeHtml(snap.leaves.length)}</div>
      </div>
    `;
    setSummaryHtml(html);

    const chunkInfoHtml = snap.chunks
      .map((c, idx) => {
        const key = c.key ? `date:${c.key}` : `chunk:${idx}`;
        return `<div style="padding:8px;border-bottom:1px dashed rgba(255,255,255,0.04)"><strong>${escapeHtml(
          key
        )}</strong> • ${escapeHtml(c.count)} txs • root: <code>${escapeHtml(c.root.slice(0, 12))}…</code></div>`;
      })
      .join("");
    setChunkInfoHtml(`<div style="max-height:240px;overflow:auto;">${chunkInfoHtml}</div>`);
  }

  // -------- Details / proof modal --------
  function showTxDetails(idx) {
    if (!snapshot) return;
    const info = snapshot.leafJsons[idx];
    $("aiModalTitle").textContent = `Tx #${idx} details`;
    $("aiModalBody").textContent = JSON.stringify(
      { canonicalLeaf: info.leaf, canonicalJson: info.json, rawTx: info.raw },
      null,
      2
    );
    $("aiModalOverlay").style.display = "flex";
  }

  async function showProofForIndex(idx) {
    if (!snapshot) return;
    const leafHex = snapshot.leaves[idx];
    const proof = getGlobalProof(snapshot.chunks, snapshot.topTree, idx);
    if (!proof) {
      $("aiModalTitle").textContent = "Proof";
      $("aiModalBody").textContent = "No proof available";
      $("aiModalOverlay").style.display = "flex";
      return;
    }
    const proofObj = {
      proofToChunk: proof.proofToChunk,
      proofChunkToTop: proof.proofChunkToTop,
      chunkRoot: snapshot.chunks[proof.chunkIndex].root,
      topRoot: snapshot.topTree.root
    };
    const verified = await verifyGlobalProof(leafHex, proofObj);
    $("aiModalTitle").textContent = `Proof #${idx} • verified: ${verified ? "OK" : "FAIL"}`;
    $("aiModalBody").textContent = JSON.stringify({ index: idx, leafHash: leafHex, proofObj, verified }, null, 2);
    $("aiModalOverlay").style.display = "flex";
  }

  // -------- export snapshot --------
  function exportSnapshot() {
    if (!snapshot) {
      setStatus("No snapshot");
      return;
    }
    setStatus("Exporting snapshot...");
    const exportObj = {
      schemaVersion: snapshot.schemaVersion,
      generatedAt: snapshot.generatedAt,
      address: snapshot.address,
      dateRange: snapshot.dateRange,
      txCount: snapshot.txCount,
      mode: snapshot.mode,
      chunkSize: snapshot.chunkSize,
      topRoot: snapshot.topTree.root,
      chunks: snapshot.chunks.map((c) => ({
        startIndex: c.startIndex,
        endIndex: c.endIndex,
        count: c.count,
        root: c.root,
        leafHashes: c.leafHashes
      })),
      leaves: snapshot.leaves,
      txs: snapshot.txs
    };
    downloadJson(exportObj, `naluxrp-snapshot-${snapshot.address}-${Date.now()}.json`);
    setStatus("Export complete");
  }

  function downloadJson(obj, filename) {
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

  // -------- clear snapshot --------
  function clearAll() {
    snapshot = null;
    setSummaryHtml('<div style="opacity:.8">Account summary will appear here after snapshot.</div>');
    setChunkInfoHtml("<div><strong>Chunks:</strong> —</div>");
    setTxListHtml("");
    setRaw("");
    setStatus("Ready");
    setProgress(-1);
    const exp = $("aiExport");
    if (exp) exp.style.display = "none";
  }

  // =========================
  // Issuer Tree (Ledger-only)
  // =========================

  function clearIssuerTree() {
    graphState = {
      builtAt: null,
      issuer: null,
      depth: TREE_DEFAULT_DEPTH,
      perNode: TREE_DEFAULT_PER_NODE,
      maxAccounts: TREE_DEFAULT_MAX_ACCOUNTS,
      maxEdges: TREE_DEFAULT_MAX_EDGES,
      constraints: { startDate: null, endDate: null, ledgerMin: null, ledgerMax: null, minXrp: 0 },
      nodes: new Map(),
      edges: [],
      adjacency: new Map()
    };
    setTreeStatus("Ready");
    setTreeProgress(-1);
    const t = $("itTree");
    if (t) t.innerHTML = "";
    const s = $("itSummary");
    if (s) s.innerHTML = `<div style="opacity:.8">Issuer tree summary will appear here.</div>`;
    const r = $("itResults");
    if (r) r.innerHTML = `<div style="opacity:.8">Path + pattern results will appear here.</div>`;
    const items = $("itEdgeItems");
    if (items) items.innerHTML = "";
  }

  function guessIssuerFromSnapshot() {
    if (!snapshot?.leafJsons?.length) {
      setTreeStatus("No snapshot available to guess from. Build a snapshot first (optional).");
      return;
    }
    const guessed = guessIssuerFromLeafJsons(snapshot.leafJsons);
    if (!guessed) {
      setTreeStatus("Could not guess an issuer from snapshot.");
      return;
    }
    $("itIssuer").value = guessed;
    setTreeStatus(`Guessed issuer: ${guessed}`);
  }

  async function onBuildIssuerTree() {
    const issuer = ($("itIssuer") || {}).value?.trim();
    if (!isValidXrpAddress(issuer)) {
      setTreeStatus("Enter a valid issuer r... address");
      return;
    }

    const depth = clampInt(Number(($("itDepth") || {}).value || TREE_DEFAULT_DEPTH), 1, 6);
    const perNode = clampInt(Number(($("itPerNode") || {}).value || TREE_DEFAULT_PER_NODE), 10, 500);
    const maxAccounts = clampInt(Number(($("itMaxAccounts") || {}).value || TREE_DEFAULT_MAX_ACCOUNTS), 20, 2000);
    const maxEdges = clampInt(Number(($("itMaxEdges") || {}).value || TREE_DEFAULT_MAX_EDGES), 50, 10000);

    const startDate = ($("itStart") || {}).value ? new Date(($("itStart") || {}).value).toISOString() : null;
    const endDate = ($("itEnd") || {}).value ? new Date(($("itEnd") || {}).value).toISOString() : null;

    const ledgerMin = parseNullableInt(($("itLedgerMin") || {}).value);
    const ledgerMax = parseNullableInt(($("itLedgerMax") || {}).value);

    const minXrp = Number(($("itMinXrp") || {}).value || 0);

    clearIssuerTree();
    graphState.issuer = issuer;
    graphState.depth = depth;
    graphState.perNode = perNode;
    graphState.maxAccounts = maxAccounts;
    graphState.maxEdges = maxEdges;
    graphState.constraints = { startDate, endDate, ledgerMin, ledgerMax, minXrp };

    setTreeStatus("Building issuer tree (ledger-only)...");
    setTreeProgress(0);

    try {
      await buildIssuerTreeBfs();
      graphState.builtAt = new Date().toISOString();
      renderIssuerTree();
      renderIssuerSummary();
      renderEdgeFilter();
      setTreeStatus(`Tree built: ${graphState.nodes.size} accounts, ${graphState.edges.length} edges`);
      setTreeProgress(-1);
    } catch (e) {
      console.error(e);
      setTreeStatus("Tree build failed: " + (e?.message ? e.message : String(e)));
      setTreeProgress(-1);
    }
  }

  function clampInt(n, min, max) {
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, Math.floor(n)));
  }

  function parseNullableInt(v) {
    const s = String(v || "").trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  async function buildIssuerTreeBfs() {
    const issuer = graphState.issuer;
    const q = [{ addr: issuer, level: 0 }];
    const seen = new Set([issuer]);

    ensureNode(issuer, 0);

    let processed = 0;
    while (q.length) {
      const { addr, level } = q.shift();
      processed += 1;

      setTreeStatus(`Fetching node ${processed} • ${addr.slice(0, 6)}… (lvl ${level}/${graphState.depth})`);
      setTreeProgress(processed / Math.max(1, Math.min(graphState.maxAccounts, processed + q.length)));

      if (level >= graphState.depth) continue;
      if (graphState.nodes.size >= graphState.maxAccounts) break;
      if (graphState.edges.length >= graphState.maxEdges) break;

      const txs = await fetchAccountTxsForwardOldestFirst(addr, Math.max(graphState.perNode * 3, graphState.perNode + 50), {
        ledgerMin: graphState.constraints.ledgerMin ?? -1,
        ledgerMax: graphState.constraints.ledgerMax ?? -1
      });

      // first N outgoing from this node, within constraints, Payment only by default
      const outgoing = [];
      for (const t of txs) {
        const type = t.TransactionType || t.type || "Unknown";
        if (type !== "Payment") continue;

        const from = t.Account || t.account;
        const to = t.Destination || t.destination;
        if (!from || !to) continue;
        if (from !== addr) continue;

        t._iso = t._iso || safeToIso(t.date || t.close_time || null);
        if (!withinConstraints(t, graphState.constraints)) continue;

        const amt = parseAmount(t.Amount ?? t.delivered_amount ?? t.meta?.delivered_amount ?? null);
        if (graphState.constraints.minXrp && amt.currency === "XRP" && amt.value < graphState.constraints.minXrp) continue;

        outgoing.push({ t, amt });
        if (outgoing.length >= graphState.perNode) break;
      }

      // add edges
      for (const { t, amt } of outgoing) {
        if (graphState.edges.length >= graphState.maxEdges) break;

        const from = t.Account || t.account;
        const to = t.Destination || t.destination;
        const edge = {
          from,
          to,
          ledger_index: Number(t.ledger_index || 0),
          date: t._iso || null,
          type: t.TransactionType || t.type || "Payment",
          amount: amt.value,
          currency: amt.currency,
          issuer: amt.issuer || null,
          result: t.meta?.TransactionResult || t.engine_result || t.meta?.transaction_result || null,
          tx_hash: String(t.hash || "")
        };

        addEdge(edge);
        bumpNodeStats(from, "out", edge);
        bumpNodeStats(to, "in", edge);

        if (!seen.has(to) && graphState.nodes.size < graphState.maxAccounts) {
          seen.add(to);
          ensureNode(to, level + 1);
          q.push({ addr: to, level: level + 1 });
        }
      }
    }
  }

  function ensureNode(addr, level) {
    if (!graphState.nodes.has(addr)) {
      graphState.nodes.set(addr, {
        address: addr,
        level,
        outCount: 0,
        inCount: 0,
        outXrp: 0,
        inXrp: 0,
        firstLedger: null,
        lastLedger: null,
        firstDate: null,
        lastDate: null,
        parents: new Set(),
        children: new Set()
      });
    } else {
      const n = graphState.nodes.get(addr);
      n.level = Math.min(n.level, level);
    }
  }

  function bumpNodeStats(addr, dir, edge) {
    ensureNode(addr, graphState.nodes.get(addr)?.level ?? 99);
    const n = graphState.nodes.get(addr);
    const led = Number(edge.ledger_index || 0);
    if (n.firstLedger == null || led < n.firstLedger) n.firstLedger = led;
    if (n.lastLedger == null || led > n.lastLedger) n.lastLedger = led;

    if (edge.date) {
      if (!n.firstDate || edge.date < n.firstDate) n.firstDate = edge.date;
      if (!n.lastDate || edge.date > n.lastDate) n.lastDate = edge.date;
    }

    if (dir === "out") {
      n.outCount += 1;
      if (edge.currency === "XRP") n.outXrp += Number(edge.amount || 0);
    } else {
      n.inCount += 1;
      if (edge.currency === "XRP") n.inXrp += Number(edge.amount || 0);
    }
  }

  function addEdge(edge) {
    const idx = graphState.edges.length;
    graphState.edges.push(edge);

    if (!graphState.adjacency.has(edge.from)) graphState.adjacency.set(edge.from, []);
    graphState.adjacency.get(edge.from).push(idx);

    ensureNode(edge.from, graphState.nodes.get(edge.from)?.level ?? 99);
    ensureNode(edge.to, graphState.nodes.get(edge.to)?.level ?? 99);

    graphState.nodes.get(edge.from).children.add(edge.to);
    graphState.nodes.get(edge.to).parents.add(edge.from);
  }

  function renderIssuerSummary() {
    const sum = $("itSummary");
    if (!sum) return;

    const issuer = graphState.issuer;
    const edges = graphState.edges.length;
    const accounts = graphState.nodes.size;

    const outEdges = graphState.edges.filter((e) => e.from === issuer);
    const uniqueFirstHop = new Set(outEdges.map((e) => e.to)).size;

    // dominance: top first-hop recipient share
    const c = new Map();
    for (const e of outEdges) c.set(e.to, (c.get(e.to) || 0) + 1);
    const top = Array.from(c.entries()).sort((a, b) => b[1] - a[1])[0] || [null, 0];
    const dom = outEdges.length ? top[1] / outEdges.length : 0;

    sum.innerHTML = `
      <div><strong>Issuer</strong>: <code>${escapeHtml(issuer)}</code></div>
      <div style="margin-top:6px;">Accounts: <strong>${escapeHtml(accounts)}</strong> • Edges: <strong>${escapeHtml(
      edges
    )}</strong></div>
      <div style="margin-top:6px;">First-hop unique recipients: <strong>${escapeHtml(uniqueFirstHop)}</strong></div>
      <div style="margin-top:6px;">First-hop dominance: <strong>${escapeHtml(Math.round(dom * 100))}%</strong> ${
        top[0] ? `(<code>${escapeHtml(top[0])}</code>)` : ""
      }</div>
      <div style="margin-top:6px;opacity:.8;font-size:12px;">Constraints: date=${escapeHtml(
        graphState.constraints.startDate || "—"
      )}..${escapeHtml(graphState.constraints.endDate || "—")} • ledger=${escapeHtml(
      graphState.constraints.ledgerMin ?? "—"
    )}..${escapeHtml(graphState.constraints.ledgerMax ?? "—")} • minXRP=${escapeHtml(
      graphState.constraints.minXrp || 0
    )}</div>
    `;
  }

  function renderIssuerTree() {
    const host = $("itTree");
    if (!host) return;

    // Build a stable hierarchy from issuer outward using recorded levels and edges
    const issuer = graphState.issuer;
    const levels = new Map(); // addr -> level
    levels.set(issuer, 0);

    // compute levels via BFS on adjacency
    const qq = [issuer];
    while (qq.length) {
      const cur = qq.shift();
      const lv = levels.get(cur) ?? 0;
      if (lv >= graphState.depth) continue;

      const idxs = graphState.adjacency.get(cur) || [];
      for (const ei of idxs) {
        const e = graphState.edges[ei];
        if (!levels.has(e.to) || levels.get(e.to) > lv + 1) {
          levels.set(e.to, lv + 1);
          qq.push(e.to);
        }
      }
    }

    // group by parent for display (tree-like; not strictly a tree but rendered as a tree using first parent)
    const parent = new Map();
    parent.set(issuer, null);
    const q2 = [issuer];
    while (q2.length) {
      const cur = q2.shift();
      const lv = levels.get(cur) ?? 0;
      if (lv >= graphState.depth) continue;
      const idxs = graphState.adjacency.get(cur) || [];
      for (const ei of idxs) {
        const e = graphState.edges[ei];
        if (levels.get(e.to) !== lv + 1) continue;
        if (!parent.has(e.to)) parent.set(e.to, cur);
        if (!q2.includes(e.to)) q2.push(e.to);
      }
    }

    // children map
    const children = new Map();
    for (const [addr, p] of parent.entries()) {
      if (!children.has(addr)) children.set(addr, []);
      if (p) {
        if (!children.has(p)) children.set(p, []);
        children.get(p).push(addr);
      }
    }
    for (const [k, arr] of children.entries()) {
      arr.sort((a, b) => (graphState.nodes.get(b)?.inCount || 0) - (graphState.nodes.get(a)?.inCount || 0));
    }

    function nodeRow(addr) {
      const n = graphState.nodes.get(addr);
      const out = n?.outCount ?? 0;
      const inn = n?.inCount ?? 0;
      const lvl = levels.get(addr) ?? n?.level ?? 0;
      const first = n?.firstLedger ?? "—";
      const last = n?.lastLedger ?? "—";
      const outx = (n?.outXrp ?? 0).toFixed(2);
      const inx = (n?.inXrp ?? 0).toFixed(2);

      return `
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;">
          <div>
            <div><code>${escapeHtml(addr)}</code> <span style="opacity:.7">lvl ${escapeHtml(lvl)}</span></div>
            <div style="opacity:.75;font-size:12px;">out:${escapeHtml(out)} (XRP ${escapeHtml(outx)}) • in:${escapeHtml(
        inn
      )} (XRP ${escapeHtml(inx)}) • ledger ${escapeHtml(first)}..${escapeHtml(last)}</div>
          </div>
          <div style="display:flex;gap:8px;">
            <button class="itShowEdges" data-addr="${escapeHtml(addr)}" style="padding:6px 8px;border-radius:6px;border:1px solid var(--accent-tertiary);background:transparent;cursor:pointer;">Edges</button>
          </div>
        </div>
      `;
    }

    function renderRec(addr, indentPx) {
      const kids = children.get(addr) || [];
      const sectionId = `itKids_${addr}`;
      const hasKids = kids.length > 0;

      const head = `
        <div style="padding:8px;border-bottom:1px dashed rgba(255,255,255,0.05);margin-left:${indentPx}px;">
          <div style="display:flex;align-items:center;gap:8px;">
            ${
              hasKids
                ? `<button class="itToggle" data-target="${escapeHtml(sectionId)}" style="width:28px;height:28px;border-radius:8px;border:1px solid var(--accent-tertiary);background:transparent;cursor:pointer;">▾</button>`
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

    host.innerHTML = renderRec(issuer, 0);

    Array.from(document.querySelectorAll(".itToggle")).forEach((btn) =>
      btn.addEventListener("click", () => {
        const target = btn.getAttribute("data-target");
        const el = document.getElementById(target);
        if (!el) return;
        const open = el.style.display !== "none";
        el.style.display = open ? "none" : "block";
        btn.textContent = open ? "▸" : "▾";
      })
    );

    Array.from(document.querySelectorAll(".itShowEdges")).forEach((btn) =>
      btn.addEventListener("click", () => {
        const addr = btn.getAttribute("data-addr");
        showEdgesForAddress(addr);
      })
    );
  }

  function showEdgesForAddress(addr) {
    const idxs = graphState.adjacency.get(addr) || [];
    const edges = idxs.map((i) => graphState.edges[i]).slice(0, 400);

    $("aiModalTitle").textContent = `Edges from ${addr} (${edges.length})`;
    $("aiModalBody").textContent = JSON.stringify(edges, null, 2);
    $("aiModalOverlay").style.display = "flex";
  }

  function renderEdgeFilter() {
    const q = String(($("itSearch") || {}).value || "").trim().toLowerCase();
    const items = $("itEdgeItems");
    if (!items) return;

    const filtered = q
      ? graphState.edges.filter((e) => {
          const hay = `${e.from} ${e.to} ${e.type} ${e.tx_hash} ${e.currency} ${e.amount} ${e.ledger_index} ${e.date || ""}`.toLowerCase();
          return hay.includes(q);
        })
      : graphState.edges;

    const slice = filtered.slice(0, 200);
    items.innerHTML = slice
      .map((e, idx) => {
        const shortHash = e.tx_hash ? e.tx_hash.slice(0, 10) + "…" : "";
        return `<div style="padding:8px;border-bottom:1px dashed rgba(255,255,255,0.05);font-size:12px;">
          <div><code>${escapeHtml(e.from.slice(0, 8))}…</code> → <code>${escapeHtml(e.to.slice(0, 8))}…</code> • ${escapeHtml(
          e.type
        )} • ledger ${escapeHtml(e.ledger_index)} • ${escapeHtml(e.currency)} ${escapeHtml(e.amount)}</div>
          <div style="opacity:.75;">${escapeHtml(e.date || "—")} • ${escapeHtml(shortHash)}</div>
        </div>`;
      })
      .join("");

    // small hint
    const r = $("itResults");
    if (r && !q) {
      r.innerHTML = `<div style="opacity:.85">Edges: ${escapeHtml(graphState.edges.length)} (showing ${escapeHtml(
        slice.length
      )}). Use search to filter.</div>`;
    }
  }

  function exportIssuerGraph() {
    if (!graphState.issuer || !graphState.edges.length) {
      setTreeStatus("No graph to export.");
      return;
    }
    const out = {
      schemaVersion: SCHEMA_VERSION,
      builtAt: graphState.builtAt || new Date().toISOString(),
      issuer: graphState.issuer,
      depth: graphState.depth,
      perNode: graphState.perNode,
      caps: { maxAccounts: graphState.maxAccounts, maxEdges: graphState.maxEdges },
      constraints: graphState.constraints,
      nodes: Array.from(graphState.nodes.values()).map((n) => ({
        ...n,
        parents: Array.from(n.parents),
        children: Array.from(n.children)
      })),
      edges: graphState.edges
    };
    downloadJson(out, `naluxrp-issuer-tree-${graphState.issuer}-${Date.now()}.json`);
    setTreeStatus("Graph exported");
  }

  // -------- Pathfinding --------
  function onFindPath() {
    const target = ($("itTarget") || {}).value?.trim();
    if (!graphState.issuer || !graphState.edges.length) {
      setTreeStatus("Build the issuer tree first.");
      return;
    }
    if (!isValidXrpAddress(target)) {
      setTreeStatus("Enter a valid target r... address.");
      return;
    }
    const path = findShortestPath(graphState.issuer, target);
    const res = $("itResults");
    if (!res) return;

    if (!path) {
      res.innerHTML = `<div>No path found (within current tree/caps/constraints).</div>`;
      return;
    }

    const pretty = path
      .map((p) => `<div style="padding:6px 0;"><code>${escapeHtml(p)}</code></div>`)
      .join("");

    res.innerHTML = `
      <div><strong>Shortest path</strong> (${escapeHtml(path.length - 1)} hops)</div>
      <div style="margin-top:8px;">${pretty}</div>
      <div style="margin-top:8px;"><button id="itShowPathEdges" style="padding:8px 10px;border-radius:8px;border:1px solid var(--accent-tertiary);background:transparent;cursor:pointer;">Show path edges</button></div>
    `;

    $("itShowPathEdges").addEventListener("click", () => {
      const edges = extractPathEdges(path);
      $("aiModalTitle").textContent = "Path edges";
      $("aiModalBody").textContent = JSON.stringify(edges, null, 2);
      $("aiModalOverlay").style.display = "flex";
    });
  }

  function findShortestPath(src, dst) {
    if (src === dst) return [src];
    const prev = new Map();
    const q = [src];
    prev.set(src, null);

    while (q.length) {
      const cur = q.shift();
      const idxs = graphState.adjacency.get(cur) || [];
      for (const ei of idxs) {
        const e = graphState.edges[ei];
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

  function extractPathEdges(path) {
    const edges = [];
    for (let i = 0; i < path.length - 1; i++) {
      const from = path[i];
      const to = path[i + 1];
      const idxs = graphState.adjacency.get(from) || [];
      const match = idxs.map((ix) => graphState.edges[ix]).find((e) => e.to === to);
      if (match) edges.push(match);
    }
    return edges;
  }

  // -------- Pattern Scan --------
  function onRunPatterns() {
    if (!graphState.issuer || !graphState.edges.length) {
      setTreeStatus("Build the issuer tree first.");
      return;
    }
    const results = runPatternScan();
    const host = $("itResults");
    if (!host) return;

    host.innerHTML = `
      <div><strong>Pattern scan</strong></div>
      <div style="margin-top:8px;display:flex;flex-direction:column;gap:10px;">
        ${results.map(renderPatternCard).join("")}
      </div>
    `;

    Array.from(document.querySelectorAll(".itPatternShow")).forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.getAttribute("data-key");
        const payload = results.find((r) => r.key === key)?.payload || null;
        $("aiModalTitle").textContent = `Pattern: ${key}`;
        $("aiModalBody").textContent = JSON.stringify(payload, null, 2);
        $("aiModalOverlay").style.display = "flex";
      });
    });
  }

  function renderPatternCard(r) {
    return `
      <div style="padding:10px;border-radius:10px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.04);">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
          <div>
            <div><strong>${escapeHtml(r.title)}</strong></div>
            <div style="opacity:.85;font-size:12px;margin-top:4px;">${escapeHtml(r.summary)}</div>
          </div>
          <button class="itPatternShow" data-key="${escapeHtml(r.key)}" style="padding:8px 10px;border-radius:8px;border:1px solid var(--accent-tertiary);background:transparent;cursor:pointer;">Details</button>
        </div>
      </div>
    `;
  }

  function runPatternScan() {
    const edges = graphState.edges.slice().sort((a, b) => (a.ledger_index || 0) - (b.ledger_index || 0));

    const fanOut = detectFanOutBursts(edges, graphState.issuer);
    const recon = detectReconsolidation(edges);
    const cycles = detectCycles(edges, graphState.issuer, PATTERN_CYCLE_MAX_LEN);
    const splits = detectSplitPayments(edges, graphState.issuer);
    const dominated = detectDominatedRoutes(edges, graphState.issuer);

    const out = [];
    out.push({
      key: "fan_out_bursts",
      title: "Fan-out bursts",
      summary: fanOut.length ? `${fanOut.length} burst(s) detected` : "None detected",
      payload: fanOut
    });
    out.push({
      key: "reconsolidation_hubs",
      title: "Reconsolidation hubs",
      summary: recon.length ? `${recon.length} hub(s) detected` : "None detected",
      payload: recon
    });
    out.push({
      key: "cycles",
      title: "Cycles (<=4 hops)",
      summary: cycles.length ? `${cycles.length} cycle(s) detected` : "None detected",
      payload: cycles
    });
    out.push({
      key: "split_payments",
      title: "Split payments",
      summary: splits.length ? `${splits.length} group(s) detected` : "None detected",
      payload: splits
    });
    out.push({
      key: "dominated_routes",
      title: "Dominated routes",
      summary: dominated ? dominated.summary : "N/A",
      payload: dominated
    });

    return out;
  }

  function detectFanOutBursts(edges, issuer) {
    // burst = >= threshold tx from issuer within ledger window
    const srcEdges = edges.filter((e) => e.from === issuer);
    if (!srcEdges.length) return [];

    const out = [];
    let left = 0;
    for (let right = 0; right < srcEdges.length; right++) {
      while (
        srcEdges[right].ledger_index - srcEdges[left].ledger_index > PATTERN_BURST_LEDGER_WINDOW &&
        left < right
      ) {
        left += 1;
      }
      const windowCount = right - left + 1;
      if (windowCount >= PATTERN_BURST_TX_THRESHOLD) {
        const win = srcEdges.slice(left, right + 1);
        const uniq = new Set(win.map((e) => e.to)).size;
        out.push({
          ledgerStart: win[0].ledger_index,
          ledgerEnd: win[win.length - 1].ledger_index,
          txCount: win.length,
          uniqueRecipients: uniq,
          sample: win.slice(0, 10)
        });
        left = right + 1; // non-overlapping bursts
      }
    }
    return out;
  }

  function detectReconsolidation(edges) {
    // hubs = nodes that receive from many unique senders (>= min) within constraints window
    const recv = new Map(); // to -> Set(from)
    for (const e of edges) {
      if (!recv.has(e.to)) recv.set(e.to, new Set());
      recv.get(e.to).add(e.from);
    }
    const hubs = [];
    for (const [to, senders] of recv.entries()) {
      if (senders.size >= PATTERN_RECONSOLIDATION_MIN_SENDERS) {
        hubs.push({ hub: to, uniqueSenders: senders.size, senders: Array.from(senders).slice(0, 30) });
      }
    }
    hubs.sort((a, b) => b.uniqueSenders - a.uniqueSenders);
    return hubs.slice(0, 25);
  }

  function detectCycles(edges, root, maxLen) {
    // find small cycles containing root if possible; otherwise any cycles up to maxLen
    const adj = new Map();
    for (const e of edges) {
      if (!adj.has(e.from)) adj.set(e.from, new Set());
      adj.get(e.from).add(e.to);
    }

    const cycles = [];
    const startNodes = root ? [root] : Array.from(adj.keys()).slice(0, 50);

    for (const start of startNodes) {
      const stack = [{ node: start, path: [start] }];
      while (stack.length) {
        const cur = stack.pop();
        if (cur.path.length > maxLen) continue;
        const nbrs = adj.get(cur.node);
        if (!nbrs) continue;

        for (const nxt of nbrs) {
          if (nxt === start && cur.path.length >= 2) {
            cycles.push({ cycle: [...cur.path, start] });
            continue;
          }
          if (cur.path.includes(nxt)) continue;
          stack.push({ node: nxt, path: [...cur.path, nxt] });
        }
      }
    }

    // dedupe by string key
    const seen = new Set();
    const out = [];
    for (const c of cycles) {
      const key = c.cycle.join(">");
      if (!seen.has(key)) {
        seen.add(key);
        out.push(c);
      }
    }
    return out.slice(0, 50);
  }

  function detectSplitPayments(edges, issuer) {
    // groups: issuer sends same XRP amount (rounded) to many recipients
    const src = edges.filter((e) => e.from === issuer && e.currency === "XRP");
    const buckets = new Map(); // amountRounded -> edges
    for (const e of src) {
      const k = String(Math.round((Number(e.amount || 0) + Number.EPSILON) * 1000) / 1000);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(e);
    }
    const groups = [];
    for (const [amt, arr] of buckets.entries()) {
      const uniq = new Set(arr.map((e) => e.to)).size;
      if (arr.length >= 10 && uniq >= 8) {
        groups.push({
          amount: Number(amt),
          txCount: arr.length,
          uniqueRecipients: uniq,
          ledgerSpan: { start: arr[0].ledger_index, end: arr[arr.length - 1].ledger_index },
          sample: arr.slice(0, 12)
        });
      }
    }
    groups.sort((a, b) => b.txCount - a.txCount);
    return groups.slice(0, 25);
  }

  function detectDominatedRoutes(edges, issuer) {
    // dominance at each hop: if one child captures majority of outgoing edges at a node
    const perNode = new Map(); // from -> Map(to->count)
    for (const e of edges) {
      if (!perNode.has(e.from)) perNode.set(e.from, new Map());
      const m = perNode.get(e.from);
      m.set(e.to, (m.get(e.to) || 0) + 1);
    }

    function nodeDom(from) {
      const m = perNode.get(from);
      if (!m) return null;
      const total = Array.from(m.values()).reduce((a, b) => a + b, 0);
      const top = Array.from(m.entries()).sort((a, b) => b[1] - a[1])[0] || [null, 0];
      const dom = total ? top[1] / total : 0;
      return { from, total, topTo: top[0], topCount: top[1], dominance: dom };
    }

    const rootDom = nodeDom(issuer);
    if (!rootDom) return null;

    const notable = [];
    for (const from of perNode.keys()) {
      const d = nodeDom(from);
      if (d && d.total >= 10 && d.dominance >= 0.65) notable.push(d);
    }
    notable.sort((a, b) => b.dominance - a.dominance);

    return {
      summary: `Issuer dominance: ${Math.round((rootDom.dominance || 0) * 100)}% to ${rootDom.topTo || "—"}; notable nodes: ${notable.length}`,
      issuer: rootDom,
      notable: notable.slice(0, 30)
    };
  }

  // -------- init & expose API --------
  renderPage();

  window.initInspector = () => renderPage();
  window.AccountInspector = {
    // snapshot
    buildSnapshot: onBuild,
    getSnapshot: () => snapshot,
    getGlobalProof: (idx) => (snapshot ? getGlobalProof(snapshot.chunks, snapshot.topTree, idx) : null),
    verifyGlobalProof,

    // issuer tree
    buildIssuerTree: onBuildIssuerTree,
    getIssuerGraph: () => ({
      issuer: graphState.issuer,
      builtAt: graphState.builtAt,
      nodes: Array.from(graphState.nodes.values()),
      edges: graphState.edges
    })
  };

  console.log("🛡️ Account Inspector (full page: Merkle + Issuer Tree) loaded");
})();
