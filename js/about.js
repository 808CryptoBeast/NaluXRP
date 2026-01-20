/* =========================================================
   about.js — NaluXrp 🌊 About Page (Futuristic + Educational)
   UPDATED:
   ✅ Adds "Resources" tab with curated industry, government, XRPL, and learning links.
   ========================================================= */

(function () {
  const VERSION = "about@3.1.0-resources";

  const GLOSSARY = [
    { term: "Ledger", tags: ["basics", "xrpl"], definition: "A ledger is a finalized batch of XRPL activity. Every few seconds, the network closes a ledger that contains validated transactions and updates to account state." },
    { term: "Ledger Stream", tags: ["dashboard", "live"], definition: "A continuously updating view of recently closed ledgers. Each card summarizes one ledger: totals, fees, success rate, and the transaction mix." },
    { term: "Transaction Mix", tags: ["analytics"], definition: "The breakdown of transaction types in a ledger (Payments, Offers, NFTs, TrustSet, Other). Mix helps explain what the network is doing at scale." },
    { term: "Dominant Type", tags: ["metrics", "dashboard"], definition: "The transaction category with the highest count in a ledger. Dominance is a quick situation signal; it’s strongest when compared across several ledgers." },
    { term: "Dominance Strength", tags: ["metrics"], definition: "How strongly one type dominates the mix (e.g., Offers at 75% = high dominance). It is an explainable heuristic, not a verdict." },
    { term: "Continuity Gap", tags: ["network", "quality"], definition: "A missing ledger in local capture history (reconnects, node throttling, fetch failure). Gaps can distort short-window analytics." },
    { term: "Flow", tags: ["forensics"], definition: "A simplified view of movement patterns inferred from Payment activity: sender → receiver edges. Used for fingerprinting and clustering." },
    { term: "Breadcrumb / Flow Fingerprint", tags: ["forensics", "cybersecurity"], definition: "A repeated flow structure across multiple ledgers (often repeated sender→receiver relationships). Persistence across ledgers strengthens the signal." },
    { term: "Fan-out", tags: ["patterns"], definition: "One sender distributes to many receivers. Can be benign (airdrops/payouts/withdrawals) or risky (drain dispersion/smurfing). Context matters." },
    { term: "Fan-in", tags: ["patterns"], definition: "Many senders converge into one receiver. Often benign (exchange deposits/merchant aggregation), sometimes seen in coordinated funneling." },
    { term: "Hub Model", tags: ["graph"], definition: "A central connector routes between many wallets. Usually legitimate service infrastructure; the question is whether routing changes abruptly or uses obfuscation." },
    { term: "Cluster", tags: ["graph", "forensics"], definition: "A group of wallets connected by observed interactions in a window. Clusters describe structure, not identity." },
    { term: "Cluster Persistence", tags: ["graph", "metrics"], definition: "How consistently the cluster appears across the selected window. Persistent clusters often indicate stable services; volatile clusters can indicate temporary campaigns." },
    { term: "Replay Window", tags: ["workflow"], definition: "A slice of captured history you can rewind through. Replay helps compare baseline vs anomaly using the same analysis lens." },
    { term: "Forensic Snapshot", tags: ["export"], definition: "An exportable record of state: window size, selected ledger, fingerprints, clusters, and narratives — useful for documentation and team handoff." },
    { term: "Account Inspector", tags: ["inspector"], definition: "A deeper per-account view used to validate signals: balance/state, objects, trustlines, and relationships. It’s where you pivot from signal to investigation." },
    { term: "Blockchain analytics provider", tags: ["tools", "industry"], definition: "Companies offering tooling and datasets to analyse on-chain flows, link addresses, and assist compliance or investigations. Their methods vary; their outputs are inputs to human analysis." },
    { term: "Chain of custody", tags: ["evidence"], definition: "Procedures and records that preserve how data / exports were collected, who handled them, and when — important for reproducibility and legal admissibility." },
  ];

  function el(id) { return document.getElementById(id); }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

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
              It turns live ledger activity into explainable signals: dominance, flow fingerprints, clusters,
              replayable snapshots, and exportable reports — without identity claims.
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
                    Think of the ledger as an event stream. We look for persistence, bursts, routing behavior,
                    and graph structure — similar to fraud analysis and threat hunting.
                  </div>
                </div>
              </div>

              <div class="about-callout warn">
                <div class="about-callout-icon">⚠️</div>
                <div>
                  <div class="about-callout-title">Interpretation warning</div>
                  <div class="about-callout-text">
                    Exchanges, issuers, and market makers create patterns that can look “suspicious”.
                    Treat signals as starting points — validate with context and repetition.
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
              what repeated, what changed, and what connected — plus tools to pivot and document responsibly.
            </p>
          </div>
        </div>

        <!-- Tabs (NON-STICKY override so it won’t block content) -->
        <div class="about-tabs" role="tablist" aria-label="About tabs"
             style="position:relative; top:auto; margin-top: 10px;">
          <button class="about-tab is-active" data-tab="algorithms" role="tab" aria-selected="true">🧠 Algorithms</button>
          <button class="about-tab" data-tab="patterns" role="tab" aria-selected="false">🧩 Visual Patterns</button>
          <button class="about-tab" data-tab="glossary" role="tab" aria-selected="false">📚 Glossary</button>
          <button class="about-tab" data-tab="limits" role="tab" aria-selected="false">⚠️ Limits</button>
          <button class="about-tab" data-tab="resources" role="tab" aria-selected="false">🔗 Resources</button>
        </div>

        <div class="about-section is-active" data-section="algorithms" role="tabpanel">
          <div class="about-section-head">
            <h2>How the dashboard “thinks”</h2>
            <p>
              NaluXrp is designed like a security console: summarize what just happened, highlight persistence,
              and provide workflows to drill deeper. Here are the core signals in plain English.
            </p>
          </div>

          <div class="about-grid">
            ${card("⚡", "Dominance & Transaction Mix", "Each ledger card groups activity into Payment / Offers / NFT / TrustSet / Other and labels the dominant type. Dominance becomes meaningful when compared across several ledgers.",
              ["Use it for fast situational awareness.", "Compare several ledgers — one ledger can be noisy.", "Look for bursts or dominance flips (e.g., Payment → Offer)."]
            )}
            ${card("👣", "Flow Fingerprints (Breadcrumbs)", "Breadcrumbs detect repeated flow structures across several ledgers (often repeated sender→receiver). Persistence is stronger than one-off events.",
              ["Repeat count ranks stable patterns above noise.", "Confidence is a heuristic (not proof).", "Use breadcrumbs to trace-highlight relevant ledgers."]
            )}
            ${card("🕸️", "Cluster Inference (Graph-Based)", "The app builds an interaction graph from observed flows and groups connected wallets into clusters. Clusters describe structure — not identity.",
              ["Cluster size: how many wallets connect.", "Persistence: how consistently it appears across the window.", "Services often form stable clusters (benign)."]
            )}
          </div>

          <div class="about-divider"></div>

          <div class="about-section-head">
            <h3>Workflow: observe → pivot → validate → document</h3>
            <p>
              Start broad, then narrow. Use replay to compare baselines. Export snapshots so your conclusions remain reproducible.
            </p>
          </div>

          <div class="about-steps">
            ${step("⚡", "Start with the Ledger Stream", "Watch dominant activity, transaction mix, and continuity. Look for bursts across multiple ledgers.")}
            ${step("👣", "Use Breadcrumbs to prioritize", "Persistent fingerprints are more meaningful than single spikes. Click to trace-highlight involved ledgers.")}
            ${step("🔎", "Pivot to Account Inspector", "Inspect the top participants from a fingerprint. Validate whether it looks like a service hub or abnormal routing.")}
            ${step("⏮️", "Replay baseline vs anomaly", "Use consistent window sizes when comparing changes.")}
            ${step("📦", "Export snapshots for reports", "Export JSON/CSV including window size and triggers so analysis is repeatable.")}
          </div>
        </div>

        <div class="about-section" data-section="patterns" role="tabpanel">
          <div class="about-section-head">
            <h2>Visual patterns</h2>
            <p>These are common flow shapes used in cybersecurity-style analysis. They can be benign or risky depending on context.</p>
          </div>

          <div class="about-pattern-grid">
            ${pattern("Fan-out", "One → many distribution", "Flow shape",
              "A single source sends to many destinations in a short window. Common for payouts/withdrawals — also used for drain dispersion.",
              ["Airdrops / payouts", "Exchange withdrawals", "Treasury distribution"],
              ["Drain-style dispersion", "Automation / scripting", "Smurfing patterns"]
            )}
            ${pattern("Fan-in", "Many → one aggregation", "Flow shape",
              "Many sources converge into one destination. Common for deposits/aggregation — can be used for staging.",
              ["Exchange deposits", "Merchant aggregation", "Consolidation for fees"],
              ["Coordinated funneling", "Staging before movement", "Highly regular deposits"]
            )}
            ${pattern("Hub model", "Central connector node", "Graph shape",
              "A hub routes between many wallets. Hubs are normal for services. Risk comes from abrupt changes and unusual routing.",
              ["Service hot wallet", "Bridge/router", "Issuer distribution hub"],
              ["Sudden routing shifts", "Layering-like paths", "Unexpected hub emergence"]
            )}
            ${pattern("Ping-pong / loops", "Back-and-forth transfers", "Behavioral",
              "Two wallets repeatedly transfer both directions. Can be benign operations or used to generate noisy motion.",
              ["Testing", "Market-making dynamics", "Operational checks"],
              ["Uniform amounts + strict timing", "Long-lived loop", "Obfuscation attempts"]
            )}
          </div>
        </div>

        <div class="about-section" data-section="glossary" role="tabpanel">
          <div class="about-section-head">
            <h2>Glossary</h2>
            <p>Search terms like “fan-out”, “hub”, “dominance”, “cluster”, “continuity gap”… then expand items for definitions.</p>
          </div>

          <div class="about-glossary-toolbar">
            <div class="about-search">
              <span class="about-search-icon">🔎</span>
              <input id="aboutSearchInput" type="text" placeholder="Search: fan-out, hub, dominance, cluster..." />
            </div>

            <div class="about-toolbar-actions">
              <button class="about-btn" id="aboutExpandAll" type="button">Expand all</button>
              <button class="about-btn" id="aboutCollapseAll" type="button">Collapse all</button>
            </div>

            <div class="about-toolbar-note" id="aboutGlossaryMeta">0 terms</div>
          </div>

          <div class="about-glossary-list" id="aboutGlossaryList"></div>
        </div>

        <div class="about-section" data-section="limits" role="tabpanel">
          <div class="about-section-head">
            <h2>Signal limits & data quality</h2>
            <p>These constraints are normal in real-time capture. Knowing them prevents false confidence.</p>
          </div>

          <div class="about-limit-grid">
            ${simple("🧾", "On-ledger only", "Signals come from observable XRPL activity. Off-ledger context (exchange internal movement, custody, identity) is not visible here.")}
            ${simple("⚠️", "False positives are normal", "Service wallets create strong fan-in/out and hubs. Treat signals as prompts, not accusations.")}
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

        <div class="about-section" data-section="resources" role="tabpanel">
          <div class="about-section-head">
            <h2>Further reading & tools</h2>
            <p>Curated sources for analysts, researchers, policymakers, and learners. Use these to deepen technical knowledge, learn investigative workflows, and understand policy context.</p>
          </div>

          <div class="about-resources-grid">

            <div class="about-card">
              <div class="about-card-top">
                <div class="about-card-icon">🏢</div>
                <div class="about-card-title">Industry & vendor resources</div>
                <div></div>
              </div>
              <div class="about-card-body">
                Trusted vendors and their public research/blogs are useful for techniques and case studies:
                <ul>
                  <li><a href="https://blog.chainalysis.com/" target="_blank" rel="noopener noreferrer">Chainalysis — Research & Blog</a></li>
                  <li><a href="https://www.elliptic.co/resources" target="_blank" rel="noopener noreferrer">Elliptic — Research & Resources</a></li>
                  <li><a href="https://trmlabs.com/resources/" target="_blank" rel="noopener noreferrer">TRM Labs — Resources</a></li>
                  <li><a href="https://ciphertrace.com/" target="_blank" rel="noopener noreferrer">CipherTrace / industry tools</a></li>
                </ul>
              </div>
            </div>

            <div class="about-card">
              <div class="about-card-top">
                <div class="about-card-icon">🏛️</div>
                <div class="about-card-title">Government & policy</div>
                <div></div>
              </div>
              <div class="about-card-body">
                Policy and law-enforcement guidance frames how on-chain analysis is used in investigations and compliance:
                <ul>
                  <li><a href="https://www.fincen.gov/" target="_blank" rel="noopener noreferrer">FinCEN (U.S.) — Financial intelligence & guidance</a></li>
                  <li><a href="https://www.fatf-gafi.org/publications/" target="_blank" rel="noopener noreferrer">FATF — Standards & publications</a></li>
                  <li><a href="https://www.europol.europa.eu/" target="_blank" rel="noopener noreferrer">Europol — e-crime & policy work</a></li>
                  <li><a href="https://nationalcrimeagency.gov.uk/" target="_blank" rel="noopener noreferrer">UK National Crime Agency — cyber / financial crime</a></li>
                </ul>
                Note: governments often contract vendors or build internal tooling. Their reports help you understand operational use-cases and legal constraints.
              </div>
            </div>

            <div class="about-card">
              <div class="about-card-top">
                <div class="about-card-icon">🌊</div>
                <div class="about-card-title">XRPL-specific & developer docs</div>
                <div></div>
              </div>
              <div class="about-card-body">
                For protocol-level details, transaction types, and RPC usage:
                <ul>
                  <li><a href="https://xrpl.org/" target="_blank" rel="noopener noreferrer">XRPL.org — Official documentation</a></li>
                  <li>Use explorers and node docs to reproduce ledger data and validate captures.</li>
                </ul>
              </div>
            </div>

            <div class="about-card">
              <div class="about-card-top">
                <div class="about-card-icon">🎓</div>
                <div class="about-card-title">Learning & training</div>
                <div></div>
              </div>
              <div class="about-card-body">
                Recommended learning paths and hands-on exercises:
                <ul>
                  <li><a href="https://university.chainalysis.com/" target="_blank" rel="noopener noreferrer">Chainalysis University — courses & certification (vendor-run)</a></li>
                  <li>Vendor blogs often include step-by-step case studies; reproduce them locally with testnets and exported snapshots.</li>
                  <li>Look for university research & arXiv surveys on blockchain forensics to understand academic methods.</li>
                </ul>
              </div>
            </div>

            <div class="about-card">
              <div class="about-card-top">
                <div class="about-card-icon">🛠️</div>
                <div class="about-card-title">Practical tips & tools</div>
                <div></div>
              </div>
              <div class="about-card-body">
                Hands-on suggestions to get more from NaluXrp and improve reproducibility:
                <ul>
                  <li>Take reproducible snapshots: include window size, selected ledgers, and trigger criteria in exported JSON/CSV.</li>
                  <li>Practice with testnets before using live captures for sensitive analysis.</li>
                  <li>Combine on-chain signals with off-chain context (official exchange notices, published reports) before making claims.</li>
                  <li>Keep a documented chain of custody for exports if findings may enter compliance or legal workflows.</li>
                </ul>
              </div>
            </div>

            <div class="about-card">
              <div class="about-card-top">
                <div class="about-card-icon">🔎</div>
                <div class="about-card-title">How to use these sources</div>
                <div></div>
              </div>
              <div class="about-card-body">
                A short analyst guide:
                <ol>
                  <li>Start with vendor blog case studies to learn common indicators and techniques.</li>
                  <li>Reproduce examples with NaluXrp and XRPL test data to build muscle memory.</li>
                  <li>Read policy documents (FATF, FinCEN) to understand regulatory constraints.</li>
                  <li>Document findings with snapshots and narrative — signals are starting points, not identity claims.</li>
                </ol>
              </div>
            </div>

          </div>
        </div>

      </div>
    `;

    bindTabs(root);
    renderGlossary("");
    bindGlossary(root);
  }

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

  function bindTabs(root) {
    const tabs = root.querySelectorAll(".about-tab[data-tab]");
    const sections = root.querySelectorAll(".about-section[data-section]");
    if (!tabs.length || !sections.length) return;

    tabs.forEach((t) => {
      t.addEventListener("click", () => {
        const name = t.getAttribute("data-tab");
        tabs.forEach(x => {
          const on = x.getAttribute("data-tab") === name;
          x.classList.toggle("is-active", on);
          x.setAttribute("aria-selected", on ? "true" : "false");
        });
        sections.forEach(s => {
          const on = s.getAttribute("data-section") === name;
          s.classList.toggle("is-active", on);
        });
      });
    });

    // accordion toggles (cards)
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

    list.innerHTML = filtered.map((g) => {
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

  function bindGlossary(root) {
    const input = root.querySelector("#aboutSearchInput");
    const expand = root.querySelector("#aboutExpandAll");
    const collapse = root.querySelector("#aboutCollapseAll");

    if (input) input.addEventListener("input", () => renderGlossary(input.value));

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
