/* =========================================================
   about.css — NaluXrp 🌊 About Page (Futuristic)
   Includes safety rules so page cannot "disappear"
   ========================================================= */

/* SAFETY: ensure the about section has room when active */
#about.page-section.active {
  display: block;
}
#about.page-section {
  width: 100%;
  min-height: calc(100vh - 90px);
}

/* Main container */
.about-page {
  width: 100%;
  max-width: 1400px;
  margin: 0 auto;
  padding: 110px 20px 40px; /* fixed navbar */
  box-sizing: border-box;
  animation: fadeSlideIn 0.55s ease-out;
}

/* Error fallback UI */
.about-error {
  border-radius: 18px;
  border: 1px solid rgba(255, 184, 108, 0.35);
  background: rgba(255, 184, 108, 0.08);
  padding: 16px;
}
.about-error-title {
  font-weight: 900;
  color: var(--text-primary);
  margin-bottom: 8px;
}
.about-error-body {
  color: var(--text-secondary);
  line-height: 1.5;
}
.about-error code {
  display: inline-block;
  margin-top: 8px;
  padding: 6px 10px;
  border-radius: 10px;
  background: rgba(0,0,0,0.35);
  border: 1px solid rgba(255,255,255,0.12);
  color: var(--text-primary);
}

/* HERO */
.about-hero {
  display: grid;
  grid-template-columns: 1.2fr 0.8fr;
  gap: 18px;
  align-items: stretch;
  margin-bottom: 18px;
}

.about-kicker {
  font-size: 0.85rem;
  color: var(--text-secondary);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  opacity: 0.95;
}

.about-title {
  margin: 10px 0 6px;
  font-size: 2.2rem;
  letter-spacing: 0.01em;
  color: var(--text-primary);
  text-shadow: 0 0 14px rgba(0, 212, 255, 0.15);
}

.about-subtitle {
  margin: 0;
  max-width: 62ch;
  color: var(--text-secondary);
  line-height: 1.55;
  font-size: 1.02rem;
}

.about-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 14px;
}

.about-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border-radius: 999px;
  border: 1px solid var(--accent-tertiary);
  background: rgba(0, 0, 0, 0.28);
  color: var(--text-primary);
  font-size: 0.85rem;
  font-weight: 600;
  box-shadow: 0 0 0 1px rgba(255,255,255,0.02);
}

.about-hero-card {
  position: relative;
  border-radius: 18px;
  border: 1px solid rgba(255, 255, 255, 0.10);
  background:
    radial-gradient(circle at 20% 0%, rgba(0, 212, 255, 0.18), transparent 55%),
    radial-gradient(circle at 100% 20%, rgba(189, 147, 249, 0.16), transparent 55%),
    linear-gradient(135deg, rgba(0,0,0,0.58), rgba(0,0,0,0.78));
  box-shadow:
    0 0 0 1px rgba(255,255,255,0.04),
    0 18px 44px rgba(0,0,0,0.65);
  padding: 16px 16px 14px;
  overflow: hidden;
}

.about-hero-card::before {
  content: "";
  position: absolute;
  inset: -20%;
  opacity: 0.55;
  filter: blur(34px);
  background: radial-gradient(circle at 0 0, rgba(0,212,255,0.22), transparent 55%);
  pointer-events: none;
}

.about-hero-card-title {
  font-weight: 800;
  color: var(--accent-secondary);
  font-size: 1.05rem;
  letter-spacing: 0.02em;
}

.about-hero-card-tag {
  margin-top: 6px;
  display: inline-flex;
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.14);
  background: rgba(0,0,0,0.35);
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.about-hero-card-text {
  margin: 12px 0 10px;
  color: var(--text-secondary);
  line-height: 1.55;
  position: relative;
  z-index: 1;
}

/* CALLOUTS */
.about-callouts {
  display: grid;
  gap: 10px;
  position: relative;
  z-index: 1;
}

.about-callout {
  display: grid;
  grid-template-columns: 32px 1fr;
  gap: 10px;
  align-items: start;
  padding: 10px 10px;
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,0.10);
  background: rgba(0,0,0,0.35);
}

.about-callout-icon {
  font-size: 1.25rem;
  line-height: 1;
  margin-top: 2px;
}

.about-callout-title {
  font-weight: 800;
  color: var(--text-primary);
  margin-bottom: 2px;
}

.about-callout-text {
  color: var(--text-secondary);
  font-size: 0.92rem;
  line-height: 1.45;
}

.about-callout.warn {
  border-color: rgba(255, 184, 108, 0.35);
  background: rgba(255, 184, 108, 0.08);
}

.about-callout.neutral {
  border-color: rgba(139, 233, 253, 0.25);
  background: rgba(139, 233, 253, 0.06);
}

/* TABS */
.about-tabs {
  position: sticky;
  top: 78px;
  z-index: 50;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  padding: 12px;
  margin: 14px 0 16px;
  border-radius: 16px;
  background: rgba(0,0,0,0.30);
  border: 1px solid rgba(255,255,255,0.10);
  backdrop-filter: blur(16px);
}

