/* =========================================
   NaluXrp 🌊 – Dashboard V2 (FORENSICS EXPANDED)
   REAL DATA ONLY - No Mock Data

   ✅ Kept EXACT: Ledger Overview (metrics) + Ledger Stream cards (design/markup)
   ✅ Kept: Network selector + connection box + patterns/dominance panel
   ➕ Forensics additions (real-data)

   ✅ FIXES ADDED:
      - Ledger stream ordering is canonical by ledgerIndex (dedupe + sort)
      - Late ledgers insert correctly (no arrival-order glitches)
      - Ledger stream DISPLAY is ASCENDING (counts up visually)
      - Removed timestamps from ledger stream cards
      - Smooth continuous right→left scroll via RAF (no animation reset)
      - Continuity checks (gap detection)
      - Notifications do NOT block navbar/dropdowns (pointer-events fix)

   ✅ NEW FIX (this patch):
      - Forensics alerts are NON-BLOCKING by default:
        "Alerts Tray" inside Forensics Toolkit
      - Alert modes: Tray (default) / Toast (rate-limited) / Off
      - Clear alerts button
      - Toasts are heavily rate-limited + only for higher-signal alerts
   ========================================= */

(function () {
  const MAX_STREAM_LEDGERS = 10;          // display
  const MAX_REPLAY_LEDGERS = 250;         // retained history for replay/forensics
  const DEFAULT_FLOW_WINDOW = 20;         // 5 / 20 / 50
  const DEFAULT_ALERT_FINGERPRINT_MIN = 3;

  // Stream motion tuning (px/sec). “a little faster” than slow, but stable.
  const STREAM_SCROLL_PX_PER_SEC = 52;

  // Alerts
  const DEFAULT_ALERT_MODE = "tray";      // "tray" | "toast" | "off"
  const MAX_ALERT_LOG = 60;
  const TOAST_RATE_LIMIT_MS = 9000;       // at most 1 toast / 9s
  const TOAST_MIN_CONFIDENCE = 75;        // only toast if confidence high (prevents spam)
  const TOAST_MIN_REPEATS_EXTRA = 1;      // require repeats >= (min + extra) for toast

  const Dashboard = {
    charts: {},
    initialized: false,

    // Display stream (kept)
    ledgerStream: [],

    // Extended history for replay/forensics (canonical store)
    replayHistory: [], // newest-first by ledgerIndex, deduped

    // Raw recent tx window (from XRPL module, if provided)
    recentTransactions: [],

    // Forensics settings
    flowWindowSize: DEFAULT_FLOW_WINDOW,
    alertFingerprintMin: DEFAULT_ALERT_FINGERPRINT_MIN,
    replayIndex: null, // ledgerIndex selected for replay (null = live)

    // Alerts (NEW)
    alertMode: DEFAULT_ALERT_MODE, // "tray" | "toast" | "off"
    alertsLog: [],                // newest-first
    lastToastAt: 0,               // ms timestamp for rate-limit
    lastAlerts: new Set(),        // dedupe key set

    // Derived / UI state
    selectedTraceLedgers: new Set(),

    // Stream animation state (RAF-based to prevent jumps)
    _streamRAF: null,
    _streamLastTS: 0,
    _streamOffsetX: 0,
    _streamLoopWidth: 0,
    _streamNeedsMeasure: true,

    render() {
      const container = document.getElementById("dashboard");
      if (!container) {
        console.error("NaluXrp: #dashboard section not found.");
        return;
      }

      container.innerHTML = `
        <div class="dashboard-page">
          <div class="dashboard-header">
            <div class="network-selector">
              <span class="selector-label">🌐 Network:</span>
              <button class="net-btn" data-network="xrpl-mainnet">
                <img src="images/xrplmainnet.jpg" class="net-icon" alt="XRPL" onerror="this.style.display='none'"> Mainnet
              </button>
              <button class="net-btn" data-network="xrpl-testnet">
                <img src="images/xrptestnet.jpg" class="net-icon" alt="Testnet" onerror="this.style.display='none'"> Testnet
              </button>
              <button class="net-btn" data-network="xahau-mainnet">
                <img src="images/xahau.jpg" class="net-icon" alt="Xahau" onerror="this.style.display='none'"> Xahau
              </button>
            </div>

            <div class="connection-box">
              <span id="connDot" class="conn-dot"></span>
              <span id="connText">Connecting to XRPL…</span>
            </div>
          </div>

          <div class="dashboard-columns">
            <div class="dashboard-col-main">

              <!-- METRICS (KEPT EXACT) -->
              <section class="dashboard-metrics">
                <div class="dashboard-metrics-title">🌊 Ledger Overview</div>

                <div class="dashboard-metric-grid">
                  <article class="metric-card">
                    <div class="metric-label">Ledger Index</div>
                    <div class="metric-value" id="d2-ledger-index">—</div>
                    <div class="metric-sub" id="d2-ledger-age">Waiting…</div>
                  </article>

                  <article class="metric-card">
                    <div class="metric-label">TX / Second</div>
                    <div class="metric-value" id="d2-tps">—</div>
                    <div class="metric-sub" id="d2-tps-trend">Waiting…</div>
                  </article>

                  <article class="metric-card">
                    <div class="metric-label">Avg Fee (XRP)</div>
                    <div class="metric-value" id="d2-fee">—</div>
                    <div class="metric-sub" id="d2-fee-note">Waiting…</div>
                  </article>

                  <article class="metric-card">
                    <div class="metric-label">Validators</div>
                    <div class="metric-value" id="d2-validators">—</div>
                    <div class="metric-sub" id="d2-validator-health">Waiting…</div>
                  </article>

                  <article class="metric-card">
                    <div class="metric-label">TX / Ledger</div>
                    <div class="metric-value" id="d2-tx-per-ledger">—</div>
                    <div class="metric-sub" id="d2-tx-spread">Waiting…</div>
                  </article>

                  <article class="metric-card">
                    <div class="metric-label">Load Factor</div>
                    <div class="metric-value" id="d2-load">—</div>
                    <div class="metric-sub" id="d2-load-note">Waiting…</div>
                  </article>
                </div>
              </section>

              <!-- PATTERNS & DOMINANCE (KEPT) -->
              <section class="widget-card">
                <header class="widget-header">
                  <div class="widget-title">🧠 Ledger Patterns & Dominance</div>
                  <span class="widget-tag">Explainable Signals</span>
                </header>

                <div class="widget-body">
                  <div class="widget-row">
                    <span class="widget-label">Dominant Activity</span>
                    <span class="widget-value" id="d2-dominant-type">—</span>
                  </div>

                  <div class="widget-row">
                    <span class="widget-label">Dominance Strength</span>
                    <span class="widget-value" id="d2-dominance-score">—</span>
                  </div>

                  <div class="widget-row">
                    <span class="widget-label">Pattern Flags</span>
                    <span class="widget-value badge-warn" id="d2-pattern-flags">None</span>
                  </div>

                  <div class="mini-bar">
                    <div class="mini-bar-fill" id="d2-dominance-bar" style="width: 0%;"></div>
                  </div>

                  <div class="widget-row" style="margin-top: 10px;">
                    <span class="widget-label">Interpretation</span>
                    <span class="widget-label" id="d2-pattern-explain" style="text-align:right;">Waiting…</span>
                  </div>
                </div>
              </section>

              <!-- LEDGER STREAM (KEPT EXACT DESIGN) -->
              <section class="widget-card ledger-stream-card">
                <header class="widget-header">
                  <div class="widget-title">⚡ Real-Time Ledger Stream</div>
                  <span class="widget-tag">Last 10 Ledgers</span>
                </header>

                <div class="widget-body">
                  <div class="ledger-stream-shell" id="ledgerStreamShell">
                    <div class="ledger-stream-track" id="ledgerStreamTrack">
                      <div class="widget-label" style="padding: 40px;">Connecting to XRPL…</div>
                    </div>
                    <div class="ledger-stream-particles" id="ledgerStreamParticles"></div>
                  </div>
                </div>
              </section>

              <!-- NEW: FORENSICS TOOLKIT -->
              <section class="widget-card">
                <header class="widget-header">
                  <div class="widget-title">🧭 Forensics Toolkit</div>
                  <span class="widget-tag">Flow • Clusters • Replay</span>
                </header>

                <div class="widget-body">
                  <div class="widget-row" style="align-items:flex-start;">
                    <div style="flex:1;">
                      <div class="widget-label" style="margin-bottom:6px;">Flow Window</div>
                      <div class="orderbook-row" id="d2-flow-window-buttons" style="gap:8px;">
                        <span class="widget-pill" data-window="5">5</span>
                        <span class="widget-pill" data-window="20">20</span>
                        <span class="widget-pill" data-window="50">50</span>
                        <span class="widget-pill" data-window="live">LIVE</span>
                      </div>
                    </div>

                    <div style="flex:1;">
                      <div class="widget-label" style="margin-bottom:6px;">Alert Threshold</div>
                      <div class="widget-row" style="gap:10px;">
                        <span class="widget-label">Fingerprint ≥</span>
                        <input id="d2-alert-min" type="number" min="2" max="20" value="${DEFAULT_ALERT_FINGERPRINT_MIN}"
                          style="width:90px; padding:8px 10px; border-radius:10px; border:1px solid rgba(255,255,255,0.12); background:rgba(0,0,0,0.25); color:inherit;" />
                      </div>
                    </div>
                  </div>

                  <div class="widget-row" style="margin-top:12px; align-items:flex-start;">
                    <div style="flex:1;">
                      <div class="widget-label" style="margin-bottom:6px;">Replay Timeline</div>
                      <input id="d2-replay-slider" type="range" min="0" max="0" value="0"
                        style="width:100%; accent-color: currentColor;" />
                      <div class="widget-row" style="margin-top:6px;">
                        <span class="widget-label">Selected</span>
                        <span class="widget-value" id="d2-replay-label">LIVE</span>
                      </div>
                    </div>

                    <div style="flex:1;">
                      <div class="widget-label" style="margin-bottom:6px;">Export</div>
                      <div class="orderbook-row" style="gap:8px;">
                        <span class="widget-pill" id="d2-export-json">Export JSON</span>
                        <span class="widget-pill" id="d2-export-csv">Export CSV</span>
                        <span class="widget-pill" id="d2-clear-trace">Clear Trace</span>
                      </div>
                    </div>
                  </div>

                  <!-- NEW: Alert Mode -->
                  <div class="widget-row" style="margin-top:12px; align-items:flex-start;">
                    <div style="flex:1;">
                      <div class="widget-label" style="margin-bottom:6px;">Alerts Mode</div>
                      <div class="orderbook-row" id="d2-alert-mode-buttons" style="gap:8px;">
                        <span class="widget-pill" data-alertmode="tray">Tray</span>
                        <span class="widget-pill" data-alertmode="toast">Toast</span>
                        <span class="widget-pill" data-alertmode="off">Off</span>
                        <span class="widget-pill" id="d2-alert-clear">Clear</span>
                      </div>
                      <div class="d2-alert-hint" id="d2-alert-hint">Non-blocking tray is active.</div>
                    </div>

                    <div style="flex:1;">
                      <div class="widget-label" style="margin-bottom:6px;">Status</div>
                      <div class="widget-row" style="gap:10px;">
                        <span class="widget-label" id="d2-forensics-status" style="text-align:right; width:100%;">Waiting for ledgers…</span>
                      </div>
                    </div>
                  </div>

                  <!-- NEW: Alerts Tray (non-blocking) -->
                  <div class="d2-alert-tray" id="d2-alert-tray">
                    <div class="d2-alert-tray-head">
                      <div class="widget-label">🚨 Alerts</div>
                      <div class="d2-alert-count" id="d2-alert-count">0</div>
                    </div>
                    <div class="d2-alert-feed" id="d2-alert-feed">
                      <div class="widget-label">No alerts yet.</div>
                    </div>
                  </div>
                </div>
              </section>

              <!-- NEW: BREADCRUMBS -->
              <section class="widget-card">
                <header class="widget-header">
                  <div class="widget-title">👣 Wallet Flow Breadcrumbs</div>
                  <span class="widget-tag">Repeated Fingerprints</span>
                </header>

                <div class="widget-body">
                  <div class="widget-row">
                    <span class="widget-label">Top Signals</span>
                    <span class="widget-label" id="d2-breadcrumb-meta" style="text-align:right;">—</span>
                  </div>
                  <div id="d2-breadcrumb-list" class="gateway-list">
                    <div class="widget-label">Waiting…</div>
                  </div>
                </div>
              </section>

              <!-- NEW: CLUSTERS -->
              <section class="widget-card">
                <header class="widget-header">
                  <div class="widget-title">🕸️ Cluster Inference</div>
                  <span class="widget-tag">Graph-Based • No Identity</span>
                </header>

                <div class="widget-body">
                  <div class="widget-row">
                    <span class="widget-label">Persistence</span>
                    <span class="widget-value" id="d2-cluster-persistence">—</span>
                  </div>
                  <div id="d2-cluster-list" class="gateway-list">
                    <div class="widget-label">Waiting…</div>
                  </div>
                </div>
              </section>

              <!-- NEW: DELTA NARRATIVES -->
              <section class="widget-card">
                <header class="widget-header">
                  <div class="widget-title">📖 Ledger-to-Ledger Delta Narratives</div>
                  <span class="widget-tag">Explainable Changes</span>
                </header>

                <div class="widget-body">
                  <div id="d2-delta-narratives" class="gateway-list">
                    <div class="widget-label">Waiting…</div>
                  </div>
                </div>
              </section>

            </div>
          </div>
        </div>
      `;

      this.injectFixStyles();
      this.injectForensicsStyles();
      this.bindNetworkButtons();
      this.initLedgerStreamParticles();
      this.bindForensicsControls();

      // ✅ Start smooth stream animation (prevents jump/reset)
      this.startStreamAnimation();

      // Alert UI init
      this.applyAlertModeUI();
      this.renderAlertsTray();

      this.initialized = true;
      console.log("✅ Dashboard rendered - waiting for real XRPL data");
    },

    /* =========================
       FIX STYLES:
       - notifications not blocking navbar
       - stream smoother (hint browser)
       - broaden toast selectors (more libraries)
       ========================= */
    injectFixStyles() {
      if (document.getElementById("d2-fix-style")) return;
      const style = document.createElement("style");
      style.id = "d2-fix-style";
      style.textContent = `
        /* Prevent notification overlays from blocking navbar/dropdowns */
        #notifications,
        .notifications,
        .notification-container,
        .toast-container,
        .toast-wrapper,
        .toasts,
        .Toastify__toast-container,
        .notyf,
        .notyf__wrapper,
        .iziToast-wrapper,
        .izitoast-wrapper,
        .swal2-container {
          pointer-events: none !important;
          z-index: 9999 !important;
        }
        #notifications .notification,
        .notifications .notification,
        .notification-container .notification,
        .toast-container .toast,
        .toast-wrapper .toast,
        .toasts .toast,
        .Toastify__toast,
        .notyf__toast,
        .iziToast {
          pointer-events: auto !important;
        }

        /* Stream perf */
        #ledgerStreamTrack { will-change: transform; }
      `;
      document.head.appendChild(style);
    },

    injectForensicsStyles() {
      if (document.getElementById("d2-forensics-style")) return;
      const style = document.createElement("style");
      style.id = "d2-forensics-style";
      style.textContent = `
        .widget-pill { cursor: pointer; user-select:none; }
        .widget-pill.is-active { outline: 2px solid rgba(255,255,255,0.20); }

        .ledger-card.is-trace {
          box-shadow: 0 0 0 2px rgba(255, 204, 102, 0.65), 0 0 22px rgba(255, 204, 102, 0.15);
          transform: translateY(-1px);
        }

        .d2-bc-item { cursor:pointer; }
        .d2-bc-sub { opacity: 0.85; font-size: 12px; margin-top: 3px; }
        .d2-bc-row { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; }

        /* Alerts tray (non-blocking) */
        .d2-alert-tray {
          margin-top: 12px;
          border-radius: 14px;
          border: 1px solid rgba(255,255,255,0.10);
          background: rgba(0,0,0,0.18);
          overflow: hidden;
        }
        .d2-alert-tray-head {
          display:flex;
          justify-content:space-between;
          align-items:center;
          padding: 10px 12px;
          border-bottom: 1px solid rgba(255,255,255,0.08);
          background: rgba(255,255,255,0.03);
        }
        .d2-alert-count {
          font-size: 12px;
          padding: 4px 10px;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.14);
          background: rgba(0,0,0,0.22);
          color: inherit;
        }
        .d2-alert-feed {
          max-height: 160px;
          overflow: auto;
          padding: 10px 12px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .d2-alert-item {
          border-radius: 12px;
          border: 1px solid rgba(255,255,255,0.10);
          background: rgba(0,0,0,0.18);
          padding: 10px 10px;
        }
        .d2-alert-top {
          display:flex;
          justify-content:space-between;
          align-items:flex-start;
          gap: 10px;
        }
        .d2-alert-title {
          font-weight: 700;
          font-size: 13px;
          line-height: 1.25;
        }
        .d2-alert-meta {
          opacity: 0.85;
          font-size: 12px;
          margin-top: 3px;
        }
        .d2-alert-badges {
          display:flex;
          gap: 6px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }
        .d2-alert-badge {
          font-size: 11px;
          padding: 3px 8px;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.14);
          background: rgba(255,255,255,0.04);
          white-space: nowrap;
        }
        .d2-alert-actions {
          display:flex;
          gap: 8px;
          margin-top: 8px;
          justify-content: flex-end;
        }
        .d2-alert-btn {
          font-size: 12px;
          padding: 6px 10px;
          border-radius: 10px;
          border: 1px solid rgba(255,255,255,0.14);
          background: rgba(0,0,0,0.20);
          color: inherit;
          cursor: pointer;
        }
        .d2-alert-btn:hover { filter: brightness(1.08); }
        .d2-alert-hint {
          margin-top: 6px;
          font-size: 12px;
          opacity: 0.85;
        }
      `;
      document.head.appendChild(style);
    },

    bindNetworkButtons() {
      const buttons = document.querySelectorAll(".net-btn[data-network]");
      buttons.forEach((btn) => {
        btn.addEventListener("click", () => {
          const net = btn.getAttribute("data-network");
          console.log("🌐 Network requested:", net);
          if (typeof window.setXRPLNetwork === "function") {
            window.setXRPLNetwork(net);
          }
        });
      });
    },

    bindForensicsControls() {
      const windowWrap = document.getElementById("d2-flow-window-buttons");
      if (windowWrap) {
        const pills = windowWrap.querySelectorAll(".widget-pill[data-window]");
        const setActive = (val) => {
          pills.forEach((p) => p.classList.toggle("is-active", p.getAttribute("data-window") === String(val)));
        };

        setActive(String(this.flowWindowSize));

        pills.forEach((p) => {
          p.addEventListener("click", () => {
            const w = p.getAttribute("data-window");
            if (w === "live") {
              this.replayIndex = null;
              this.updateReplayUI();
              this.renderLiveStreamFromHistory();
              setActive("live");
              return;
            }
            const num = Number(w);
            if (!Number.isFinite(num) || num <= 0) return;
            this.flowWindowSize = num;
            setActive(String(num));
            this.runForensicsPipeline();
          });
        });
      }

      const alertMin = document.getElementById("d2-alert-min");
      if (alertMin) {
        alertMin.addEventListener("change", () => {
          const v = Number(alertMin.value);
          if (Number.isFinite(v) && v >= 2 && v <= 20) {
            this.alertFingerprintMin = v;
            this.runForensicsPipeline();
          }
        });
      }

      const slider = document.getElementById("d2-replay-slider");
      if (slider) {
        slider.addEventListener("input", () => {
          const idx = Number(slider.value);
          const item = this.replayHistory[idx];
          if (!item) this.replayIndex = null;
          else this.replayIndex = item.ledgerIndex;

          this.updateReplayUI();
          this.renderReplayStream();
          this.runForensicsPipeline();
        });
      }

      const btnJson = document.getElementById("d2-export-json");
      if (btnJson) btnJson.addEventListener("click", () => this.exportForensicReport("json"));

      const btnCsv = document.getElementById("d2-export-csv");
      if (btnCsv) btnCsv.addEventListener("click", () => this.exportForensicReport("csv"));

      const btnClear = document.getElementById("d2-clear-trace");
      if (btnClear) btnClear.addEventListener("click", () => this.clearTrace());

      // NEW: alert modes
      const modeWrap = document.getElementById("d2-alert-mode-buttons");
      if (modeWrap) {
        const pills = modeWrap.querySelectorAll(".widget-pill[data-alertmode]");
        const setActive = () => {
          pills.forEach((p) => p.classList.toggle("is-active", p.getAttribute("data-alertmode") === this.alertMode));
        };
        setActive();

        pills.forEach((p) => {
          p.addEventListener("click", () => {
            const m = p.getAttribute("data-alertmode");
            if (!m) return;
            this.alertMode = m;
            this.applyAlertModeUI();
            setActive();
          });
        });

        const clearBtn = document.getElementById("d2-alert-clear");
        if (clearBtn) {
          clearBtn.addEventListener("click", () => this.clearAlerts());
        }
      }
    },

    applyAlertModeUI() {
      const hint = document.getElementById("d2-alert-hint");
      const tray = document.getElementById("d2-alert-tray");
      if (hint) {
        hint.textContent =
          this.alertMode === "tray" ? "Non-blocking tray is active." :
          this.alertMode === "toast" ? "Toasts are ON (rate-limited, high-signal only)." :
          "Alerts are OFF.";
      }
      if (tray) {
        tray.style.display = (this.alertMode === "tray") ? "block" : "none";
      }
      this.renderAlertsTray();
    },

    clearAlerts() {
      this.alertsLog = [];
      this.renderAlertsTray();
    },

    /* =========================
       Incoming state apply
       ========================= */
    applyXRPLState(state) {
      if (!state) return;

      this.updateTopMetrics(state);

      // Capture raw recent tx window if provided (real-data only)
      if (Array.isArray(state.recentTransactions)) {
        this.recentTransactions = state.recentTransactions.slice(-2000);
      }

      // Ledger stream ingestion
      if (state.latestLedger?.ledgerIndex) {
        this.pushLedgerToStream(state.latestLedger);
      } else if (state.ledgerIndex) {
        this.pushLedgerToStream({
          ledgerIndex: state.ledgerIndex,
          closeTime: state.ledgerTime || new Date(),
          totalTx: state.txPerLedger || 0,
          txTypes: state.txTypes || {},
          avgFee: state.avgFee || 0,
          successRate: 99.9,
        });
      }

      this.updateReplayUI();
      this.runForensicsPipeline();
    },

    /* =========================
       Helpers for ORDER + TIME
       ========================= */
    coerceLedgerIndex(v) {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    },

    coerceCloseTime(v) {
      if (v instanceof Date) return v;
      if (typeof v === "number") return new Date(v * 1000);
      if (typeof v === "string") {
        const d = new Date(v);
        return Number.isFinite(d.getTime()) ? d : new Date();
      }
      return new Date();
    },

    // Canonical upsert into replayHistory:
    // - Dedup by ledgerIndex
    // - Sort newest-first by ledgerIndex
    // - Keep bounded
    upsertReplayLedger(cardData) {
      const li = this.coerceLedgerIndex(cardData?.ledgerIndex);
      if (li == null) return;

      const idx = this.replayHistory.findIndex((x) => x.ledgerIndex === li);
      if (idx >= 0) this.replayHistory[idx] = cardData;
      else this.replayHistory.push(cardData);

      this.replayHistory.sort((a, b) => (b.ledgerIndex - a.ledgerIndex));

      if (this.replayHistory.length > MAX_REPLAY_LEDGERS) {
        this.replayHistory = this.replayHistory.slice(0, MAX_REPLAY_LEDGERS);
      }
    },

    /* =========================
       TxType normalization (KEPT)
       ========================= */
    normalizeTxTypes(txTypes) {
      const t = txTypes || {};
      const agg = { Payment: 0, Offer: 0, NFT: 0, TrustSet: 0, Other: 0 };

      agg.Offer += Number(t.Offer || 0);
      agg.Offer += Number(t.OfferCreate || 0);
      agg.Offer += Number(t.OfferCancel || 0);

      agg.NFT += Number(t.NFT || 0);
      agg.NFT += Number(t.NFTMint || 0);
      agg.NFT += Number(t.NFTBurn || 0);
      agg.NFT += Number(t.NFTokenMint || 0);
      agg.NFT += Number(t.NFTokenBurn || 0);

      agg.Payment += Number(t.Payment || 0);
      agg.TrustSet += Number(t.TrustSet || 0);

      for (const [k, v] of Object.entries(t)) {
        if (
          k === "Payment" ||
          k === "Offer" ||
          k === "OfferCreate" ||
          k === "OfferCancel" ||
          k === "NFT" ||
          k === "NFTMint" ||
          k === "NFTBurn" ||
          k === "NFTokenMint" ||
          k === "NFTokenBurn" ||
          k === "TrustSet"
        ) continue;
        agg.Other += Number(v || 0);
      }

      const totalAgg = agg.Payment + agg.Offer + agg.NFT + agg.TrustSet + agg.Other;
      if (!totalAgg) {
        if (typeof t.Payment === "number") agg.Payment = t.Payment;
        if (typeof t.Offer === "number") agg.Offer = t.Offer;
        if (typeof t.NFT === "number") agg.NFT = t.NFT;
        if (typeof t.TrustSet === "number") agg.TrustSet = t.TrustSet;
        if (typeof t.Other === "number") agg.Other = t.Other;
      }

      return agg;
    },

    /* =========================
       Top metrics (KEPT)
       ========================= */
    updateTopMetrics(state) {
      const $ = (id) => document.getElementById(id);

      if ($("d2-ledger-index")) $("d2-ledger-index").textContent = state.ledgerIndex != null ? state.ledgerIndex.toLocaleString() : "—";
      if ($("d2-ledger-age")) $("d2-ledger-age").textContent = `Age: ${state.ledgerAge || "—"}`;

      if ($("d2-tps")) {
        const tps = state.tps != null ? state.tps : state.txnPerSec != null ? state.txnPerSec : null;
        $("d2-tps").textContent = tps != null ? Number(tps).toFixed(1) : "—";
      }
      if ($("d2-tps-trend")) $("d2-tps-trend").textContent = state.tpsTrend || "Trend: Collecting…";

      if ($("d2-fee")) {
        const fee = state.avgFee != null ? state.avgFee : state.feeAvg != null ? state.feeAvg : null;
        $("d2-fee").textContent = fee != null ? Number(fee).toFixed(6) : "—";
      }
      if ($("d2-fee-note")) {
        const fee = state.avgFee != null ? state.avgFee : state.feeAvg != null ? state.feeAvg : null;
        if (fee != null) {
          if (fee < 0.00001) $("d2-fee-note").textContent = "Very Low";
          else if (fee < 0.00002) $("d2-fee-note").textContent = "Stable";
          else $("d2-fee-note").textContent = "Elevated";
        } else $("d2-fee-note").textContent = "—";
      }

      if (state.validators) {
        const v = state.validators;
        const total = v.total != null ? v.total : typeof state.validators === "number" ? state.validators : null;

        if ($("d2-validators")) $("d2-validators").textContent = total != null ? String(total) : "—";
        if ($("d2-validator-health")) {
          const healthy = v.healthy != null ? v.healthy : total != null ? Math.round(total * 0.95) : null;
          $("d2-validator-health").textContent = healthy != null ? `Healthy: ${healthy}` : "Healthy: —";
        }
      }

      if ($("d2-tx-per-ledger")) {
        const tpl = state.txPerLedger != null ? state.txPerLedger : state.txnPerLedger != null ? state.txnPerLedger : null;
        $("d2-tx-per-ledger").textContent = tpl != null ? String(tpl) : "—";
      }
      if ($("d2-tx-spread")) $("d2-tx-spread").textContent = `Spread: ${state.txSpread || "—"}`;

      if ($("d2-load")) {
        const lf = state.loadFactor != null ? state.loadFactor : state.loadFee != null ? state.loadFee : null;
        $("d2-load").textContent = lf != null ? Number(lf).toFixed(2) : "—";
      }
      if ($("d2-load-note")) {
        const lf = state.loadFactor != null ? state.loadFactor : state.loadFee != null ? state.loadFee : 1.0;
        $("d2-load-note").textContent = state.loadNote || (lf > 1.2 ? "Elevated" : "Normal");
      }
    },

    /* =========================
       Ledger stream (cards) — KEPT DESIGN
       + FIX: canonical insert order
       ========================= */
    pushLedgerToStream(summary, opts = {}) {
      const li = this.coerceLedgerIndex(summary?.ledgerIndex);
      if (li == null) return;

      const closeDate = this.coerceCloseTime(summary.closeTime);
      const groupedTxTypes = this.normalizeTxTypes(summary.txTypes || {});
      const domType = this.getDominantType(groupedTxTypes);

      const cardData = {
        ledgerIndex: li,
        closeTime: closeDate,
        totalTx: summary.totalTx ?? 0,
        txTypes: groupedTxTypes,
        avgFee: summary.avgFee ?? 0,
        successRate: summary.successRate ?? 99.9,
        dominantType: domType,
        flowEdges: Array.isArray(summary.flowEdges) ? summary.flowEdges : null
      };

      // Canonical store (dedupe + sort)
      this.upsertReplayLedger(cardData);

      // Update display slice depending on mode
      if (this.replayIndex == null) {
        this.ledgerStream = this.replayHistory.slice(0, MAX_STREAM_LEDGERS);
      } else {
        const pos = this.replayHistory.findIndex((x) => x.ledgerIndex === this.replayIndex);
        this.ledgerStream = pos >= 0
          ? this.replayHistory.slice(pos, pos + MAX_STREAM_LEDGERS)
          : this.replayHistory.slice(0, MAX_STREAM_LEDGERS);
      }

      // ✅ No CSS animation resets; just re-render contents
      this.renderLedgerStreamTrack();

      // Continuity checks (gap detection)
      this.checkContinuity();

      // Patterns panel
      this.analyzeLedgerPatterns();
    },

    getDominantType(txTypes) {
      const agg = { Payment: 0, Offer: 0, NFT: 0, TrustSet: 0, Other: 0 };
      for (const [k, v] of Object.entries(txTypes || {})) {
        if (agg[k] !== undefined) agg[k] += Number(v || 0);
        else agg.Other += Number(v || 0);
      }
      let topType = "Other", topVal = -1;
      for (const [type, count] of Object.entries(agg)) {
        if (count > topVal) { topVal = count; topType = type; }
      }
      return topType;
    },

    /* =========================
       ✅ FIX: STREAM DISPLAY ORDER
       You store newest-first, but DISPLAY ascending so it "counts up"
       ========================= */
    renderLedgerStreamTrack() {
      const track = document.getElementById("ledgerStreamTrack");
      if (!track) return;

      if (this.ledgerStream.length === 0) {
        track.innerHTML = '<div class="widget-label" style="padding: 40px;">Waiting for ledgers…</div>';
        this._streamNeedsMeasure = true;
        return;
      }

      // Sort ASC for display so numbers go up left→right
      const asc = [...this.ledgerStream].sort((a, b) => a.ledgerIndex - b.ledgerIndex);

      const cardsHtml = asc.map((card) => this.buildLedgerCardHtml(card));
      const combined = cardsHtml.concat(cardsHtml); // seamless loop
      track.innerHTML = combined.join("");

      this.applyTraceHighlights();
      this._streamNeedsMeasure = true; // measure again after DOM update
    },

    // IMPORTANT: card markup kept, but timestamp REMOVED
    buildLedgerCardHtml(card) {
      const domClass =
        {
          Payment: "ledger-card--payment",
          Offer: "ledger-card--offer",
          NFT: "ledger-card--nft",
          TrustSet: "ledger-card--trust",
          Other: "ledger-card--other",
        }[card.dominantType] || "ledger-card--other";

      const total = card.totalTx ?? 0;
      const t = card.txTypes || {};

      const payment = t.Payment ?? 0;
      const offers = t.Offer ?? 0;
      const nfts = t.NFT ?? 0;
      const trust = t.TrustSet ?? 0;
      const other = t.Other ?? 0;

      const pct = (value) => `${((value / Math.max(1, total)) * 100).toFixed(1)}%`;

      return `
        <article class="ledger-card ${domClass}" data-ledger-index="${card.ledgerIndex}">
          <div class="ledger-card-inner">
            <header class="ledger-card-header">
              <div class="ledger-id">#${card.ledgerIndex.toLocaleString()}</div>
              <div class="ledger-meta">
                <span class="ledger-tag">${card.dominantType}</span>
              </div>
            </header>

            <div class="ledger-card-body">
              <div class="ledger-main-row">
                <div class="ledger-main-stat">
                  <span class="ledger-stat-label">Total TX</span>
                  <span class="ledger-stat-value">${total}</span>
                </div>
                <div class="ledger-main-stat">
                  <span class="ledger-stat-label">Success</span>
                  <span class="ledger-stat-value">${Number(card.successRate).toFixed(2)}%</span>
                </div>
                <div class="ledger-main-stat">
                  <span class="ledger-stat-label">Avg Fee</span>
                  <span class="ledger-stat-value">${Number(card.avgFee).toFixed(6)}</span>
                </div>
              </div>

              <div class="ledger-type-bars">
                <div class="ledger-type-row">
                  <span class="ledger-type-label">Payment</span>
                  <div class="ledger-type-bar">
                    <div class="ledger-type-fill type-payment" style="width:${pct(payment)}"></div>
                  </div>
                  <span class="ledger-type-count">${payment}</span>
                </div>

                <div class="ledger-type-row">
                  <span class="ledger-type-label">Offers</span>
                  <div class="ledger-type-bar">
                    <div class="ledger-type-fill type-offer" style="width:${pct(offers)}"></div>
                  </div>
                  <span class="ledger-type-count">${offers}</span>
                </div>

                <div class="ledger-type-row">
                  <span class="ledger-type-label">NFT</span>
                  <div class="ledger-type-bar">
                    <div class="ledger-type-fill type-nft" style="width:${pct(nfts)}"></div>
                  </div>
                  <span class="ledger-type-count">${nfts}</span>
                </div>

                <div class="ledger-type-row">
                  <span class="ledger-type-label">TrustSet</span>
                  <div class="ledger-type-bar">
                    <div class="ledger-type-fill type-trust" style="width:${pct(trust)}"></div>
                  </div>
                  <span class="ledger-type-count">${trust}</span>
                </div>

                <div class="ledger-type-row">
                  <span class="ledger-type-label">Other</span>
                  <div class="ledger-type-bar">
                    <div class="ledger-type-fill type-other" style="width:${pct(other)}"></div>
                  </div>
                  <span class="ledger-type-count">${other}</span>
                </div>
              </div>
            </div>
          </div>
        </article>
      `;
    },

    initLedgerStreamParticles() {
      const shell = document.getElementById("ledgerStreamShell");
      const pContainer = document.getElementById("ledgerStreamParticles");
      if (!shell || !pContainer) return;

      pContainer.innerHTML = "";
      const count = 14;
      for (let i = 0; i < count; i++) {
        const p = document.createElement("div");
        p.className = "ledger-particle";
        p.style.left = Math.random() * 100 + "%";
        p.style.top = 20 + Math.random() * 60 + "%";
        p.style.animationDuration = 6 + Math.random() * 8 + "s";
        p.style.animationDelay = Math.random() * 5 + "s";
        pContainer.appendChild(p);
      }
    },

    /* =========================
       ✅ FIX: smooth stream animation (no jumps)
       Right-to-left continuous
       ========================= */
    startStreamAnimation() {
      if (this._streamRAF) return;

      const step = (ts) => {
        if (!this._streamLastTS) this._streamLastTS = ts;
        const dt = Math.min(0.05, (ts - this._streamLastTS) / 1000);
        this._streamLastTS = ts;

        const track = document.getElementById("ledgerStreamTrack");
        if (track) {
          if (this._streamNeedsMeasure) {
            const full = track.scrollWidth || 0;
            this._streamLoopWidth = Math.max(1, Math.floor(full / 2));
            this._streamOffsetX = this._streamOffsetX % this._streamLoopWidth;
            this._streamNeedsMeasure = false;
          }

          this._streamOffsetX += STREAM_SCROLL_PX_PER_SEC * dt;

          if (this._streamOffsetX >= this._streamLoopWidth) {
            this._streamOffsetX -= this._streamLoopWidth;
          }

          track.style.transform = `translateX(${-this._streamOffsetX}px)`;
        }

        this._streamRAF = requestAnimationFrame(step);
      };

      this._streamRAF = requestAnimationFrame(step);

      window.addEventListener("resize", () => {
        this._streamNeedsMeasure = true;
      });
    },

    /* =========================
       Continuity checks (gap detection)
       ========================= */
    checkContinuity() {
      const slice = this.replayHistory.slice(0, 25).map(x => x.ledgerIndex);
      if (slice.length < 3) return;

      let gap = null;
      for (let i = 0; i < slice.length - 1; i++) {
        const a = slice[i];
        const b = slice[i + 1];
        if (a - b > 1) {
          gap = { from: a, to: b, missing: (a - b - 1) };
          break;
        }
      }

      const status = document.getElementById("d2-forensics-status");
      if (gap) {
        const msg = `Continuity gap: missing ${gap.missing} ledger(s) between #${gap.to.toLocaleString()} → #${gap.from.toLocaleString()}`;
        if (status) status.textContent = `⚠️ ${msg}`;

        const key = `gap|${gap.from}|${gap.to}`;
        if (!this.lastAlerts.has(key)) {
          this.lastAlerts.add(key);
          // NOTE: continuity warnings go to tray only (non-blocking)
          this.pushAlert({
            title: "Continuity gap",
            message: msg,
            kind: "Continuity",
            repeats: gap.missing,
            confidence: 100,
            ledgers: [gap.to, gap.from]
          }, { allowToast: false });
        }
      }
    },

    /* =========================
       Patterns & dominance panel (KEPT)
       ========================= */
    analyzeLedgerPatterns() {
      const typeEl = document.getElementById("d2-dominant-type");
      const scoreEl = document.getElementById("d2-dominance-score");
      const barEl = document.getElementById("d2-dominance-bar");
      const flagsEl = document.getElementById("d2-pattern-flags");
      const explainEl = document.getElementById("d2-pattern-explain");

      if (!typeEl || !scoreEl || !barEl || !flagsEl || !explainEl) return;

      const recent = this.ledgerStream.slice().sort((a, b) => b.ledgerIndex - a.ledgerIndex).slice(0, 6);

      if (recent.length < 3) {
        typeEl.textContent = "—";
        scoreEl.textContent = "—";
        barEl.style.width = "0%";
        flagsEl.textContent = "None";
        explainEl.textContent = "Waiting for ledgers…";
        return;
      }

      const totals = { Payment: 0, Offer: 0, NFT: 0, TrustSet: 0, Other: 0 };
      let totalTx = 0;

      for (const l of recent) {
        const t = l.txTypes || {};
        for (const k of Object.keys(totals)) {
          const v = Number(t[k] || 0);
          totals[k] += v;
          totalTx += v;
        }
      }

      let dominant = "Other";
      let max = 0;
      for (const k of Object.keys(totals)) {
        if (totals[k] > max) {
          max = totals[k];
          dominant = k;
        }
      }

      const dominancePct = totalTx ? (max / totalTx) * 100 : 0;

      let h = 0;
      for (const k of Object.keys(totals)) {
        const share = totalTx ? totals[k] / totalTx : 0;
        h += share * share;
      }
      const concentration = Math.min(100, Math.max(0, h * 100));

      const last = recent[0]?.txTypes || {};
      let lastDom = "Other";
      let lastMax = -1;
      for (const k of Object.keys(totals)) {
        const v = Number(last[k] || 0);
        if (v > lastMax) {
          lastMax = v;
          lastDom = k;
        }
      }
      const flip = lastDom !== dominant;

      const flags = [];
      if (dominancePct > 70) flags.push("High concentration");
      if (concentration > 45) flags.push("Compressed mix");
      if (dominant === "Offer" && dominancePct > 55) flags.push("Offer pressure (wash-like possible)");
      if (dominant === "Payment" && dominancePct > 65) flags.push("Heavy routing / drain-style flow possible");
      if (dominant === "TrustSet" && dominancePct > 40) flags.push("Trustline churn / issuer activity");
      if (flip && dominancePct > 45) flags.push("Dominance flip");

      typeEl.textContent = dominant;
      scoreEl.textContent = `${dominancePct.toFixed(1)}%`;
      barEl.style.width = `${Math.min(100, dominancePct)}%`;
      flagsEl.textContent = flags.length ? flags.join(", ") : "None";

      if (!totalTx) {
        explainEl.textContent = "No transaction mix available yet.";
      } else if (flags.includes("Dominance flip")) {
        explainEl.textContent = `Mix shifted: last ledger led by ${lastDom}, but recent dominant is ${dominant}.`;
      } else if (dominancePct > 70) {
        explainEl.textContent = `One activity dominates (${dominant}) — watch for abnormal clustering or routing.`;
      } else {
        explainEl.textContent = `Mix appears ${concentration > 45 ? "compressed" : "balanced"} across recent ledgers.`;
      }
    },

    /* =========================
       Forensics: pipeline (KEPT)
       ========================= */
    runForensicsPipeline() {
      const status = document.getElementById("d2-forensics-status");
      if (!status) return;

      const history = this.getWindowHistory();
      if (history.length < 3) {
        status.textContent = "Waiting for more ledgers…";
        this.renderBreadcrumbs([]);
        this.renderClusters([]);
        this.renderNarratives([]);
        return;
      }

      status.textContent = `Analyzing ${history.length} ledgers…`;

      const flowByLedger = this.buildFlowByLedger(history);
      const breadcrumbs = this.detectBreadcrumbs(flowByLedger, history);
      const clusters = this.inferClusters(flowByLedger, history);
      const narratives = this.buildDeltaNarratives(history);

      this.renderBreadcrumbs(breadcrumbs);
      this.renderClusters(clusters);
      this.renderNarratives(narratives);

      // Alerts (now non-blocking by default)
      this.emitAlerts(breadcrumbs);

      status.textContent = `Live signals: ${breadcrumbs.length} • clusters: ${clusters.length}`;
    },

    getWindowHistory() {
      const base = this.replayHistory; // newest-first
      const endLedgerIndex = this.replayIndex;

      let startPos = 0;
      if (endLedgerIndex != null) {
        const pos = base.findIndex((x) => x.ledgerIndex === endLedgerIndex);
        startPos = pos >= 0 ? pos : 0;
      }

      const windowSize = Math.max(5, Math.min(50, this.flowWindowSize));
      return base.slice(startPos, startPos + windowSize);
    },

    buildFlowByLedger(history) {
      const map = new Map();
      for (const l of history) map.set(l.ledgerIndex, []);

      let hasAny = false;
      for (const l of history) {
        if (Array.isArray(l.flowEdges) && l.flowEdges.length) {
          map.set(l.ledgerIndex, l.flowEdges.slice());
          hasAny = true;
        }
      }
      if (hasAny) return map;

      if (!Array.isArray(this.recentTransactions) || this.recentTransactions.length === 0) return map;

      const ledgerSet = new Set(history.map((h) => h.ledgerIndex));
      for (const tx of this.recentTransactions) {
        if (!tx || tx.type !== "Payment") continue;
        const li = Number(tx.ledgerIndex);
        if (!ledgerSet.has(li)) continue;
        if (!tx.account || !tx.destination) continue;
        if (tx.account === tx.destination) continue;

        const edges = map.get(li);
        edges.push({
          from: tx.account,
          to: tx.destination,
          amount: Number(tx.amountXRP || 0),
          currency: "XRP",
          hash: tx.hash || null,
        });
      }

      return map;
    },

    detectBreadcrumbs(flowByLedger, history) {
      const ledgers = history.map((h) => h.ledgerIndex);

      const pairStats = new Map();
      const fanOut = new Map();
      const fanIn = new Map();

      for (const li of ledgers) {
        const edges = flowByLedger.get(li) || [];
        const seenPairsThisLedger = new Set();

        for (const e of edges) {
          const from = e.from, to = e.to;
          const amt = Number(e.amount || 0);

          const k = `${from}|${to}`;
          if (!seenPairsThisLedger.has(k)) {
            seenPairsThisLedger.add(k);
            if (!pairStats.has(k)) pairStats.set(k, { ledgers: new Set(), totalAmount: 0 });
            pairStats.get(k).ledgers.add(li);
          }
          pairStats.get(k).totalAmount += amt;

          if (!fanOut.has(from)) fanOut.set(from, { toSet: new Set(), ledgers: new Set(), totalAmount: 0 });
          const fo = fanOut.get(from);
          fo.toSet.add(to);
          fo.ledgers.add(li);
          fo.totalAmount += amt;

          if (!fanIn.has(to)) fanIn.set(to, { fromSet: new Set(), ledgers: new Set(), totalAmount: 0 });
          const fi = fanIn.get(to);
          fi.fromSet.add(from);
          fi.ledgers.add(li);
          fi.totalAmount += amt;
        }
      }

      const pingPong = [];
      for (const [k] of pairStats.entries()) {
        const [a, b] = k.split("|");
        const rev = `${b}|${a}`;
        if (!pairStats.has(rev)) continue;

        const ledA = pairStats.get(k).ledgers;
        const ledB = pairStats.get(rev).ledgers;

        const union = new Set([...ledA, ...ledB]);
        if (union.size < 2) continue;

        pingPong.push({
          kind: "PingPong Loop",
          key: `${a} ⇄ ${b}`,
          from: a,
          to: b,
          ledgers: [...union].sort((x, y) => y - x),
          repeats: union.size,
          confidence: this.confidenceScore({ stability: union.size, window: history.length, strength: 0.55 }),
          details: `Bidirectional transfers observed across ${union.size} ledgers.`,
        });
      }

      const list = [];

      for (const [k, ps] of pairStats.entries()) {
        const repeats = ps.ledgers.size;
        if (repeats < 2) continue;

        const [from, to] = k.split("|");
        const stability = repeats;
        const strength = Math.min(1, (ps.totalAmount / Math.max(1, repeats)) / 250000);
        const confidence = this.confidenceScore({ stability, window: history.length, strength });

        list.push({
          kind: "Repeated Pair",
          key: `${this.shortAddr(from)} → ${this.shortAddr(to)}`,
          from,
          to,
          ledgers: [...ps.ledgers].sort((a, b) => b - a),
          repeats,
          confidence,
          details: `Seen in ${repeats} ledgers • approx total ${ps.totalAmount.toFixed(2)} XRP`,
        });
      }

      for (const [from, fo] of fanOut.entries()) {
        const uniqueTo = fo.toSet.size;
        const repeats = fo.ledgers.size;
        if (uniqueTo >= 6 && repeats >= 2) {
          const stability = repeats;
          const strength = Math.min(1, uniqueTo / 14);
          const confidence = this.confidenceScore({ stability, window: history.length, strength });

          list.push({
            kind: "Drain / Fan-out",
            key: `${this.shortAddr(from)} ⇢ ${uniqueTo} wallets`,
            from,
            to: null,
            ledgers: [...fo.ledgers].sort((a, b) => b - a),
            repeats,
            confidence,
            details: `Fan-out to ${uniqueTo} unique receivers • total ${fo.totalAmount.toFixed(2)} XRP`,
          });
        }
      }

      for (const [to, fi] of fanIn.entries()) {
        const uniqueFrom = fi.fromSet.size;
        const repeats = fi.ledgers.size;
        if (uniqueFrom >= 6 && repeats >= 2) {
          const stability = repeats;
          const strength = Math.min(1, uniqueFrom / 14);
          const confidence = this.confidenceScore({ stability, window: history.length, strength });

          list.push({
            kind: "Aggregation / Fan-in",
            key: `${uniqueFrom} wallets ⇢ ${this.shortAddr(to)}`,
            from: null,
            to,
            ledgers: [...fi.ledgers].sort((a, b) => b - a),
            repeats,
            confidence,
            details: `Collected from ${uniqueFrom} unique senders • total ${fi.totalAmount.toFixed(2)} XRP`,
          });
        }
      }

      for (const pp of pingPong) list.push(pp);

      list.sort((a, b) => (b.confidence - a.confidence) || (b.repeats - a.repeats));

      const top = list.slice(0, 10);

      const meta = document.getElementById("d2-breadcrumb-meta");
      if (meta) meta.textContent = `Window: ${Math.min(50, Math.max(5, this.flowWindowSize))} ledgers`;

      return top;
    },

    confidenceScore({ stability, window, strength }) {
      const s = Math.max(0, Math.min(1, (stability || 0) / Math.max(1, window || 1)));
      const st = Math.max(0, Math.min(1, Number(strength || 0)));
      const score = 0.65 * s + 0.35 * st;
      return Math.round(score * 100);
    },

    inferClusters(flowByLedger, history) {
      const nodes = new Map();
      const ledgerPresence = new Map();

      for (const h of history) {
        const li = h.ledgerIndex;
        const edges = flowByLedger.get(li) || [];
        for (const e of edges) {
          const a = e.from, b = e.to;
          if (!a || !b) continue;
          if (!nodes.has(a)) nodes.set(a, new Set());
          if (!nodes.has(b)) nodes.set(b, new Set());
          nodes.get(a).add(b);
          nodes.get(b).add(a);

          if (!ledgerPresence.has(a)) ledgerPresence.set(a, new Set());
          if (!ledgerPresence.has(b)) ledgerPresence.set(b, new Set());
          ledgerPresence.get(a).add(li);
          ledgerPresence.get(b).add(li);
        }
      }

      const visited = new Set();
      const comps = [];

      for (const addr of nodes.keys()) {
        if (visited.has(addr)) continue;
        const stack = [addr];
        visited.add(addr);

        const comp = new Set([addr]);
        while (stack.length) {
          const x = stack.pop();
          const n = nodes.get(x);
          if (!n) continue;
          for (const y of n) {
            if (visited.has(y)) continue;
            visited.add(y);
            comp.add(y);
            stack.push(y);
          }
        }
        comps.push(comp);
      }

      const windowSize = history.length;
      const clusterRows = [];

      for (const comp of comps) {
        if (comp.size < 4) continue;

        let sumStability = 0;
        let coreCount = 0;

        for (const a of comp) {
          const pres = ledgerPresence.get(a);
          const stability = pres ? pres.size : 0;
          sumStability += stability / Math.max(1, windowSize);
          if (stability >= Math.max(2, Math.floor(windowSize * 0.35))) coreCount += 1;
        }

        const meanStability = sumStability / comp.size;
        const coreShare = coreCount / comp.size;
        const persistenceScore = Math.round((0.6 * meanStability + 0.4 * coreShare) * 100);

        clusterRows.push({
          size: comp.size,
          persistence: persistenceScore,
          members: [...comp].slice(0, 8),
          allMembers: [...comp],
        });
      }

      clusterRows.sort((a, b) => (b.persistence - a.persistence) || (b.size - a.size));

      const top = clusterRows.slice(0, 6);

      const persEl = document.getElementById("d2-cluster-persistence");
      if (persEl) {
        const best = top[0]?.persistence;
        persEl.textContent = best != null ? `${best}% (best cluster)` : "—";
      }

      return top;
    },

    buildDeltaNarratives(history) {
      if (history.length < 2) return [];

      const a = history[0];
      const b = history[1];

      const tA = a.txTypes || {};
      const tB = b.txTypes || {};

      const keys = ["Payment", "Offer", "NFT", "TrustSet", "Other"];
      const deltas = keys.map((k) => ({
        k,
        a: Number(tA[k] || 0),
        b: Number(tB[k] || 0),
        d: Number(tA[k] || 0) - Number(tB[k] || 0),
      }));

      deltas.sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
      const top = deltas.slice(0, 3);

      const lines = [];
      for (const x of top) {
        if (x.d === 0) continue;
        const verb = x.d > 0 ? "surged" : "collapsed";
        const pct = x.b > 0 ? Math.round((Math.abs(x.d) / x.b) * 100) : null;

        lines.push({
          title: `${x.k} ${verb}`,
          detail:
            pct != null
              ? `${x.k}: ${x.b} → ${x.a} (${pct}% change) between #${b.ledgerIndex} → #${a.ledgerIndex}`
              : `${x.k}: ${x.b} → ${x.a} between #${b.ledgerIndex} → #${a.ledgerIndex}`,
          ledgers: [a.ledgerIndex, b.ledgerIndex],
        });
      }

      const dominantA = a.dominantType || this.getDominantType(tA);
      const dominantB = b.dominantType || this.getDominantType(tB);
      if (dominantA !== dominantB) {
        lines.unshift({
          title: "Dominance flip",
          detail: `Dominant activity changed ${dominantB} → ${dominantA} (#${b.ledgerIndex} → #${a.ledgerIndex}).`,
          ledgers: [a.ledgerIndex, b.ledgerIndex],
        });
      }

      return lines.slice(0, 6);
    },

    renderBreadcrumbs(items) {
      const list = document.getElementById("d2-breadcrumb-list");
      if (!list) return;

      if (!Array.isArray(items) || items.length === 0) {
        list.innerHTML = `<div class="widget-label">No stable fingerprints yet.</div>`;
        return;
      }

      list.innerHTML = items
        .map((x, idx) => {
          const badge =
            x.confidence >= 80 ? "badge-good" :
            x.confidence >= 60 ? "badge-warn" : "badge-warn";

          const ledgers = (x.ledgers || []).slice(0, 6).map((n) => `#${n}`).join(", ");
          return `
            <div class="gateway-item d2-bc-item" data-bc-index="${idx}" title="Click to trace-highlight ledgers">
              <div style="width:100%;">
                <div class="d2-bc-row">
                  <div>
                    <strong>${x.kind}</strong>
                    <div class="widget-label">${x.key}</div>
                    <div class="d2-bc-sub">${x.details}</div>
                    <div class="d2-bc-sub">Ledgers: ${ledgers}${(x.ledgers || []).length > 6 ? "…" : ""}</div>
                  </div>
                  <div style="text-align:right;">
                    <div class="widget-label ${badge}" style="display:inline-block; padding:4px 8px; border-radius:999px;">
                      ${x.confidence}% conf
                    </div>
                    <div class="d2-bc-sub">repeats: ${x.repeats}</div>
                  </div>
                </div>
              </div>
            </div>
          `;
        })
        .join("");

      const nodes = list.querySelectorAll(".d2-bc-item[data-bc-index]");
      nodes.forEach((node) => {
        node.addEventListener("click", () => {
          const i = Number(node.getAttribute("data-bc-index"));
          const x = items[i];
          if (!x) return;
          this.selectTraceLedgers(new Set(x.ledgers || []));
        });
      });
    },

    renderClusters(items) {
      const list = document.getElementById("d2-cluster-list");
      if (!list) return;

      if (!Array.isArray(items) || items.length === 0) {
        list.innerHTML = `<div class="widget-label">No clusters detected in this window.</div>`;
        return;
      }

      list.innerHTML = items
        .map((c, idx) => {
          const badge =
            c.persistence >= 80 ? "badge-good" :
            c.persistence >= 60 ? "badge-warn" : "badge-warn";

          const members = (c.members || []).map((m) => this.shortAddr(m)).join(", ");
          return `
            <div class="gateway-item d2-bc-item" data-cluster-index="${idx}" title="Click to trace-highlight ledgers involving this cluster">
              <div style="width:100%;">
                <div class="d2-bc-row">
                  <div>
                    <strong>Cluster #${idx + 1}</strong>
                    <div class="widget-label">size: ${c.size} • members: ${members}${(c.allMembers || []).length > 8 ? "…" : ""}</div>
                    <div class="d2-bc-sub">Persistence estimates how consistently this group appears in the selected window.</div>
                  </div>
                  <div style="text-align:right;">
                    <div class="widget-label ${badge}" style="display:inline-block; padding:4px 8px; border-radius:999px;">
                      ${c.persistence}% persist
                    </div>
                  </div>
                </div>
              </div>
            </div>
          `;
        })
        .join("");

      const nodes = list.querySelectorAll(".d2-bc-item[data-cluster-index]");
      nodes.forEach((node) => {
        node.addEventListener("click", () => {
          const i = Number(node.getAttribute("data-cluster-index"));
          const c = items[i];
          if (!c) return;

          const windowHistory = this.getWindowHistory();
          const ledgerSet = new Set(windowHistory.map((h) => h.ledgerIndex));
          const members = new Set(c.allMembers || []);

          const hitLedgers = new Set();
          for (const tx of this.recentTransactions || []) {
            if (!tx) continue;
            const li = Number(tx.ledgerIndex);
            if (!ledgerSet.has(li)) continue;
            if (tx.type !== "Payment") continue;
            if (members.has(tx.account) || members.has(tx.destination)) {
              hitLedgers.add(li);
            }
          }
          this.selectTraceLedgers(hitLedgers);
        });
      });
    },

    renderNarratives(items) {
      const list = document.getElementById("d2-delta-narratives");
      if (!list) return;

      if (!Array.isArray(items) || items.length === 0) {
        list.innerHTML = `<div class="widget-label">No deltas yet.</div>`;
        return;
      }

      list.innerHTML = items
        .map((n) => {
          const led = (n.ledgers || []).map((x) => `#${x}`).join(", ");
          return `
            <div class="gateway-item d2-bc-item" title="Click to trace-highlight ledgers">
              <div style="width:100%;">
                <div class="d2-bc-row">
                  <div>
                    <strong>${n.title}</strong>
                    <div class="widget-label">${n.detail}</div>
                    <div class="d2-bc-sub">Ledgers: ${led}</div>
                  </div>
                  <div style="text-align:right;">
                    <span class="widget-label badge-warn" style="display:inline-block; padding:4px 8px; border-radius:999px;">Delta</span>
                  </div>
                </div>
              </div>
            </div>
          `;
        })
        .join("");

      const nodes = list.querySelectorAll(".d2-bc-item");
      nodes.forEach((node, idx) => {
        node.addEventListener("click", () => {
          const n = items[idx];
          if (!n) return;
          this.selectTraceLedgers(new Set(n.ledgers || []));
        });
      });
    },

    /* =========================
       🔥 NEW: Non-blocking Alerts System
       ========================= */

    formatAlertMessage(b) {
      const conf = Number(b.confidence || 0);
      const rep = Number(b.repeats || 0);
      const led = Array.isArray(b.ledgers) ? b.ledgers.slice(0, 8).map((x) => `#${x}`).join(", ") : "—";

      // Example:
      // Drain / Fan-out • rpr6g5…ujpo ⇢ 326 wallets
      // repeats: 6 • confidence: 54% • ledgers: #101… #101…
      return {
        title: `${b.kind}: ${b.key}`,
        message: `${b.details || ""}`.trim() || "Signal detected.",
        meta: `repeats: ${rep} • confidence: ${conf}% • ledgers: ${led}${Array.isArray(b.ledgers) && b.ledgers.length > 8 ? "…" : ""}`
      };
    },

    pushAlert(alertObj, { allowToast = true } = {}) {
      // alertObj: {title, message, kind, repeats, confidence, ledgers}
      if (!alertObj) return;

      // Off = do nothing
      if (this.alertMode === "off") return;

      const now = Date.now();

      // log newest-first
      this.alertsLog.unshift({
        id: `${now}-${Math.random().toString(16).slice(2)}`,
        ts: now,
        ...alertObj
      });

      if (this.alertsLog.length > MAX_ALERT_LOG) {
        this.alertsLog = this.alertsLog.slice(0, MAX_ALERT_LOG);
      }

      if (this.alertMode === "tray") {
        this.renderAlertsTray(true);
        return;
      }

      // Toast mode: rate-limited and only for higher-signal alerts
      if (this.alertMode === "toast" && allowToast) {
        const conf = Number(alertObj.confidence || 0);
        const rep = Number(alertObj.repeats || 0);
        const min = Number(this.alertFingerprintMin || DEFAULT_ALERT_FINGERPRINT_MIN);

        const highSignal = (conf >= TOAST_MIN_CONFIDENCE) && (rep >= (min + TOAST_MIN_REPEATS_EXTRA));
        const rateOk = (now - this.lastToastAt) >= TOAST_RATE_LIMIT_MS;

        if (highSignal && rateOk && typeof window.showNotification === "function") {
          this.lastToastAt = now;
          window.showNotification(`🚨 ${alertObj.title} • ${rep} repeats • ${conf}%`, "warn", 3800);
        }
      }
    },

    renderAlertsTray(keepScroll = false) {
      const feed = document.getElementById("d2-alert-feed");
      const countEl = document.getElementById("d2-alert-count");
      if (!feed || !countEl) return;

      countEl.textContent = String(this.alertsLog.length);

      if (this.alertMode !== "tray") return;

      const prevScroll = feed.scrollTop;

      if (!this.alertsLog.length) {
        feed.innerHTML = `<div class="widget-label">No alerts yet.</div>`;
        return;
      }

      feed.innerHTML = this.alertsLog
        .slice(0, 20) // show last 20, keep log bigger
        .map((a) => {
          const conf = Number(a.confidence || 0);
          const rep = Number(a.repeats || 0);

          const badge1 = `<span class="d2-alert-badge">${rep} repeats</span>`;
          const badge2 = `<span class="d2-alert-badge">${conf}% conf</span>`;
          const badge3 = Array.isArray(a.ledgers) && a.ledgers.length
            ? `<span class="d2-alert-badge">${a.ledgers.length} ledgers</span>`
            : `<span class="d2-alert-badge">—</span>`;

          const ledStr = Array.isArray(a.ledgers) ? a.ledgers.slice(0, 8).map((x) => `#${x}`).join(", ") : "";
          const copyText = `ALERT: ${a.title}\n${a.message}\n${a.meta || ""}\nLedgers: ${ledStr}`;

          return `
            <div class="d2-alert-item" data-alert-id="${a.id}">
              <div class="d2-alert-top">
                <div style="min-width:0; flex:1;">
                  <div class="d2-alert-title">${escapeHtml(a.title || "Alert")}</div>
                  <div class="d2-alert-meta">${escapeHtml(a.message || "")}</div>
                  <div class="d2-alert-meta">${escapeHtml(a.meta || "")}</div>
                </div>
                <div class="d2-alert-badges">
                  ${badge1}${badge2}${badge3}
                </div>
              </div>
              <div class="d2-alert-actions">
                <button class="d2-alert-btn" data-copy="${escapeAttr(copyText)}">Copy</button>
                <button class="d2-alert-btn" data-trace="${escapeAttr((Array.isArray(a.ledgers) ? a.ledgers.join(",") : ""))}">Trace</button>
              </div>
            </div>
          `;
        })
        .join("");

      // Bind tray buttons
      feed.querySelectorAll(".d2-alert-btn[data-copy]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const text = btn.getAttribute("data-copy") || "";
          try {
            await navigator.clipboard.writeText(text);
            btn.textContent = "Copied";
            setTimeout(() => (btn.textContent = "Copy"), 900);
          } catch (e) {
            console.warn("Clipboard copy failed", e);
          }
        });
      });

      feed.querySelectorAll(".d2-alert-btn[data-trace]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const raw = btn.getAttribute("data-trace") || "";
          const parts = raw.split(",").map((x) => Number(x)).filter((n) => Number.isFinite(n));
          this.selectTraceLedgers(new Set(parts));
        });
      });

      // keep scroll position unless new alert pushes user around
      if (keepScroll) {
        feed.scrollTop = prevScroll;
      }
    },

    emitAlerts(breadcrumbs) {
      if (!Array.isArray(breadcrumbs) || breadcrumbs.length === 0) return;

      const min = this.alertFingerprintMin;

      for (const b of breadcrumbs) {
        if ((b.repeats || 0) < min) continue;

        // Stronger dedupe: kind + key + repeats + window size (prevents spam across small changes)
        const key = `${b.kind}|${b.key}|${b.repeats}|w${this.flowWindowSize}`;
        if (this.lastAlerts.has(key)) continue;
        this.lastAlerts.add(key);

        // Limit dedupe set growth
        if (this.lastAlerts.size > 120) {
          this.lastAlerts = new Set(Array.from(this.lastAlerts).slice(-90));
        }

        const fmt = this.formatAlertMessage(b);

        // Push non-blocking alert
        this.pushAlert({
          kind: b.kind,
          title: fmt.title,
          message: fmt.message,
          meta: fmt.meta,
          repeats: b.repeats,
          confidence: b.confidence,
          ledgers: b.ledgers || []
        }, { allowToast: true });
      }
    },

    selectTraceLedgers(set) {
      this.selectedTraceLedgers = set instanceof Set ? set : new Set();
      this.applyTraceHighlights();
    },

    clearTrace() {
      this.selectedTraceLedgers = new Set();
      this.applyTraceHighlights();
    },

    applyTraceHighlights() {
      const cards = document.querySelectorAll(".ledger-card[data-ledger-index]");
      if (!cards.length) return;
      cards.forEach((c) => {
        const li = Number(c.getAttribute("data-ledger-index"));
        const on = this.selectedTraceLedgers.has(li);
        c.classList.toggle("is-trace", !!on);
      });
    },

    updateReplayUI() {
      const slider = document.getElementById("d2-replay-slider");
      const label = document.getElementById("d2-replay-label");
      if (!slider || !label) return;

      const max = Math.max(0, this.replayHistory.length - 1);
      slider.max = String(max);

      if (this.replayIndex == null) {
        slider.value = "0";
        label.textContent = "LIVE";
        this.renderLiveStreamFromHistory();
        return;
      }

      const pos = this.replayHistory.findIndex((x) => x.ledgerIndex === this.replayIndex);
      if (pos < 0) {
        this.replayIndex = null;
        slider.value = "0";
        label.textContent = "LIVE";
        this.renderLiveStreamFromHistory();
        return;
      }

      slider.value = String(pos);
      label.textContent = `#${this.replayIndex.toLocaleString()}`;
    },

    renderLiveStreamFromHistory() {
      this.ledgerStream = this.replayHistory.slice(0, MAX_STREAM_LEDGERS);
      this.renderLedgerStreamTrack();
    },

    renderReplayStream() {
      if (this.replayIndex == null) {
        this.renderLiveStreamFromHistory();
        return;
      }

      const pos = this.replayHistory.findIndex((x) => x.ledgerIndex === this.replayIndex);
      if (pos < 0) {
        this.renderLiveStreamFromHistory();
        return;
      }

      this.ledgerStream = this.replayHistory.slice(pos, pos + MAX_STREAM_LEDGERS);
      this.renderLedgerStreamTrack();
    },

    exportForensicReport(format) {
      const history = this.getWindowHistory();
      if (!history.length) return;

      const flowByLedger = this.buildFlowByLedger(history);
      const breadcrumbs = this.detectBreadcrumbs(flowByLedger, history);
      const clusters = this.inferClusters(flowByLedger, history);
      const narratives = this.buildDeltaNarratives(history);

      const payload = {
        generatedAt: new Date().toISOString(),
        mode: this.replayIndex == null ? "live" : "replay",
        replayLedger: this.replayIndex,
        windowSize: Math.min(50, Math.max(5, this.flowWindowSize)),
        alertFingerprintMin: this.alertFingerprintMin,
        ledgers: history.map((h) => ({
          ledgerIndex: h.ledgerIndex,
          closeTime: h.closeTime instanceof Date ? h.closeTime.toISOString() : String(h.closeTime || ""),
          totalTx: h.totalTx,
          avgFee: h.avgFee,
          successRate: h.successRate,
          txTypes: h.txTypes,
          dominantType: h.dominantType,
        })),
        breadcrumbs,
        clusters,
        narratives,
      };

      if (format === "json") {
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        this.downloadBlob(blob, `naluxrp-forensics-${Date.now()}.json`);
        return;
      }

      if (format === "csv") {
        const rows = [];
        rows.push(["kind", "key", "repeats", "confidence", "ledgers", "details"].join(","));
        for (const b of breadcrumbs) {
          rows.push([
            this.csvEscape(b.kind),
            this.csvEscape(b.key),
            String(b.repeats || 0),
            String(b.confidence || 0),
            this.csvEscape((b.ledgers || []).join(" ")),
            this.csvEscape(b.details || ""),
          ].join(","));
        }
        const blob = new Blob([rows.join("\n")], { type: "text/csv" });
        this.downloadBlob(blob, `naluxrp-breadcrumbs-${Date.now()}.csv`);
      }
    },

    downloadBlob(blob, filename) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },

    csvEscape(s) {
      const str = String(s ?? "");
      if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
      return str;
    },

    shortAddr(addr) {
      if (!addr || typeof addr !== "string") return "—";
      if (addr.length <= 12) return addr;
      return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
    },

    updateConnectionState(isConnected, serverInfo) {
      const dot = document.getElementById("connDot");
      const text = document.getElementById("connText");
      if (!dot || !text) return;

      if (isConnected) {
        dot.classList.add("live");
        text.textContent = `LIVE – ${serverInfo?.name || "XRPL"}`;
        text.style.color = "#50fa7b";
      } else {
        dot.classList.remove("live");
        text.textContent = "Connecting...";
        text.style.color = "#ffb86c";
      }
    },
  };

  // Simple safe escaping for alert tray
  function escapeHtml(s) {
    const str = String(s ?? "");
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/\n/g, " ");
  }

  // Expose dashboard renderer + API
  window.renderDashboard = () => Dashboard.render();
  window.NaluDashboard = {
    applyXRPLState: (state) => Dashboard.applyXRPLState(state),
    pushLedgerToStream: (summary) => Dashboard.pushLedgerToStream(summary),
    updateConnectionState: (isConnected, serverInfo) => Dashboard.updateConnectionState(isConnected, serverInfo),
  };

  // Event listeners remain compatible with your connection module
  window.addEventListener("xrpl-ledger", (ev) => {
    try {
      const detail = ev.detail || {};
      if (window.NaluDashboard) window.NaluDashboard.applyXRPLState(detail);
    } catch (e) {
      console.error("❌ Dashboard: Error applying xrpl-ledger to dashboard", e);
    }
  });

  window.addEventListener("xrpl-connection", (ev) => {
    const dot = document.getElementById("connDot");
    const text = document.getElementById("connText");
    if (!dot || !text) return;

    const d = ev.detail || {};
    if (d.connected) {
      dot.classList.add("live");
      text.textContent = `LIVE – ${d.server || "XRPL"}`;
      text.style.color = "#50fa7b";
    } else {
      dot.classList.remove("live");
      text.textContent = d.modeReason === "Network switched" ? "Switching Network..." : "Connecting...";
      text.style.color = "#ffb86c";
    }
  });

  console.log("📊 NaluXrp Dashboard V2 FORENSICS loaded (alerts tray enabled, non-blocking)");
})();


