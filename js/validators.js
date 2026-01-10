/* =========================================
   NaluXrp 🌊 — Validators (shared XRPL connection)
   Uses the app's shared XRPL client (preferred) and HTTP proxy fallback.
   This version removes creating its own persistent xrpl.Client and
   relies on window.requestXrpl or window.XRPL.client when available.
   ========================================= */

/* ---------- CONFIG ---------- */
// If you deploy a public proxy (Cloudflare Worker / Vercel / Render),
// set DEPLOYED_PROXY to its base URL (HTTPS recommended).
// Example: const DEPLOYED_PROXY = "https://naluxrp-proxy.onrender.com";
const DEPLOYED_PROXY = "https://<YOUR_DEPLOYED_PROXY>"; // <- set to your deployed proxy or leave as-is for localhost/dev

const PUBLIC_VALIDATORS_API = "https://api.xrpl.org/v2/network/validators?limit=200";

let validatorCache = [];
let isInitialized = false;

/* ----------------------------------------------------
   SAFE DOM BOILERPLATE
---------------------------------------------------- */
(function ensureValidatorsDOM() {
  const section = document.getElementById("validators");
  if (!section) return;

  if (!document.getElementById("validatorsList")) {
    section.innerHTML = `
      <div class="dashboard-page">
        <div class="chart-section">
          <div class="chart-title">🛡️ Validators</div>

          <div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap; margin-top:12px;">
            <input id="validatorSearch" placeholder="Search validators by domain or key..." />
            <div id="validatorsSummary" style="margin-left:auto;"></div>
          </div>

          <div id="validatorsList" class="validators-loading" style="margin-top:16px;">
            <div class="loading-spinner"></div>
            Initializing validators…
            <div class="loading-subtext">Waiting for shared XRPL connection or proxy...</div>
          </div>
        </div>
      </div>
    `;
  }
})();

/* ----------------------------------------------------
   INIT
---------------------------------------------------- */
async function initValidators() {
  console.log("🛡️ Initializing validators module (shared-connection-first)...");

  const listContainer = document.getElementById("validatorsList");
  if (!listContainer) {
    console.error("❌ validatorsList container not found");
    return;
  }

  if (isInitialized && validatorCache.length > 0) {
    renderValidators(validatorCache);
    setupValidatorSearch();
    return;
  }

  isInitialized = true;

  addValidatorStyles();
  ensureValidatorModal();

  listContainer.innerHTML = `
    <div class="validators-loading">
      <div class="loading-spinner"></div>
      Fetching validator data…
      <div class="loading-subtext">Using shared XRPL connection if available…</div>
    </div>
  `;

  try {
    await fetchLiveValidators();
    setupValidatorSearch();
    console.log("✅ Validators initialized");
  } catch (err) {
    console.warn("Validators init error:", err);
    showConnectionError(err && err.message ? err.message : "Unknown error");
  }
}

/* ----------------------------------------------------
   FETCH HELPERS
---------------------------------------------------- */
async function tryFetchUrl(url, timeoutMs = 8000) {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);

    const resp = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
      credentials: "same-origin",
    });

    clearTimeout(id);

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      const msg = `HTTP ${resp.status}: ${text ? text.slice(0, 400) : resp.statusText}`;
      return { ok: false, error: msg };
    }

    const contentType = resp.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const json = await resp.json();
      return { ok: true, data: json };
    } else {
      const text = await resp.text();
      try {
        return { ok: true, data: JSON.parse(text) };
      } catch {
        return { ok: false, error: "Invalid JSON response" };
      }
    }
  } catch (err) {
    const msg = err && err.name === "AbortError" ? "Timeout" : (err && err.message ? err.message : String(err));
    return { ok: false, error: msg };
  }
}

