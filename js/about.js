/* =========================================================
   about.js — NaluXrp 🌊 About Page (Futuristic + Educational)
   CLEAN UPDATE:
   ✅ No floating/sticky tab bar (tabs do not block content)
   ✅ Resources section redesigned (NO search/filter UI)
   ✅ Added "Case Studies" teaching panel (guided workflows)
   ✅ Glossary kept (expand/collapse; no search)
   ========================================================= */

(function () {
  const VERSION = "about@5.0.0-case-studies-resources-clean";

  // ---------------------------
  // Glossary (educational)
  // ---------------------------
  const GLOSSARY = [
    {
      term: "Ledger",
      tags: ["basics", "xrpl"],
      definition:
        "A ledger is a finalized batch of XRPL activity. Every few seconds, the network closes a ledger that contains validated transactions and updates to account state."
    },
    {
      term: "Ledger Stream",
      tags: ["dashboard", "live"],
      definition:
        "A continuously updating view of recently closed ledgers. Each card summarizes one ledger: totals, fees, success rate, and the transaction mix."
    },
    {
      term: "Transaction Mix",
      tags: ["analytics"],
      definition:
        "The breakdown of transaction types in a ledger (Payments, Offers, NFTs, TrustSet, Other). The mix helps explain what the network is doing at scale."
    },
    {
      term: "Dominant Type",
      tags: ["metrics", "dashboard"],
      definition:
        "The transaction category with the highest count in a ledger. Dominance is a fast situational signal; it becomes meaningful when compared across multiple ledgers."
    },
    {
      term: "Dominance Strength",
      tags: ["metrics", "dashboard"],
      definition:
        "How strongly one type dominates the mix (e.g., Offers at 75% = high dominance). It is an explainable heuristic — not a verdict."
    },
    {
      term: "Continuity Gap",
      tags: ["network", "quality"],
      definition:
        "A missing ledger in local capture history (reconnects, throttling, fetch failures). Gaps can distort short-window analytics or make a stream look inconsistent."
    },
    {
      term: "Flow",
      tags: ["forensics"],
      definition:
        "A simplified view of movement patterns inferred from Payment activity: sender → receiver edges. Used for fingerprinting and cluster inference."
    },
    {
      term: "Breadcrumb / Flow Fingerprint",
      tags: ["forensics", "cybersecurity"],
      definition:
        "A repeated flow structure across multiple ledgers (often repeated sender→receiver relationships). Persistence across ledgers strengthens the signal."
    },
    {
      term: "Fan-out",
      tags: ["patterns", "forensics"],
      definition:
        "One sender distributes to many receivers in a short window. Benign examples include payouts/airdrops/withdrawals; risk cues include drain dispersion and smurfing."
    },
    {
      term: "Fan-in",
      tags: ["patterns", "forensics"],
      definition:
        "Many senders converge into one receiver. Often benign (exchange deposits/merchant aggregation) but can appear in coordinated funneling."
    },
    {
      term: "Hub Model",
      tags: ["graph", "forensics"],
      definition:
        "A central connector routes between many wallets. Hubs are normal for services; risk comes from abrupt routing changes, unusual counterparties, or short-lived layering paths."
    },
    {
      term: "Cluster",
      tags: ["graph", "forensics"],
      definition:
        "A group of wallets connected by observed interactions in a window. Clusters describe structure — not identity."
    },
    {
      term: "Cluster Persistence",
      tags: ["graph", "metrics"],
      definition:
        "How consistently a cluster appears across the selected window. Persistent clusters often indicate stable services; volatile clusters can indicate temporary campaigns."
    },
    {
      term: "Replay Window",
      tags: ["workflow"],
      definition:
        "A slice of captured history you can rewind through. Replay helps compare baseline vs anomaly using the same analysis lens."
    },
    {
      term: "Forensic Snapshot",
      tags: ["export", "workflow"],
      definition:
        "An exportable record of state: window size, selected ledger, fingerprints, clusters, and narratives — useful for documentation and team handoff."
    },
    {
      term: "Account Inspector",
      tags: ["inspector", "workflow"],
      definition:
        "A deeper per-account view used to validate signals: balance/state, objects, trustlines, and relationships. It’s where you pivot from signal to investigation."
    },
    {
      term: "Chain of custody",
      tags: ["evidence", "workflow"],
      definition:
        "Procedures and records that preserve how exports were collected, who handled them, and when — important for reproducibility and legal admissibility."
    }
  ];

  // ---------------------------
  // Case Studies (guided learning)
  // ---------------------------
  const CASE_STUDIES = [
    {
      id: "dominance-flip",
      icon: "⚡",
      title: "Dominance Flip (Payments → Offers)",
      subtitle: "When the network ‘mode’ changes quickly",
      whatYouSee: [
        "Ledger cards show a sudden shift in dominant type (e.g., Payment dominance collapses; Offer dominance surges).",
        "Total TX might stay similar, but the *mix* changes dramatically.",
        "Avg fee can rise slightly during heavy DEX activity (not always)."
      ],
      whatItOftenMeans: [
        "Market-making bursts, arbitrage windows, or liquidity events.",
        "Major issuer activity (TrustSet bursts often precede new token activity).",
        "Sometimes a node/capture artifact if continuity gaps exist."
      ],
      validateLikeAnAnalyst: [
        "Compare 5–10 ledgers before/after the flip using the same window size.",
        "Check continuity (missing ledgers can fake a ‘sudden’ change).",
        "Pivot into Explorer/Analytics to confirm OfferCreate/OfferCancel patterns.",
        "If a specific issuer is involved, check TrustSet/issuer hubs."
      ],
      exportNotes: [
        "Export a snapshot with the window size, the ‘flip’ ledger index, and the top deltas.",
        "Write a short narrative: ‘Offers surged from X% → Y% across N ledgers; persistence observed/not observed.’"
      ]
    },
    {
      id: "fan-out",
      icon: "🧪",
      title: "Fan-out (One → Many)",
      subtitle: "Payouts vs dispersion",
      whatYouSee: [
        "One sender appears repeatedly; many receivers change quickly.",
        "Similar amounts or timing suggests automation.",
        "Often shows up as repeated breadcrumbs across multiple ledgers."
      ],
      whatItOftenMeans: [
        "Benign: airdrops, payroll, exchange withdrawals, treasury distribution.",
        "Risk cues: drain-style dispersion, smurfing, rapid multi-hop exits."
      ],
      validateLikeAnAnalyst: [
        "Check whether the sender is a known service wallet (explorer labeling helps).",
        "Look for persistence across several ledgers (one-off fan-out is common).",
        "In Inspector: examine account objects, trustlines, and whether destinations are brand-new accounts.",
        "Check if recipients immediately forward funds (fan-out followed by fan-in is a common pattern)."
      ],
      exportNotes: [
        "Export list of top sender + destination count + time window.",
        "Capture 2–3 ledgers around the event (before/during/after) to show behavior change."
      ]
    },
    {
      id: "cluster-persistence",
      icon: "🕸️",
      title: "Persistent Cluster (Graph Structure)",
      subtitle: "Stable service vs coordinated campaign",
      whatYouSee: [
        "Same set of wallets repeatedly interact (core members remain constant).",
        "Cluster persistence is high across the window.",
        "A hub may appear that routes flow."
      ],
      whatItOftenMeans: [
        "Benign: service infrastructure (exchange hot wallets, routers/bridges, market maker clusters).",
        "Risk cues: a long-lived coordination ring, repeated routing through ‘thin’ hubs, abrupt counterparty changes."
      ],
      validateLikeAnAnalyst: [
        "Identify the core: wallets that show up in most ledgers (persistence).",
        "Inspect hub behavior: does it route predictably or abruptly change routes?",
        "Check if behavior is consistent across different times of day / different windows.",
        "Confirm whether the cluster interacts with known service endpoints."
      ],
      exportNotes: [
        "Export the cluster membership + persistence metrics.",
        "Document which window size was used (5 vs 20 vs 50 changes the picture)."
      ]
    }
  ];

  // ---------------------------
  // Resources (NO search UI)
  // Replaced broken entries with stable, widely-used sources
  // ---------------------------
  const RESOURCES = [
    {
      group: "XRPL fundamentals",
      items: [
        {
          icon: "📘",
          title: "XRPL Documentation (xrpl.org)",
          desc: "Core concepts, transaction types, APIs, and best practices for interacting with the XRP Ledger.",
          url: "https://xrpl.org/"
        },
        {
          icon: "🧾",
          title: "XRPL Transaction Types",
          desc: "Reference for Payment, OfferCreate/Cancel, TrustSet, NFTokenMint, and more — useful for interpreting your mix & dominance.",
          url: "https://xrpl.org/transaction-types.html"
        },
        {
          icon: "🔌",
          title: "WebSocket / JSON-RPC API Methods",
          desc: "How requests like server_info, ledger, account_info, and tx are structured.",
          url: "https://xrpl.org/public-api-methods.html"
        }
      ]
    },
    {
      group: "Explorers & inspection",
      items: [
        {
          icon: "🔍",
          title: "XRPScan",
          desc: "Explorer with account views, transaction details, and rich XRPL metadata.",
          url: "https://xrpscan.com/"
        },
        {
          icon: "🛰️",
          title: "Bithomp",
          desc: "Explorer useful for account history, labels, and entity context when available.",
          url: "https://bithomp.com/"
        },
        {
          icon: "🌐",
          title: "XRPL Explorer (XRPLF)",
          desc: "XRPL Foundation explorer interface — useful for cross-checking ledgers and server behavior.",
          url: "https://livenet.xrpl.org/"
        }
      ]
    },
    {
      group: "Forensics & investigation workflow",
      items: [
        {
          icon: "🧭",
          title: "FATF: Red Flag Indicators (Virtual Assets)",
          desc: "Policy-level guidance on risk indicators and investigative thinking for virtual assets.",
          url: "https://www.fatf-gafi.org/en/publications/Methodsandtrends/virtual-assets-red-flag-indicators.html"
        },
        {
          icon: "🧠",
          title: "MITRE ATT&CK",
          desc: "Threat behavior taxonomy. Helpful mindset for pattern recognition, persistence, and adversary-style reasoning.",
          url: "https://attack.mitre.org/"
        },
        {
          icon: "📄",
          title: "NIST Incident Handling Guide (SP 800-61)",
          desc: "Solid structure for ‘detect → triage → analyze → document’ workflows (adapted here for on-ledger investigations).",
          url: "https://csrc.nist.gov/publications/detail/sp/800-61/rev-2/final"
        }
      ]
    },
    {
      group: "Graph analysis & visualization",
      items: [
        {
          icon: "🕸️",
          title: "Gephi",
          desc: "Open graph visualization tool. Useful for exploring clusters/hubs/fan-in/out from exported edges.",
          url: "https://gephi.org/"
        },
        {
          icon: "📈",
          title: "Graph concepts (Network science primer)",
          desc: "Basic graph vocabulary: nodes, edges, connected components, centrality — matches the cluster/hub language used in NaluXrp.",
          url: "https://en.wikipedia.org/wiki/Network_science"
        }
      ]
    }
  ];

  // ---------------------------
  // Utilities
  // ---------------------------
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

  // ---------------------------
  // Render About
  // ---------------------------
  function renderAbout() {
    const root = el("about");
    if (!root) return;

    root.innerHTML = `
      <div class="about-page">

        <div class="about-hero">
          <div class="about-hero-card">
            <div class="about-kicker">NaluXrp 🌊 • XRPL Forensics • Explainable Signals</div>
            <div class="about-title">About</div>
            <p class="about-subtitle">
              NaluXrp is a real-time XRPL analysis suite built for <strong>learning</strong> and <strong>investigation</strong>.
              It turns live ledger activity into explainable signals (dominance, fingerprints, clusters),
              plus workflows to pivot, validate, and document — <strong>without identity claims</strong>.
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
                    Treat the ledger as a high-volume event stream. We look for persistence, bursts, routing behavior,
                    and graph structure — similar to threat hunting and fraud analysis.
                  </div>
                </div>
              </div>

              <div class="about-callout warn">
                <div class="about-callout-icon">⚠️</div>
                <div>
                  <div class="about-callout-title">Interpretation warning</div>
                  <div class="about-callout-text">
                    Exchanges, issuers, and market makers create patterns that can look “suspicious”.
                    Use signals as starting points — validate with context and repetition.
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="about-hero-card">
            <div class="about-hero-card-title">Mission</div>
            <div class="about-hero-card-tag">Futuristic • Explainable • Practical</div>
            <p class="about-hero-card-text">
              NaluXrp helps you build intuition for XRPL behavior by translating raw ledgers into readable structure:
              what repeated, what changed, and what connected — plus tools to drill deeper and export responsibly.
            </p>
          </div>
        </div>

        <div class="about-tabs" role="tablist" aria-label="About tabs">
          <button class="about-tab is-active" data-tab="algorithms" role="tab" aria-selected="true">🧠 Algorithms</button>
          <button class="about-tab" data-tab="case-studies" role="tab" aria-selected="false">🧪 Case Studies</button>
          <button class="about-tab" data-tab="patterns" role="tab" aria-selected="false">🧩 Visual Patterns</button>
          <button class="about-tab" data-tab="glossary" role="tab" aria-selected="false">📚 Glossary</button>
          <button class="about-tab" data-tab="limits" role="tab" aria-selected="false">⚠️ Limits</button>
          <button class="about-tab" data-tab="resources" role="tab" aria-selected="false">🔗 Resources</button>
        </div>

        <!-- ================= Algorithms ================= -->
        <div class="about-section is-active" data-section="algorithms" role="tabpanel">
          <div class="about-section-head">
            <h2>How the dashboard “thinks”</h2>
            <p>
              NaluXrp behaves like a security console: summarize what just happened, highlight persistence,
              and give you safe pivots to validate.
            </p>
          </div>

          <div class="about-grid">
            ${card("⚡", "Transaction Mix & Dominance", "Each ledger card groups activity into Payment / Offers / NFT / TrustSet / Other and labels the dominant type. Dominance becomes meaningful when compared across several ledgers.",
              ["Use it for fast situational awareness.", "Compare several ledgers — one ledger can be noisy.", "Look for bursts or dominance flips (e.g., Payment → Offer)."]
            )}
            ${card("👣", "Flow Fingerprints (Breadcrumbs)", "Breadcrumbs detect repeated flow structures across several ledgers (often repeated sender→receiver). Persistence is stronger than one-off events.",
              ["Repeat counts elevate stable patterns above noise.", "Confidence is a heuristic (not proof).", "Use breadcrumbs to trace-highlight relevant ledgers."]
            )}
            ${card("🕸️", "Cluster Inference (Graph-Based)", "The app builds an interaction graph from observed flows and groups connected wallets into clusters. Clusters describe structure — not identity.",
              ["Cluster size: how many wallets connect.", "Persistence: how consistently it appears across the window.", "Stable clusters often represent services (benign)."]
            )}
          </div>

          <div class="about-divider"></div>

          <div class="about-section-head">
            <h3>How to investigate (practical workflow)</h3>
            <p>Use the same repeatable steps so your conclusions stay explainable and reproducible.</p>
          </div>

          <div class="about-steps">
            ${step("⚡", "Start with the Ledger Stream", "Watch dominant activity, tx mix, and continuity. Look for bursts, flips, and repeated patterns across several ledgers.")}
            ${step("👣", "Use Fingerprints to Focus", "Persistence matters more than one-off spikes. Repeated fingerprints tell you where to spend attention.")}
            ${step("🔎", "Pivot into Account Inspector", "Inspect top senders/receivers. Expand outward carefully and compare neighbors to avoid chasing noise.")}
            ${step("🧭", "Validate with Context", "Check if the pattern matches known service behavior (exchanges/issuers). Confirm amounts, regularity, and persistence.")}
            ${step("📦", "Export a Snapshot", "Export JSON/CSV and write down: window size, selected ledgers, and what triggered the investigation.")}
          </div>
        </div>

        <!-- ================= Case Studies ================= -->
        <div class="about-section" data-section="case-studies" role="tabpanel">
          <div class="about-section-head">
            <h2>Case studies</h2>
            <p>These are guided examples that teach you how to interpret patterns without guessing identity.</p>
          </div>

          <div class="about-case-switch" id="aboutCaseSwitch">
            ${CASE_STUDIES.map((c, i) => `
              <button class="about-case-btn ${i === 0 ? "is-active" : ""}" type="button" data-case="${escapeHtml(c.id)}">
                <span class="about-case-icon">${escapeHtml(c.icon)}</span>
                <span class="about-case-text">
                  <span class="about-case-title">${escapeHtml(c.title)}</span>
                  <span class="about-case-sub">${escapeHtml(c.subtitle)}</span>
                </span>
              </button>
            `).join("")}
          </div>

          <div id="aboutCasePanel"></div>
        </div>

        <!-- ================= Patterns ================= -->
        <div class="about-section" data-section="patterns" role="tabpanel">
          <div class="about-section-head">
            <h2>Visual patterns</h2>
            <p>Common flow shapes used in cybersecurity-style analysis. They can be benign or risky depending on context.</p>
          </div>

          <div class="about-pattern-grid">
            ${pattern("Fan-out", "One → many distribution", "Flow shape",
              "A single source sends to many destinations in a short window. Common for payouts/withdrawals — also used for drain dispersion.",
              ["Airdrops / payouts", "Exchange withdrawals", "Treasury distribution"],
              ["Drain-style dispersion", "Automation / scripting", "Smurfing patterns"]
            )}
            ${pattern("Fan-in", "Many → one aggregation", "Flow shape",
              "Many sources converge into one destination. Common for deposits/aggregation — can also be used for staging.",
              ["Exchange deposits", "Merchant aggregation", "Consolidation for fees"],
              ["Coordinated funneling", "Staging before movement", "Highly regular deposits"]
            )}
            ${pattern("Hub model", "Central connector node", "Graph shape",
              "A hub routes between many wallets. Hubs are normal for services. Risk comes from abrupt changes and unusual routing.",
              ["Service hot wallet", "Bridge/router", "Issuer distribution hub"],
              ["Sudden routing shifts", "Layering-like paths", "Unexpected hub emergence"]
            )}
            ${pattern("Clusters", "Connected component", "Graph shape",
              "A group of wallets linked by observed interactions. Persistence suggests stable structure; volatility suggests opportunistic flow.",
              ["Ecosystem structure", "Service network", "Market-making group"],
              ["Coordinated campaign", "Persistent laundering ring", "Short-lived burst clusters"]
            )}
          </div>
        </div>

        <!-- ================= Glossary ================= -->
        <div class="about-section" data-section="glossary" role="tabpanel">
          <div class="about-section-head">
            <h2>Glossary</h2>
            <p>Clear definitions for the words used throughout the dashboard and forensic signals.</p>
          </div>

          <div class="about-toolbar-actions" style="margin: 10px 0 12px;">
            <button class="about-btn" id="aboutExpandAll" type="button">Expand all</button>
            <button class="about-btn" id="aboutCollapseAll" type="button">Collapse all</button>
            <span class="about-toolbar-note" id="aboutGlossaryMeta" style="margin-left:auto">0 terms</span>
          </div>

          <div class="about-glossary-list" id="aboutGlossaryList"></div>
        </div>

        <!-- ================= Limits ================= -->
        <div class="about-section" data-section="limits" role="tabpanel">
          <div class="about-section-head">
            <h2>Signal limits & data quality</h2>
            <p>These constraints are normal in real-time capture. Knowing them prevents false confidence.</p>
          </div>

          <div class="about-limit-grid">
            ${simple("🧾", "On-ledger only", "Signals come from observable XRPL activity. Off-ledger context (exchange internal movement, custody, identity) is not visible here.")}
            ${simple("⚠️", "False positives are normal", "Service wallets can produce strong fan-in/out and hub patterns. Treat signals as prompts, not accusations.")}
            ${simple("🛰️", "Sampling + capture gaps", "Reconnects and node throttling can cause missing ledgers locally, which can distort short-window comparisons.")}
            ${simple("🧪", "Heuristics, not proof", "Confidence scores and persistence are explainable heuristics — not legal determinations or identity claims.")}
            ${simple("🔭", "Window sensitivity", "Results change with 5 vs 20 vs 50 ledgers. Compare using consistent windows, especially in replay.")}
            ${simple("🌐", "Node variability", "Different XRPL servers behave differently under load. Queueing/backoff helps but no capture is perfect.")}
          </div>

          <div class="about-footer">
            <div class="about-footer-left">NaluXrp • <span style="color: var(--accent-secondary);">${VERSION}</span></div>
            <div>Built for explainability: patterns are signals, not accusations.</div>
          </div>
        </div>

        <!-- ================= Resources (no search) ================= -->
        <div class="about-section" data-section="resources" role="tabpanel">
          <div class="about-section-head">
            <h2>Further reading & tools</h2>
            <p>
              Curated links that work reliably and match what NaluXrp is teaching:
              XRPL fundamentals, explorers, investigation workflow, and graph analysis.
            </p>
          </div>

          <div class="about-resources">
            ${RESOURCES.map(group => `
              <div class="about-resource-group">
                <div class="about-resource-group-title">${escapeHtml(group.group)}</div>
                <div class="about-resource-grid">
                  ${group.items.map(r => `
                    <div class="about-card about-resource-card">
                      <div class="about-card-top">
                        <div class="about-card-icon">${escapeHtml(r.icon)}</div>
                        <div class="about-card-title">${escapeHtml(r.title)}</div>
                        <div style="margin-left:auto">
                          <button class="about-btn about-resource-open" type="button" data-url="${escapeHtml(r.url)}">Open</button>
                        </div>
                      </div>
                      <div class="about-card-body">${escapeHtml(r.desc)}</div>
                    </div>
                  `).join("")}
                </div>
              </div>
            `).join("")}
          </div>

          <div class="about-hint">
            Tip: Use resources to <strong>validate</strong> what the dashboard signals — don’t treat heuristics as conclusions.
            When exporting, always include: node/provider, window size, ledger range, and what triggered the review.
          </div>
        </div>

      </div>
    `;

    bindTabs(root);
    renderGlossary();
    bindGlossaryControls(root);
    bindAccordions(root);
    bindCaseStudies(root);
    bindResources(root);

    console.log(`ℹ️ About loaded: ${VERSION}`);
  }

  // ---------------------------
  // UI: tabs
  // ---------------------------
  function bindTabs(root) {
    const tabs = root.querySelectorAll(".about-tab[data-tab]");
    const sections = root.querySelectorAll(".about-section[data-section]");
    if (!tabs.length || !sections.length) return;

    tabs.forEach((t) => {
      t.addEventListener("click", () => {
        const name = t.getAttribute("data-tab");
        tabs.forEach((x) => {
          const on = x.getAttribute("data-tab") === name;
          x.classList.toggle("is-active", on);
          x.setAttribute("aria-selected", on ? "true" : "false");
        });
        sections.forEach((s) => {
          const on = s.getAttribute("data-section") === name;
          s.classList.toggle("is-active", on);
        });
      });
    });
  }

  // ---------------------------
  // UI: accordions (Details toggles)
  // ---------------------------
  function bindAccordions(root) {
    root.querySelectorAll(".about-acc-toggle[data-acc]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.getAttribute("data-acc");
        const body = root.querySelector(`.about-acc-body[data-acc-body="${key}"]`);
        if (!body) return;

        const open = body.classList.toggle("is-open");
        btn.classList.toggle("is-open", open);
        btn.setAttribute("aria-expanded", open ? "true" : "false");

        const chev = btn.querySelector(".about-acc-chevron");
        if (chev) chev.textContent = open ? "▴" : "▾";
      });
    });
  }

  // ---------------------------
  // Case studies panel
  // ---------------------------
  function bindCaseStudies(root) {
    const panel = root.querySelector("#aboutCasePanel");
    const switcher = root.querySelector("#aboutCaseSwitch");
    if (!panel || !switcher) return;

    function renderCase(caseId) {
      const c = CASE_STUDIES.find(x => x.id === caseId) || CASE_STUDIES[0];

      panel.innerHTML = `
        <div class="about-case-panel">
          <div class="about-card">
            <div class="about-card-top">
              <div class="about-card-icon">${escapeHtml(c.icon)}</div>
              <div class="about-card-title">${escapeHtml(c.title)}</div>
              <div></div>
            </div>
            <div class="about-card-body" style="margin-top:6px;">
              <div style="font-weight:900; color: var(--text-primary); margin-bottom:6px;">What you see</div>
              <ul class="about-bullets">${c.whatYouSee.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul>

              <div style="font-weight:900; color: var(--text-primary); margin: 10px 0 6px;">What it often means</div>
              <ul class="about-bullets">${c.whatItOftenMeans.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul>

              <div style="font-weight:900; color: var(--text-primary); margin: 10px 0 6px;">Validate like an analyst</div>
              <ul class="about-bullets">${c.validateLikeAnAnalyst.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul>

              <div style="font-weight:900; color: var(--text-primary); margin: 10px 0 6px;">Export / reporting notes</div>
              <ul class="about-bullets">${c.exportNotes.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul>
            </div>
          </div>
        </div>
      `;
    }

    // default
    renderCase(CASE_STUDIES[0].id);

    switcher.querySelectorAll(".about-case-btn[data-case]").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-case");
        switcher.querySelectorAll(".about-case-btn").forEach(b => b.classList.toggle("is-active", b === btn));
        renderCase(id);
      });
    });
  }

  // ---------------------------
  // Resources (open buttons)
  // ---------------------------
  function bindResources(root) {
    root.querySelectorAll(".about-resource-open[data-url], .about-resource-open").forEach((btn) => {
      btn.addEventListener("click", () => {
        const url = btn.getAttribute("data-url");
        if (!url) return;
        window.open(url, "_blank", "noopener,noreferrer");
      });
    });
  }

  // ---------------------------
  // Glossary render + controls (no search)
  // ---------------------------
  function renderGlossary() {
    const list = el("aboutGlossaryList");
    const meta = el("aboutGlossaryMeta");
    if (!list) return;

    const items = GLOSSARY.slice();
    if (meta) meta.textContent = `${items.length} term${items.length === 1 ? "" : "s"}`;

    list.innerHTML = items.map((g) => {
      const tags = (g.tags || []).map(t => `<span class="about-tag">${escapeHtml(t)}</span>`).join("");
      return `
        <div class="about-glossary-item">
          <button class="about-glossary-head" type="button" aria-expanded="false">
            <div class="about-glossary-left">
              <div class="about-glossary-term">${escapeHtml(g.term)}</div>
              <div class="about-glossary-tags">${tags}</div>
            </div>
            <div class="about-glossary-right">
              <span class="about-glossary-chevron">▾</span>
            </div>
          </button>
          <div class="about-glossary-body">${escapeHtml(g.definition)}</div>
        </div>
      `;
    }).join("");

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

  function bindGlossaryControls(root) {
    const expand = root.querySelector("#aboutExpandAll");
    const collapse = root.querySelector("#aboutCollapseAll");

    if (expand) {
      expand.addEventListener("click", () => {
        root.querySelectorAll(".about-glossary-item").forEach((item) => {
          item.classList.add("is-open");
          const head = item.querySelector(".about-glossary-head");
          const body = item.querySelector(".about-glossary-body");
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
          const head = item.querySelector(".about-glossary-head");
          const body = item.querySelector(".about-glossary-body");
          const chev = item.querySelector(".about-glossary-chevron");
          if (body) body.classList.remove("is-open");
          if (head) head.setAttribute("aria-expanded", "false");
          if (chev) chev.textContent = "▾";
        });
      });
    }
  }

  // ---------------------------
  // Reusable HTML helpers
  // ---------------------------
  function card(icon, title, body, bullets) {
    const key = `acc_${Math.random().toString(16).slice(2)}_${Date.now()}`;
    return `
      <div class="about-card">
        <div class="about-card-top">
          <div class="about-card-icon">${escapeHtml(icon)}</div>
          <div class="about-card-title">${escapeHtml(title)}</div>
          <button class="about-acc-toggle" type="button" data-acc="${key}" aria-expanded="false">
            <span>Details</span><span class="about-acc-chevron">▾</span>
          </button>
        </div>
        <div class="about-card-body">${escapeHtml(body)}</div>
        <div class="about-acc-body" data-acc-body="${key}">
          <ul class="about-bullets">${(bullets || []).map(b => `<li>${escapeHtml(b)}</li>`).join("")}</ul>
        </div>
      </div>
    `;
  }

  function step(icon, title, body) {
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

  function pattern(title, sub, badge, description, good, warn) {
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
            <ul class="about-mini-list">${(good || []).map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul>
          </div>
          <div class="about-split-col warn">
            <div class="about-split-title">⚠️ Risk cues</div>
            <ul class="about-mini-list">${(warn || []).map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul>
          </div>
        </div>
      </div>
    `;
  }

  function simple(icon, title, body) {
    return `
      <div class="about-card">
        <div class="about-card-top">
          <div class="about-card-icon">${escapeHtml(icon)}</div>
          <div class="about-limit-title">${escapeHtml(title)}</div>
          <div></div>
        </div>
        <div class="about-card-body">${escapeHtml(body)}</div>
      </div>
    `;
  }

  // ---------------------------
  // Hooks: ensure About renders when page is shown
  // ---------------------------
  function installHooks() {
    window.initAbout = function () {
      renderAbout();
    };

    if (typeof window.switchPage === "function" && !window.__aboutSwitchWrapped) {
      const original = window.switchPage;
      window.switchPage = function (pageId, ...rest) {
        const res = original.apply(this, [pageId, ...rest]);
        if (pageId === "about") setTimeout(() => renderAbout(), 0);
        return res;
      };
      window.__aboutSwitchWrapped = true;
    }

    const aboutEl = el("about");
    if (aboutEl && !aboutEl.__aboutObserver) {
      const obs = new MutationObserver(() => {
        if (aboutEl.classList.contains("active")) renderAbout();
      });
      obs.observe(aboutEl, { attributes: true, attributeFilter: ["class"] });
      aboutEl.__aboutObserver = obs;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    installHooks();
    const aboutEl = el("about");
    if (aboutEl && aboutEl.classList.contains("active")) renderAbout();
  });
})();
