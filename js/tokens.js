// ===============================
// /js/tokens.js  (ledger-first)
// ===============================
/* =========================================
   NaluXrp 🌊 — Live Ledger Tokens
   Direct trustline fetch from XRPL via xrplClient.
   ========================================= */

let tokenCache = [];
let tokenPage = 1;
const TOKENS_PER_PAGE = 25;
let tokenMode = "ledger"; // "ledger" | "global" (optional)

/* ---------- INIT ---------- */
document.addEventListener("DOMContentLoaded", () => {
  const section = document.getElementById("tokens");
  if (!section) return;

  // Wire controls
  const fetchBtn = document.getElementById("fetchLedgerTokensBtn");
  const ledgerBtn = document.getElementById("ledgerMode");
  const globalBtn = document.getElementById("globalMode");

  if (fetchBtn) fetchBtn.addEventListener("click", fetchLedgerTokens);
  if (ledgerBtn) ledgerBtn.addEventListener("click", () => switchMode("ledger"));
  if (globalBtn) globalBtn.addEventListener("click", () => switchMode("global"));

  // Default highlight
  if (ledgerBtn) ledgerBtn.classList.add("active");

  // Search binding
  const search = document.getElementById("tokenSearch");
  if (search) {
    search.addEventListener("input", onSearch);
  }
});

/* ---------- MODE SWITCH ---------- */
function switchMode(mode) {
  tokenMode = mode;
  const ledgerBtn = document.getElementById("ledgerMode");
  const globalBtn = document.getElementById("globalMode");
  if (ledgerBtn) ledgerBtn.classList.toggle("active", mode === "ledger");
  if (globalBtn) globalBtn.classList.toggle("active", mode === "global");

  if (mode === "ledger") fetchLedgerTokens();
  else fetchGlobalTokens(); // optional; can be stubbed/disabled
}

/* ---------- LEDGER TOKEN FETCH ---------- */
async function fetchLedgerTokens() {
  const container = document.getElementById("tokensList");
  const input = document.getElementById("ledgerAccountInput");
  const account = (input?.value?.trim()) || (window.userWallet?.address);

  if (!container) return;

  if (!account) {
    container.innerHTML = `<div class="loading">⚠️ Enter an XRPL address or connect a wallet in Profile.</div>`;
    return;
  }

  if (!window.xrplClient || !xrplClient.isConnected()) {
    container.innerHTML = `<div class="loading-error">❌ XRPL connection not ready.</div>`;
    return;
  }

  container.innerHTML = `<div class="loading">🌊 Fetching trustlines for ${account.slice(0,12)}…</div>`;

  try {
    const res = await xrplClient.request({
      command: "account_lines",
      account,
      limit: 400
    });

    tokenCache = (res.result?.lines || []).map(line => ({
      currency: line.currency,
      issuer: line.account,
      balance: Number(line.balance),
      limit: line.limit,
      quality_in: line.quality_in,
      quality_out: line.quality_out,
      authorized: !!line.authorized,
      ripplingDisabled: !!line.no_ripple || !!line.no_ripple_peer
    }));

    if (!tokenCache.length) {
      container.innerHTML = `<div class="loading">No trustline tokens found for this account.</div>`;
      clearTokenChart();
      return;
    }

    tokenPage = 1;
    renderTokens(tokenPage);
    renderTokenDistributionChart(tokenCache);
  } catch (err) {
    console.error("❌ Error fetching ledger tokens:", err);
    container.innerHTML = `<div class="loading-error">❌ Failed to fetch tokens (check address/connection).</div>`;
    clearTokenChart();
  }
}

/* ---------- OPTIONAL GLOBAL TOKENS (stub or wire your proxy) ---------- */
async function fetchGlobalTokens() {
  const container = document.getElementById("tokensList");
  if (!container) return;
  container.innerHTML = `<div class="loading">🌍 Loading top tokens (global index)…</div>`;

  try {
    // If you have your proxy, call it here; else soft-disable.
    // const res = await fetch("http://localhost:3000/api/tokens");
    // const data = await res.json();
    // tokenCache = (data.data || data.tokens || data).slice(0, 50);

    tokenCache = []; // disabled by default to keep ledger-first
    container.innerHTML = `<div class="loading">Global index disabled. Using ledger mode.</div>`;
  } catch (e) {
    container.innerHTML = `<div class="loading-error">⚠️ Global index unavailable.</div>`;
  }
}

