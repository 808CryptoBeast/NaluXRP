/* =========================================
   NaluXrp 🌊 — Validators Module (Fixed)
   Live validator stats + CORS-safe fetching
   ========================================= */

const VALIDATORS_API = "https://corsproxy.io/?https://data.ripple.com/v2/network/validators"; 
let validatorCache = [];

/* ---------- INIT ---------- */
document.addEventListener("DOMContentLoaded", async () => {
  const container = document.getElementById("validatorsList");
  if (!container) return; // safety guard

  await fetchValidators();
  setupValidatorSearch();

  // Auto-refresh validators every minute
  setInterval(fetchValidators, 60000);

  // Also refresh whenever a new ledger closes
  window.addEventListener("xrpl-ledger", fetchValidators);
});

/* ---------- FETCH VALIDATORS ---------- */
async function fetchValidators() {
  const container = document.getElementById("validatorsList");
  if (!container) return;

  try {
    const res = await fetch(VALIDATORS_API);
    const data = await res.json();

    validatorCache = data.validators || [];
    displayValidators(validatorCache);
  } catch (err) {
    console.error("❌ Error fetching validators:", err);
    container.innerHTML = `
      <div style="color: #ff5555; padding: 10px;">
        ❌ Error loading validator data.<br>
        <small>(Network/CORS issue or Ripple API timeout)</small>
      </div>
    `;
  }
}

/* ---------- DISPLAY VALIDATORS ---------- */
function displayValidators(validators) {
  const container = document.getElementById("validatorsList");
  if (!container) return;

  if (!validators.length) {
    container.innerHTML = `<div style="color:#888;">No validator data available.</div>`;
    return;
  }

  container.innerHTML = validators
    .slice(0, 50) // show top 50 for performance
    .map(v => {
      const unl = v.unl || "—";
      const domain = v.domain || "unknown";
      const agreement = (v.agreement_24h ?? 0).toFixed(2);
      const uptime = (v.uptime_24h ?? 0).toFixed(2);
      const pubkey = v.validation_public_key?.slice(0, 12) || "—";
      const unlBadge = unl === "Ripple" ? "unl-full" : "unl-partial";

      return `
        <div class="validator-card">
          <div class="validator-header">
            <div class="validator-key">${pubkey}...</div>
            <div class="unl-badge ${unlBadge}">
              ${unl === "Ripple" ? "Ripple UNL" : "Community"}
            </div>
          </div>
          <div class="validator-stats">
            <div class="validator-stat">
              <div class="validator-stat-label">Domain</div>
              <div class="validator-stat-value">${domain}</div>
            </div>
            <div class="validator-stat">
              <div class="validator-stat-label">Uptime (24h)</div>
              <div class="validator-stat-value">${uptime}%</div>
            </div>
            <div class="validator-stat">
              <div class="validator-stat-label">Agreement</div>
              <div class="validator-stat-value">${agreement}%</div>
            </div>
          </div>
        </div>
      `;
    })
    .join("");
}

/* ---------- SEARCH ---------- */
function setupValidatorSearch() {
  const input = document.getElementById("validatorSearch");
  const container = document.getElementById("validatorsList");
  if (!input || !container) return;

  input.addEventListener("input", () => {
    const term = input.value.toLowerCase();
    const filtered = validatorCache.filter(v =>
      v.domain?.toLowerCase().includes(term) ||
      v.validation_public_key?.toLowerCase().includes(term)
    );
    displayValidators(filtered);
  });
}
