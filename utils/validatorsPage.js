/* =========================================
   NaluXrp 🌊 — Validators Page
   XRPL one-shot RPC via xrplClient.js
   ========================================= */

import { fetchValidatorsFromNode } from "./xrplClient.js";

const ValidatorsPage = {
  mounted: false,
  cache: [],

  async mount() {
    const section = document.getElementById("validators");
    if (!section) {
      console.error("❌ #validators section missing");
      return;
    }

    section.innerHTML = `
      <div class="validators-page">
        <header class="validators-header">
          <h2>🛡️ XRPL Validators</h2>
          <p>Live validator performance via XRPL RPC</p>
        </header>

        <input
          id="validatorSearch"
          class="validator-search"
          placeholder="Search by domain or public key…"
        />

        <div id="validatorsList" class="validators-loading">
          Connecting to XRPL node…
        </div>
      </div>
    `;

    this.injectStyles();

    if (!this.mounted) {
      await this.load();
      this.bindSearch();
      this.mounted = true;
    } else {
      this.render(this.cache);
    }
  },

  async load() {
    try {
      const validators = await fetchValidatorsFromNode("wss://s1.ripple.com");
      this.cache = validators;
      this.render(validators);
    } catch (err) {
      this.showError(err.message);
    }
  },

  /* -----------------------------
     RENDER
  ----------------------------- */
  render(validators) {
    const list = document.getElementById("validatorsList");
    if (!list) return;

    if (!validators.length) {
      list.innerHTML = `<div class="validators-empty">No validators returned.</div>`;
      return;
    }

    // Sort: UNL first, then by confidence score
    const sorted = [...validators].sort((a, b) => {
      const aUnl = a.unl === true || a.unl === "Ripple";
      const bUnl = b.unl === true || b.unl === "Ripple";
      if (aUnl !== bUnl) return aUnl ? -1 : 1;
      return this.confidence(b) - this.confidence(a);
    });

    list.innerHTML = `
      <div class="validators-grid">
        ${sorted.map(v => this.card(v)).join("")}
      </div>
    `;
  },

  card(v) {
    const key = v.validation_public_key || "—";
    const short =
      key.length > 16 ? key.slice(0, 8) + "…" + key.slice(-6) : key;

    const domain = v.domain || "unknown";
    const unl = v.unl === true || v.unl === "Ripple";
    const score = this.score(v);
    const confidence = this.confidence(v);

    return `
      <div class="validator-card ${unl ? "unl" : "community"}">
        <div class="validator-key" title="${key}">${short}</div>
        <div class="validator-domain">${domain}</div>

        <div class="validator-metrics">
          <span class="metric">Score: <strong>${score}</strong></span>
          <span class="metric">Confidence: <strong>${confidence}</strong></span>
        </div>

        <span class="badge ${unl ? "unl" : "community"}">
          ${unl ? "Ripple UNL" : "Community"}
        </span>
      </div>
    `;
  },

  /* -----------------------------
     METRICS / LOGIC
  ----------------------------- */
  score(v) {
    const a24 = v.agreement_24h?.score || 0;
    const a1 = v.agreement_1h?.score || 0;
    return Math.round((a24 * 0.7 + a1 * 0.3) * 100);
  },

  confidence(v) {
    const total = v.agreement_24h?.total || 0;
    const missed = v.agreement_24h?.missed || 0;
    if (!total) return 0;

    // Confidence = participation stability
    return Math.round(((total - missed) / total) * 100);
  },

  /* -----------------------------
     SEARCH
  ----------------------------- */
  bindSearch() {
    const input = document.getElementById("validatorSearch");
    if (!input) return;

    input.addEventListener("input", e => {
      const q = e.target.value.toLowerCase();
      this.render(
        this.cache.filter(v =>
          (v.domain || "").toLowerCase().includes(q) ||
          (v.validation_public_key || "").toLowerCase().includes(q)
        )
      );
    });
  },

  /* -----------------------------
     ERROR
  ----------------------------- */
  showError(msg) {
    const list = document.getElementById("validatorsList");
    if (!list) return;

    list.innerHTML = `
      <div class="validators-error">
        <h3>⚠️ Validators Unavailable</h3>
        <p>${msg || "XRPL node did not return validator data."}</p>
      </div>
    `;
  },

  /* -----------------------------
     STYLES (scoped)
  ----------------------------- */
  injectStyles() {
    if (document.getElementById("validators-page-styles")) return;

    const s = document.createElement("style");
    s.id = "validators-page-styles";
    s.textContent = `
      .validators-page { padding: 24px }
      .validators-header h2 { margin-bottom: 4px }
      .validator-search {
        width: 100%;
        padding: 14px;
        margin: 20px 0;
        border-radius: 12px;
        border: 1px solid var(--accent-tertiary);
      }
      .validators-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
        gap: 20px;
      }
      .validator-card {
        background: var(--card-bg);
        border-radius: 16px;
        padding: 18px;
        border: 2px solid var(--accent-tertiary);
      }
      .validator-key {
        font-family: monospace;
        margin-bottom: 6px;
      }
      .validator-domain {
        color: var(--text-secondary);
        margin-bottom: 10px;
      }
      .validator-metrics {
        display: flex;
        justify-content: space-between;
        margin-bottom: 8px;
      }
      .badge {
        padding: 4px 10px;
        border-radius: 12px;
        font-size: 12px;
        display: inline-block;
      }
      .badge.unl { background: #2ecc71; color: #fff }
      .badge.community { background: #f39c12; color: #fff }
    `;
    document.head.appendChild(s);
  }
};

export default ValidatorsPage;
