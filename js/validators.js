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
      <div class="dashboard-page">
        <div class="chart-section">
          <div class="chart-title">🛡️ Validators</div>

          <div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap; margin-top:12px;">
            <input id="validatorSearch" placeholder="Search validators by domain, public key, or master key..." />
            <div id="validatorsSummary" style="margin-left:auto;"></div>
          </div>

          <div id="validatorsSummaryGrid" class="validators-summary-grid" style="margin-top:14px;"></div>

          <div id="validatorsList" class="validators-grid" style="margin-top:16px;">
            <div style="color: #888; text-align:center; padding:30px;">
              <div style="font-size:1.05rem; font-weight:600">Validator list will appear here</div>
              <div style="opacity:.85; margin-top:8px;">Start the proxy (dev): <code>npm run proxy</code></div>
            </div>
          </div>

        </div>
      </div>
    `;
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

  } catch (error) {
    console.error("❌ Failed to initialize validators:", error);
    showConnectionError();
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

    const resp = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: controller.signal
    });

    clearTimeout(id);

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      const msg = `HTTP ${resp.status}: ${resp.statusText}${text ? " — " + text : ""}`;
      console.warn("fetch failed for", url, msg);
      return { ok: false, error: msg };
    }

    const json = await resp.json().catch(err => {
      console.warn("fetch parse failed for", url, err && err.message ? err.message : err);
      return null;
    });

    if (json == null) return { ok: false, error: "Invalid JSON response" };
    return { ok: true, data: json };
  } catch (err) {
    const em = err && err.message ? err.message : String(err);
    console.warn("fetch failed for", url, em);
    return { ok: false, error: em };
  }
}

/* ----------------------------------------------------
   RAW rippled WebSocket one-shot helper (non-persistent)
   (used as a fallback to avoid creating another persistent xrpl.Client)
---------------------------------------------------- */
function rippledWsRequest(payload = { command: "validators" }, timeoutMs = 9000) {
  return new Promise((resolve, reject) => {
    try {
      const url = "wss://s1.ripple.com";
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
   FETCH LIVE VALIDATOR DATA (WebSocket-first, then HTTP fallbacks)
---------------------------------------------------- */
async function fetchLiveValidators() {
  const container = document.getElementById("validatorsList");
  if (!container) return;

  console.log("🌐 Fetching live validator data (WebSocket-first, proxy/Public fallback)...");

  // Update loading message
  const loadingEl = container.querySelector('.loading-subtext');
  if (loadingEl) loadingEl.textContent = 'Connecting to XRPL WebSocket (wss://s1.ripple.com)...';

  // 1) Try WebSocket via xrpl.Client (preferred — avoids CORS and proxies)
  if (typeof window.xrpl !== "undefined" && window.xrpl.Client) {
    try {
      const client = new xrpl.Client("wss://s1.ripple.com");
      await client.connect();
      console.log("🌐 Connected to rippled via WebSocket");

      // request validators
      const res = await client.request({ command: "validators" });

      try { await client.disconnect(); } catch (e) { /* no-op */ }

      // Normalize response shapes
      let validatorsArr = null;
      if (res && Array.isArray(res.validators)) validatorsArr = res.validators;
      else if (res && Array.isArray(res.result?.validators)) validatorsArr = res.result.validators;
      else if (Array.isArray(res)) validatorsArr = res;
      else {
        const arr = Object.values(res || {}).find(v => Array.isArray(v));
        if (arr) validatorsArr = arr;
      }

      if (Array.isArray(validatorsArr) && validatorsArr.length) {
        validatorCache = validatorsArr;
        console.log(`✅ Loaded ${validatorCache.length} validators via WebSocket`);
        renderValidators(validatorCache);
        showLiveDataIndicator();
        return;
      } else {
        console.warn("WebSocket validators response had no validators array — falling back to HTTP candidates", res);
        // fall through to HTTP fallback
      }
    } catch (err) {
      console.warn("WebSocket attempt failed — falling back to HTTP candidates:", err && err.message ? err.message : err);
      // fall through to HTTP fallback
    }
  } else {
    console.log("xrpl.Client not present in window — skipping WebSocket attempt");
  }

  // 2) HTTP fallback candidates
  if (loadingEl) loadingEl.textContent = 'Attempting proxy(s) and public API...';

  const candidates = [];
  if (DEPLOYED_PROXY && !DEPLOYED_PROXY.includes("<YOUR_WORKER_SUBDOMAIN>")) {
    candidates.push(`${DEPLOYED_PROXY}/validators`);
  }
  candidates.push(`${location.protocol}//${location.host}/api/validators`);
  candidates.push("http://localhost:3000/validators");
  candidates.push(PUBLIC_VALIDATORS_API);

  const attemptErrors = [];
  let data = null;
  let used = null;

  for (const candidate of candidates) {
    console.log('Attempting validator fetch from', candidate);
    const result = await tryFetchUrl(candidate);
    if (!result.ok) {
      attemptErrors.push({ url: candidate, error: result.error });
      continue;
    }

    const payload = result.data;
    let validatorsArr = null;

    if (payload && Array.isArray(payload.validators)) validatorsArr = payload.validators;
    else if (payload && Array.isArray(payload.result?.validators)) validatorsArr = payload.result.validators;
    else if (Array.isArray(payload)) validatorsArr = payload;
    else {
      const arr = Object.values(payload || {}).find(v => Array.isArray(v));
      if (arr) validatorsArr = arr;
    }

    if (Array.isArray(validatorsArr) && validatorsArr.length) {
      data = { validators: validatorsArr };
      used = candidate;
      break;
    } else {
      attemptErrors.push({ url: candidate, error: "No validators array found in response" });
    }
  }

  if (!data || !Array.isArray(data.validators)) {
    console.error("No validator data found. Attempt errors:", attemptErrors);
    const details = attemptErrors.map(a => `${a.url} → ${a.error}`).join("\n");
    showProxyError(`No validator data available.\nAttempts:\n${details}`);
    return;
  }

  validatorCache = data.validators;
  console.log(`✅ Loaded ${validatorCache.length} live validators via ${used}`);

  // Render and indicator
  renderValidators(validatorCache);
  showLiveDataIndicator();
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

  // Sort: UNL first, then by reliability score
  const sorted = [...list].sort((a, b) => {
    const aUnl = a.unl === true || a.unl === "Ripple" || a.unl === "true";
    const bUnl = b.unl === true || b.unl === "Ripple" || b.unl === "true";

    if (aUnl && !bUnl) return -1;
    if (!aUnl && bUnl) return 1;

    const aScore = calculateReliabilityScore(a);
    const bScore = calculateReliabilityScore(b);

    return bScore - aScore;
  });

  // Create stats header
  const statsHTML = `
    <div class="validators-stats">
      <div class="stats-card">
        <div class="stats-title">Total Validators</div>
        <div class="stats-value">${list.length}</div>
        <div class="stats-subtitle">Live Count</div>
      </div>
      <div class="stats-card">
        <div class="stats-title">Ripple UNL</div>
        <div class="stats-value">${unlCount}</div>
        <div class="stats-subtitle">Consensus Nodes</div>
      </div>
      <div class="stats-card">
        <div class="stats-title">Community</div>
        <div class="stats-value">${communityCount}</div>
        <div class="stats-subtitle">Independent Nodes</div>
      </div>
      <div class="stats-card">
        <div class="stats-title">Status</div>
        <div class="stats-value">🟢</div>
        <div class="stats-subtitle">Live Data</div>
      </div>
    </div>
  `;

  // Render all validators
  const validatorsHTML = sorted.map((validator, index) => {
    const metrics = calculateValidatorMetrics(validator);
    const key = validator.validation_public_key || `unknown-${index}`;
    const shortKey = key.length > 14 ? key.slice(0, 10) + "…" + key.slice(-4) : key || "—";
    const domain = validator.domain || "unknown";

    const agreement24h = validator.agreement_24h || { total: 0, missed: 0, score: 0 };
    const total = agreement24h.total || 0;
    const missed = agreement24h.missed || 0;

    return `
      <div class="validator-card ${metrics.isUnl ? 'unl-validator' : 'community-validator'}">
        <div class="validator-header">
          <div class="validator-key" title="${key}">${shortKey}</div>
          <div class="unl-badge ${metrics.isUnl ? 'unl-full' : 'unl-partial'}">
            ${metrics.isUnl ? 'Ripple UNL' : 'Community'}
          </div>
        </div>
        <div class="validator-domain">${domain}</div>
        <div class="validator-stat-row">
          <div class="validator-pill pill-score">Score ${metrics.score}/100</div>
          <div class="validator-pill pill-label ${getLabelClass(metrics.label)}">${metrics.label}</div>
        </div>
        <div class="validator-stat-row">
          <div class="validator-stat">
            <span>Uptime 24h</span><strong>${formatPercent(metrics.uptime24h)}</strong>
          </div>
          <div class="validator-stat">
            <span>Agreement 24h</span><strong>${formatPercent(metrics.agreement24)}</strong>
          </div>
        </div>
        <div class="validator-stat-row">
          <div class="validator-stat">
            <span>Total Validations</span><strong>${total}</strong>
          </div>
          <div class="validator-stat">
            <span>Missed</span><strong>${missed}</strong>
          </div>
        </div>
        <button class="validator-details-btn" onclick="openValidatorModal('${key.replace(/'/g, "\\'")}')">
          View Live Details
        </button>
      </div>
    `;
  }).join("");

  container.innerHTML = statsHTML + '<div class="validators-grid">' + validatorsHTML + '</div>';

  console.log(`✅ Rendered ${sorted.length} live validators`);
}

