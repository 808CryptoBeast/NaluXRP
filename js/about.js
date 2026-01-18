/* =========================================================
   about.js — NaluXrp 🌊 About Page (Futuristic + Explainable)
   - Renders About page into #about
   - Tabs: Algorithms | Visual Patterns | Glossary | Limits
   - Accordions + Glossary search + Expand/Collapse all
   - No external deps
   ========================================================= */

(function () {
  const About = {
    initialized: false,
    activeTab: "algorithms",

    glossaryItems: [
      {
        key: "Dominant Type",
        tags: ["metrics", "dashboard"],
        body:
          "The transaction category with the highest count inside a ledger (Payment, Offers, NFT, TrustSet, Other). Used to color-code the ledger stream card and summarize what the network is doing most in that moment.",
      },
      {
        key: "Dominance Strength",
        tags: ["metrics", "dashboard"],
        body:
          "How concentrated the transaction mix is toward the dominant category. High dominance means one activity is taking up most of the ledger’s transaction volume.",
      },
      {
        key: "Mix Compression (Concentration)",
        tags: ["analytics"],
        body:
          "A measure of how ‘compressed’ the transaction mix is. High compression means fewer categories account for most activity, which can happen during bursts, maintenance, market-maker cycles, or network stress.",
      },
      {
        key: "Breadcrumb (Flow Fingerprint)",
        tags: ["forensics"],
        body:
          "A repeated movement pattern across multiple ledgers (e.g., repeated sender→receiver pairs, fan-out, fan-in). Breadcrumbs are meant as pivots for investigation, not proof.",
      },
      {
        key: "Fan-out",
        tags: ["forensics", "cybersecurity"],
        body:
          "One source sends to many destinations across a short window. Can be normal (airdrops/payouts/exchange withdrawals) or a risk cue (drain-style dispersion, scripting, smurfing).",
      },
      {
        key: "Fan-in",
        tags: ["forensics", "cybersecurity"],
        body:
          "Many sources send into one destination. Can be normal (exchange deposits/merchant aggregation) or a risk cue (coordinated funneling, consolidation before laundering).",
      },
      {
        key: "Hub Model",
        tags: ["forensics", "graph"],
        body:
          "A central connector node that links many wallets and routes flow. Often a service hot wallet (exchange/bridge/issuer), sometimes a coordinator. Context is critical.",
      },
      {
        key: "Cluster",
        tags: ["forensics", "graph"],
        body:
          "A connected component in the interaction graph built from observed flows. Clusters do not imply identity; they indicate that addresses are related by activity in the window.",
      },
      {
        key: "Cluster Persistence",
        tags: ["forensics", "graph"],
        body:
          "An explainable stability estimate: how consistently a cluster appears across the selected ledger window. Higher persistence suggests a stable structure (service network, recurring campaign, market-making group).",
      },
      {
        key: "Ping-pong",
        tags: ["forensics"],
        body:
          "Bidirectional transfers between two accounts across multiple ledgers. Can be normal (rebalancing, market-making, internal operations) or a risk cue (looping/layering behavior).",
      },
      {
        key: "Continuity Gap",
        tags: ["network", "quality"],
        body:
          "A missing range of ledgers inside the local capture window. Can be caused by reconnects, server load limits, throttling, or fetch failures. Gaps can distort short-window analysis.",
      },
      {
        key: "Account Inspector",
        tags: ["inspector"],
        body:
          "A pivot tool for a single account or issuer set. Used to expand outward and visualize relationships. Inspector results depend on node availability and rate limits.",
      },
    ],

    render() {
      const root = document.getElementById("about");
      if (!root) return;

      // Render once; keep content stable
      root.innerHTML = this.buildHtml();
      this.bind();
      this.initialized = true;

      // Default tab
      this.setTab(this.activeTab);

      console.log("ℹ️ About module loaded (about@2.0.0-futuristic)");
    },

    buildHtml() {
      return `
        <div class="about-page">
          <header class="about-hero">
            <div class="about-hero-left">
              <div class="about-kicker">NaluXrp 🌊 • XRPL Forensics • Explainable Signals</div>
              <h1 class="about-title">About</h1>
              <p class="about-subtitle">
                A real-time XRPL analysis suite focused on <strong>explainable heuristics</strong>:
                dominance, flow fingerprints, graph clusters, and replayable forensic snapshots.
              </p>

              <div class="about-chip-row" aria-label="highlights">
                <span class="about-chip">Real ledger data</span>
                <span class="about-chip">Stream + replay</span>
                <span class="about-chip">Flow fingerprints</span>
                <span class="about-chip">Cluster inference</span>
                <span class="about-chip">Export snapshots</span>
              </div>
            </div>

            <div class="about-hero-right">
              <div class="about-hero-card">
                <div class="about-hero-card-title">What this app is</div>
                <div class="about-hero-card-tag">Futuristic • Explainable • Practical</div>
                <p class="about-hero-card-text">
                  NaluXrp helps you observe XRPL behavior in motion — not just raw data.
                  It highlights patterns used in cybersecurity-style analysis: anomaly cues,
                  persistence, fingerprinting, and graph structure.
                </p>
                <div class="about-callouts">
                  <div class="about-callout">
                    <div class="about-callout-icon">🔐</div>
                    <div>
                      <div class="about-callout-title">Cybersecurity mindset</div>
                      <div class="about-callout-text">
                        Treat the ledger as a high-volume event stream. We look for stable fingerprints,
                        bursts, routing behaviors, and persistent clusters.
                      </div>
                    </div>
                  </div>

                  <div class="about-callout warn">
                    <div class="about-callout-icon">⚠️</div>
                    <div>
                      <div class="about-callout-title">Interpretation warning</div>
                      <div class="about-callout-text">
                        Many suspicious-looking patterns are normal for exchanges, issuers, and market makers.
                        Use signals as starting points — not conclusions.
                      </div>
                    </div>
                  </div>

                  <div class="about-callout neutral">
                    <div class="about-callout-icon">🧾</div>
                    <div>
                      <div class="about-callout-title">No identity claims</div>
                      <div class="about-callout-text">
                        NaluXrp does not attribute identity. It surfaces explainable signals and gives you tools
                        to pivot into deeper inspection and documentation.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </header>

          <nav class="about-tabs" role="tablist" aria-label="About navigation">
            ${this.tabButton("algorithms", "🧠 Algorithms")}
            ${this.tabButton("patterns", "🧩 Visual Patterns")}
            ${this.tabButton("glossary", "📚 Glossary")}
            ${this.tabButton("limits", "⚠️ Limits")}
          </nav>

          <section class="about-section" data-tab="algorithms" role="tabpanel">
            <div class="about-section-head">
              <h2>🧠 Algorithms & Signals</h2>
              <p>How the dashboard “thinks” (in plain English)</p>
            </div>

            <div class="about-grid">
              ${this.algoCard({
                icon: "⏱️",
                title: "Ledger Rhythm & Cadence",
                body:
                  "Tracks close cadence shifts and continuity to spot stress, congestion, and capture gaps.",
                bullets: ["Cadence deviations", "Continuity gap flags", "Replay-safe analysis windows"],
              })}
              ${this.algoCard({
                icon: "🧪",
                title: "Transaction Mix, Dominance & Concentration",
                body:
                  "Groups types per ledger (Payment / Offers / NFT / TrustSet / Other) and explains dominant behavior changes.",
                bullets: ["Dominant type", "Dominance %", "Pattern flags", "Delta narratives"],
              })}
              ${this.algoCard({
                icon: "👣",
                title: "Wallet Flow Breadcrumbs (Repeated Fingerprints)",
                body:
                  "Detects repeated flow fingerprints across multiple ledgers to highlight persistent movement patterns.",
                bullets: ["Repeated fingerprints", "Repeat counts", "Confidence score", "Trace-highlight ledgers"],
              })}
              ${this.algoCard({
                icon: "🕸️",
                title: "Cluster Inference (Graph-Based, No Identity)",
                body:
                  "Builds an interaction graph from flows and infers clusters via connectivity and persistence.",
                bullets: ["Cluster size", "Persistence %", "Core members", "Cluster drill-down targets"],
              })}
              ${this.algoCard({
                icon: "📖",
                title: "Ledger-to-Ledger Delta Narratives",
                body:
                  "Turns raw deltas into explainable summaries (e.g., ‘Offers surged’ / ‘Payments collapsed’).",
                bullets: ["Top deltas", "Dominance flips", "Explainable summaries"],
              })}
              ${this.algoCard({
                icon: "⏮️",
                title: "Replay & Forensic Snapshots",
                body:
                  "Rewind captured history and export explainable state snapshots for reporting and investigation.",
                bullets: ["Replay window", "Export JSON/CSV", "Stable analysis lens"],
              })}
            </div>

            <div class="about-divider"></div>

            <div class="about-section-head">
              <h3>🧭 How to Investigate</h3>
              <p>A practical workflow (investigation → validation → documentation)</p>
            </div>

            <div class="about-steps">
              ${this.step("⚡", "Start with the Ledger Stream", "Watch dominant activity, tx mix, and continuity. Look for bursts, flips, and repeated patterns across several ledgers.")}
              ${this.step("👣", "Click Breadcrumbs to Trace Ledgers", "Use repeated fingerprints to highlight relevant ledgers in the stream. Persistence matters more than one-off spikes.")}
              ${this.step("🔎", "Pivot into Account Inspector", "Inspect top senders/receivers from suspicious fingerprints. Expand outward carefully and compare neighbors.")}
              ${this.step("🧭", "Validate with Context", "Check whether the pattern matches known service behavior (exchanges/issuers). Confirm amounts, regularity, and persistence.")}
              ${this.step("⏮️", "Use Replay for Before/After", "Rewind to compare baseline behavior vs anomaly. Keep the same window size when comparing.")}
              ${this.step("📦", "Export Snapshots", "Export JSON/CSV for reports. Document the window size, selected ledger, and what triggered the investigation.")}
            </div>

            <div class="about-hint">
              Want this even clearer? We can add mini interactive tooltips on the live dashboard
              (hover on “Fan-out” to show the diagram + benign vs risk notes).
            </div>
          </section>

          <section class="about-section" data-tab="patterns" role="tabpanel">
            <div class="about-section-head">
              <h2>🧩 Visual Patterns</h2>
              <p>Fast mental models for fan-in/out, hubs, and clusters</p>
            </div>

            <div class="about-pattern-grid">
              ${this.patternCard({
                title: "Fan-out",
                subtitle: "One → many distribution",
                body:
                  "A single source sends to many destinations across a short window. Can be payouts/airdrops or drain-style dispersion.",
                benign: ["Airdrops / payouts", "Exchange withdrawals", "Treasury distribution"],
                risk: ["Drain-style dispersion", "Scripting / automation", "Smurfing patterns"],
              })}
              ${this.patternCard({
                title: "Fan-in",
                subtitle: "Many → one aggregation",
                body:
                  "Many sources send into one destination. Can be deposits or consolidation before a move.",
                benign: ["Exchange deposits", "Merchant aggregation", "Consolidation for fees"],
                risk: ["Consolidation before laundering", "Coordinated funneling", "Layering preparation"],
              })}
              ${this.patternCard({
                title: "Hub Model",
                subtitle: "Central connector node",
                body:
                  "A hub links many nodes and routes flow. Often a service wallet (exchange/bridge/issuer), sometimes a coordinator.",
                benign: ["Service hot wallet", "Bridge/router", "Issuer distribution hub"],
                risk: ["Coordinated routing", "Layering behavior", "Obfuscation hops"],
              })}
              ${this.patternCard({
                title: "Cluster",
                subtitle: "Connected component",
                body:
                  "A group of wallets linked by observed interactions. Persistence suggests stable structure; volatility suggests opportunistic flow.",
                benign: ["Ecosystem structure", "Service network", "Market-making group"],
                risk: ["Coordinated campaign", "Persistent laundering ring", "Bot-driven ring"],
              })}
            </div>

            <div class="about-divider"></div>

            <div class="about-section-head">
              <h3>✅ Common Benign Explanations</h3>
              <p>Signals often have normal causes — check context</p>
            </div>

            <div class="about-benign-grid">
              ${this.benignCard("🏦 Exchanges / Service wallets",
                "High fan-in/out, hubs, and dense clusters are normal around exchanges. Look for consistent patterns and strong persistence.",
                ["Hot wallet hubs", "Batch deposits/withdrawals", "Consolidation of dust"]
              )}
              ${this.benignCard("🏷️ Issuers / Trustline operations",
                "TrustSet bursts, issuer-centric hubs, and distribution fan-outs can be legitimate token operations.",
                ["Trustline churn", "Treasury distribution", "Market maker interactions"]
              )}
              ${this.benignCard("💧 DEX / AMM activity",
                "OfferCreate/Cancel surges and loop-like patterns can be market-making, arbitrage, or liquidity operations.",
                ["Offer spikes", "Rapid cancels", "Routing via pools"]
              )}
              ${this.benignCard("🤖 Automation & testing",
                "Uniform amounts, strict periodicity, and repeated pairs can be scripts (especially on testnet).",
                ["Uniform sizes", "Regular intervals", "Same counterparties"]
              )}
            </div>
          </section>

          <section class="about-section" data-tab="glossary" role="tabpanel">
            <div class="about-section-head">
              <h2>📚 Glossary</h2>
              <p>Terms you’ll see in NaluXrp</p>
            </div>

            <div class="about-glossary-toolbar">
              <div class="about-search">
                <span class="about-search-icon">🔎</span>
                <input id="aboutGlossarySearch" type="text" placeholder="Search terms (fan-out, hub, dominance, cluster, continuity gap)..." />
              </div>

              <div class="about-toolbar-actions">
                <button class="about-btn" id="aboutExpandAll" type="button">Expand all</button>
                <button class="about-btn" id="aboutCollapseAll" type="button">Collapse all</button>
                <span class="about-toolbar-note" id="aboutGlossaryCount"></span>
              </div>
            </div>

            <div class="about-glossary-list" id="aboutGlossaryList">
              ${this.glossaryItems.map((it, idx) => this.glossaryRow(it, idx)).join("")}
            </div>
          </section>

          <section class="about-section" data-tab="limits" role="tabpanel">
            <div class="about-section-head">
              <h2>⚠️ Signal Limits & Data Quality</h2>
              <p>Why results can change + how to interpret safely</p>
            </div>

            <div class="about-limit-grid">
              ${this.limitCard("🧾 On-ledger only",
                "Signals come from observable XRPL activity. Off-ledger context (exchange internal movement, KYC, custody) is not visible here."
              )}
              ${this.limitCard("⚠️ False positives are normal",
                "Many patterns have benign explanations (service wallets, batching, market making). Treat signals as prompts, not conclusions."
              )}
              ${this.limitCard("🛰️ Sampling + capture gaps",
                "Reconnects, server load limits, and missing ledgers can distort local history. Continuity gaps can skew comparisons."
              )}
              ${this.limitCard("🧪 Heuristics, not proof",
                "Confidence and persistence are explainable heuristics — not identity attribution or legal determinations."
              )}
              ${this.limitCard("🔭 Window sensitivity",
                "Results can change with different window sizes (5 vs 20 vs 50). Use consistent windows for analysis and exports."
              )}
              ${this.limitCard("🌐 Rate limits & node variability",
                "Different XRPL servers behave differently under load. Throttling and queue-based fetching reduce skipped ledgers."
              )}
            </div>
          </section>

          <footer class="about-footer">
            <div class="about-footer-left">NaluXrp • about@2.0.0-futuristic</div>
            <div class="about-footer-right">Built for explainability: patterns are signals, not accusations.</div>
          </footer>
        </div>
      `;
    },

    tabButton(id, label) {
      return `
        <button class="about-tab" type="button" role="tab"
          data-tab-btn="${id}" aria-selected="false">
          ${label}
        </button>
      `;
    },

    algoCard({ icon, title, body, bullets }) {
      const id = this.safeId(title);
      return `
        <article class="about-card about-accordion" data-acc="${id}">
          <div class="about-card-top">
            <div class="about-card-icon">${icon}</div>
            <div class="about-card-title">${title}</div>
            <button class="about-acc-toggle" type="button" aria-expanded="false" data-acc-toggle="${id}">
              <span class="about-acc-label">Details</span>
              <span class="about-acc-chevron">▾</span>
            </button>
          </div>

          <div class="about-acc-body" data-acc-body="${id}">
            <p class="about-card-body">${body}</p>
            <ul class="about-bullets">
              ${(bullets || []).map((b) => `<li>${b}</li>`).join("")}
            </ul>
          </div>
        </article>
      `;
    },

    step(icon, title, body) {
      return `
        <div class="about-step">
          <div class="about-step-icon">${icon}</div>
          <div class="about-step-content">
            <div class="about-step-title">${title}</div>
            <div class="about-step-body">${body}</div>
          </div>
        </div>
      `;
    },

    patternCard({ title, subtitle, body, benign, risk }) {
      return `
        <article class="about-card about-pattern">
          <div class="about-pattern-head">
            <div>
              <div class="about-pattern-title">${title}</div>
              <div class="about-pattern-sub">${subtitle}</div>
            </div>
            <div class="about-pattern-badge">Pattern</div>
          </div>

          <p class="about-card-body">${body}</p>

          <div class="about-split">
            <div class="about-split-col good">
              <div class="about-split-title">Benign</div>
              <ul class="about-mini-list">
                ${(benign || []).map((x) => `<li>${x}</li>`).join("")}
              </ul>
            </div>
            <div class="about-split-col warn">
              <div class="about-split-title">Risk cues</div>
              <ul class="about-mini-list">
                ${(risk || []).map((x) => `<li>${x}</li>`).join("")}
              </ul>
            </div>
          </div>
        </article>
      `;
    },

    benignCard(title, body, bullets) {
      return `
        <article class="about-card about-benign">
          <div class="about-benign-title">${title}</div>
          <p class="about-card-body">${body}</p>
          <ul class="about-bullets">
            ${(bullets || []).map((b) => `<li>${b}</li>`).join("")}
          </ul>
        </article>
      `;
    },

    limitCard(title, body) {
      return `
        <article class="about-card about-limit">
          <div class="about-limit-title">${title}</div>
          <p class="about-card-body">${body}</p>
        </article>
      `;
    },

    glossaryRow(item, idx) {
      const id = `glossary_${idx}_${this.safeId(item.key)}`;
      const tags = (item.tags || []).map((t) => `<span class="about-tag">${t}</span>`).join("");
      return `
        <div class="about-glossary-item" data-glossary-item="${id}">
          <button class="about-glossary-head" type="button" data-glossary-toggle="${id}" aria-expanded="false">
            <div class="about-glossary-left">
              <div class="about-glossary-term">${item.key}</div>
              <div class="about-glossary-tags">${tags}</div>
            </div>
            <div class="about-glossary-right">
              <span class="about-glossary-chevron">▾</span>
            </div>
          </button>
          <div class="about-glossary-body" data-glossary-body="${id}">
            ${item.body}
          </div>
        </div>
      `;
    },

    bind() {
      const root = document.getElementById("about");
      if (!root) return;

      // Tabs
      root.querySelectorAll("[data-tab-btn]").forEach((btn) => {
        btn.addEventListener("click", () => this.setTab(btn.getAttribute("data-tab-btn")));
      });

      // Accordions
      root.querySelectorAll("[data-acc-toggle]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.getAttribute("data-acc-toggle");
          this.toggleAccordion(id, btn);
        });
      });

      // Glossary toggles
      root.querySelectorAll("[data-glossary-toggle]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.getAttribute("data-glossary-toggle");
          this.toggleGlossary(id, btn);
        });
      });

      // Glossary search
      const search = document.getElementById("aboutGlossarySearch");
      if (search) {
        search.addEventListener("input", () => this.filterGlossary(search.value));
      }

      // Expand / collapse all
      const expandAll = document.getElementById("aboutExpandAll");
      const collapseAll = document.getElementById("aboutCollapseAll");

      if (expandAll) expandAll.addEventListener("click", () => this.setAllGlossary(true));
      if (collapseAll) collapseAll.addEventListener("click", () => this.setAllGlossary(false));

      // Count label
      this.updateGlossaryCount();
    },

    setTab(tabId) {
      const root = document.getElementById("about");
      if (!root) return;

      this.activeTab = tabId;

      // Buttons
      root.querySelectorAll(".about-tab[data-tab-btn]").forEach((b) => {
        const on = b.getAttribute("data-tab-btn") === tabId;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
      });

      // Panels
      root.querySelectorAll(".about-section[data-tab]").forEach((sec) => {
        const on = sec.getAttribute("data-tab") === tabId;
        sec.classList.toggle("is-active", on);
      });
    },

    toggleAccordion(id, btn) {
      const body = document.querySelector(`[data-acc-body="${id}"]`);
      if (!body) return;

      const expanded = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", expanded ? "false" : "true");
      btn.classList.toggle("is-open", !expanded);
      body.classList.toggle("is-open", !expanded);
    },

    toggleGlossary(id, btn) {
      const body = document.querySelector(`[data-glossary-body="${id}"]`);
      const item = document.querySelector(`[data-glossary-item="${id}"]`);
      if (!body || !item) return;

      const expanded = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", expanded ? "false" : "true");
      item.classList.toggle("is-open", !expanded);
      body.classList.toggle("is-open", !expanded);
    },

    setAllGlossary(open) {
      document.querySelectorAll("[data-glossary-toggle]").forEach((btn) => {
        const id = btn.getAttribute("data-glossary-toggle");
        const body = document.querySelector(`[data-glossary-body="${id}"]`);
        const item = document.querySelector(`[data-glossary-item="${id}"]`);
        if (!body || !item) return;
        btn.setAttribute("aria-expanded", open ? "true" : "false");
        item.classList.toggle("is-open", open);
        body.classList.toggle("is-open", open);
      });
    },

    filterGlossary(q) {
      const query = (q || "").trim().toLowerCase();
      const list = document.getElementById("aboutGlossaryList");
      if (!list) return;

      let visible = 0;

      list.querySelectorAll(".about-glossary-item").forEach((node) => {
        const term = (node.querySelector(".about-glossary-term")?.textContent || "").toLowerCase();
        const tags = (node.querySelector(".about-glossary-tags")?.textContent || "").toLowerCase();
        const body = (node.querySelector(".about-glossary-body")?.textContent || "").toLowerCase();

        const match =
          !query ||
          term.includes(query) ||
          tags.includes(query) ||
          body.includes(query);

        node.style.display = match ? "" : "none";
        if (match) visible += 1;
      });

      this.updateGlossaryCount(visible);
    },

    updateGlossaryCount(overrideVisible) {
      const countEl = document.getElementById("aboutGlossaryCount");
      if (!countEl) return;

      const total = this.glossaryItems.length;
      const visible =
        typeof overrideVisible === "number"
          ? overrideVisible
          : document.querySelectorAll(".about-glossary-item").length;

      countEl.textContent = `${visible}/${total}`;
    },

    safeId(s) {
      return String(s || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 60);
    },
  };

  // Render on load (works with your current "sections" architecture)
  document.addEventListener("DOMContentLoaded", () => {
    About.render();
  });

  // Optional external trigger if your UI re-mounts pages
  window.renderAbout = () => About.render();

  // Export for debugging
  window.NaluAbout = About;
})();
