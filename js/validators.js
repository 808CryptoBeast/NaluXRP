/* =========================================
   NaluXrp 🌊 — Validators Deep Dive
   Live XRPL validator metrics + modal
   ========================================= */

/* ---------- CONFIG ---------- */
// If you deploy a public proxy (Cloudflare Worker / Vercel), set DEPLOYED_PROXY to its base URL.
// Example: const DEPLOYED_PROXY = "https://naluxrp-validators.workers.dev";
const DEPLOYED_PROXY = "https://<YOUR_WORKER_SUBDOMAIN>.workers.dev"; // <-- REPLACE THIS WHEN DEPLOYED

const PUBLIC_VALIDATORS_API = "https://api.xrpl.org/v2/network/validators?limit=200";

let validatorCache = [];
let isInitialized = false;

/* ----------------------------------------------------
   DEFENSIVE DOM CREATION
   Ensure required DOM elements exist so initValidators won't abort
---------------------------------------------------- */
(function ensureValidatorsDOM() {
  const section = document.getElementById("validators");
  if (!section) return;

  if (!document.getElementById("validatorsList")) {
    section.innerHTML = section.innerHTML + `
      <div id="validatorsList" class="validators-loading">
        Initializing validators module…
      </div>
    `;
  }

  if (!document.getElementById("validatorModalOverlay")) {
    const overlay = document.createElement("div");
    overlay.id = "validatorModalOverlay";
    overlay.className = "validator-modal-overlay";
    overlay.style.display = "none";
    overlay.innerHTML = `
      <div class="validator-modal">
        <header class="validator-modal-header">
          <h2>Validator Details</h2>
          <button class="validator-modal-close" onclick="closeValidatorModal()">✕</button>
        </header>
        <div id="validatorModalBody" class="validator-modal-body"></div>
      </div>
    `;
    document.body.appendChild(overlay);
  }
})();

/* ----------------------------------------------------
   INITIALIZATION
---------------------------------------------------- */
async function initValidators() {
  console.log("🛡️ Initializing validators module...");

  const listContainer = document.getElementById("validatorsList");
  if (!listContainer) {
    console.error("❌ validatorsList container not found");
    return;
  }

  if (isInitialized && validatorCache.length > 0) {
    console.log("✅ Showing cached validators");
    renderValidators(validatorCache);
    return;
  }

  isInitialized = true;

  // Show loading state
  listContainer.innerHTML = `
    <div class="validators-loading">
      <div class="loading-spinner"></div>
      Fetching live XRPL validator data...
      <div class="loading-subtext">Connecting to proxy / public API...</div>
    </div>
  `;

  // Add styles
  addValidatorStyles();

  // Ensure modal exists
  ensureValidatorModal();

  // Fetch and render data
  try {
    await fetchLiveValidators();
    setupValidatorSearch();
    console.log("✅ Validators module initialized successfully");
  } catch (err) {
    console.warn("Validators initialization error:", err);
    showConnectionError(err && err.message ? err.message : "Unknown error");
  }
}

/* ----------------------------------------------------
   FETCH HELPER (structured result)
   returns { ok: true, data } or { ok: false, error }
---------------------------------------------------- */
async function tryFetchUrl(url, timeoutMs = 8000) {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(url, { signal: controller.signal, credentials: "same-origin" });
    clearTimeout(id);

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return { ok: false, error: `HTTP ${res.status}: ${txt}` };
    }

    // try parse json
    const ctype = res.headers.get("content-type") || "";
    if (ctype.includes("application/json")) {
      const data = await res.json();
      return { ok: true, data };
    } else {
      const text = await res.text();
      try {
        return { ok: true, data: JSON.parse(text) };
      } catch {
        return { ok: false, error: "Invalid JSON response" };
      }
    }
  } catch (err) {
    const message = err.name === "AbortError" ? "Timeout" : (err.message || String(err));
    return { ok: false, error: message };
  }
}

