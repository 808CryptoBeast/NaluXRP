/* =========================================
   NaluXrp 🌊 — Validators Deep Dive
   Browser-safe, UI-compatible
   ========================================= */

let validatorCache = [];
let initialized = false;

/* ----------------------------------------------------
   INIT
---------------------------------------------------- */
async function initValidators() {
  console.log("🛡️ Initializing Validators page");

  const section = document.getElementById("validators");
  if (!section) {
    console.error("❌ #validators section not found");
    return;
  }

  section.innerHTML = `
    <div class="validators-page">
      <input
        id="validatorSearch"
        placeholder="Search validators by domain or key…"
      />
      <div id="validatorsList" class="validators-loading">
        Fetching validator data from XRPL…
      </div>
    </div>
  `;

  addValidatorStyles();
  ensureValidatorModal();

  if (initialized && validatorCache.length) {
    renderValidators(validatorCache);
    setupValidatorSearch();
    return;
  }

  try {
    if (typeof window.fetchValidatorsFromNode !== "function") {
      throw new Error("XRPL client not available");
    }

    validatorCache = await window.fetchValidatorsFromNode(
      "wss://s1.ripple.com"
    );

    renderValidators(validatorCache);
    setupValidatorSearch();
    initialized = true;
  } catch (err) {
    showValidatorError(err.message);
  }
}

/* ----------------------------------------------------
   RENDER
---------------------------------------------------- */
function renderValidators(validators) {
  const list = document.getElementById("validatorsList");
  if (!list) return;

  if (!validators.length) {
    list.innerHTML =
      `<div class="validators-empty">No validators available.</div>`;
    return;
  }

  const sorted = [...validators].sort(
    (a, b) => (b.agreement_24h?.score || 0) - (a.agreement_24h?.score || 0)
  );

  list.innerHTML = `
    <div class="validators-grid">
      ${sorted.map(renderValidatorCard).join("")}
    </div>
  `;
}

function renderValidatorCard(v) {
  const key = v.validation_public_key || "—";
  const shortKey =
    key.length > 16 ? key.slice(0, 8) + "…" + key.slice(-6) : key;

  const domain = v.domain || "unknown";
  const score = calcScore(v);
  const label = scoreLabel(score);
  const unl = v.unl === true || v.unl === "Ripple";

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
        <span class="validator-pill pill-score">Score ${score}</span>
        <span class="validator-pill pill-label ${label.class}">
          ${label.text}
        </span>
      </div>

      <div class="validator-stat-row">
        <div class="validator-stat">
          <span>Agreement 24h</span>
          <strong>${pct(v.agreement_24h?.score)}</strong>
        </div>
        <div class="validator-stat">
          <span>Uptime 24h</span>
          <strong>${pct(uptime(v.agreement_24h))}</strong>
        </div>
      </div>

      <button class="validator-details-btn"
        onclick="openValidatorModal('${key}')">
        View Details
      </button>
    </div>
  `;
}

/* ----------------------------------------------------
   METRICS
---------------------------------------------------- */
function calcScore(v) {
  const a24 = v.agreement_24h?.score || 0;
  const a1 = v.agreement_1h?.score || 0;
  let score = (a24 * 0.8 + a1 * 0.2) * 100;
  if (v.unl) score += 5;
  return Math.min(100, Math.round(score));
}

function uptime(a) {
  if (!a || !a.total) return null;
  return ((a.total - a.missed) / a.total) * 100;
}

function pct(v) {
  return v == null ? "—" : `${(v * 100).toFixed(2)}%`;
}

function scoreLabel(score) {
  if (score >= 95) return { text: "Excellent", class: "label-excellent" };
  if (score >= 85) return { text: "Strong", class: "label-strong" };
  if (score >= 70) return { text: "Good", class: "label-good" };
  if (score >= 50) return { text: "Fair", class: "label-fair" };
  return { text: "Poor", class: "label-poor" };
}

/* ----------------------------------------------------
   SEARCH
---------------------------------------------------- */
function setupValidatorSearch() {
  const input = document.getElementById("validatorSearch");
  if (!input) return;

  input.addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase();
    renderValidators(
      validatorCache.filter(
        (v) =>
          (v.domain || "").toLowerCase().includes(q) ||
          (v.validation_public_key || "").toLowerCase().includes(q)
      )
    );
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
      <header>
        <h2>Validator Details</h2>
        <button onclick="closeValidatorModal()">✕</button>
      </header>
      <div id="validatorModalBody"></div>
    </div>
  `;

  document.body.appendChild(overlay);
}

function openValidatorModal(key) {
  const v = validatorCache.find(
    (x) => x.validation_public_key === key
  );
  if (!v) return;

  document.getElementById("validatorModalBody").innerHTML = `
    <p><strong>Public Key:</strong><br><code>${key}</code></p>
    <p><strong>Domain:</strong> ${v.domain || "—"}</p>
    <p><strong>Agreement 24h:</strong> ${pct(v.agreement_24h?.score)}</p>
    <p><strong>Agreement 1h:</strong> ${pct(v.agreement_1h?.score)}</p>
  `;

  document.getElementById("validatorModalOverlay").style.display = "flex";
}

function closeValidatorModal() {
  const o = document.getElementById("validatorModalOverlay");
  if (o) o.style.display = "none";
}

/* ----------------------------------------------------
   ERROR
---------------------------------------------------- */
function showValidatorError(msg) {
  const list = document.getElementById("validatorsList");
  if (!list) return;

  list.innerHTML = `
    <div class="validators-error">
      <h3>⚠️ Validators Unavailable</h3>
      <p>${msg || "Unable to fetch validator data"}</p>
    </div>
  `;
}

/* ----------------------------------------------------
   STYLES
---------------------------------------------------- */
function addValidatorStyles() {
  if (document.getElementById("validator-style-fix")) return;

  const s = document.createElement("style");
  s.id = "validator-style-fix";
  s.textContent = `.validators-page{padding:20px}`;
  document.head.appendChild(s);
}

/* ----------------------------------------------------
   EXPORTS (for ui.js + inline onclick)
---------------------------------------------------- */
window.initValidators = initValidators;
window.openValidatorModal = openValidatorModal;
window.closeValidatorModal = closeValidatorModal;

console.log("🛡️ validators.js loaded (xrplClient, UI-compatible)");
