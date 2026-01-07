/* =========================================
   NaluXrp 🌊 – Dashboard Ledger Cards
   Supplementary module for dashboard ledger visualization
   ========================================= */

// This module provides additional utilities for the dashboard
// The main dashboard functionality is in dashboard.js

window.DashboardLedgerCards = {
  initialized: false,
  
  init() {
    if (this.initialized) return;
    this.initialized = true;
    console.log('✅ Dashboard Ledger Cards module initialized');
  },
  
  // Utility function to format ledger card data
  formatLedgerCard(ledgerData) {
    if (!ledgerData) return null;
    
    return {
      index: ledgerData.ledger_index || ledgerData.ledgerIndex,
      txCount: ledgerData.txn_count || ledgerData.transactions?.length || 0,
      closeTime: ledgerData.close_time || ledgerData.closeTime,
      hash: ledgerData.ledger_hash || ledgerData.hash,
    };
  },
  
  // Helper to create a visual representation of a ledger
  createLedgerCardHTML(ledgerData) {
    const formatted = this.formatLedgerCard(ledgerData);
    if (!formatted) return '';
    
    return `
      <div class="ledger-card" style="
        background: var(--card-bg);
        border-radius: 12px;
        padding: 15px;
        border: 2px solid var(--accent-tertiary);
        transition: all 0.3s ease;
      ">
        <div style="font-size: 1.2em; font-weight: 700; color: var(--accent-primary); margin-bottom: 8px;">
          Ledger #${formatted.index}
        </div>
        <div style="color: var(--text-secondary); font-size: 0.9em;">
          <div>📊 Transactions: ${formatted.txCount}</div>
          <div style="font-size: 0.8em; margin-top: 5px; opacity: 0.7;">
            ${formatted.hash ? formatted.hash.substring(0, 16) + '...' : 'Hash unavailable'}
          </div>
        </div>
      </div>
    `;
  }
};

// Auto-initialize when loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.DashboardLedgerCards.init();
  });
} else {
  window.DashboardLedgerCards.init();
}

console.log('✅ Dashboard Ledger Cards module loaded');
