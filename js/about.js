/* =========================================
   NaluXrp 🌊 — About (about.js)
   Modern / Futuristic About Page
   - Visual pattern diagrams (SVG)
   - Common benign explanations
   - Investigation checklist
   - Signal limits + data quality notes
   - Glossary w/ search + accordion controls
   ========================================= */

(function () {
  const ABOUT_VERSION = "about@2.0.0-futuristic";

  // ---------- Data ----------
  const ALGORITHMS = [
    {
      id: "ledger-rhythm",
      icon: "⏱️",
      title: "Ledger Rhythm & Cadence",
      short:
        "Tracks close cadence shifts and continuity to spot stress, congestion, and capture gaps.",
      details: [
        "XRPL closes validated ledgers continuously. Changes in cadence can reflect load or network conditions.",
        "Continuity gaps (missing ledgers in local capture) can appear due to reconnects or server load limits.",
      ],
      outputs: ["Cadence deviations", "Continuity gap flags", "Replay-safe analysis windows"],
      benign: [
        "Temporary websocket disconnects or rate limiting",
        "Server-side load (“too much load on the server”)",
        "Catch-up after switching endpoints",
      ],
      investigate: [
        "Check connection mode + server endpoint",
        "Confirm ledger indices are monotonic (no duplicates) in history",
        "If gaps appear, verify your queue/catch-up logic and throttle ledger fetches",
      ],
    },
    {
      id: "tx-mix",
      icon: "🧪",
      title: "Transaction Mix, Dominance & Concentration",
      short:
        "Groups types per ledger (Payment / Offers / NFT / TrustSet / Other) and explains dominant behavior changes.",
      details: [
        "Dominant Type is the largest category in the ledger mix.",
        "Dominance Strength measures how much one type controls the mix.",
        "Mix compression is a heuristic that flags when activity becomes unusually narrow or uniform.",
      ],
      outputs: ["Dominant type", "Dominance %", "Pattern flags", "Delta narratives"],
      benign: [
        "AMM/DEX bursts producing many OfferCreate/Cancel",
        "Issuer operations producing TrustSet spikes",
        "Batching behavior (payments grouped into ledger windows)",
      ],
      investigate: [
        "Compare several ledgers (not just one) to confirm persistence",
        "Check if dominance flips align with known events (DEX activity, issuer actions)",
        "Pivot into Inspector on top senders/receivers if Payments dominate",
      ],
    },
    {
      id: "breadcrumbs",
      icon: "👣",
      title: "Wallet Flow Breadcrumbs (Repeated Fingerprints)",
      short:
        "Detects repeated flow fingerprints across multiple ledgers to highlight persistent movement patterns.",
      details: [
        "Repeated Pair: A → B appears across multiple ledgers.",
        "Fan-out: one sender distributes to many receivers.",
        "Fan-in: many senders converge to one receiver.",
        "Ping-pong: back-and-forth A ⇄ B across ledgers.",
      ],
      outputs: ["Repeated fingerprints", "Repeat counts", "Confidence score", "Trace-highlight ledgers"],
      benign: [
        "Exchange hot wallets (many deposits/withdrawals)",
        "Issuer distribution and treasury operations",
        "Payment processors and batching systems",
        "Testing / automation scripts (especially on testnet)",
      ],
      investigate: [
        "Check amounts: are they uniform (scripted) or organic?",
        "Check timing: does it persist across many ledgers?",
        "Pivot: inspect addresses, then check neighbors and repeated counterparts",
      ],
    },
    {
      id: "clusters",
      icon: "🕸️",
      title: "Cluster Inference (Graph-Based, No Identity)",
      short:
        "Builds an interaction graph from flows and infers clusters via connectivity and persistence.",
      details: [
        "Addresses are nodes; observed transfers become edges.",
        "Clusters are inferred from structure only — not identity claims.",
        "Persistence estimates how consistently the group appears across the selected window.",
      ],
      outputs: ["Cluster size", "Persistence %", "Core members", "Cluster drill-down targets"],
      benign: [
        "Service wallets (exchanges/bridges) naturally connect many nodes",
        "Issuer ecosystems (treasury, distributors, market makers)",
        "Market making / routing networks (legit liquidity operations)",
      ],
      investigate: [
        "Look for hub-like nodes: high degree + repeated presence",
        "Check whether the cluster persists across multiple windows",
        "Use Inspector to map subtrees and see if it’s a service structure",
      ],
    },
    {
      id: "narratives",
      icon: "📖",
      title: "Ledger-to-Ledger Delta Narratives",
      short:
        "Turns raw deltas into explainable summaries (e.g., ‘Offers surged’ / ‘Payments collapsed’).",
      details: [
        "Compares adjacent ledgers in the selected window and ranks the largest changes.",
        "Adds a ‘dominance flip’ narrative when the leading category changes.",
      ],
      outputs: ["Top deltas", "Dominance flips", "Explainable summaries"],
      benign: [
        "Normal bursts from trading, arbitrage, AMM activity",
        "Issuer trustline churn during integrations/updates",
        "Batching effects shifting ledger-to-ledger mix",
      ],
      investigate: [
        "Confirm deltas are not an artifact of missing data or a continuity gap",
        "Cross-check the dominant ledgers in the stream",
        "Pivot into Explorer/Inspector for the window around the change",
      ],
    },
    {
      id: "replay",
      icon: "⏮️",
      title: "Replay & Forensic Snapshots",
      short:
        "Rewind captured history and export explainable state snapshots for reporting and investigation.",
      details: [
        "A rolling local history is retained (bounded) so analysis is stable.",
        "Replay anchors analysis to a selected ledger index.",
        "Exports snapshot current signals, narratives, and inferred structures.",
      ],
      outputs: ["Replay window", "Export JSON/CSV", "Stable analysis lens"],
      benign: [
        "Replay is local history — it won’t include ledgers not captured during outages",
        "Export reflects the current window and heuristics (not ground truth)",
      ],
      investigate: [
        "Export before switching networks to preserve evidence",
        "Use replay to compare ‘before/after’ around anomalies",
        "Keep window sizes consistent when comparing snapshots",
      ],
    },
  ];

  const PATTERN_VISUALS = [
    {
      id: "fanout",
      title: "Fan-out",
      subtitle: "One → many distribution",
      desc:
        "A single source sends to many destinations across a short window. Can be payouts/airdrops or drain-style dispersion.",
      svg: svgFanOut(),
      benign: ["Airdrops / payouts", "Exchange withdrawals", "Treasury distribution"],
      risk: ["Drain-style dispersion", "Scripting / automation", "Smurfing patterns"],
    },
    {
      id: "fanin",
      title: "Fan-in",
      subtitle: "Many → one aggregation",
      desc:
        "Many sources send into one destination. Can be exchange deposits or consolidation before a move.",
      svg: svgFanIn(),
      benign: ["Exchange deposits", "Merchant aggregation", "Consolidation for fees"],
      risk: ["Consolidation before laundering", "Coordinated funneling"],
    },
    {
      id: "hub",
      title: "Hub Model",
      subtitle: "Central connector node",
      desc:
        "A hub links many nodes and routes flow. Often a service wallet (exchange/bridge/issuer), sometimes a coordinator.",
      svg: svgHub(),
      benign: ["Service hot wallet", "Bridge/router", "Issuer distribution hub"],
      risk: ["Coordinated routing", "Layering behavior"],
    },
    {
      id: "cluster",
      title: "Cluster",
      subtitle: "Connected component",
      desc:
        "A group of wallets linked by observed interactions. Persistence suggests stable structure; volatility suggests opportunistic flow.",
      svg: svgCluster(),
      benign: ["Ecosystem structure", "Service network", "Market-making group"],
      risk: ["Coordinated campaign", "Persistent laundering ring"],
    },
  ];

  const GLOSSARY = [
    {
      term: "Dominant Type",
      tags: ["metrics", "dashboard"],
      def:
        "The transaction category (Payment / Offers / NFT / TrustSet / Other) with the highest count in a ledger or window.",
      why:
        "A dominance flip can indicate a behavior change (routing burst, DEX activity, issuer operations).",
    },
    {
      term: "Dominance Strength",
      tags: ["metrics", "dashboard"],
      def:
        "How strongly one transaction type dominates the mix (displayed as a percentage).",
      why:
        "High dominance can be normal in bursts, but persistent dominance can indicate concentrated or scripted behavior.",
    },
    {
      term: "Mix Compression (Concentration)",
      tags: ["analytics"],
      def:
        "A heuristic that measures how narrow/uniform the transaction mix is (HHI-like).",
      why:
        "Compressed mixes can appear during coordinated bursts, narrow-use periods, or certain protocol behaviors.",
    },
    {
      term: "Breadcrumb (Flow Fingerprint)",
      tags: ["forensics"],
      def:
        "A repeated, recognizable flow pattern across ledgers (e.g., A→B repeated).",
      why:
        "Helps focus investigation on persistent behavior rather than one-off noise.",
    },
    {
      term: "Fan-out",
      tags: ["forensics", "cybersecurity"],
      def:
        "One source sends to many destinations in a short time window.",
      why:
        "Can be legitimate distribution or drain-style dispersion—context matters.",
    },
    {
      term: "Fan-in",
      tags: ["forensics", "cybersecurity"],
      def:
        "Many sources send into one destination in a short time window.",
      why:
        "Can reflect exchange deposits or consolidation; persistence + amounts help interpret.",
    },
    {
      term: "Hub Model",
      tags: ["forensics", "graph"],
      def:
        "A graph pattern where a node acts as a central connector linking many others (high degree).",
      why:
        "Often a service wallet—can also be a coordination point in layered movement.",
    },
    {
      term: "Cluster",
      tags: ["forensics", "graph"],
      def:
        "A set of wallets inferred to be connected through observed flows (connectivity only, no identity).",
      why:
        "Clusters help identify stable structures or persistent campaigns for deeper review.",
    },
    {
      term: "Cluster Persistence",
      tags: ["forensics", "graph"],
      def:
        "A score estimating how consistently a cluster appears across the selected window.",
      why:
        "Persistent clusters are more likely to represent stable structures than random adjacency.",
    },
    {
      term: "Ping-pong",
      tags: ["forensics"],
      def:
        "Back-and-forth transfers between two wallets (A⇄B) across multiple ledgers.",
      why:
        "May be market-making, testing, or wash-like loops—needs additional context.",
    },
    {
      term: "Continuity Gap",
      tags: ["network", "quality"],
      def:
        "Missing ledger ranges inside local capture (e.g., you saw #100 then #103).",
      why:
        "Commonly caused by reconnects, server load limits, or catch-up logic that skips ahead.",
    },
    {
      term: "Account Inspector",
      tags: ["inspector"],
      def:
        "A tool to explore an account’s ledger activity and relationships to build a tree/graph view.",
      why:
        "Use it to pivot from a breadcrumb or cluster into an account-centric investigation.",
    },
  ];

  const INVESTIGATION_WORKFLOW = [
    {
      title: "Start with the Ledger Stream",
      icon: "⚡",
      text:
        "Watch dominant activity, tx mix, and continuity. Look for bursts, flips, and repeated patterns across several ledgers.",
    },
    {
      title: "Click Breadcrumbs to Trace Ledgers",
      icon: "👣",
      text:
        "Use repeated fingerprints to highlight relevant ledgers in the stream. Persistence matters more than one-off spikes.",
    },
    {
      title: "Pivot into Account Inspector",
      icon: "🔎",
      text:
        "Inspect top senders/receivers from suspicious fingerprints. Expand outward carefully and compare neighbors.",
    },
    {
      title: "Validate with Context",
      icon: "🧭",
      text:
        "Check whether the pattern matches known service behavior (exchanges/issuers). Confirm amounts, regularity, and persistence.",
    },
    {
      title: "Use Replay for Before/After",
      icon: "⏮️",
      text:
        "Rewind to compare baseline behavior vs anomaly. Keep the same window size when comparing.",
    },
    {
      title: "Export Snapshots",
      icon: "📦",
      text:
        "Export JSON/CSV for reports. Document the window size, selected ledger, and what triggered the investigation.",
    },
  ];

  const LIMITS = [
    {
      title: "On-ledger only",
      icon: "🧾",
      text:
        "Signals come from observable XRPL activity. Off-ledger context (exchange internal movement, KYC, custody) is not visible here.",
    },
    {
      title: "False positives are normal",
      icon: "⚠️",
      text:
        "Many patterns have benign explanations (service wallets, batching, market making). Treat signals as prompts, not conclusions.",
    },
    {
      title: "Sampling + capture gaps",
      icon: "🛰️",
      text:
        "Reconnects, server load limits, and missing ledgers can distort local history. Continuity gaps can skew comparisons.",
    },
    {
      title: "Heuristics, not proof",
      icon: "🧪",
      text:
        "Confidence and persistence are explainable heuristics — not identity attribution or legal determinations.",
    },
    {
      title: "Window sensitivity",
      icon: "🔭",
      text:
        "Results can change with different window sizes (5 vs 20 vs 50). Use consistent windows for analysis and exports.",
    },
    {
      title: "Rate limits & node variability",
      icon: "🌐",
      text:
        "Different XRPL servers behave differently under load. Throttling and queue-based fetching reduce skipped ledgers.",
    },
  ];

  // ---------- Render ----------
  function renderAbout() {
    const el = document.getElementById("about");
    if (!el) return;

    el.innerHTML = `
      <div class="about-page">

        <section class="about-hero">
          <div class="about-hero-bg"></div>
          <div class="about-hero-inner">
            <div class="about-hero-kicker">NaluXrp 🌊 • XRPL Forensics • Explainable Signals</div>
            <div class="about-hero-title">About</div>
            <div class="about-hero-sub">
              A real-time XRPL analysis suite focused on <strong>explainable heuristics</strong>:
              dominance, flow fingerprints, graph clusters, and replayable forensic snapshots.
            </div>

            <div class="about-hero-actions">
              <button class="about-btn about-btn-primary" id="aboutJumpAlgorithms" type="button">🧠 Algorithms</button>
              <button class="about-btn" id="aboutJumpVisuals" type="button">🧩 Visual Patterns</button>
              <button class="about-btn" id="aboutJumpGlossary" type="button">📚 Glossary</button>
              <button class="about-btn" id="aboutJumpLimits" type="button">⚠️ Limits</button>
            </div>

            <div class="about-hero-badges">
              <span class="about-badge">Real ledger data</span>
              <span class="about-badge">Stream + replay</span>
              <span class="about-badge">Flow fingerprints</span>
              <span class="about-badge">Cluster inference</span>
              <span class="about-badge">Export snapshots</span>
            </div>
          </div>
        </section>

        <section class="about-section" id="aboutIntro">
          <div class="about-card about-card-wide">
            <div class="about-card-header">
              <div class="about-card-title">What this app is</div>
              <div class="about-chip">Futuristic • Explainable • Practical</div>
            </div>
            <div class="about-card-body">
              <p>
                <strong>NaluXrp</strong> is built to help you observe XRPL behavior in motion — not just raw data.
                It highlights <strong>patterns</strong> used in cybersecurity-style analysis:
                anomaly cues, persistence, fingerprinting, and graph structure.
              </p>
              <p class="about-muted">
                NaluXrp does <strong>not</strong> claim identity. It surfaces explainable signals and gives you tools
                to pivot into deeper inspection and documentation.
              </p>
              <div class="about-callouts">
                <div class="about-callout">
                  <div class="about-callout-title">🔐 Cybersecurity mindset</div>
                  <div class="about-callout-text">
                    Think of the ledger as a high-volume event stream.
                    We look for stable fingerprints, bursts, routing behaviors, and persistent clusters.
                  </div>
                </div>
                <div class="about-callout warn">
                  <div class="about-callout-title">⚠️ Interpretation warning</div>
                  <div class="about-callout-text">
                    Many “suspicious-looking” patterns are normal for exchanges, issuers, and market makers.
                    Use signals as starting points for investigation — not conclusions.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class="about-section" id="aboutAlgorithms">
          <div class="about-section-head">
            <div class="about-section-title">🧠 Algorithms & Signals</div>
            <div class="about-section-sub">How the dashboard “thinks” (in plain English)</div>
          </div>

          <div class="about-grid">
            ${ALGORITHMS.map(renderAlgorithmCard).join("")}
          </div>
        </section>

        <section class="about-section" id="aboutVisuals">
          <div class="about-section-head">
            <div class="about-section-title">🧩 Visual Patterns</div>
            <div class="about-section-sub">Fast mental models for fan-in/out, hubs, and clusters</div>
          </div>

          <div class="about-visual-grid">
            ${PATTERN_VISUALS.map(renderVisualCard).join("")}
          </div>
        </section>

        <section class="about-section" id="aboutBenign">
          <div class="about-section-head">
            <div class="about-section-title">✅ Common Benign Explanations</div>
            <div class="about-section-sub">Signals often have normal causes — check context</div>
          </div>

          <div class="about-benign-grid">
            ${renderBenignPanel()}
          </div>
        </section>

        <section class="about-section" id="aboutWorkflow">
          <div class="about-section-head">
            <div class="about-section-title">🧭 How to Investigate</div>
            <div class="about-section-sub">A practical workflow (investigation → validation → documentation)</div>
          </div>

          <div class="about-steps">
            ${INVESTIGATION_WORKFLOW.map(renderStep).join("")}
          </div>
        </section>

        <section class="about-section" id="aboutGlossary">
          <div class="about-section-head">
            <div class="about-section-title">📚 Glossary</div>
            <div class="about-section-sub">Terms you’ll see in NaluXrp</div>
          </div>

          <div class="about-card about-card-wide">
            <div class="about-glossary-toolbar">
              <input id="aboutGlossarySearch" class="about-input" type="text"
                placeholder="Search terms (fan-out, hub, dominance, cluster, continuity gap)..." />
              <button class="about-btn" id="aboutGlossaryClear" type="button">Clear</button>
              <button class="about-btn" id="aboutExpandAll" type="button">Expand all</button>
              <button class="about-btn" id="aboutCollapseAll" type="button">Collapse all</button>
            </div>

            <div id="aboutGlossaryList" class="about-accordion">
              ${GLOSSARY.map(renderGlossaryItem).join("")}
            </div>

            <div class="about-footnote">
              Want this even clearer? We can add mini interactive tooltips on the live dashboard (hover on “Fan-out”
              to show the diagram + benign vs risk notes).
            </div>
          </div>
        </section>

        <section class="about-section" id="aboutLimits">
          <div class="about-section-head">
            <div class="about-section-title">⚠️ Signal Limits & Data Quality</div>
            <div class="about-section-sub">Why results can change + how to interpret safely</div>
          </div>

          <div class="about-limit-grid">
            ${LIMITS.map(renderLimit).join("")}
          </div>
        </section>

        <div class="about-footer">
          <div class="about-footer-inner">
            <div class="about-footer-line">NaluXrp • ${ABOUT_VERSION}</div>
            <div class="about-footer-line about-muted">
              Built for explainability: patterns are signals, not accusations.
            </div>
          </div>
        </div>
      </div>
    `;

    bindAboutInteractions();
  }

  // ---------- Cards ----------
  function renderAlgorithmCard(a) {
    const details = (a.details || []).map((x) => `<li>${escapeHtml(x)}</li>`).join("");
    const outputs = (a.outputs || []).map((x) => `<span class="about-pill">${escapeHtml(x)}</span>`).join("");
    const benign = (a.benign || []).map((x) => `<li>${escapeHtml(x)}</li>`).join("");
    const inv = (a.investigate || []).map((x) => `<li>${escapeHtml(x)}</li>`).join("");

    return `
      <article class="about-card" data-kind="algo" data-id="${escapeHtml(a.id)}">
        <div class="about-card-header">
          <div class="about-card-title">${escapeHtml(a.icon)} ${escapeHtml(a.title)}</div>
          <button class="about-mini-btn" type="button" aria-expanded="false" data-toggle="algo" data-id="${escapeHtml(a.id)}">
            Details
          </button>
        </div>

        <div class="about-card-body">
          <div class="about-text">${escapeHtml(a.short)}</div>

          <div class="about-pill-row">${outputs}</div>

          <div class="about-collapse" id="algoBody-${escapeHtml(a.id)}" hidden>
            <div class="about-split">
              <div class="about-panel">
                <div class="about-panel-title">How it works</div>
                <ul class="about-ul">${details}</ul>
              </div>
              <div class="about-panel">
                <div class="about-panel-title">Common benign causes</div>
                <ul class="about-ul">${benign}</ul>
              </div>
            </div>

            <div class="about-panel" style="margin-top: 10px;">
              <div class="about-panel-title">How to investigate</div>
              <ul class="about-ul">${inv}</ul>
            </div>
          </div>
        </div>
      </article>
    `;
  }

  function renderVisualCard(v) {
    const benign = (v.benign || []).map((x) => `<li>${escapeHtml(x)}</li>`).join("");
    const risk = (v.risk || []).map((x) => `<li>${escapeHtml(x)}</li>`).join("");

    return `
      <article class="about-card about-visual-card" data-kind="visual" data-id="${escapeHtml(v.id)}">
        <div class="about-visual-top">
          <div class="about-visual-title">${escapeHtml(v.title)}</div>
          <div class="about-visual-sub">${escapeHtml(v.subtitle)}</div>
        </div>

        <div class="about-visual-canvas" aria-hidden="true">
          ${v.svg}
          <div class="about-visual-glow"></div>
        </div>

        <div class="about-card-body">
          <div class="about-text">${escapeHtml(v.desc)}</div>

          <div class="about-split" style="margin-top:10px;">
            <div class="about-panel">
              <div class="about-panel-title">Benign</div>
              <ul class="about-ul">${benign}</ul>
            </div>
            <div class="about-panel">
              <div class="about-panel-title">Risk cues</div>
              <ul class="about-ul">${risk}</ul>
            </div>
          </div>
        </div>
      </article>
    `;
  }

  function renderBenignPanel() {
    const items = [
      {
        title: "Exchanges / Service wallets",
        icon: "🏦",
        text:
          "High fan-in/out, hubs, and dense clusters are normal around exchanges. Look for consistent patterns, known behavior, and strong persistence.",
        bullets: ["Hot wallet hubs", "Batch deposits/withdrawals", "Consolidation of dust"],
      },
      {
        title: "Issuers / Trustline operations",
        icon: "🏷️",
        text:
          "TrustSet bursts, issuer-centric hubs, and distribution fan-outs can be legitimate token operations.",
        bullets: ["Trustline churn", "Treasury distribution", "Market maker interactions"],
      },
      {
        title: "DEX / AMM activity",
        icon: "💧",
        text:
          "OfferCreate/Cancel surges and loop-like patterns can be market-making, arbitrage, or liquidity operations.",
        bullets: ["Offer spikes", "Rapid cancels", "Routing via pools"],
      },
      {
        title: "Automation & testing",
        icon: "🤖",
        text:
          "Uniform amounts, strict periodicity, and repeated pairs can be scripts. Especially common on testnet.",
        bullets: ["Uniform sizes", "Regular intervals", "Same counterparties"],
      },
    ];

    return items
      .map((x) => {
        const bullets = (x.bullets || []).map((b) => `<li>${escapeHtml(b)}</li>`).join("");
        return `
          <div class="about-card about-benign-card">
            <div class="about-card-header">
              <div class="about-card-title">${escapeHtml(x.icon)} ${escapeHtml(x.title)}</div>
            </div>
            <div class="about-card-body">
              <div class="about-text">${escapeHtml(x.text)}</div>
              <ul class="about-ul">${bullets}</ul>
            </div>
          </div>
        `;
      })
      .join("");
  }

  function renderStep(s) {
    return `
      <div class="about-step">
        <div class="about-step-icon">${escapeHtml(s.icon)}</div>
        <div class="about-step-title">${escapeHtml(s.title)}</div>
        <div class="about-step-text">${escapeHtml(s.text)}</div>
      </div>
    `;
  }

  function renderLimit(l) {
    return `
      <div class="about-card about-limit-card">
        <div class="about-card-header">
          <div class="about-card-title">${escapeHtml(l.icon)} ${escapeHtml(l.title)}</div>
        </div>
        <div class="about-card-body">
          <div class="about-text">${escapeHtml(l.text)}</div>
        </div>
      </div>
    `;
  }

  function renderGlossaryItem(item, idx) {
    const id = `gloss-${idx}`;
    const tags = (item.tags || []).map((t) => `<span class="about-tag">${escapeHtml(t)}</span>`).join("");

    return `
      <div class="about-acc-item" data-term="${escapeHtml(item.term.toLowerCase())}">
        <button class="about-acc-btn" type="button" aria-expanded="false" aria-controls="${id}">
          <span class="about-acc-title">${escapeHtml(item.term)}</span>
          <span class="about-acc-tags">${tags}</span>
          <span class="about-acc-icon">▾</span>
        </button>

        <div class="about-acc-panel" id="${id}" hidden>
          <div class="about-acc-def"><strong>Definition:</strong> ${escapeHtml(item.def)}</div>
          <div class="about-acc-why"><strong>Why it matters:</strong> ${escapeHtml(item.why)}</div>
        </div>
      </div>
    `;
  }

  // ---------- Interactions ----------
  function bindAboutInteractions() {
    // jump buttons
    bindOnce("aboutJumpAlgorithms", () => smoothScrollTo("aboutAlgorithms"));
    bindOnce("aboutJumpVisuals", () => smoothScrollTo("aboutVisuals"));
    bindOnce("aboutJumpGlossary", () => smoothScrollTo("aboutGlossary"));
    bindOnce("aboutJumpLimits", () => smoothScrollTo("aboutLimits"));

    // algo detail toggles
    document.querySelectorAll('[data-toggle="algo"]').forEach((btn) => {
      if (btn.__bound) return;
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        const panel = document.getElementById(`algoBody-${id}`);
        if (!panel) return;
        const expanded = btn.getAttribute("aria-expanded") === "true";
        btn.setAttribute("aria-expanded", expanded ? "false" : "true");
        panel.hidden = expanded;
        btn.textContent = expanded ? "Details" : "Hide";
      });
      btn.__bound = true;
    });

    // glossary accordion
    document.querySelectorAll(".about-acc-btn").forEach((btn) => {
      if (btn.__bound) return;
      btn.addEventListener("click", () => toggleAccordion(btn));
      btn.__bound = true;
    });

    const search = document.getElementById("aboutGlossarySearch");
    const clear = document.getElementById("aboutGlossaryClear");
    const expandAll = document.getElementById("aboutExpandAll");
    const collapseAll = document.getElementById("aboutCollapseAll");

    if (search && !search.__bound) {
      search.addEventListener("input", () => filterGlossary(search.value));
      search.__bound = true;
    }
    if (clear && !clear.__bound) {
      clear.addEventListener("click", () => {
        if (search) search.value = "";
        filterGlossary("");
      });
      clear.__bound = true;
    }
    if (expandAll && !expandAll.__bound) {
      expandAll.addEventListener("click", () => setAllAccordion(true));
      expandAll.__bound = true;
    }
    if (collapseAll && !collapseAll.__bound) {
      collapseAll.addEventListener("click", () => setAllAccordion(false));
      collapseAll.__bound = true;
    }
  }

  function smoothScrollTo(id) {
    const target = document.getElementById(id);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function bindOnce(id, handler) {
    const el = document.getElementById(id);
    if (!el || el.__bound) return;
    el.addEventListener("click", handler);
    el.__bound = true;
  }

  function toggleAccordion(btn) {
    const item = btn.closest(".about-acc-item");
    if (!item) return;
    const panel = item.querySelector(".about-acc-panel");
    if (!panel) return;

    const expanded = btn.getAttribute("aria-expanded") === "true";
    btn.setAttribute("aria-expanded", expanded ? "false" : "true");
    panel.hidden = expanded;
    item.classList.toggle("open", !expanded);
  }

  function setAllAccordion(open) {
    document.querySelectorAll(".about-acc-item").forEach((item) => {
      if (item.style.display === "none") return;
      const btn = item.querySelector(".about-acc-btn");
      const panel = item.querySelector(".about-acc-panel");
      if (!btn || !panel) return;
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      panel.hidden = !open;
      item.classList.toggle("open", open);
    });
  }

  function filterGlossary(query) {
    const q = String(query || "").trim().toLowerCase();
    const items = document.querySelectorAll(".about-acc-item");
    items.forEach((it) => {
      const term = it.getAttribute("data-term") || "";
      const text = (it.textContent || "").toLowerCase();
      const match = !q || term.includes(q) || text.includes(q);
      it.style.display = match ? "" : "none";
    });
  }

  // ---------- SVG visuals (inline) ----------
  function svgFanOut() {
    // one center node -> many nodes
    return `
      <svg class="about-svg" viewBox="0 0 360 160" role="img" aria-label="Fan-out diagram">
        <defs>
          <linearGradient id="g1" x1="0" x2="1">
            <stop offset="0%" stop-color="var(--about-neon-1)"/>
            <stop offset="100%" stop-color="var(--about-neon-2)"/>
          </linearGradient>
        </defs>
        <g class="about-svg-grid">
          <path d="M10 30 H350" />
          <path d="M10 80 H350" />
          <path d="M10 130 H350" />
        </g>
        <circle class="about-node core" cx="70" cy="80" r="12"/>
        ${[20, 50, 80, 110, 140].map((y, i) => `
          <circle class="about-node leaf" cx="290" cy="${y}" r="9"/>
          <path class="about-edge" d="M82 80 C 150 ${80 + (y-80)*0.2}, 210 ${y}, 280 ${y}" />
        `).join("")}
      </svg>
    `;
  }

  function svgFanIn() {
    // many -> one
    return `
      <svg class="about-svg" viewBox="0 0 360 160" role="img" aria-label="Fan-in diagram">
        <defs>
          <linearGradient id="g2" x1="0" x2="1">
            <stop offset="0%" stop-color="var(--about-neon-2)"/>
            <stop offset="100%" stop-color="var(--about-neon-3)"/>
          </linearGradient>
        </defs>
        <g class="about-svg-grid">
          <path d="M10 30 H350" />
          <path d="M10 80 H350" />
          <path d="M10 130 H350" />
        </g>
        ${[20, 50, 80, 110, 140].map((y) => `
          <circle class="about-node leaf" cx="70" cy="${y}" r="9"/>
          <path class="about-edge" d="M80 ${y} C 150 ${y}, 210 ${80 + (y-80)*0.2}, 278 80" />
        `).join("")}
        <circle class="about-node core" cx="290" cy="80" r="12"/>
      </svg>
    `;
  }

  function svgHub() {
    // hub in center connecting many
    const points = [
      [70, 30], [70, 130], [130, 20], [130, 140],
      [300, 30], [300, 130], [240, 20], [240, 140],
    ];
    return `
      <svg class="about-svg" viewBox="0 0 360 160" role="img" aria-label="Hub model diagram">
        <defs>
          <linearGradient id="g3" x1="0" x2="1">
            <stop offset="0%" stop-color="var(--about-neon-1)"/>
            <stop offset="100%" stop-color="var(--about-neon-3)"/>
          </linearGradient>
        </defs>
        <g class="about-svg-grid">
          <path d="M10 30 H350" />
          <path d="M10 80 H350" />
          <path d="M10 130 H350" />
        </g>
        <circle class="about-node core" cx="180" cy="80" r="14"/>
        ${points.map(([x,y]) => `
          <circle class="about-node leaf" cx="${x}" cy="${y}" r="9"/>
          <path class="about-edge" d="M180 80 C ${(x+180)/2} ${80}, ${(x+180)/2} ${y}, ${x} ${y}" />
        `).join("")}
      </svg>
    `;
  }

  function svgCluster() {
    // cluster with internal edges and a couple outside
    const nodes = [
      { x: 110, y: 60, r: 10, c: "leaf" },
      { x: 150, y: 40, r: 9, c: "leaf" },
      { x: 180, y: 70, r: 10, c: "core" },
      { x: 150, y: 100, r: 9, c: "leaf" },
      { x: 110, y: 120, r: 9, c: "leaf" },
      { x: 230, y: 45, r: 9, c: "leaf" },
      { x: 240, y: 100, r: 9, c: "leaf" },
      // outsiders
      { x: 300, y: 30, r: 9, c: "ghost" },
      { x: 305, y: 130, r: 9, c: "ghost" },
    ];
    const edges = [
      [0,2],[1,2],[2,3],[3,4],[2,5],[2,6],[5,6],[0,1],[0,3],
      [6,7],[4,8] // weak external touches
    ];

    return `
      <svg class="about-svg" viewBox="0 0 360 160" role="img" aria-label="Cluster diagram">
        <defs>
          <linearGradient id="g4" x1="0" x2="1">
            <stop offset="0%" stop-color="var(--about-neon-2)"/>
            <stop offset="100%" stop-color="var(--about-neon-4)"/>
          </linearGradient>
        </defs>
        <g class="about-svg-grid">
          <path d="M10 30 H350" />
          <path d="M10 80 H350" />
          <path d="M10 130 H350" />
        </g>

        ${edges.map(([a,b]) => {
          const A = nodes[a], B = nodes[b];
          const cls = (nodes[a].c === "ghost" || nodes[b].c === "ghost") ? "about-edge weak" : "about-edge";
          return `<path class="${cls}" d="M${A.x} ${A.y} C ${(A.x+B.x)/2} ${A.y}, ${(A.x+B.x)/2} ${B.y}, ${B.x} ${B.y}" />`;
        }).join("")}

        ${nodes.map(n => `<circle class="about-node ${n.c}" cx="${n.x}" cy="${n.y}" r="${n.r}"/>`).join("")}
      </svg>
    `;
  }

  // ---------- Utils ----------
  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // ---------- Init ----------
  function initAbout() {
    renderAbout();
  }

  // expose for manual calls if your UI triggers it
  window.renderAbout = renderAbout;
  window.initAbout = initAbout;

  document.addEventListener("DOMContentLoaded", () => {
    // Render immediately so page is ready even before user navigates
    initAbout();
    console.log("ℹ️ About module loaded:", ABOUT_VERSION);
  });
})();