/* ----------------------------------------------------
   RAW rippled WebSocket one-shot helper (non-persistent)
   (used as a fallback to avoid creating another persistent xrpl.Client)
---------------------------------------------------- */
function rippledWsRequest(payload = { command: "validators" }, timeoutMs = 9000) {
  return new Promise((resolve, reject) => {
    try {
      const url = (payload && payload.server) || "wss://s1.ripple.com";
      const ws = new WebSocket(url);
      let finished = false;
      const t = setTimeout(() => {
        if (!finished) {
          finished = true;
          try { ws.close(); } catch {}
          reject(new Error("WS timeout"));
        }
      }, timeoutMs);

      ws.addEventListener("open", () => {
        try {
          ws.send(JSON.stringify(payload));
        } catch (e) { /* ignore */ }
      });

      ws.addEventListener("message", (msg) => {
        if (finished) return;
        finished = true;
        clearTimeout(t);
        try {
          const data = JSON.parse(msg.data);
          ws.close();
          resolve(data);
        } catch (e) {
          ws.close();
          reject(e);
        }
      });

      ws.addEventListener("error", (err) => {
        if (finished) return;
        finished = true;
        clearTimeout(t);
        try { ws.close(); } catch {}
        reject(err || new Error("WS error"));
      });

      ws.addEventListener("close", () => {
        if (!finished) {
          finished = true;
          clearTimeout(t);
          reject(new Error("WS closed"));
        }
      });
    } catch (e) {
      reject(e);
    }
  });
}