.about-tab {
  appearance: none;
  border: 1px solid var(--accent-tertiary);
  background: rgba(0, 0, 0, 0.28);
  color: var(--text-primary);
  padding: 10px 12px;
  border-radius: 12px;
  font-weight: 800;
  font-size: 0.9rem;
  cursor: pointer;
  transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
  white-space: nowrap;
}

.about-tab:hover {
  transform: translateY(-2px);
  border-color: var(--accent-secondary);
  box-shadow: 0 10px 24px rgba(0,0,0,0.55);
}

.about-tab.is-active {
  border-color: var(--accent-primary);
  background:
    radial-gradient(circle at 0 0, rgba(0,212,255,0.18), transparent 60%),
    rgba(0,0,0,0.35);
  box-shadow: 0 0 0 1px rgba(0,212,255,0.12), 0 12px 28px rgba(0,0,0,0.6);
}

/* SECTIONS */
.about-section {
  display: none;
  animation: fadeSlideIn 0.45s ease-out;
}
.about-section.is-active {
  display: block;
}

.about-section-head {
  margin: 8px 0 14px;
}

.about-section-head h2,
.about-section-head h3 {
  margin: 0 0 5px;
  color: var(--accent-secondary);
  font-weight: 900;
  letter-spacing: 0.02em;
}

.about-section-head p {
  margin: 0;
  color: var(--text-secondary);
  line-height: 1.5;
}

.about-divider {
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.14), transparent);
  margin: 18px 0;
}

/* GRIDS */
.about-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.about-pattern-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.about-benign-grid,
.about-limit-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

/* CARDS */
.about-card {
  border-radius: 18px;
  border: 1px solid rgba(255,255,255,0.10);
  background:
    radial-gradient(circle at 20% 0%, rgba(255,255,255,0.06), transparent 55%),
    linear-gradient(135deg, rgba(0,0,0,0.55), rgba(0,0,0,0.78));
  box-shadow:
    0 0 0 1px rgba(255,255,255,0.03),
    0 18px 38px rgba(0,0,0,0.62);
  padding: 14px 14px 12px;
  overflow: hidden;
  position: relative;
}

.about-card::before {
  content: "";
  position: absolute;
  inset: -30%;
  background: radial-gradient(circle at 0 0, rgba(0,212,255,0.10), transparent 55%);
  opacity: 0.65;
  filter: blur(34px);
  pointer-events: none;
}

.about-card-top {
  display: grid;
  grid-template-columns: 34px 1fr auto;
  align-items: center;
  gap: 10px;
  position: relative;
  z-index: 1;
}

.about-card-icon {
  width: 34px;
  height: 34px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0,0,0,0.35);
  border: 1px solid rgba(255,255,255,0.10);
  font-size: 1.1rem;
}

.about-card-title {
  font-weight: 900;
  color: var(--text-primary);
}

.about-card-body {
  margin: 10px 0 0;
  color: var(--text-secondary);
  line-height: 1.55;
  position: relative;
  z-index: 1;
}

.about-bullets {
  margin: 10px 0 0;
  padding-left: 18px;
  color: var(--text-secondary);
  position: relative;
  z-index: 1;
}
.about-bullets li {
  margin: 6px 0;
}

/* ACCORDIONS */
.about-acc-toggle {
  border: 1px solid rgba(255,255,255,0.10);
  background: rgba(0,0,0,0.35);
  color: var(--text-primary);
  padding: 7px 10px;
  border-radius: 12px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-weight: 800;
  transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
  position: relative;
  z-index: 1;
}

.about-acc-toggle:hover {
  transform: translateY(-2px);
  border-color: var(--accent-secondary);
  box-shadow: 0 10px 20px rgba(0,0,0,0.55);
}

.about-acc-chevron {
  opacity: 0.9;
  transition: transform 0.18s ease;
}

.about-accordion [aria-expanded="true"] .about-acc-chevron {
  transform: rotate(180deg);
}

.about-acc-body {
  display: none;
  margin-top: 10px;
}
.about-acc-body.is-open {
  display: block;
}

/* STEPS */
.about-steps {
  display: grid;
  gap: 10px;
}

.about-step {
  display: grid;
  grid-template-columns: 44px 1fr;
  gap: 12px;
  align-items: start;
  padding: 12px 12px;
  border-radius: 18px;
  border: 1px solid rgba(255,255,255,0.10);
  background: rgba(0,0,0,0.28);
}

.about-step-icon {
  width: 44px;
  height: 44px;
  border-radius: 16px;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(0,0,0,0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.25rem;
}

.about-step-title {
  font-weight: 900;
  color: var(--text-primary);
}

.about-step-body {
  color: var(--text-secondary);
  line-height: 1.55;
  margin-top: 4px;
}

/* PATTERN CARDS */
.about-pattern-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
  position: relative;
  z-index: 1;
}

.about-pattern-title {
  font-weight: 950;
  font-size: 1.05rem;
  color: var(--text-primary);
}

