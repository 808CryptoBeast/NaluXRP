/* =========================================================
   about.js — NaluXrp 🌊 About Page (Futuristic + Educational)
   ✅ Matches class names expected by your provided about.css
   ✅ Renders reliably when switching to About (initAbout + hooks)
   ✅ Tabs + accordions + glossary search + expand/collapse
   ✅ Highly detailed explanations for non-technical users
   ========================================================= */

(function () {
  const VERSION = "about@3.0.0-edu-futuristic";

  // ---------- Glossary data (educational, plain-English) ----------
  const GLOSSARY = [
    {
      term: "Ledger",
      tags: ["basics", "xrpl"],
      definition:
        "A ledger is a finalized 'block' of XRPL activity. Every few seconds, the network closes a ledger that contains a set of validated transactions and updates the state of accounts, balances, and trustlines."
    },
    {
      term: "Ledger Stream",
      tags: ["dashboard", "live"],
      definition:
        "A continuously updating view of recently closed ledgers. In NaluXrp, each card summarizes one ledger: total transactions, transaction-type mix, fee averages, and a dominant activity label."
    },
    {
      term: "Transaction Mix",
      tags: ["analytics", "dashboard"],
      definition:
        "The breakdown of transaction types within a ledger (Payments, Offers, NFTs, TrustSet, Other). Mix helps you understand what the network is 'doing' right now."
    },
    {
      term: "Dominant Type",
      tags: ["metrics", "dashboard"],
      definition:
        "The transaction category with the highest count in a given ledger. Dominant type is a fast signal: if one activity overwhelms others, that often reflects a market phase, a service batch, or abnormal bursts."
    },
    {
      term: "Dominance Strength",
      tags: ["metrics", "analytics"],
      definition:
        "How strongly one transaction type dominates the mix. Example: If Offers are 75% of the ledger, dominance strength is high. If everything is evenly spread, dominance strength is low."
    },
    {
      term: "Mix Compression (Concentration)",
      tags: ["analytics", "patterns"],
      definition:
        "A measure of how concentrated activity is in a small number of categories. High compression means the ledger is 'one-note' (mostly one type), which can happen during bursts or specialized activity."
    },
    {
      term: "Continuity Gap",
      tags: ["quality", "network"],
      definition:
        "A missing ledger in your locally captured history. This can happen because of reconnects, node load, rate limiting, or temporarily failing to fetch a ledger. Gaps matter because they can distort short-window statistics."
    },
    {
      term: "Flow",
      tags: ["forensics", "basics"],
      definition:
        "In this app, 'flow' usually refers to value movement patterns inferred from Payment transactions (sender → receiver edges). Flow is used to detect repeated fingerprints and clusters."
    },
    {
      term: "Flow Fingerprint (Breadcrumb)",
      tags: ["forensics", "cybersecurity"],
      definition:
        "A repeated sender→receiver relationship seen across multiple ledgers (or repeated structural pattern). The important word is repeated: persistence across ledgers is often more meaningful than a single spike."
    },
    {
      term: "Repeat Count",
      tags: ["forensics", "metrics"],
      definition:
        "How many separate ledgers contain the same fingerprint pattern. Higher repeat counts generally indicate a stable process (service batching, automation, routing) or a persistent coordinated behavior."
    },
    {
      term: "Confidence Score",
      tags: ["forensics", "heuristics"],
      definition:
        "An explainable heuristic score estimating how stable and strong a pattern is within the chosen window. This is not proof and not identity — it’s a ranking signal to help you prioritize investigation."
    },
    {
      term: "Fan-out",
      tags: ["patterns", "cybersecurity"],
      definition:
        "One sender distributes to many receivers. This can be legitimate (airdrops, payouts, exchange withdrawals) or suspicious (drain dispersion, smurfing). Context and persistence are key."
    },
    {
      term: "Fan-in",
      tags: ["patterns", "cybersecurity"],
      definition:
        "Many senders converge into one receiver. Often legitimate (exchange deposits, merchant aggregation, consolidation), but can also appear in coordinated funneling or staging."
    },
    {
      term: "Hub Model",
      tags: ["graph", "patterns"],
      definition:
        "A central connector node that links many wallets. Hubs are common for services (exchanges, bridges, issuers). A hub alone isn’t suspicious; unusual routing behavior or sudden shifts can be."
    },
    {
      term: "Cluster",
      tags: ["graph", "forensics"],
      definition:
        "A group of wallets connected by observed interactions within a window. Clusters can represent ecosystem structure (service networks, market-making) or coordinated campaigns."
    },
    {
      term: "Cluster Persistence",
      tags: ["graph", "metrics"],
      definition:
        "How consistently a cluster’s members appear across the selected window. A persistent cluster suggests stable structure (service network). A volatile cluster suggests opportunistic or temporary behavior."
    },
    {
      term: "Ping-pong Pattern",
      tags: ["forensics", "patterns"],
      definition:
        "Back-and-forth transfers between two wallets across multiple ledgers. Sometimes benign (testing, market-making), sometimes used as a layering-like behavior. Look at amount regularity and timing."
    },
    {
      term: "Replay Window",
      tags: ["forensics", "workflow"],
      definition:
        "A controlled slice of captured ledger history you can rewind through. Replay is powerful because it lets you compare “before vs after” with the same analysis lens."
    },
    {
      term: "Forensic Snapshot",
      tags: ["forensics", "export"],
      definition:
        "An exportable record of the analysis state: selected window size, ledgers in view, detected fingerprints, clusters, and explainable narratives — designed for documentation and reporting."
    },
    {
      term: "Account Inspector",
      tags: ["inspector", "workflow"],
      definition:
        "A deeper per-account view used to pivot from signals into details: balances, objects, trustlines, and account state. Inspector is where you validate a suspected hub, service behavior, or routing pattern."
    }
  ];

  // ---------- Utilities ----------
  function el(id) {
    return document.getElementById(id);
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function uniqId(prefix) {
    return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
  }

  // ---------- Render ----------
  function renderAbout() {
    const root = el("about");
    if (!root) {
      console.error("❌ about.js: #about section not found.");
      return;
    }

    // Build page HTML to match your about.css selectors:
    root.innerHTML = `
      <div class="about-page">

        <!-- ===== HERO ===== -->
        <div class="about-hero">
          <!-- Left hero info (text content) -->
          <div class="about-hero-card">
            <div class="about-kicker">NaluXrp 🌊 • XRPL Forensics • Explainable Signals</div>
            <div class="about-title">About</div>
            <p class="about-subtitle">
              NaluXrp is a real-time XRPL analysis suite built for <strong>learning</strong> and <strong>investigation</strong>.
              It turns live ledger activity into explainable signals: transaction dominance, flow fingerprints,
              graph clusters, and replayable forensic snapshots — without claiming identity or making accusations.
            </p>

            <div class="about-chip-row">
              <span class="about-chip">Real ledger data</span>
              <span class="about-chip">Stream + replay</span>
              <span class="about-chip">Explainable heuristics</span>
              <span class="about-chip">Flow fingerprints</span>
              <span class="about-chip">Graph clusters</span>
              <span class="about-chip">Export snapshots</span>
            </div>

            <div class="about-divider"></div>

            <div class="about-callouts">
              <div class="about-callout neutral">
                <div class="about-callout-icon">🔐</div>
                <div>
                  <div class="about-callout-title">Cybersecurity mindset</div>
                  <div class="about-callout-text">
                    Treat the ledger like a high-volume event stream. We look for stable fingerprints, bursts,
                    routing behaviors, and persistent clusters — the same kinds of patterns used in threat hunting,
                    fraud analysis, and network telemetry.
                  </div>
                </div>
              </div>

              <div class="about-callout warn">
                <div class="about-callout-icon">⚠️</div>
                <div>
                  <div class="about-callout-title">Interpretation warning</div>
                  <div class="about-callout-text">
                    Many “suspicious-looking” structures are normal for exchanges, issuers, bridges, and market makers.
                    Signals here are <strong>starting points</strong>, not conclusions. Always validate with context and multiple sources.
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Right hero side (quick mission card) -->
          <div class="about-hero-card">
            <div class="about-hero-card-title">Mission</div>
            <div class="about-hero-card-tag">Futuristic • Explainable • Practical</div>
            <p class="about-hero-card-text">
              NaluXrp helps you learn how modern on-chain analysis works by translating raw XRPL activity into readable patterns:
              <strong>what changed</strong>, <strong>what repeated</strong>, and <strong>what connected</strong>.
              The goal is to help you build intuition — and document investigations responsibly.
            </p>

            <button class="about-acc-toggle" type="button" data-acc="missionDetails" aria-expanded="false">
              <span>Why “Explainable” matters</span>
              <span class="about-acc-chevron">▾</span>
            </button>
            <div class="about-acc-body" data-acc-body="missionDetails">
              <ul class="about-bullets">
                <li><strong>Transparent signals:</strong> You can see exactly what triggered a flag or narrative.</li>
                <li><strong>Better learning:</strong> Users can understand patterns without reading raw JSON.</li>
                <li><strong>Safer conclusions:</strong> Clear heuristics discourage “identity claims” based on weak evidence.</li>
              </ul>
            </div>
          </div>
        </div>

        <!-- ===== TABS ===== -->
        <div class="about-tabs" role="tablist" aria-label="About tabs">
          <button class="about-tab is-active" data-tab="algorithms" role="tab" aria-selected="true">🧠 Algorithms</button>
          <button class="about-tab" data-tab="patterns" role="tab" aria-selected="false">🧩 Visual Patterns</button>
          <button class="about-tab" data-tab="glossary" role="tab" aria-selected="false">📚 Glossary</button>
          <button class="about-tab" data-tab="limits" role="tab" aria-selected="false">⚠️ Limits</button>
        </div>

        <!-- ===== SECTION: ALGORITHMS ===== -->
        <div class="about-section is-active" data-section="algorithms" role="tabpanel">

          <div class="about-section-head">
            <h2>How NaluXrp “thinks” (plain English)</h2>
            <p>
              The dashboard is designed like a security console: it summarizes live activity, highlights persistence,
              and provides workflows to drill deeper. Here’s what the main systems do — and how to interpret them safely.
            </p>
          </div>

          <div class="about-grid">
            ${buildAlgorithmCard({
              icon: "⚡",
              title: "Ledger Stream + Transaction Dominance",
              body:
                "Each ledger card summarizes what just happened: total TX, fees, success rate, and a breakdown of activity types. " +
                "The dominant type (Payment / Offers / NFT / TrustSet / Other) is a fast situational-awareness signal.",
              bullets: [
                "Use dominance to spot bursts and sudden behavior shifts.",
                "Compare several ledgers — one ledger alone can be misleading.",
                "Watch for rapid flips: e.g., Payments dominate → Offers dominate."
              ],
              detailsId: "alg_dominance"
            })}

            ${buildAlgorithmCard({
              icon: "🧪",
              title: "Mix Compression + “What changed” Narratives",
              body:
                "NaluXrp tracks how concentrated the transaction mix is. A highly compressed mix means the ledger is dominated by fewer categories. " +
                "Delta narratives summarize what changed between ledgers (e.g., “Offers surged”, “Payments collapsed”).",
              bullets: [
                "Compression helps you quickly detect 'one-note' activity.",
                "Narratives reduce raw numbers into explainable summaries.",
                "Useful for before/after comparison during replay."
              ],
              detailsId: "alg_compression"
            })}

            ${buildAlgorithmCard({
              icon: "👣",
              title: "Flow Fingerprints (Breadcrumbs)",
              body:
                "Breadcrumbs are repeated flow patterns that appear across multiple ledgers — like recurring sender→receiver relationships. " +
                "Persistence is a powerful concept: repeated structure often matters more than single spikes.",
              bullets: [
                "Repeat count ranks stable patterns above noise.",
                "Confidence scores are explainable heuristics (not proof).",
                "Click fingerprints to highlight relevant ledgers (trace workflow)."
              ],
              detailsId: "alg_breadcrumbs"
            })}
          </div>

          <div class="about-divider"></div>

          <div class="about-grid">
            ${buildAlgorithmCard({
              icon: "🕸️",
              title: "Cluster Inference (Graph-Based, No Identity)",
              body:
                "The app builds a temporary interaction graph from observed flows. Wallets that connect form clusters. " +
                "Clusters help you understand structure: service networks, ecosystems, or coordinated campaigns — depending on context.",
              bullets: [
                "Cluster size: how many wallets are connected in the window.",
                "Persistence: how consistently the cluster appears across ledgers.",
                "Clusters are structural hints — not attribution."
              ],
              detailsId: "alg_clusters"
            })}

            ${buildAlgorithmCard({
              icon: "⏮️",
              title: "Replay Mode + Stable Windows",
              body:
                "Replay lets you rewind captured history. This matters because analysis depends on window size: 5 vs 20 vs 50 ledgers can change results. " +
                "Replay helps you compare behavior using the same lens.",
              bullets: [
                "Use a consistent window size when comparing time periods.",
                "Replay reduces emotional bias from live spikes.",
                "Best for documenting “baseline → anomaly → aftermath”."
              ],
              detailsId: "alg_replay"
            })}

            ${buildAlgorithmCard({
              icon: "📦",
              title: "Forensic Snapshots (Export JSON/CSV)",
              body:
                "Exports are designed for reporting and reproducibility. You export not just a number — but the context: " +
                "window size, selected ledgers, fingerprints, clusters, and narratives.",
              bullets: [
                "Use exports to write investigation notes.",
                "Attach exports to reports for repeatable analysis.",
                "Exports help teams discuss evidence without guessing."
              ],
              detailsId: "alg_exports"
            })}
          </div>

          <div class="about-divider"></div>

          <div class="about-section-head">
            <h3>A practical workflow (learn → investigate → document)</h3>
            <p>
              If you’re new to on-chain analytics, this workflow is how to use NaluXrp without getting misled by noise.
              Think of it like SOC (security operations) triage: observe, pivot, validate, and document.
            </p>
          </div>

          <div class="about-steps">
            ${buildStep("⚡", "Start with the Ledger Stream", "Look for dominant activity, bursts, and continuity gaps. Pay attention to trends across multiple ledgers, not just one.")}
            ${buildStep("👣", "Use Breadcrumbs to find persistence", "Repeated fingerprints are often more meaningful than spikes. Use them to highlight ledgers involved in the same pattern.")}
            ${buildStep("🔎", "Pivot into Account Inspector", "Inspect suspected hubs/senders/receivers. Check whether behavior matches service-wallet patterns (batching, routing, known structure).")}
            ${buildStep("🧭", "Validate with context", "Ask: Could this be exchange/issuer/market-making activity? Check amounts, timing regularity, and whether the pattern persists.")}
            ${buildStep("⏮️", "Replay baseline vs anomaly", "Rewind and compare. Keep the same window size to avoid false differences caused by sensitivity.")}
            ${buildStep("📦", "Export and document", "Export JSON/CSV snapshots. Record: window size, trigger pattern, ledgers highlighted, and what you validated.")}
          </div>

          <div class="about-hint">
            <strong>Tip:</strong> A pattern isn’t “bad” because it looks complex. Services are complex.
            The question is whether behavior is consistent with known service dynamics — and whether changes are sudden, persistent, and explainable.
          </div>
        </div>

        <!-- ===== SECTION: PATTERNS ===== -->
        <div class="about-section" data-section="patterns" role="tabpanel">
          <div class="about-section-head">
            <h2>Visual Patterns (mental models)</h2>
            <p>
              These are the core flow structures used in cybersecurity-style analytics. NaluXrp flags them because humans reason well with shape:
              “one-to-many”, “many-to-one”, “hub routing”, and “dense clusters”.
            </p>
          </div>

          <div class="about-pattern-grid">
            ${buildPatternCard({
              title: "Fan-out",
              sub: "One → many distribution",
              badge: "Flow shape",
              description:
                "A single source sends to many destinations in a short window. This is common for payouts and withdrawals — and also for drain-style dispersion.",
              good: ["Airdrops / payouts", "Exchange withdrawals", "Treasury distribution"],
              warn: ["Drain-style dispersion", "Automation / scripting", "Smurfing patterns"]
            })}

            ${buildPatternCard({
              title: "Fan-in",
              sub: "Many → one aggregation",
              badge: "Flow shape",
              description:
                "Multiple sources converge into one destination. Common for exchange deposits and merchant aggregation — also seen in coordinated funneling.",
              good: ["Exchange deposits", "Merchant aggregation", "Consolidation for fees"],
              warn: ["Funneling before movement", "Coordinated staging", "High regularity deposits"]
            })}

            ${buildPatternCard({
              title: "Hub Model",
              sub: "Central connector node",
              badge: "Graph shape",
              description:
                "A hub routes transactions between many wallets. Most hubs are legitimate service infrastructure. Suspicion comes from unusual routing changes or bursts, not the hub itself.",
              good: ["Service hot wallet", "Bridge/router", "Issuer distribution hub"],
              warn: ["Coordinated routing shifts", "Layering-like routes", "Sudden hub emergence"]
            })}

            ${buildPatternCard({
              title: "Ping-pong / Loops",
              sub: "Back-and-forth activity",
              badge: "Behavioral",
              description:
                "Two wallets repeatedly interact in both directions. This can be benign (testing, making markets) or used to create noisy layering-like motion.",
              good: ["Test transactions", "Market-making dynamics", "Operational checks"],
              warn: ["Uniform amounts + strict timing", "Repeated loop across many ledgers", "Obfuscation attempts"]
            })}
          </div>

          <div class="about-divider"></div>

          <div class="about-section-head">
            <h3>How to avoid false positives</h3>
            <p>
              Many patterns are normal around exchanges, issuers, and DEX/AMM activity. Use these checks before escalating:
            </p>
          </div>

          <div class="about-benign-grid">
            ${buildSimpleCard("🏦", "Exchanges / Service wallets", "High fan-in/out and hubs are normal for exchanges. Look for consistent batching, known structure, and stable persistence over time.")}
            ${buildSimpleCard("🏷️", "Issuers / Trustline operations", "TrustSet bursts and issuer-centric routing can be legitimate token ops: onboarding, distribution, and liquidity provisioning.")}
            ${buildSimpleCard("💧", "DEX / AMM activity", "OfferCreate/Cancel surges and loop-like patterns often reflect market-making and arbitrage. Check if it aligns with liquidity activity.")}
            ${buildSimpleCard("🤖", "Automation & testing", "Uniform amounts and strict periodicity can be scripts. This is especially common on testnet or during integration testing.")}
          </div>

          <div class="about-hint">
            <strong>Rule of thumb:</strong> Suspicion should increase when a pattern is
            <em>persistent</em> + <em>structurally coordinated</em> + <em>abruptly changes</em>
            without a reasonable service explanation.
          </div>
        </div>

        <!-- ===== SECTION: GLOSSARY ===== -->
        <div class="about-section" data-section="glossary" role="tabpanel">
          <div class="about-section-head">
            <h2>Glossary</h2>
            <p>
              Learning the language makes the signals easier. Use search to filter terms, and expand items for definitions.
            </p>
          </div>

          <div class="about-glossary-toolbar">
            <div class="about-search">
              <span class="about-search-icon">🔎</span>
              <input id="aboutSearchInput" type="text" placeholder="Search: fan-out, hub, dominance, cluster, continuity gap..." />
            </div>

            <div class="about-toolbar-actions">
              <button class="about-btn" id="aboutExpandAll" type="button">Expand all</button>
              <button class="about-btn" id="aboutCollapseAll" type="button">Collapse all</button>
            </div>

            <div class="about-toolbar-note" id="aboutGlossaryMeta">0 terms</div>
          </div>

          <div class="about-glossary-list" id="aboutGlossaryList"></div>

          <div class="about-hint">
            Want this even clearer? A next upgrade is to add <strong>dashboard tooltips</strong>:
            hover “Fan-out” or “Dominance” on the live dashboard to see a mini diagram + benign vs risk notes.
          </div>
        </div>

        <!-- ===== SECTION: LIMITS ===== -->
        <div class="about-section" data-section="limits" role="tabpanel">
          <div class="about-section-head">
            <h2>Signal limits & data quality</h2>
            <p>
              These are important. Great investigators know the limitations of their instruments.
              NaluXrp is designed to be honest about uncertainty and window sensitivity.
            </p>
          </div>

          <div class="about-limit-grid">
            ${buildSimpleCard("🧾", "On-ledger only", "Signals come from observable XRPL activity. Off-ledger context (internal exchange transfers, custody movement, KYC, identity) is not visible here.")}
            ${buildSimpleCard("⚠️", "False positives are normal", "Services create patterns that look coordinated. Treat signals as prompts to investigate, not accusations.")}
            ${buildSimpleCard("🛰️", "Sampling + continuity gaps", "Reconnects and rate limits can cause missing ledgers in local history. Gaps can distort short-window measurements and narratives.")}
            ${buildSimpleCard("🧪", "Heuristics are not proof", "Confidence scores and persistence are explainable heuristics — not legal determinations and not identity claims.")}
            ${buildSimpleCard("🔭", "Window sensitivity", "Results can change with 5 vs 20 vs 50 ledgers. Always compare using the same window size, especially in replay mode.")}
            ${buildSimpleCard("🌐", "Node variability", "Different XRPL servers behave differently under load. Queueing, backoff, and retries help — but no real-time capture is perfect.")}
          </div>

          <div class="about-divider"></div>

          <div class="about-section-head">
            <h3>Ethics & responsible use</h3>
            <p>
              Tools like this are powerful. The goal is to understand structure and behavior — not to label people.
              If you publish analysis, include uncertainty, cite what you observed, and avoid identity attribution.
            </p>
          </div>

          <div class="about-footer">
            <div class="about-footer-left">NaluXrp • <span style="color: var(--accent-secondary);">${VERSION}</span></div>
            <div>Built for explainability: patterns are signals, not accusations.</div>
          </div>
        </div>

      </div>
    `;

    // Bind UI
    bindTabs(root);
    bindAccordions(root);

    // Render glossary
    renderGlossary("");
    bindGlossary(root);
  }

  // ---------- Builders (markup matches your about.css) ----------
  function buildAlgorithmCard({ icon, title, body, bullets, detailsId }) {
    const accKey = uniqId(detailsId);
    return `
      <div class="about-card">
        <div class="about-card-top">
          <div class="about-card-icon">${escapeHtml(icon)}</div>
          <div class="about-card-title">${escapeHtml(title)}</div>
          <button class="about-acc-toggle" type="button" data-acc="${accKey}" aria-expanded="false">
            <span>Details</span>
            <span class="about-acc-chevron">▾</span>
          </button>
        </div>

        <div class="about-card-body">${escapeHtml(body)}</div>

        <div class="about-acc-body" data-acc-body="${accKey}">
          <ul class="about-bullets">
            ${(bullets || []).map((b) => `<li>${escapeHtml(b)}</li>`).join("")}
          </ul>
        </div>
      </div>
    `;
  }

  function buildStep(icon, title, body) {
    return `
      <div class="about-step">
        <div class="about-step-icon">${escapeHtml(icon)}</div>
        <div>
          <div class="about-step-title">${escapeHtml(title)}</div>
          <div class="about-step-body">${escapeHtml(body)}</div>
        </div>
      </div>
    `;
  }

  function buildPatternCard({ title, sub, badge, description, good, warn }) {
    return `
      <div class="about-card">
        <div class="about-pattern-head">
          <div>
            <div class="about-pattern-title">${escapeHtml(title)}</div>
            <div class="about-pattern-sub">${escapeHtml(sub)}</div>
          </div>
          <div class="about-pattern-badge">${escapeHtml(badge)}</div>
        </div>

        <div class="about-card-body">${escapeHtml(description)}</div>

        <div class="about-split">
          <div class="about-split-col good">
            <div class="about-split-title">✅ Common benign causes</div>
            <ul class="about-mini-list">
              ${(good || []).map((x) => `<li>${escapeHtml(x)}</li>`).join("")}
            </ul>
          </div>

          <div class="about-split-col warn">
            <div class="about-split-title">⚠️ Risk cues</div>
            <ul class="about-mini-list">
              ${(warn || []).map((x) => `<li>${escapeHtml(x)}</li>`).join("")}
            </ul>
          </div>
        </div>
      </div>
    `;
  }

  function buildSimpleCard(icon, title, body) {
    return `
      <div class="about-card">
        <div class="about-card-top">
          <div class="about-card-icon">${escapeHtml(icon)}</div>
          <div class="about-benign-title">${escapeHtml(title)}</div>
          <div></div>
        </div>
        <div class="about-card-body">${escapeHtml(body)}</div>
      </div>
    `;
  }

  // ---------- Tabs ----------
  function bindTabs(root) {
    const tabs = root.querySelectorAll(".about-tab[data-tab]");
    const sections = root.querySelectorAll(".about-section[data-section]");
    if (!tabs.length || !sections.length) return;

    function setActive(name) {
      tabs.forEach((t) => {
        const on = t.getAttribute("data-tab") === name;
        t.classList.toggle("is-active", on);
        t.setAttribute("aria-selected", on ? "true" : "false");
      });

      sections.forEach((s) => {
        const on = s.getAttribute("data-section") === name;
        s.classList.toggle("is-active", on);
      });

      // keep the tab row visible (sticky), and prevent weird scroll offsets
      const topAnchor = root.querySelector(".about-tabs");
      if (topAnchor) topAnchor.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    tabs.forEach((t) => {
      t.addEventListener("click", () => {
        setActive(t.getAttribute("data-tab"));
      });
    });
  }

  // ---------- Accordions ----------
  function bindAccordions(root) {
    root.querySelectorAll(".about-acc-toggle[data-acc]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.getAttribute("data-acc");
        const body = root.querySelector(`.about-acc-body[data-acc-body="${key}"]`);
        if (!body) return;

        const isOpen = body.classList.toggle("is-open");
        btn.classList.toggle("is-open", isOpen);
        btn.setAttribute("aria-expanded", isOpen ? "true" : "false");

        const chevron = btn.querySelector(".about-acc-chevron");
        if (chevron) chevron.textContent = isOpen ? "▴" : "▾";
      });
    });
  }

  // ---------- Glossary ----------
  function renderGlossary(query) {
    const list = el("aboutGlossaryList");
    const meta = el("aboutGlossaryMeta");
    if (!list) return;

    const q = String(query || "").trim().toLowerCase();
    const filtered = GLOSSARY.filter((g) => {
      if (!q) return true;
      return (
        g.term.toLowerCase().includes(q) ||
        (g.tags || []).join(" ").toLowerCase().includes(q) ||
        g.definition.toLowerCase().includes(q)
      );
    });

    if (meta) meta.textContent = `${filtered.length} term${filtered.length === 1 ? "" : "s"}`;

    list.innerHTML = filtered
      .map((g) => {
        const tagHtml = (g.tags || []).map((t) => `<span class="about-tag">${escapeHtml(t)}</span>`).join("");
        const itemId = uniqId("gloss");
        return `
          <div class="about-glossary-item" data-gloss-item="${itemId}">
            <button class="about-glossary-head" type="button" aria-expanded="false">
              <div class="about-glossary-left">
                <div class="about-glossary-term">${escapeHtml(g.term)}</div>
                <div class="about-glossary-tags">${tagHtml}</div>
              </div>
              <div class="about-glossary-right">
                <span class="about-glossary-chevron">▾</span>
              </div>
            </button>
            <div class="about-glossary-body">${escapeHtml(g.definition)}</div>
          </div>
        `;
      })
      .join("");

    // click binding for glossary items
    list.querySelectorAll(".about-glossary-item").forEach((item) => {
      const head = item.querySelector(".about-glossary-head");
      const body = item.querySelector(".about-glossary-body");
      const chev = item.querySelector(".about-glossary-chevron");
      if (!head || !body) return;

      head.addEventListener("click", () => {
        const open = item.classList.toggle("is-open");
        body.classList.toggle("is-open", open);
        head.setAttribute("aria-expanded", open ? "true" : "false");
        if (chev) chev.textContent = open ? "▴" : "▾";
      });
    });
  }

  function bindGlossary(root) {
    const input = root.querySelector("#aboutSearchInput");
    const expand = root.querySelector("#aboutExpandAll");
    const collapse = root.querySelector("#aboutCollapseAll");

    if (input) {
      input.addEventListener("input", () => renderGlossary(input.value));
    }

    if (expand) {
      expand.addEventListener("click", () => {
        root.querySelectorAll(".about-glossary-item").forEach((item) => {
          item.classList.add("is-open");
          const body = item.querySelector(".about-glossary-body");
          const head = item.querySelector(".about-glossary-head");
          const chev = item.querySelector(".about-glossary-chevron");
          if (body) body.classList.add("is-open");
          if (head) head.setAttribute("aria-expanded", "true");
          if (chev) chev.textContent = "▴";
        });
      });
    }

    if (collapse) {
      collapse.addEventListener("click", () => {
        root.querySelectorAll(".about-glossary-item").forEach((item) => {
          item.classList.remove("is-open");
          const body = item.querySelector(".about-glossary-body");
          const head = item.querySelector(".about-glossary-head");
          const chev = item.querySelector(".about-glossary-chevron");
          if (body) body.classList.remove("is-open");
          if (head) head.setAttribute("aria-expanded", "false");
          if (chev) chev.textContent = "▾";
        });
      });
    }
  }

  // ---------- Activation hooks (so About ALWAYS renders when opened) ----------
  function isAboutActive() {
    const a = el("about");
    return !!(a && a.classList.contains("active"));
  }

  function ensureRendered(force) {
    const root = el("about");
    if (!root) return;

    // If already has about-page and not forcing, do nothing
    if (!force && root.querySelector(".about-page")) return;

    renderAbout();
  }

  function installHooks() {
    // 1) Provide initAbout() (UI usually calls this)
    window.initAbout = function () {
      try {
        ensureRendered(true);
      } catch (e) {
        console.error("❌ initAbout failed:", e);
      }
    };

    // 2) Wrap switchPage to render when page becomes "about"
    if (typeof window.switchPage === "function" && !window.__aboutSwitchWrapped) {
      const original = window.switchPage;
      window.switchPage = function (pageId, ...rest) {
        const res = original.apply(this, [pageId, ...rest]);
        if (pageId === "about") {
          // render after UI swaps classes
          setTimeout(() => ensureRendered(false), 0);
        }
        return res;
      };
      window.__aboutSwitchWrapped = true;
    }

    // 3) MutationObserver fallback (if UI changes class "active")
    const aboutEl = el("about");
    if (aboutEl && !aboutEl.__aboutObserver) {
      const obs = new MutationObserver(() => {
        if (isAboutActive()) ensureRendered(false);
      });
      obs.observe(aboutEl, { attributes: true, attributeFilter: ["class"] });
      aboutEl.__aboutObserver = obs;
    }
  }

  // ---------- Boot ----------
  document.addEventListener("DOMContentLoaded", () => {
    installHooks();
    if (isAboutActive()) ensureRendered(false);
    console.log("ℹ️ about.js loaded (educational + CSS-matched)");
  });
})();