/* ----------------------------------------------------
   CALCULATE METRICS
---------------------------------------------------- */
function calculateValidatorMetrics(v) {
  const agreement24h = v.agreement_24h || { total: 0, missed: 0, score: 0 };
  const agreement1h = v.agreement_1h || { total: 0, missed: 0, score: 0 };

  const uptime1h = calculateUptime(agreement1h);
  const uptime24h = calculateUptime(agreement24h);
  const agreement1hScore = calculateAgreement(agreement1h);
  const agreement24hScore = calculateAgreement(agreement24h);

  const score = calculateReliabilityScore(v);

  let label;
  if (score >= 95) label = "Excellent";
  else if (score >= 85) label = "Strong";
  else if (score >= 70) label = "Good";
  else if (score >= 50) label = "Fair";
  else label = "Poor";

  const isUnl = v.unl === true || v.unl === "Ripple" || v.unl === "true";

  return {
    uptime1h,
    uptime24h,
    agreement1h: agreement1hScore,
    agreement24: agreement24hScore,
    score: Math.round(score),
    label,
    isUnl
  };
}

function getLabelClass(label) {
  if (!label) return '';
  switch (label.toLowerCase()) {
    case 'excellent': return 'label-excellent';
    case 'strong': return 'label-strong';
    case 'good': return 'label-good';
    case 'fair': return 'label-fair';
    case 'poor': return 'label-poor';
    default: return '';
  }
}