.about-pattern-sub {
  font-size: 0.85rem;
  color: var(--text-secondary);
  margin-top: 2px;
}

.about-pattern-badge {
  font-size: 0.75rem;
  font-weight: 900;
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(0,0,0,0.35);
  color: var(--text-secondary);
}

.about-split {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 12px;
  position: relative;
  z-index: 1;
}

.about-split-col {
  border-radius: 14px;
  padding: 10px 10px 8px;
  border: 1px solid rgba(255,255,255,0.10);
  background: rgba(0,0,0,0.28);
}

.about-split-col.good {
  border-color: rgba(80, 250, 123, 0.25);
  background: rgba(80, 250, 123, 0.06);
}

.about-split-col.warn {
  border-color: rgba(255, 184, 108, 0.28);
  background: rgba(255, 184, 108, 0.06);
}

.about-split-title {
  font-weight: 900;
  color: var(--text-primary);
  margin-bottom: 6px;
}

.about-mini-list {
  margin: 0;
  padding-left: 16px;
  color: var(--text-secondary);
}
.about-mini-list li {
  margin: 6px 0;
}

/* GLOSSARY */
.about-glossary-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  margin: 10px 0 12px;
  padding: 12px;
  border-radius: 16px;
  background: rgba(0,0,0,0.28);
  border: 1px solid rgba(255,255,255,0.10);
}

.about-search {
  flex: 1 1 320px;
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 10px 12px;
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,0.10);
  background: rgba(0,0,0,0.35);
}

.about-search input {
  width: 100%;
  outline: none;
  border: 0;
  background: transparent;
  color: var(--text-primary);
  font-size: 0.95rem;
}

.about-toolbar-actions {
  display: flex;
  gap: 10px;
  align-items: center;
  flex: 0 0 auto;
}

.about-btn {
  padding: 10px 12px;
  border-radius: 14px;
  border: 1px solid var(--accent-tertiary);
  background: rgba(0,0,0,0.35);
  color: var(--text-primary);
  font-weight: 900;
  cursor: pointer;
  transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
  white-space: nowrap;
}

.about-btn:hover {
  transform: translateY(-2px);
  border-color: var(--accent-secondary);
  box-shadow: 0 12px 22px rgba(0,0,0,0.55);
}

.about-toolbar-note {
  font-size: 0.85rem;
  color: var(--text-secondary);
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.10);
  background: rgba(0,0,0,0.28);
}

.about-glossary-list {
  display: grid;
  gap: 10px;
}

.about-glossary-item {
  border-radius: 18px;
  border: 1px solid rgba(255,255,255,0.10);
  background:
    radial-gradient(circle at 20% 0%, rgba(255,255,255,0.06), transparent 55%),
    rgba(0,0,0,0.35);
  overflow: hidden;
}

.about-glossary-head {
  width: 100%;
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  background: transparent;
  border: 0;
  cursor: pointer;
  color: inherit;
}

.about-glossary-term {
  font-weight: 950;
  color: var(--text-primary);
}

.about-glossary-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 6px;
}

.about-tag {
  font-size: 0.72rem;
  padding: 4px 9px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(0,0,0,0.30);
  color: var(--text-secondary);
  font-weight: 800;
}

.about-glossary-chevron {
  opacity: 0.9;
  transition: transform 0.18s ease;
}

.about-glossary-item.is-open .about-glossary-chevron {
  transform: rotate(180deg);
}

.about-glossary-body {
  display: none;
  padding: 0 14px 14px;
  color: var(--text-secondary);
  line-height: 1.6;
}
.about-glossary-body.is-open {
  display: block;
}

/* HINT */
.about-hint {
  margin-top: 16px;
  padding: 12px 14px;
  border-radius: 18px;
  border: 1px solid rgba(139, 233, 253, 0.25);
  background: rgba(139, 233, 253, 0.06);
  color: var(--text-secondary);
}

/* FOOTER */
.about-footer {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid rgba(255,255,255,0.10);
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.about-footer-left {
  font-weight: 900;
  color: var(--text-primary);
}

/* RESPONSIVE */
@media (max-width: 1200px) {
  .about-hero {
    grid-template-columns: 1fr;
  }
  .about-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 820px) {
  .about-page {
    padding: 100px 16px 34px;
  }
  .about-grid,
  .about-pattern-grid,
  .about-benign-grid,
  .about-limit-grid {
    grid-template-columns: 1fr;
  }
  .about-split {
    grid-template-columns: 1fr;
  }
  .about-tabs {
    top: 74px;
  }
}

@media (max-width: 480px) {
  .about-title {
    font-size: 1.75rem;
  }
  .about-tab {
    width: 100%;
    justify-content: center;
  }
  .about-toolbar-actions {
    width: 100%;
    justify-content: space-between;
  }
}

/* fallback animation */
@keyframes fadeSlideIn {
  0% { opacity: 0; transform: translateY(-10px); }
  100% { opacity: 1; transform: translateY(0); }
}