/* ----------------------------------------------------
   PRIMARY FETCH: prefer shared client (requestXrpl / window.XRPL.client)
   If shared client unavailable or returns nothing, fall back to:
    - one-shot rippled WebSocket (raw)
    - HTTP candidate chain (DEPLOYED_PROXY, same-origin /api/validators, localhost, public API)
---------------------------------------------------- */
async function fetchLiveValidators() {
  const container = document.getElementById("validatorsList");
  if (!container) return;

  const loadingEl = container.querySelector(".loading-subtext");
  if (loadingEl) loadingEl.textContent = "Querying shared XRPL connection...";

  // 1) Use requestXrpl wrapper if available (preferred)
  if (typeof window.requestXrpl === "function") {
    try {
      const res = await window.requestXrpl({ command: "validators" }, { timeoutMs: 9000 });
      const validators = normalizeValidatorsResponse(res);
      if (validators && validators.length) {
        validatorCache = validators;
        renderValidators(validatorCache);
        showLiveDataIndicator();
        console.log(`✅ Loaded ${validators.length} validators via window.requestXrpl`);
        return;
      } else {
        console.warn("requestXrpl returned no validators, trying other approaches");
      }
    } catch (err) {
      console.warn("window.requestXrpl failed:", err && err.message ? err.message : err);
    }
  }

  // 2) Use shared XRPL client directly if available
  try {
    if (window.XRPL && window.XRPL.client && window.XRPL.connected && typeof window.XRPL.client.request === "function") {
      if (loadingEl) loadingEl.textContent = "Querying shared XRPL.client...";
      try {
        const res = await window.XRPL.client.request({ command: "validators" });
        const validators = normalizeValidatorsResponse(res);
        if (validators && validators.length) {
          validatorCache = validators;
          renderValidators(validatorCache);
          showLiveDataIndicator();
          console.log(`✅ Loaded ${validators.length} validators via window.XRPL.client`);
          return;
        } else {
          console.warn("window.XRPL.client returned no validators, trying other approaches");
        }
      } catch (err) {
        console.warn("window.XRPL.client.request failed:", err && err.message ? err.message : err);
      }
    }
  } catch (e) {
    console.warn("Shared XRPL client not usable:", e && e.message ? e.message : e);
  }

  // 3) One-shot raw rippled WebSocket (non-persistent) fallback
  if (loadingEl) loadingEl.textContent = "Querying rippled via one-shot WebSocket...";
  try {
    const wsRes = await rippledWsRequest({ command: "validators" }, 9000);
    const validators = normalizeValidatorsResponse(wsRes);
    if (validators && validators.length) {
      validatorCache = validators;
      renderValidators(validatorCache);
      showLiveDataIndicator();
      console.log(`✅ Loaded ${validators.length} validators via one-shot WebSocket`);
      return;
    } else {
      console.warn("One-shot WS returned no validators, continuing to HTTP fallbacks");
    }
  } catch (err) {
    console.warn("one-shot rippled WS failed:", err && err.message ? err.message : err);
  }

  // 4) HTTP fallback chain
  if (loadingEl) loadingEl.textContent = "Attempting proxy(s) and public API...";
  const candidates = [];
  if (DEPLOYED_PROXY && !DEPLOYED_PROXY.includes("<YOUR_DEPLOYED_PROXY>")) candidates.push(`${DEPLOYED_PROXY}/validators`);
  candidates.push(`${location.protocol}//${location.host}/api/validators`);
  candidates.push("http://localhost:3000/validators");
  candidates.push(PUBLIC_VALIDATORS_API);

  const attemptErrors = [];
  let found = null;
  let used = null;

  for (const url of candidates) {
    try {
      console.log("Attempting validator fetch from", url);
      const r = await tryFetchUrl(url, 9000);
      if (!r.ok) {
        attemptErrors.push({ url, error: r.error });
        continue;
      }

      const validators = normalizeValidatorsResponse(r.data);
      if (validators && validators.length) {
        found = validators;
        used = url;
        break;
      } else {
        attemptErrors.push({ url, error: "No validators array in response" });
      }
    } catch (err) {
      attemptErrors.push({ url, error: err && err.message ? err.message : String(err) });
    }
  }

  if (!found) {
    const details = attemptErrors.map(a => `${a.url} → ${a.error}`).join("\n");
    console.error("No validator data found. Attempt errors:", attemptErrors);
    showProxyError(`No validator data available.\nAttempts:\n${details}`);
    return;
  }

  validatorCache = found;
  renderValidators(validatorCache);
  showLiveDataIndicator();
  console.log(`✅ Loaded ${validatorCache.length} validators via ${used}`);
}