function calculateReliabilityScore(v) {
  const agreement24h = v.agreement_24h || { total: 0, missed: 0, score: 0 };
  const agreement1h = v.agreement_1h || { total: 0, missed: 0, score: 0 };

  const uptime24h = calculateUptime(agreement24h) || 0;
  const agreement24hScore = calculateAgreement(agreement24h) || 0;
  const uptime1h = calculateUptime(agreement1h) || 0;
  const agreement1hScore = calculateAgreement(agreement1h) || 0;

  const isUnl = v.unl === true || v.unl === "Ripple" || v.unl === "true";

  let score = (
    0.45 * uptime24h +
    0.35 * agreement24hScore +
    0.10 * uptime1h +
    0.10 * agreement1hScore
  );

  if (isUnl) score += 5;

  return Math.max(0, Math.min(100, score));
}

function calculateUptime(agreement) {
  if (!agreement) return null;
  const total = Number(agreement.total) || 0;
  const missed = Number(agreement.missed) || 0;
  if (total <= 0) return null;
  return ((total - missed) / total) * 100;
}

function calculateAgreement(agreement) {
  if (!agreement || agreement.score == null) return null;
  const score = Number(agreement.score) || 0;
  return score * 100;
}

function formatPercent(value) {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(2) + "%";
}

