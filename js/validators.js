/* =========================================
   NaluXrp 🌊 — Validators Deep Dive
   Live XRPL validator metrics + modal
   ========================================= */

// Use local proxy server to avoid CORS issues
const VALIDATORS_API_CANDIDATES = [
  `${location.protocol}//${location.host}/validators`,
  "http://localhost:3000/validators",
  "https://api.xrpl.org/v2/network/validators?limit=200"
];

let validatorCache = [];
let isInitialized = false;
let proxyServerAvailable = true;

/* ----------------------------------------------------
   DEFENSIVE DOM CREATION
   Ensure expected DOM nodes exist so initValidators doesn't abort
---------------------------------------------------- */
(function ensureValidatorsDOM() {
  const section = document.getElementById('validators');
  if (!section) return;

  if (!document.getElementById('validatorsList')) {
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
              <div style="opacity:.85; margin-top:8px;">Start the proxy: <code>npm run proxy</code></div>
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
      <div class="loading-subtext">Connecting via local proxy server...</div>
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
   FETCH HELPER: tryFetchUrl
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
      throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    }

    const json = await resp.json();
    return json;
  } catch (err) {
    console.warn('fetch failed for', url, err && err.message ? err.message : err);
    return null;
  }
}

/* ----------------------------------------------------
   FETCH LIVE VALIDATOR DATA - MULTI-ENDPOINT FALLBACK
---------------------------------------------------- */
async function fetchLiveValidators() {
  const container = document.getElementById("validatorsList");
  if (!container) return;
  
  console.log("🌐 Fetching live validator data via proxy (with fallbacks)...");
  
  // Update loading message
  if (container.querySelector('.loading-subtext')) {
    container.querySelector('.loading-subtext').textContent = 'Connecting to local proxy server...';
  }
  
  try {
    let data = null;
    let used = null;

    for (const candidate of VALIDATORS_API_CANDIDATES) {
      console.log('Attempting validator fetch from', candidate);
      const attempt = await tryFetchUrl(candidate);
      if (!attempt) continue;

      // Normalize response shapes into { validators: [] }
      if (Array.isArray(attempt.validators)) {
        data = { validators: attempt.validators };
      } else if (Array.isArray(attempt.result?.validators)) {
        data = { validators: attempt.result.validators };
      } else if (Array.isArray(attempt)) {
        data = { validators: attempt };
      } else {
        const arr = Object.values(attempt || {}).find(v => Array.isArray(v));
        if (arr) data = { validators: arr };
      }

      if (data && Array.isArray(data.validators) && data.validators.length) {
        used = candidate;
        break;
      }
    }

    if (!data || !data.validators || !Array.isArray(data.validators)) {
      throw new Error('Invalid response format from any candidate');
    }

    validatorCache = data.validators;
    console.log(`✅ Loaded ${validatorCache.length} live validators via ${used}`);
    
    // Show stats
    const unlCount = validatorCache.filter(v => v.unl === true || v.unl === "Ripple" || v.unl === "true").length;
    const communityCount = validatorCache.length - unlCount;
    console.log(`📊 Live Stats: ${unlCount} UNL, ${communityCount} Community`);
    
    // Render
    renderValidators(validatorCache);
    
    // Show success message
    showLiveDataIndicator();
    
  } catch (error) {
    console.error("❌ Error fetching live validators:", error);
    showProxyError(error.message || String(error));
  }
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
    
    // UNL validators first
    if (aUnl && !bUnl) return -1;
    if (!aUnl && bUnl) return 1;
    
    // Then by reliability score
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
    
    // Use available data or provide defaults
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
            <span>Agreement 24h</span><strong>${formatPercent(metrics.agreement24h)}</strong>
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
        <button class="validator-details-btn" onclick="openValidatorModal('${key}')">
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
  
  // Reliability label
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
    agreement24h: agreement24hScore,
    score: Math.round(score),
    label,
    isUnl
  };
}

function getLabelClass(label) {
  switch(label.toLowerCase()) {
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
  
  // Weighted score calculation
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
  
  input.addEventListener("input", function() {
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
  
  overlay.addEventListener("click", function(e) {
    if (e.target === overlay) closeValidatorModal();
  });
  
  document.addEventListener("keydown", function(e) {
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
          <div><strong>Agreement 24h:</strong> ${formatPercent(metrics.agreement24h)}</div>
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
        The local proxy server is not running. This is needed to fetch live XRPL validator data.
      </p>
      
      <div style="background: var(--card-bg); padding: 20px; border-radius: 12px; border: 1px solid var(--accent-tertiary); margin-bottom: 25px; text-align: left;">
        <h4 style="color: var(--accent-secondary); margin-bottom: 15px;">🚀 Quick Setup:</h4>
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
        " onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'>
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
        " onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'>
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
   Remainder of file kept unchanged (styles, modal, helpers, exports)
---------------------------------------------------- */

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
  
  // Reliability label
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
    agreement24h: agreement24hScore,
    score: Math.round(score),
    label,
    isUnl
  };
}

function getLabelClass(label) {
  switch(label.toLowerCase()) {
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
  
  // Weighted score calculation
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
  
  input.addEventListener("input", function() {
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
  
  overlay.addEventListener("click", function(e) {
    if (e.target === overlay) closeValidatorModal();
  });
  
  document.addEventListener("keydown", function(e) {
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
          <div><strong>Agreement 24h:</strong> ${formatPercent(metrics.agreement24h)}</div>
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
        The local proxy server is not running. This is needed to fetch live XRPL validator data.
      </p>
      
      <div style="background: var(--card-bg); padding: 20px; border-radius: 12px; border: 1px solid var(--accent-tertiary); margin-bottom: 25px; text-align: left;">
        <h4 style="color: var(--accent-secondary); margin-bottom: 15px;">🚀 Quick Setup:</h4>
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
        " onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'>
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
        " onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'>
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
   EXPORT FUNCTIONS TO WINDOW
   (keep existing exports)
---------------------------------------------------- */
window.initValidators = initValidators;
window.openValidatorModal = openValidatorModal;
window.closeValidatorModal = closeValidatorModal;
window.fetchLiveValidators = fetchLiveValidators;

console.log("🛡️ Live Validators module loaded successfully");