/* ----------------------------------------------------
   Small helper: normalize validator responses that may be shaped differently
---------------------------------------------------- */
function normalizeValidatorsResponse(res) {
  if (!res) return null;
  // Common shapes:
  // { validators: [...] }
  // { result: { validators: [...] } }
  // { validator_list: [...] }
  // direct array [...]
  if (Array.isArray(res)) return res;
  if (Array.isArray(res.validators)) return res.validators;
  if (Array.isArray(res.result?.validators)) return res.result.validators;
  if (Array.isArray(res.validator_list)) return res.validator_list;
  // try to find any array value
  const arr = Object.values(res).find(v => Array.isArray(v));
  if (arr) return arr;
  return null;
}

/* ----------------------------------------------------
   Lightweight one-shot WebSocket helper (used as fallback)
   (prevents creating another persistent xrpl.Client in-browser)
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
          try { ws.close(); } catch (e) {}
          reject(new Error("WS timeout"));
        }
      }, timeoutMs);

      ws.addEventListener("open", () => {
        try {
          ws.send(JSON.stringify(payload));
        } catch (e) { /* continue */ }
      });

      ws.addEventListener("message", (ev) => {
        if (finished) return;
        finished = true;
        clearTimeout(t);
        try {
          const parsed = JSON.parse(ev.data);
          ws.close();
          resolve(parsed.result || parsed);
        } catch (err) {
          ws.close();
          reject(err);
        }
      });

      ws.addEventListener("error", (err) => {
        if (finished) return;
        finished = true;
        clearTimeout(t);
        try { ws.close(); } catch (e) {}
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
   RENDERING
---------------------------------------------------- */
function renderValidators(list) {
  const container = document.getElementById("validatorsList");
  if (!container) return;

  if (!list || !list.length) {
    container.innerHTML = '<div class="validators-empty">No live validator data available.</div>';
    return;
  }

  const unlCount = list.filter(v => v.unl === true || v.unl === "Ripple" || v.unl === "true").length;
  const communityCount = list.length - unlCount;

  const sorted = [...list].sort((a, b) => {
    const aUnl = a.unl === true || a.unl === "Ripple" || a.unl === "true";
    const bUnl = b.unl === true || b.unl === "Ripple" || b.unl === "true";
    if (aUnl && !bUnl) return -1;
    if (!aUnl && bUnl) return 1;
    const aScore = (a.agreement_24h?.score || 0) + (a.agreement_1h?.score || 0);
    const bScore = (b.agreement_24h?.score || 0) + (b.agreement_1h?.score || 0);
    return bScore - aScore;
  });

  const statsHTML = `
    <div class="validators-summary-grid" style="margin-bottom:14px">
      <div class="validators-summary-card"><div class="summary-title">Total Validators</div><div class="summary-value">${list.length}</div></div>
      <div class="validators-summary-card"><div class="summary-title">Ripple UNL</div><div class="summary-value">${unlCount}</div></div>
      <div class="validators-summary-card"><div class="summary-title">Community</div><div class="summary-value">${communityCount}</div></div>
    </div>
  `;

  const validatorsHTML = sorted.map((v, idx) => {
    const key = v.validation_public_key || v.public_key || `unknown-${idx}`;
    const shortKey = key.length > 16 ? key.slice(0, 8) + "…" + key.slice(-6) : key;
    const domain = v.domain || v.domain_name || "unknown";
    const a24 = v.agreement_24h?.score ?? null;
    const a1 = v.agreement_1h?.score ?? null;
    const score = Math.round(((a24 || 0) * 0.7 + (a1 || 0) * 0.3) * 100);
    const unl = v.unl === true || v.unl === "Ripple" || v.unl === "true";

    return `
      <div class="validator-card ${unl ? "unl-validator" : "community-validator"}">
        <div class="validator-header">
          <div class="validator-key" title="${key}">${shortKey}</div>
          <div class="unl-badge ${unl ? "unl-full" : "unl-partial"}">${unl ? "Ripple UNL" : "Community"}</div>
        </div>

        <div class="validator-domain">${domain}</div>

        <div class="validator-stat-row">
          <div class="validator-pill pill-score">Score ${score}</div>
          <div class="validator-pill pill-label">${a24 != null ? (a24 * 100).toFixed(2) + "%" : "—"}</div>
        </div>

        <div class="validator-stat-row">
          <div class="validator-stat"><span>Agreement 24h</span><strong>${a24 != null ? (a24 * 100).toFixed(2) + "%" : "—"}</strong></div>
          <div class="validator-stat"><span>Uptime 24h</span><strong>${formatPercent(v.agreement_24h && typeof v.agreement_24h.score === "number" ? ((v.agreement_24h.total - v.agreement_24h.missed) / Math.max(1, v.agreement_24h.total)) * 100 : null)}</strong></div>
        </div>

        <button class="validator-details-btn" onclick="openValidatorModal('${key.replace(/'/g, "\\'")}')">View Details</button>
      </div>
    `;
  }).join("");

  container.innerHTML = statsHTML + '<div class="validators-grid">' + validatorsHTML + '</div>';
}

/* ----------------------------------------------------
   METRICS helpers
---------------------------------------------------- */
function formatPercent(v) {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(2) + "%";
}

/* ----------------------------------------------------
   SEARCH
---------------------------------------------------- */
function setupValidatorSearch() {
  const input = document.getElementById("validatorSearch");
  if (!input) return;
  input.placeholder = "Search live validators by domain or key...";

  input.addEventListener("input", function () {
    const q = this.value.trim().toLowerCase();
    if (!q) return renderValidators(validatorCache);
    const filtered = validatorCache.filter(v => {
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
      <div class="validator-modal-header">
        <h2 id="validatorModalTitle">Validator Details</h2>
        <button id="validatorModalClose" class="validator-modal-close">✕</button>
      </div>
      <div id="validatorModalBody" class="validator-modal-body"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById("validatorModalClose").addEventListener("click", closeValidatorModal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeValidatorModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && overlay.style.display === "flex") closeValidatorModal(); });
}

function openValidatorModal(pubkey) {
  const overlay = document.getElementById("validatorModalOverlay");
  const body = document.getElementById("validatorModalBody");
  const title = document.getElementById("validatorModalTitle");
  if (!overlay || !body || !title) return;

  const v = validatorCache.find(x => (x.validation_public_key || x.public_key) === pubkey);
  if (!v) return;

  const agreement24h = v.agreement_24h || { total: 0, missed: 0, score: 0 };
  const total = agreement24h.total || 0;
  const missed = agreement24h.missed || 0;
  const successRate = total > 0 ? (((total - missed) / total) * 100).toFixed(2) + "%" : "—";

  title.textContent = "Validator Details";
  body.innerHTML = `
    <div class="validator-modal-section">
      <h3>Identity</h3>
      <p><strong>Public Key:</strong><br><code>${v.validation_public_key || v.public_key || "—"}</code></p>
      <p><strong>Domain:</strong> ${v.domain || v.domain_name || "—"}</p>
    </div>

    <div class="validator-modal-section">
      <h3>Performance</h3>
      <p><strong>Agreement 24h:</strong> ${formatPercent((v.agreement_24h?.score ?? null) !== null ? (v.agreement_24h.score * 100) : null)}</p>
      <p><strong>Uptime 24h:</strong> ${successRate}</p>
    </div>

    <div class="validator-modal-section">
      <h3>Raw Data</h3>
      <pre style="white-space:pre-wrap; max-height:300px; overflow:auto;">${escapeHtml(JSON.stringify(v, null, 2))}</pre>
    </div>
  `;

  overlay.style.display = "flex";
}

function closeValidatorModal() {
  const overlay = document.getElementById("validatorModalOverlay");
  if (overlay) overlay.style.display = "none";
}

/* ----------------------------------------------------
   ERRORS / UI
---------------------------------------------------- */
function showProxyError(errorMessage = "") {
  const container = document.getElementById("validatorsList");
  if (!container) return;
  container.innerHTML = `
    <div class="validators-error">
      <h3>⚠️ Validators Unavailable</h3>
      <p>${escapeHtml(errorMessage || "Unable to fetch validator data from proxy or network.")}</p>
      <div style="margin-top:12px;">
        <button onclick="fetchLiveValidators()" class="nav-btn">Retry</button>
      </div>
    </div>
  `;
}

function showConnectionError(errorMessage = "") {
  const container = document.getElementById("validatorsList");
  if (!container) return;
  container.innerHTML = `
    <div class="validators-error">
      <h3>🔌 Connection Error</h3>
      <p>${escapeHtml(errorMessage || "Shared XRPL connection not available.")}</p>
      <div style="margin-top:12px;">
        <button onclick="fetchLiveValidators()" class="nav-btn">Retry</button>
      </div>
    </div>
  `;
}

function showLiveDataIndicator() {
  const existing = document.querySelector(".live-data-indicator");
  if (existing) existing.remove();
  const indicator = document.createElement("div");
  indicator.className = "live-data-indicator";
  indicator.style.position = "fixed";
  indicator.style.bottom = "16px";
  indicator.style.right = "16px";
  indicator.style.padding = "8px 12px";
  indicator.style.background = "var(--success-color,#2ecc71)";
  indicator.style.color = "#fff";
  indicator.style.borderRadius = "12px";
  indicator.style.zIndex = 9999;
  indicator.textContent = `Live XRPL Data • ${validatorCache.length} validators`;
  document.body.appendChild(indicator);
  setTimeout(() => indicator.remove(), 4500);
}

/* ----------------------------------------------------
   STYLES & HELPERS
---------------------------------------------------- */
function addValidatorStylesOriginal() {
  if (document.querySelector("#validator-styles")) return;
  const s = document.createElement("style");
  s.id = "validator-styles";
  s.textContent = `
    .validators-summary-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:12px}
    .validators-summary-card{background:var(--card-bg);padding:10px;border-radius:10px;border:1px solid var(--accent-tertiary)}
    .validators-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
    .validator-card{background:var(--card-bg);padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,0.04)}
    .validator-key{font-family:monospace}
    .validator-domain{color:var(--text-secondary);margin:6px 0}
    .validator-stat-row{display:flex;gap:8px;justify-content:space-between;align-items:center}
    .validator-pill{padding:6px 10px;border-radius:999px;background:rgba(255,255,255,0.04)}
    .validator-details-btn{margin-top:8px;padding:8px 12px;border-radius:10px;border:1px solid var(--accent-tertiary);background:transparent;cursor:pointer}
    .validators-loading{padding:18px}
    .validators-error{padding:18px;background:var(--card-bg);border-radius:12px}
    .validator-modal-overlay{position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);z-index:9999}
    .validator-modal{width:min(720px,95%);background:var(--bg-secondary);border-radius:12px;padding:14px;border:1px solid var(--accent-tertiary)}
  `;
  document.head.appendChild(s);
}

function addValidatorStyles() {
  if (typeof window.addValidatorStyles === "function" && window.addValidatorStyles !== addValidatorStyles) {
    try { window.addValidatorStyles(); return; } catch (e) { /* fallback */ }
  }
  addValidatorStylesOriginal();
}

function escapeHtml(str) {
  if (str == null) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* ----------------------------------------------------
   EXPORTS
---------------------------------------------------- */
window.initValidators = initValidators;
window.openValidatorModal = openValidatorModal;
window.closeValidatorModal = closeValidatorModal;
window.fetchLiveValidators = fetchLiveValidators;

console.log("🛡️ Validators (shared-client) module loaded");