/* ----------------------------------------------------
   FETCH LIVE VALIDATOR DATA (preference order)
   1) shared xrpl client via window.requestXrpl()
   2) one-off rippled WebSocket (rippled)
   3) HTTP fallback chain: deployed proxy -> same-origin /api/validators -> localhost -> public API
---------------------------------------------------- */
async function fetchLiveValidators() {
  const container = document.getElementById("validatorsList");
  if (!container) return;

  // Show helpful subtext
  const loadingSub = container.querySelector(".loading-subtext");
  if (loadingSub) loadingSub.textContent = "Trying shared XRPL connection…";

  // 1) Try shared XRPL connection wrapper if available
  if (typeof window.requestXrpl === "function") {
    try {
      const res = await window.requestXrpl({ command: "validators" }, { timeoutMs: 9000 });
      // normalize a few variant shapes
      let validatorsArr = null;
      if (res && Array.isArray(res.validators)) validatorsArr = res.validators;
      else if (res && Array.isArray(res.result?.validators)) validatorsArr = res.result.validators;
      else if (Array.isArray(res)) validatorsArr = res;
      else {
        // attempt to discover any array in result
        const maybe = Object.values(res || {}).find(v => Array.isArray(v));
        if (maybe) validatorsArr = maybe;
      }

      if (Array.isArray(validatorsArr) && validatorsArr.length) {
        validatorCache = validatorsArr;
        renderValidators(validatorCache);
        showLiveDataIndicator();
        console.log(`✅ Loaded ${validatorCache.length} validators via shared XRPL connection`);
        return;
      } else {
        console.warn("Shared XRPL request returned no validators — falling back");
      }
    } catch (err) {
      console.warn("Shared XRPL request failed — falling back:", err && err.message ? err.message : err);
    }
  }

  // 2) Try one-off rippled WebSocket
  if (loadingSub) loadingSub.textContent = "Querying rippled via WebSocket…";
  try {
    const wsRes = await rippledWsRequest({ command: "validators" }, 9000);
    let validatorsArr = null;
    if (wsRes && Array.isArray(wsRes.validators)) validatorsArr = wsRes.validators;
    else if (wsRes && Array.isArray(wsRes.validator_list)) validatorsArr = wsRes.validator_list;
    else if (Array.isArray(wsRes)) validatorsArr = wsRes;
    else {
      const maybe = Object.values(wsRes || {}).find(v => Array.isArray(v));
      if (maybe) validatorsArr = maybe;
    }

    if (Array.isArray(validatorsArr) && validatorsArr.length) {
      validatorCache = validatorsArr;
      renderValidators(validatorCache);
      showLiveDataIndicator();
      console.log(`✅ Loaded ${validatorCache.length} validators via one-off rippled WS`);
      return;
    } else {
      console.warn("Raw WS returned no validators, continuing to HTTP fallbacks", wsRes);
    }
  } catch (err) {
    console.warn("Raw rippled WS request failed:", err && err.message ? err.message : err);
  }

  // 3) HTTP fallback chain
  if (loadingSub) loadingSub.textContent = "Attempting proxy(s) and public API...";

  const candidates = [];
  if (DEPLOYED_PROXY && !DEPLOYED_PROXY.includes("<YOUR_WORKER_SUBDOMAIN>")) candidates.push(`${DEPLOYED_PROXY}/validators`);
  candidates.push(`${location.protocol}//${location.host}/api/validators`);
  candidates.push("http://localhost:3000/validators");
  candidates.push(PUBLIC_VALIDATORS_API);

  const attemptErrors = [];
  let data = null;
  let used = null;

  for (const candidate of candidates) {
    try {
      console.log("Attempting validator fetch from", candidate);
      const r = await tryFetchUrl(candidate, 9000);
      if (!r.ok) {
        attemptErrors.push({ url: candidate, error: r.error });
        continue;
      }

      const payload = r.data;
      let validatorsArr = null;
      if (payload && Array.isArray(payload.validators)) validatorsArr = payload.validators;
      else if (payload && Array.isArray(payload.result?.validators)) validatorsArr = payload.result.validators;
      else if (Array.isArray(payload)) validatorsArr = payload;
      else {
        const maybe = Object.values(payload || {}).find(v => Array.isArray(v));
        if (maybe) validatorsArr = maybe;
      }

      if (Array.isArray(validatorsArr) && validatorsArr.length) {
        data = { validators: validatorsArr };
        used = candidate;
        break;
      } else {
        attemptErrors.push({ url: candidate, error: "No validators array found in response" });
      }
    } catch (err) {
      attemptErrors.push({ url: candidate, error: err && err.message ? err.message : String(err) });
    }
  }

  if (!data || !Array.isArray(data.validators)) {
    const details = attemptErrors.map(a => `${a.url} → ${a.error}`).join("\n");
    showProxyError(`No validator data available. Attempts:\n${details}`);
    return;
  }

  validatorCache = data.validators;
  renderValidators(validatorCache);
  showLiveDataIndicator();
  console.log(`✅ Loaded ${validatorCache.length} live validators via ${used}`);
}

