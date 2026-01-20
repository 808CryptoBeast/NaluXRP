/* =========================================================
   about.js — NaluXrp 🌊 About Page (Futuristic + Educational)
   UPDATED:
   ✅ Resources UI now loads docs/resources.json
   ✅ Filters (tags), search, and bookmarking (localStorage)
   ✅ "Try demo" demo snapshot loader (examples/demo_snapshot.json)
   ✅ Export reproducible metadata & "How to cite" helper
   ✅ Report-an-issue CTA (links to GitHub issue template)
   Version bumped for visibility.
   ========================================================= */

(function () {
  const VERSION = "about@4.0.0-resources-demos";

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

  // LocalStorage keys
  const LS_BOOKMARKS = "nalu_resources_bookmarks_v1";

  function el(id) { return document.getElementById(id); }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  /* ----------------------------
     Render / bind About
     ---------------------------- */
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

        <!-- Algorithms / Patterns / Glossary sections omitted for brevity in template -->
        <!-- Keep the original content for algorithms/patterns/glossary/limits as previous version -->
        <div class="about-section is-active" data-section="algorithms" role="tabpanel">
          <!-- ... existing algorithms content (omitted here to keep patch readable) ... -->
          <div class="about-section-head">
            <h2>How the dashboard “thinks”</h2>
            <p>NaluXrp is designed like a security console: summarize what just happened, highlight persistence, and provide workflows to drill deeper. Here are the core signals in plain English.</p>
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
        </div>

        <div class="about-section" data-section="patterns" role="tabpanel">
          <!-- patterns content (unchanged) -->
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

        <!-- Resources section (dynamically populated) -->
        <div class="about-section" data-section="resources" role="tabpanel">
          <div class="about-section-head">
            <h2>Further reading & tools</h2>
            <p>Curated sources for analysts, researchers, policymakers, and learners. Use these to deepen technical knowledge, learn investigative workflows, and understand policy context.</p>
          </div>

          <div class="about-resources-toolbar">
            <input id="resourceSearch" class="about-search-input" placeholder="Search resources (title, description, tags)..." />
            <select id="resourceTagFilter" class="about-select">
              <option value="">All types / tags</option>
            </select>
            <button id="clearResourceFilters" class="about-btn">Clear</button>
            <div style="margin-left:auto">
              <button id="tryDemo" class="about-btn">Try demo snapshot</button>
              <button id="exportMeta" class="about-btn">Download export template</button>
            </div>
          </div>

          <div id="aboutResourceList" class="about-resources-list"></div>

          <div class="about-divider"></div>

          <div class="about-resources-note">
            <p>
              Tips: bookmark resources you find useful (local only), reproduce vendor case studies in testnets, and include snapshot metadata when exporting results.
              To request a resource be added, use <a href="https://github.com/808CryptoBeast/NaluXRP/issues/new?template=resource_request.md" target="_blank" rel="noopener noreferrer">this issue template</a>.
            </p>
          </div>
        </div>

      </div>
    `;

    bindTabs(root);
    renderGlossary("");
    bindGlossary(root);
    initResources(root);
  }

  /* ----------------------------
     Resources: dynamic loader, filters, bookmarks
     ---------------------------- */
  async function fetchJSON(url) {
    try {
      const res = await fetch(url, {cache: "no-cache"});
      if (!res.ok) throw new Error(`fetch ${url} status ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn("fetchJSON error", err);
      return null;
    }
  }

  async function initResources(root) {
    const listEl = el("aboutResourceList");
    const tagSel = el("resourceTagFilter");
    const searchInp = el("resourceSearch");
    const tryDemoBtn = el("tryDemo");
    const exportMetaBtn = el("exportMeta");
    if (!listEl) return;

    // Fetch curated resource index (docs/resources.json)
    const resources = await fetchJSON("/docs/resources.json") || (await fetchJSON("docs/resources.json")) || [];
    // Build tag set
    const tagSet = new Set();
    resources.forEach(r => (r.tags || []).forEach(t => tagSet.add(t)));
    const tags = Array.from(tagSet).sort();
    tags.forEach(t => {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = `${t}`;
      tagSel.appendChild(opt);
    });

    // State
    let filterTag = "";
    let q = "";
    let bookmarks = loadBookmarks();

    function render() {
      const cleanedQ = String(q || "").trim().toLowerCase();
      const filtered = resources.filter(r => {
        if (filterTag && !(r.tags || []).includes(filterTag)) return false;
        if (!cleanedQ) return true;
        const hay = `${r.title} ${r.description} ${(r.tags || []).join(" ")}`.toLowerCase();
        return hay.includes(cleanedQ);
      });

      listEl.innerHTML = filtered.map(r => renderResourceCard(r, bookmarks.includes(r.id))).join("");
      // attach handlers
      listEl.querySelectorAll(".resource-bookmark-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          const id = btn.getAttribute("data-id");
          bookmarks = toggleBookmark(id, bookmarks);
          saveBookmarks(bookmarks);
          render(); // re-render to update state
        });
      });
      listEl.querySelectorAll(".resource-open-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          const url = btn.getAttribute("data-url");
          window.open(url, "_blank", "noopener,noreferrer");
        });
      });
    }

    tagSel.addEventListener("change", () => {
      filterTag = tagSel.value;
      render();
    });

    searchInp.addEventListener("input", () => {
      q = searchInp.value;
      render();
    });

    const clearBtn = el("clearResourceFilters");
    if (clearBtn) clearBtn.addEventListener("click", () => {
      filterTag = "";
      q = "";
      tagSel.value = "";
      searchInp.value = "";
      render();
    });

    if (tryDemoBtn) {
      tryDemoBtn.addEventListener("click", async () => {
        await tryDemoSnapshot();
      });
    }

    if (exportMetaBtn) {
      exportMetaBtn.addEventListener("click", () => {
        downloadExportTemplate();
      });
    }

    render();
  }

  function renderResourceCard(r, bookmarked) {
    const tags = (r.tags || []).map(t => `<span class="about-tag">${escapeHtml(t)}</span>`).join(" ");
    const bm = bookmarked ? "★ Bookmarked" : "☆ Bookmark";
    const source = r.type ? `<span class="about-resource-type">${escapeHtml(r.type)}</span>` : "";
    return `
      <div class="about-card about-resource-card">
        <div class="about-card-top">
          <div class="about-card-icon">${escapeHtml(r.icon || "🔗")}</div>
          <div class="about-card-title">${escapeHtml(r.title)} ${source}</div>
          <div style="margin-left:auto">
            <button class="about-btn resource-open-btn" data-url="${escapeHtml(r.url)}" type="button">Open</button>
            <button class="about-btn resource-bookmark-btn" data-id="${escapeHtml(r.id)}" type="button">${escapeHtml(bm)}</button>
          </div>
        </div>
        <div class="about-card-body">
          <div>${escapeHtml(r.description || "")}</div>
          <div style="margin-top:8px">${tags}</div>
        </div>
      </div>
    `;
  }

  function loadBookmarks() {
    try {
      const raw = localStorage.getItem(LS_BOOKMARKS);
      if (!raw) return [];
      return JSON.parse(raw);
    } catch (e) {
      return [];
    }
  }

  function saveBookmarks(list) {
    try {
      localStorage.setItem(LS_BOOKMARKS, JSON.stringify(list || []));
    } catch (e) {
      console.warn("saveBookmarks failed", e);
    }
  }

  function toggleBookmark(id, list) {
    const copy = Array.isArray(list) ? list.slice() : [];
    const i = copy.indexOf(id);
    if (i === -1) copy.push(id);
    else copy.splice(i, 1);
    return copy;
  }

  /* ----------------------------
     Demo loader & export metadata
     ---------------------------- */
  async function tryDemoSnapshot() {
    // Load synthetic snapshot and attempt to hand off to app
    const paths = ["/examples/demo_snapshot.json", "examples/demo_snapshot.json", "/demo_snapshot.json", "demo_snapshot.json"];
    let snap = null;
    for (const p of paths) {
      try {
        const r = await fetch(p, {cache: "no-cache"});
        if (!r.ok) continue;
        snap = await r.json();
        break;
      } catch (e) {
        // try next
      }
    }

    if (!snap) {
      alert("Demo snapshot not found in examples/demo_snapshot.json. Please ensure the file is present in the repo.");
      return;
    }

    // If the app exposes a loader hook, use it. Otherwise download snapshot for manual inspection.
    if (typeof window.loadSnapshot === "function") {
      try {
        window.loadSnapshot(snap);
        alert("Demo snapshot loaded into the app (window.loadSnapshot).");
      } catch (e) {
        console.warn("loadSnapshot error", e);
        downloadJSON(snap, "nalu_demo_snapshot.json");
      }
    } else {
      // fallback: offer download
      downloadJSON(snap, "nalu_demo_snapshot.json");
    }
  }

  function downloadExportTemplate() {
    const template = {
      nalu_version: VERSION,
      exported_at: new Date().toISOString(),
      node: "https://example.xrplnode.org (record your node)",
      capture_window: 20,
      selected_ledger: "ledger_index or hash",
      triggers: ["dominance_flip", "fan_out_pattern"],
      notes: "Add narrative context, testnet vs mainnet, and chain of custody",
      metadata_schema_version: "nalu-export@1"
    };
    downloadJSON(template, "nalu_export_template.json");
  }

  function downloadJSON(obj, filename) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], {type: "application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  /* ----------------------------
     Reuseable UI helpers (cards/steps/patterns)
     ---------------------------- */
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

  /* ----------------------------
     Tabs / accordion / glossary binding
     ---------------------------- */
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

  /* ----------------------------
     Hooks & initialization
     ---------------------------- */
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