/* ----------------------------------------------------
   SEARCH FUNCTIONALITY
---------------------------------------------------- */
function setupValidatorSearch() {
  const input = document.getElementById("validatorSearch");
  if (!input) return;

  input.placeholder = "Search live validators by domain or key...";

  input.addEventListener("input", function () {
    const term = this.value.trim().toLowerCase();

    if (!term) {
      renderValidators(validatorCache);
      return;
    }

    const filtered = validatorCache.filter(v => {
      const domain = (v.domain || "").toLowerCase();
      const key = (v.validation_public_key || "").toLowerCase();
      return domain.includes(term) || key.includes(term);
    });

    renderValidators(filtered);
  });
}

/* ----------------------------------------------------
   MODAL FUNCTIONS
---------------------------------------------------- */
function ensureValidatorModal() {
  if (document.getElementById("validatorModalOverlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "validatorModalOverlay";
  overlay.className = "validator-modal-overlay";
  overlay.style.display = "none";

  overlay.innerHTML = `
    <div class="validator-modal">
      <div class="validator-modal-header">
        <h2 id="validatorModalTitle">Live Validator Details</h2>
        <button id="validatorModalClose" class="validator-modal-close">✕</button>
      </div>
      <div id="validatorModalBody" class="validator-modal-body"></div>
      <div class="validator-modal-footer">
        <small>Live data from XRPL network • Updated: ${new Date().toLocaleTimeString()}</small>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById("validatorModalClose").addEventListener("click", closeValidatorModal);

  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) closeValidatorModal();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && overlay.style.display === "flex") {
      closeValidatorModal();
    }
  });
}

function openValidatorModal(pubkey) {
  const overlay = document.getElementById("validatorModalOverlay");
  const body = document.getElementById("validatorModalBody");
  const title = document.getElementById("validatorModalTitle");

  if (!overlay || !body || !title) return;

  const validator = validatorCache.find(v => v.validation_public_key === pubkey);

  if (!validator) {
    console.error("Validator not found:", pubkey);
    return;
  }

  const metrics = calculateValidatorMetrics(validator);
  const agreement24h = validator.agreement_24h || { total: 0, missed: 0, score: 0 };
  const total24h = agreement24h.total || 0;
  const missed24h = agreement24h.missed || 0;
  const validated24h = total24h - missed24h;

  title.textContent = "Live Validator Analysis";

  body.innerHTML = `
    <div class="validator-modal-section">
      <h3>Identity & Network Role</h3>
      <p><strong>Public Key:</strong><br><code>${validator.validation_public_key || "—"}</code></p>
      <p><strong>Domain:</strong> ${validator.domain || "unknown"}</p>
      <p><strong>Role:</strong> <span class="${metrics.isUnl ? 'unl-full' : 'unl-partial'}" style="padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: bold;">
        ${metrics.isUnl ? "Ripple Recommended UNL" : "Community Validator"}
      </span></p>
    </div>

    <div class="validator-modal-section">
      <h3>Live Performance Metrics</h3>
      <div class="validator-score-row">
        <div class="validator-score-main">
          <div class="score-number">${metrics.score}</div>
          <div class="score-label ${getLabelClass(metrics.label)}">${metrics.label}</div>
        </div>
        <div class="validator-score-sub">
          <div><strong>Uptime 24h:</strong> ${formatPercent(metrics.uptime24h)}</div>
          <div><strong>Agreement 24h:</strong> ${formatPercent(metrics.agreement24)}</div>
          <div><strong>Uptime 1h:</strong> ${formatPercent(metrics.uptime1h)}</div>
          <div><strong>Agreement 1h:</strong> ${formatPercent(metrics.agreement1h)}</div>
        </div>
      </div>
      <div class="validator-stats-row">
        <div class="validator-stat-card">
          <div class="stat-title">24h Validations</div>
          <div class="stat-value">${total24h}</div>
        </div>
        <div class="validator-stat-card">
          <div class="stat-title">Missed</div>
          <div class="stat-value">${missed24h}</div>
        </div>
        <div class="validator-stat-card">
          <div class="stat-title">Successful</div>
          <div class="stat-value">${validated24h}</div>
        </div>
        <div class="validator-stat-card">
          <div class="stat-title">Success Rate</div>
          <div class="stat-value">${total24h > 0 ? ((validated24h / total24h) * 100).toFixed(1) + '%' : '—'}</div>
        </div>
      </div>
    </div>

    <div class="validator-modal-section">
      <h3>Network Features</h3>
      <div class="amendments-list">
        ${(validator.amendments && validator.amendments.length > 0 ?
          validator.amendments.map(a => `<span class="amendment-tag">${a}</span>`).join('') :
          '<p>No amendment data available</p>')}
      </div>
    </div>
  `;

  overlay.style.display = "flex";
}

function closeValidatorModal() {
  const overlay = document.getElementById("validatorModalOverlay");
  if (overlay) {
    overlay.style.display = "none";
  }
}

/* ----------------------------------------------------
   ERROR HANDLING
---------------------------------------------------- */
function showProxyError(errorMessage = '') {
  const container = document.getElementById("validatorsList");
  if (!container) return;

  container.innerHTML = `
    <div class="validators-error">
      <div style="font-size: 48px; margin-bottom: 20px;">🔄</div>
      <h3 style="color: var(--accent-primary); margin-bottom: 15px;">Proxy Server Required</h3>
      <p style="color: var(--text-primary); margin-bottom: 20px; line-height: 1.6;">
        The proxy server is not returning validator data. This is needed to fetch live XRPL validator data.
      </p>

      <div style="background: var(--card-bg); padding: 20px; border-radius: 12px; border: 1px solid var(--accent-tertiary); margin-bottom: 25px; text-align: left;">
        <h4 style="color: var(--accent-secondary); margin-bottom: 15px;">🚀 Quick Setup (dev):</h4>
        <ol style="color: var(--text-primary); padding-left: 20px; margin: 0;">
          <li style="margin-bottom: 10px;">
            <strong>Open a new terminal</strong> in your NaluXrp folder
          </li>
          <li style="margin-bottom: 10px;">
            <strong>Run this command:</strong><br>
            <code style="display: block; background: var(--bg-secondary); padding: 10px; border-radius: 6px; margin: 10px 0; font-family: monospace;">
              npm run proxy
            </code>
          </li>
          <li style="margin-bottom: 10px;">
            <strong>Keep the terminal open</strong> and return to this page
          </li>
          <li>
            <strong>Click the Retry button below</strong>
          </li>
        </ol>
      </div>

      <div style="display: flex; gap: 15px; justify-content: center; flex-wrap: wrap;">
        <button onclick="fetchLiveValidators()" style="
          padding: 12px 24px;
          background: var(--accent-primary);
          color: white;
          border: none;
          border-radius: 8px;
          font-weight: bold;
          cursor: pointer;
          transition: all 0.3s;
        ">
          🔄 Retry Connection
        </button>

        <button onclick="window.open('https://xrpl.org/validators.html', '_blank')" style="
          padding: 12px 24px;
          background: var(--accent-secondary);
          color: white;
          border: none;
          border-radius: 8px;
          font-weight: bold;
          cursor: pointer;
          transition: all 0.3s;
        ">
          🌐 View on XRPL.org
        </button>
      </div>

      ${errorMessage ? `
        <div style="margin-top: 20px; padding: 15px; background: var(--bg-secondary); border-radius: 8px; border: 1px solid var(--accent-tertiary);">
          <strong>Error Details:</strong><br>
          <code style="color: var(--text-secondary); font-size: 12px;">${errorMessage}</code>
        </div>
      ` : ''}
    </div>
  `;
}

function showConnectionError(errorMessage = '') {
  const container = document.getElementById("validatorsList");
  if (!container) return;

  container.innerHTML = `
    <div class="validators-error">
      <div style="font-size: 48px; margin-bottom: 20px;">🌐</div>
      <h3 style="color: var(--accent-primary); margin-bottom: 15px;">Connection Error</h3>
      <p style="color: var(--text-primary); margin-bottom: 20px; line-height: 1.6;">
        Unable to connect to XRPL network.
        ${errorMessage ? `<br><br><strong>Error:</strong> ${errorMessage}` : ''}
      </p>
      <button onclick="fetchLiveValidators()" style="
        padding: 12px 24px;
        background: var(--accent-primary);
        color: white;
        border: none;
        border-radius: 8px;
        font-weight: bold;
        cursor: pointer;
        margin-top: 20px;
      ">
        🔄 Retry Connection
      </button>
    </div>
  `;
}

/* ----------------------------------------------------
   LIVE DATA INDICATOR
---------------------------------------------------- */
function showLiveDataIndicator() {
  const existing = document.querySelector('.live-data-indicator');
  if (existing) existing.remove();

  const indicator = document.createElement('div');
  indicator.className = 'live-data-indicator';
  indicator.innerHTML = `
    <div style="
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: var(--success-color, #2ecc71);
      color: white;
      padding: 10px 20px;
      border-radius: 20px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      z-index: 9998;
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 14px;
      animation: fadeIn 0.3s ease;
    ">
      <div style="
        width: 8px;
        height: 8px;
        background: white;
        border-radius: 50%;
        animation: pulse 2s infinite;
      "></div>
      Live XRPL Data • ${validatorCache.length} Validators
    </div>
  `;

  document.body.appendChild(indicator);

  setTimeout(() => {
    indicator.style.animation = 'fadeOut 0.3s ease';
    setTimeout(() => indicator.remove(), 300);
  }, 5000);
}

/* ----------------------------------------------------
   ADD STYLES (full original styles restored)
---------------------------------------------------- */
function addValidatorStylesOriginal() {
  if (document.querySelector('#validator-styles')) return;

  const style = document.createElement('style');
  style.id = 'validator-styles';
  style.textContent = `
    /* Validators compact styles */
    .validators-summary-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(230px,1fr)); gap:16px; margin-bottom:18px; }
    .validators-summary-card { background:var(--card-bg, rgba(0,0,0,0.36)); border-radius:14px; border:1px solid var(--accent-tertiary, rgba(255,255,255,0.12)); padding:12px 14px; font-size:0.9rem; }
    #validatorSearch { width:100%; max-width:420px; padding:8px 10px; border-radius:10px; border:1px solid rgba(255,255,255,0.18); background:rgba(0,0,0,0.4); color:var(--text-primary); outline:none; font-size:0.92rem; margin:10px 0 16px; }
    .validators-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(230px,1fr)); gap:14px; align-items:stretch; }
    .validator-card { position:relative; display:flex; flex-direction:column; gap:6px; backdrop-filter:blur(12px); padding:14px; border-radius:12px; border:1px solid rgba(255,255,255,0.04); background:var(--card-bg); }
    .validator-header { display:flex; align-items:center; justify-content:space-between; gap:10px; }
    .validator-key { font-family: "SF Mono", Menlo, Consolas, monospace; font-size:0.82rem; color:var(--text-primary); }
    .validator-domain { font-size:0.86rem; color:var(--text-secondary); }
    .unl-badge { font-size:0.72rem; padding:4px 8px; border-radius:999px; border:1px solid rgba(255,255,255,0.2); text-transform:uppercase; }
    .unl-full { background:linear-gradient(135deg,#ffe066,#ffb347); color:#201600; box-shadow:0 0 12px rgba(255,225,120,0.6); }
    .unl-partial { background:rgba(0,0,0,0.45); color:var(--text-secondary); }
    .validator-stat-row { display:flex; gap:12px; margin-top:6px; flex-wrap:wrap; }
    .validator-pill { padding:8px 12px; border-radius:12px; font-weight:700; font-size:0.85rem; }
    .pill-score { background: linear-gradient(135deg, var(--accent-primary, #d4af37), var(--accent-secondary, #ffd700)); color:#201600; }
    .validator-stat { flex:1; background:rgba(0,0,0,0.18); padding:10px; border-radius:10px; text-align:center; border:1px solid rgba(255,255,255,0.06); }
    .validator-details-btn { margin-top:12px; padding:10px 14px; border-radius:12px; background: linear-gradient(135deg, var(--accent-primary, #d4af37), var(--accent-secondary, #ffd700)); color:#000; font-weight:700; border:none; cursor:pointer; }
    .validators-loading { text-align:center; padding:60px 40px; color:var(--text-secondary); font-size:16px; background:var(--card-bg); border-radius:16px; border:2px solid var(--accent-tertiary); margin:20px 0; }
    .loading-spinner { border:4px solid rgba(0,0,0,0.1); border-radius:50%; border-top:4px solid var(--accent-primary); width:50px; height:50px; animation:spin 1s linear infinite; margin:0 auto 25px; }
    @keyframes spin { 0%{transform:rotate(0deg);}100%{transform:rotate(360deg);} }
    .loading-subtext { font-size:14px; color:var(--text-secondary); margin-top:15px; opacity:0.8; font-style:italic; }
    .validators-error { background: var(--card-bg); border: 2px solid var(--accent-primary); border-radius: 20px; padding: 40px; text-align:center; color:var(--text-primary); margin:20px 0; box-shadow: 0 8px 40px rgba(0,0,0,0.1); }
    .validators-empty { text-align:center; padding:60px; color:var(--text-secondary); font-size:18px; background:var(--card-bg); border-radius:20px; border:2px dashed var(--accent-tertiary); margin:20px 0; }
    .validator-modal-overlay { position:fixed; inset:0; display:none; align-items:center; justify-content:center; z-index:9999; }
    .validator-modal { background:var(--bg-secondary); border-radius:18px; padding:20px; width:min(900px,95%); max-height:90vh; overflow:auto; border:2px solid var(--accent-tertiary); }
    .validator-modal-header { display:flex; justify-content:space-between; align-items:center; gap:12px; }
    .validator-modal-close { background:transparent; border:0; font-size:18px; cursor:pointer; color:var(--text-secondary); }
  `;
  document.head.appendChild(style);
}

/* Wrapper to prefer any existing global implementation, else inject original */
function addValidatorStyles() {
  if (typeof window.addValidatorStyles === "function" && window.addValidatorStyles !== addValidatorStyles) {
    try {
      window.addValidatorStyles();
      return;
    } catch (e) {
      console.warn("Existing addValidatorStyles failed, falling back to bundled styles", e);
    }
  }
  addValidatorStylesOriginal();
}

/* ----------------------------------------------------
   EXPORTS
---------------------------------------------------- */
window.initValidators = initValidators;
window.openValidatorModal = openValidatorModal;
window.closeValidatorModal = closeValidatorModal;
window.fetchLiveValidators = fetchLiveValidators;

console.log("🛡️ Live Validators module loaded (WebSocket-first)");