/* ----------------------------------------------------
   RENDER VALIDATORS
---------------------------------------------------- */
function renderValidators(list) {
  const container = document.getElementById("validatorsList");
  if (!container) return;

  if (!list || !list.length) {
    container.innerHTML = '<div class="validators-empty">No live validator data available.</div>';
    return;
  }

  console.log(`📊 Rendering ${list.length} live validators...`);

  // Calculate statistics
  const unlCount = list.filter(v => v.unl === true || v.unl === "Ripple" || v.unl === "true").length;
  const communityCount = list.length - unlCount;

  // Sort: UNL first, then by agreement/score (if available)
  const sorted = [...list].sort((a, b) => {
    const aUnl = a.unl === true || a.unl === "Ripple" || a.unl === "true";
    const bUnl = b.unl === true || b.unl === "Ripple" || b.unl === "true";
    if (aUnl !== bUnl) return aUnl ? -1 : 1;

    const aScore = calculateReliabilityScore(a);
    const bScore = calculateReliabilityScore(b);
    return bScore - aScore;
  });

  // Build cards
  const validatorsHTML = sorted.map(v => {
    const key = v.validation_public_key || v.public_key || "—";
    const shortKey = key.length > 16 ? key.slice(0, 8) + "…" + key.slice(-6) : key;
    const domain = v.domain || v.domain_name || "unknown";
    const metrics = calculateValidatorMetrics(v);
    const unl = v.unl === true || v.unl === "Ripple" || v.unl === "true";

    return `
      <div class="validator-card ${unl ? "unl-validator" : "community-validator"}">
        <div class="validator-header">
          <div class="validator-key" title="${key}">${shortKey}</div>
          <span class="unl-badge ${unl ? "unl-full" : "unl-partial"}">
            ${unl ? "Ripple UNL" : "Community"}
          </span>
        </div>

        <div class="validator-domain">${domain}</div>

        <div class="validator-stat-row">
          <span class="validator-pill pill-score">Score ${metrics.score}</span>
          <span class="validator-pill pill-label ${getLabelClass(metrics.label)}">${metrics.label}</span>
        </div>

        <div class="validator-stat-row">
          <div class="validator-stat">
            <span>Agreement 24h</span>
            <strong>${formatPercent(metrics.agreement24)}</strong>
          </div>
          <div class="validator-stat">
            <span>Uptime 24h</span>
            <strong>${formatPercent(metrics.uptime24)}</strong>
          </div>
        </div>

        <button class="validator-details-btn" onclick="openValidatorModal('${key.replace(/'/g, "\\'")}')">View Details</button>
      </div>
    `;
  }).join("");

  // summary
  const statsHTML = `
    <div class="validators-summary-grid">
      <div class="validators-summary-card">
        <div class="summary-title">Total Validators</div>
        <div class="summary-value">${list.length}</div>
      </div>
      <div class="validators-summary-card">
        <div class="summary-title">Ripple UNL</div>
        <div class="summary-value">${unlCount}</div>
      </div>
      <div class="validators-summary-card">
        <div class="summary-title">Community</div>
        <div class="summary-value">${communityCount}</div>
      </div>
    </div>
  `;

  container.innerHTML = statsHTML + '<div class="validators-grid">' + validatorsHTML + '</div>';

  console.log(`✅ Rendered ${sorted.length} live validators`);
}

/* ----------------------------------------------------
   CALCULATE METRICS
---------------------------------------------------- */
function calculateValidatorMetrics(v) {
  const a24 = calculateAgreement(v.agreement_24h);
  const a1 = calculateAgreement(v.agreement_1h);
  const uptime24 = calculateUptime(v.agreement_24h);
  const score = Math.round(( (a24 * 0.7) + (a1 * 0.3) ) * 100);
  let label = "Poor";
  if (score >= 95) label = "Excellent";
  else if (score >= 85) label = "Strong";
  else if (score >= 70) label = "Good";
  else if (score >= 50) label = "Fair";

  return {
    score,
    label,
    agreement24: a24 * 100,
    uptime24: uptime24 != null ? uptime24 * 100 : null
  };
}

function getLabelClass(label) {
  if (!label) return "";
  if (label === "Excellent") return "label-excellent";
  if (label === "Strong") return "label-strong";
  if (label === "Good") return "label-good";
  if (label === "Fair") return "label-fair";
  return "label-poor";
}

function calculateReliabilityScore(v) {
  // fallback simple numeric score for sorting when agreement data missing
  const a24 = v.agreement_24h?.score || 0;
  const a1 = v.agreement_1h?.score || 0;
  return Math.round((a24 * 0.7 + a1 * 0.3) * 100);
}

function calculateUptime(agreement) {
  if (!agreement || !agreement.total) return null;
  const total = agreement.total || 0;
  const missed = agreement.missed || 0;
  return total > 0 ? ((total - missed) / total) : null;
}

function calculateAgreement(agreement) {
  if (!agreement || !agreement.score) return 0;
  return Number(agreement.score) || 0;
}