/* ---------- RENDER LIST ---------- */
function renderTokens(page = 1) {
  const container = document.getElementById("tokensList");
  if (!container) return;

  const start = (page - 1) * TOKENS_PER_PAGE;
  const pageItems = tokenCache.slice(start, start + TOKENS_PER_PAGE);

  container.innerHTML = pageItems.map(t => `
    <div class="token-card">
      <div class="token-header">
        <div class="token-name">${sanitize(t.currency)}</div>
        <div class="token-currency">${sanitize(t.issuer?.slice(0, 16) || "")}…</div>
      </div>
      <div class="token-meta">
        <div><strong>Balance:</strong> ${isFinite(t.balance) ? t.balance.toFixed(2) : "—"}</div>
        <div><strong>Limit:</strong> ${t.limit || "—"}</div>
        <div><strong>Quality In:</strong> ${t.quality_in ?? "—"}</div>
        <div><strong>Quality Out:</strong> ${t.quality_out ?? "—"}</div>
        <div><strong>Authorized:</strong> ${t.authorized ? "✅" : "❌"}</div>
        <div><strong>Rippling Disabled:</strong> ${t.ripplingDisabled ? "✅" : "❌"}</div>
      </div>
    </div>
  `).join("");

  renderTokenPagination();
}

/* ---------- PAGINATION ---------- */
function renderTokenPagination() {
  const container = document.getElementById("tokensList");
  if (!container) return;

  const totalPages = Math.ceil(tokenCache.length / TOKENS_PER_PAGE);
  if (totalPages <= 1) return;

  const pagination = document.createElement("div");
  pagination.classList.add("pagination");

  for (let i = 1; i <= totalPages; i++) {
    const btn = document.createElement("button");
    btn.classList.add("page-btn");
    if (i === tokenPage) btn.classList.add("active");
    btn.textContent = i;
    btn.addEventListener("click", () => {
      tokenPage = i;
      renderTokens(i);
    });
    pagination.appendChild(btn);
  }

  container.appendChild(pagination);
}

/* ---------- SEARCH ---------- */
function onSearch(e) {
  const term = (e.target.value || "").toLowerCase();
  const filtered = tokenCache.filter(t =>
    (t.currency || "").toLowerCase().includes(term) ||
    (t.issuer || "").toLowerCase().includes(term)
  );
  renderFilteredTokens(filtered);
}

function renderFilteredTokens(list) {
  const container = document.getElementById("tokensList");
  if (!container) return;

  if (!list.length) {
    container.innerHTML = `<div class="loading">No matching tokens.</div>`;
    clearTokenChart();
    return;
  }

  container.innerHTML = list.map(t => `
    <div class="token-card">
      <div class="token-header">
        <div class="token-name">${sanitize(t.currency)}</div>
        <div class="token-currency">${sanitize(t.issuer?.slice(0, 16) || "")}…</div>
      </div>
      <div class="token-meta">
        <div><strong>Balance:</strong> ${isFinite(t.balance) ? t.balance.toFixed(2) : "—"}</div>
        <div><strong>Limit:</strong> ${t.limit || "—"}</div>
      </div>
    </div>
  `).join("");

  renderTokenDistributionChart(list);
}

/* ---------- CHART ---------- */
function renderTokenDistributionChart(tokens) {
  const canvas = document.getElementById("tokenDistributionChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const labels = tokens.map(t => t.currency);
  const balances = tokens.map(t => Math.abs(Number(t.balance)) || 0);

  if (window.tokenChart) window.tokenChart.destroy();

  window.tokenChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data: balances,
        borderWidth: 1,
        backgroundColor: balances.map((_, i) => `hsl(${(i * 47) % 360}, 70%, 60%)`),
      }]
    },
    options: {
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => `${c.label}: ${c.formattedValue}` } }
      },
      cutout: "60%"
    }
  });
}

function clearTokenChart() {
  if (window.tokenChart) {
    window.tokenChart.destroy();
    window.tokenChart = null;
  }
}

/* ---------- HELPERS ---------- */
function sanitize(s) { return String(s ?? "").replace(/[<>&"]/g, ""); }

/* ---------- AUTO REFRESH ON NEW LEDGER ---------- */
window.addEventListener("xrpl-ledger", () => {
  const section = document.getElementById("tokens");
  if (!section?.classList.contains("active")) return;
  if (tokenMode === "ledger") fetchLedgerTokens();
});

/* ---------- EXPOSE ---------- */
window.fetchLedgerTokens = fetchLedgerTokens;