function formatPercent(value) {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(2) + "%";
}

/* ----------------------------------------------------
   SEARCH
---------------------------------------------------- */
function setupValidatorSearch() {
  const input = document.getElementById("validatorSearch") || document.querySelector("#validators input");
  if (!input) return;

  input.addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase();
    const filtered = validatorCache.filter((v) => {
      return (v.domain || "").toLowerCase().includes(q) ||
             (v.validation_public_key || v.public_key || "").toLowerCase().includes(q);
    });
    renderValidators(filtered);
  });
}

/* ----------------------------------------------------
   MODAL
---------------------------------------------------- */
function ensureValidatorModal() {
  if (document.getElementById("validatorModalOverlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "validatorModalOverlay";
  overlay.className = "validator-modal-overlay";
  overlay.style.display = "none";

  overlay.innerHTML = `
    <div class="validator-modal">
      <header class="validator-modal-header">
        <h2>Validator Details</h2>
        <button class="validator-modal-close" onclick="closeValidatorModal()">✕</button>
      </header>
      <div id="validatorModalBody" class="validator-modal-body"></div>
    </div>
  `;

  document.body.appendChild(overlay);
}

function openValidatorModal(pubkey) {
  const v = validatorCache.find(x => (x.validation_public_key || x.public_key) === pubkey);
  if (!v) return;

  const body = document.getElementById("validatorModalBody");
  if (!body) return;

  const metrics = calculateValidatorMetrics(v);

  body.innerHTML = `
    <div class="validator-modal-section">
      <h3>Public Key</h3>
      <code>${v.validation_public_key || v.public_key || "—"}</code>
      <p><strong>Domain:</strong> ${v.domain || v.domain_name || "—"}</p>
      <p><strong>Score:</strong> ${metrics.score} — ${metrics.label}</p>
    </div>

    <div class="validator-modal-section">
      <h3>Agreement & Uptime</h3>
      <p>Agreement (24h): ${formatPercent(metrics.agreement24)}</p>
      <p>Uptime (24h): ${formatPercent(metrics.uptime24)}</p>
    </div>

    <div class="validator-modal-section">
      <h3>Raw</h3>
      <pre style="white-space:pre-wrap;max-height:280px;overflow:auto">${escapeHtml(JSON.stringify(v, null, 2))}</pre>
    </div>
  `;

  document.getElementById("validatorModalOverlay").style.display = "flex";
}

function closeValidatorModal() {
  const o = document.getElementById("validatorModalOverlay");
  if (o) o.style.display = "none";
}

/* ----------------------------------------------------
   ERRORS / UI HINTS
---------------------------------------------------- */
function showProxyError(errorMessage = '') {
  const list = document.getElementById("validatorsList");
  if (!list) return;
  list.innerHTML = `
    <div class="validators-error">
      <h3>⚠️ Validator Data Unavailable</h3>
      <p>${escapeHtml(errorMessage || "Unable to fetch validator data from proxies or public API.")}</p>
    </div>
  `;
}

function showConnectionError(errorMessage = '') {
  const list = document.getElementById("validatorsList");
  if (!list) return;
  list.innerHTML = `
    <div class="validators-error">
      <h3>🔌 Connection Error</h3>
      <p>${escapeHtml(errorMessage || "Network or XRPL connection error.")}</p>
    </div>
  `;
}

function showLiveDataIndicator() {
  const list = document.getElementById("validatorsList");
  if (!list) return;
  const badge = document.createElement("div");
  badge.className = "validators-warning";
  badge.textContent = "Live data — fetched from network";
  list.prepend(badge);
}

/* ----------------------------------------------------
   STYLES (inject original styles if navbar doesn't load them)
---------------------------------------------------- */
function addValidatorStylesOriginal() {
  if (document.querySelector('#validator-styles')) return;

  const style = document.createElement('style');
  style.id = 'validator-styles';
  style.textContent = `
    /* Compact copy of validator.css to ensure layout regardless of bundling */
    .validators-summary-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px;margin-bottom:18px}
    .validators-summary-card{background:var(--card-bg,rgba(0,0,0,.36));border-radius:14px;border:1px solid var(--accent-tertiary,rgba(255,255,255,.12));padding:12px 14px;font-size:.9rem}
    #validatorSearch{width:100%;max-width:420px;padding:8px 10px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:rgba(0,0,0,.4);color:var(--text-primary)}
    .validators-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px}
    .validator-card{position:relative;display:flex;flex-direction:column;gap:6px;backdrop-filter:blur(12px);padding:14px;border-radius:12px;border:1px solid rgba(255,255,255,.04);background:var(--card-bg)}
    .validator-header{display:flex;align-items:center;justify-content:space-between;gap:10px}
    .validator-key{font-family:SFMono,Menlo,Consolas,monospace;font-size:.82rem;color:var(--text-primary)}
    .validator-domain{font-size:.86rem;color:var(--text-secondary)}
    .unl-badge{font-size:.72rem;padding:4px 8px;border-radius:999px;border:1px solid rgba(255,255,255,.2);text-transform:uppercase}
    .unl-full{background:linear-gradient(135deg,#ffe066,#ffb347);color:#201600;box-shadow:0 0 12px rgba(255,225,120,.6)}
    .unl-partial{background:rgba(0,0,0,.45);color:var(--text-secondary)}
    .validator-stat-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:4px;flex-wrap:wrap}
    .validator-pill{font-size:.78rem;padding:4px 8px;border-radius:999px;border:1px solid rgba(255,255,255,.16);display:inline-flex;align-items:center;gap:4px}
    .pill-score{background:rgba(0,0,0,.55);color:var(--accent-primary)}
    .pill-label{background:rgba(255,255,255,.06);color:var(--text-primary)}
    .validator-details-btn{margin-top:6px;align-self:flex-end;padding:6px 10px;border-radius:9px;border:1px solid var(--accent-primary);background:transparent;color:var(--accent-primary);cursor:pointer}
    .validator-modal-overlay{position:fixed;inset:0;background:radial-gradient(circle at top,rgba(0,0,0,.65),rgba(0,0,0,.95));display:none;align-items:center;justify-content:center;z-index:9999}
    .validator-modal{width:min(640px,96vw);max-height:90vh;background:radial-gradient(circle at top left, rgba(255,214,96,.16),transparent),rgba(10,10,20,.96);border-radius:18px;border:1px solid rgba(255,255,255,.18);box-shadow:0 24px 48px rgba(0,0,0,.65);display:flex;flex-direction:column;overflow:hidden}
    .validator-modal-header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid rgba(255,255,255,.12)}
    .validator-modal-body{padding:12px 16px 14px;overflow-y:auto;font-size:.9rem}
    .validators-loading{padding:30px 10px;color:var(--accent-secondary);font-size:1.1em;animation:pulse 1.5s infinite}
    .validators-error{padding:20px;color:#ff5555;font-size:.95em;text-align:center}
  `;
  document.head.appendChild(style);
}

function addValidatorStyles() {
  // prefer an existing global style injection if present elsewhere; fallback to original
  if (typeof window.addValidatorStyles === "function" && window.addValidatorStyles !== addValidatorStyles) {
    try { window.addValidatorStyles(); return; } catch (e) { /* ignore */ }
  }
  addValidatorStylesOriginal();
}

/* ----------------------------------------------------
   HELPERS
---------------------------------------------------- */
function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/* ----------------------------------------------------
   BIND TO WINDOW (for inline onclick usage)
---------------------------------------------------- */
window.initValidators = initValidators;
window.openValidatorModal = openValidatorModal;
window.closeValidatorModal = closeValidatorModal;

console.log("🛡️ validators.js loaded (UI + fetch fallbacks)");
```
