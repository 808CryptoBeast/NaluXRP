/* =========================================================
   INSPECTOR TRACE TAB - Enhanced with Progress & Multi-Address
   
   Features:
   - Progress bar for Build a Tree
   - Multi-address paste support
   - Cancel button
   - Bubble map integration
   - No edge filter (removed)
   ========================================================= */

(function() {
  'use strict';
  
  const VERSION = 'inspector-trace-tab@3.0.0';
  
  let traceQueue = null;
  let currentTrace = null;
  let bubbleMapInstance = null;
  
  // ============================================
  // INITIALIZATION
  // ============================================
  
  function init() {
    console.log('🔧 Initializing Enhanced Trace Tab...');
    
    setupTraceUI();
    setupBubbleMapContainer();
    initializeTraceQueue();
    
    console.log('✅ Enhanced Trace Tab initialized');
  }
  
  // ============================================
  // UI SETUP
  // ============================================
  
  function setupTraceUI() {
    const traceTab = document.getElementById('trace-tab-content') || 
                     document.querySelector('[data-tab="trace"]');
    
    if (!traceTab) {
      console.warn('⚠️ Trace tab not found');
      return;
    }
    
    // Enhanced trace UI with multi-address input
    const enhancedUI = `
      <div class="inspector-section">
        <h3>🌳 Build Transaction Tree</h3>
        
        <div class="multi-address-input">
          <label style="display: block; margin-bottom: 10px; font-weight: 600; color: rgba(255,255,255,0.9);">
            Enter Addresses (one per line or comma-separated):
          </label>
          <textarea 
            id="trace-address-input" 
            class="multi-address-textarea"
            placeholder="rXXXXXXXXXXXXXXXX
rYYYYYYYYYYYYYYYYY
rZZZZZZZZZZZZZZZZZ

Or paste multiple addresses separated by commas:
rAAA, rBBB, rCCC"
            rows="8"
          ></textarea>
          <div class="address-input-hint">
            💡 Paste multiple addresses to trace connections between them
            <span id="address-count-badge" class="address-count" style="display: none;">0 addresses</span>
          </div>
        </div>
        
        <div class="inspector-input-group">
          <div style="flex: 1; display: flex; gap: 10px;">
            <input 
              type="number" 
              id="trace-depth-input" 
              class="inspector-input" 
              placeholder="Max Depth (1-5)"
              min="1"
              max="5"
              value="2"
              style="max-width: 200px;"
            >
            <input 
              type="number" 
              id="trace-limit-input" 
              class="inspector-input" 
              placeholder="Max Transactions (10-200)"
              min="10"
              max="200"
              value="50"
              style="max-width: 200px;"
            >
          </div>
          <button id="build-tree-btn" class="inspector-btn">
            🌳 Build Tree
          </button>
        </div>
        
        <!-- Progress Bar Container -->
        <div id="trace-progress-container" style="display: none; margin: 20px 0; padding: 20px; background: rgba(0,0,0,0.3); border-radius: 10px; border: 1px solid rgba(76,175,80,0.3);">
          <div class="progress-header">
            <div class="progress-info">
              <strong id="trace-progress-title" style="font-size: 1.1em; color: #4CAF50;">🌳 Building Transaction Tree...</strong>
              <div id="trace-progress-subtitle" style="font-size: 0.9em; color: rgba(255,255,255,0.7); margin-top: 5px;">Initializing...</div>
            </div>
            <button id="cancel-trace-btn" class="cancel-btn">
              🛑 Cancel
            </button>
          </div>
          
          <div class="progress-bar-container">
            <div id="trace-progress-bar-fill" class="progress-bar-fill">
              <span id="trace-progress-percentage" class="progress-percentage">0%</span>
            </div>
          </div>
          
          <div class="progress-stats">
            <div class="progress-stat">
              <div class="progress-stat-label">Completed</div>
              <div id="trace-progress-completed" class="progress-stat-value completed">0</div>
            </div>
            <div class="progress-stat">
              <div class="progress-stat-label">Pending</div>
              <div id="trace-progress-pending" class="progress-stat-value pending">0</div>
            </div>
            <div class="progress-stat">
              <div class="progress-stat-label">Failed</div>
              <div id="trace-progress-failed" class="progress-stat-value failed">0</div>
            </div>
            <div class="progress-stat">
              <div class="progress-stat-label">Total</div>
              <div id="trace-progress-total" class="progress-stat-value">0</div>
            </div>
          </div>
          
          <div id="trace-progress-warnings" style="margin-top: 15px; display: none;">
            <div class="progress-warning-box">
              <strong>⚠️ Connection Issues</strong>
              <p style="margin: 5px 0 0 0; font-size: 0.9em;">Retrying failed requests...</p>
            </div>
          </div>
        </div>
        
        <!-- Results Container -->
        <div id="trace-results-container" style="margin-top: 25px;"></div>
      </div>
    `;
    
    traceTab.innerHTML = enhancedUI;
    
    // Bind events
    bindTraceEvents();
  }
  
  function setupBubbleMapContainer() {
    const inspectorSection = document.getElementById('inspector');
    if (!inspectorSection) return;
    
    // Check if bubble map container already exists
    if (document.getElementById('inspector-bubble-map-container')) return;
    
    const bubbleMapHTML = `
      <div id="inspector-bubble-map-container" class="inspector-section" style="display: none;">
        <h3>🫧 Transaction Bubble Map</h3>
        
        <div class="bubble-controls">
          <button class="bubble-control-btn active" data-view="force">Force Layout</button>
          <button class="bubble-control-btn" data-view="radial">Radial Layout</button>
          <button class="bubble-control-btn" data-view="hierarchical">Hierarchical</button>
        </div>
        
        <div id="inspector-bubble-map">
          <div class="bubble-map-empty">
            Build a transaction tree to visualize connections
          </div>
        </div>
        
        <div style="margin-top: 15px; display: flex; gap: 10px; flex-wrap: wrap;">
          <button id="export-bubble-svg" class="inspector-btn secondary" style="display: none;">
            💾 Export as SVG
          </button>
          <button id="reset-bubble-view" class="inspector-btn secondary" style="display: none;">
            🔄 Reset View
          </button>
        </div>
      </div>
    `;
    
    inspectorSection.insertAdjacentHTML('beforeend', bubbleMapHTML);
    
    // Bind bubble map controls
    bindBubbleMapControls();
  }
  
  // ============================================
  // EVENT BINDING
  // ============================================
  
  function bindTraceEvents() {
    // Address input - count addresses as user types
    const addressInput = document.getElementById('trace-address-input');
    if (addressInput) {
      addressInput.addEventListener('input', updateAddressCount);
    }
    
    // Build tree button
    const buildBtn = document.getElementById('build-tree-btn');
    if (buildBtn) {
      buildBtn.addEventListener('click', handleBuildTree);
    }
    
    // Cancel button
    const cancelBtn = document.getElementById('cancel-trace-btn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', cancelTrace);
    }
  }
  
  function bindBubbleMapControls() {
    // Layout controls
    const controlBtns = document.querySelectorAll('.bubble-control-btn');
    controlBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        controlBtns.forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        
        const view = e.target.getAttribute('data-view');
        if (bubbleMapInstance && bubbleMapInstance.setLayout) {
          bubbleMapInstance.setLayout(view);
        }
      });
    });
    
    // Export SVG
    const exportBtn = document.getElementById('export-bubble-svg');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        if (bubbleMapInstance && bubbleMapInstance.exportSVG) {
          bubbleMapInstance.exportSVG();
        }
      });
    }
    
    // Reset view
    const resetBtn = document.getElementById('reset-bubble-view');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (bubbleMapInstance && bubbleMapInstance.resetView) {
          bubbleMapInstance.resetView();
        }
      });
    }
  }
  
  // ============================================
  // ADDRESS PARSING
  // ============================================
  
  function updateAddressCount() {
    const input = document.getElementById('trace-address-input');
    const badge = document.getElementById('address-count-badge');
    
    if (!input || !badge) return;
    
    const addresses = parseAddresses(input.value);
    
    if (addresses.length > 0) {
      badge.textContent = `${addresses.length} address${addresses.length === 1 ? '' : 'es'}`;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  }
  
  function parseAddresses(text) {
    if (!text || !text.trim()) return [];
    
    // Split by newlines and commas
    const rawAddresses = text.split(/[\n,]/)
      .map(addr => addr.trim())
      .filter(addr => addr.length > 0);
    
    // Validate XRP addresses (start with 'r' and 25-35 chars)
    const validAddresses = rawAddresses.filter(addr => {
      return addr.startsWith('r') && addr.length >= 25 && addr.length <= 35;
    });
    
    // Remove duplicates
    return [...new Set(validAddresses)];
  }
  
  // ============================================
  // TRACE QUEUE MANAGEMENT
  // ============================================
  
  function initializeTraceQueue() {
    if (window.EnhancedPatternDetector && window.EnhancedPatternDetector.RequestQueueManager) {
      traceQueue = new window.EnhancedPatternDetector.RequestQueueManager(2, 300);
      
      traceQueue.onProgress = updateTraceProgress;
      traceQueue.onComplete = onTraceComplete;
      traceQueue.onError = onTraceError;
      
      console.log('✅ Trace queue initialized');
    } else {
      console.warn('⚠️ RequestQueueManager not found - progress tracking limited');
    }
  }
  
  function updateTraceProgress(stats) {
    const { total, completed, failed, pending } = stats;
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
    
    const fillEl = document.getElementById('trace-progress-bar-fill');
    const percentEl = document.getElementById('trace-progress-percentage');
    if (fillEl) fillEl.style.width = `${percentage}%`;
    if (percentEl) percentEl.textContent = `${percentage}%`;
    
    const completedEl = document.getElementById('trace-progress-completed');
    const pendingEl = document.getElementById('trace-progress-pending');
    const failedEl = document.getElementById('trace-progress-failed');
    const totalEl = document.getElementById('trace-progress-total');
    
    if (completedEl) completedEl.textContent = completed;
    if (pendingEl) pendingEl.textContent = pending;
    if (failedEl) failedEl.textContent = failed;
    if (totalEl) totalEl.textContent = total;
    
    const subtitleEl = document.getElementById('trace-progress-subtitle');
    if (subtitleEl) {
      if (pending > 0) {
        subtitleEl.textContent = `Fetching transaction data... (${pending} requests queued)`;
      } else if (completed === total && total > 0) {
        subtitleEl.textContent = `✅ Tree built! Processed ${total} requests.`;
      } else {
        subtitleEl.textContent = `Processing ${completed} of ${total}...`;
      }
    }
    
    const warningsEl = document.getElementById('trace-progress-warnings');
    if (warningsEl) {
      warningsEl.style.display = failed > 0 ? 'block' : 'none';
    }
  }
  
  function onTraceComplete(stats) {
    console.log('✅ Trace complete:', stats);
    
    setTimeout(() => {
      const container = document.getElementById('trace-progress-container');
      if (container) container.style.display = 'none';
    }, 3000);
  }
  
  function onTraceError(error, item) {
    console.error('❌ Trace error:', error);
  }
  
  function showTraceProgress() {
    const container = document.getElementById('trace-progress-container');
    if (container) {
      container.style.display = 'block';
      updateTraceProgress({ total: 0, completed: 0, failed: 0, pending: 0 });
    }
  }
  
  function hideTraceProgress() {
    const container = document.getElementById('trace-progress-container');
    if (container) container.style.display = 'none';
  }
  
  function cancelTrace() {
    if (traceQueue) {
      traceQueue.cancel();
      
      if (window.showNotification) {
        window.showNotification('🛑 Tree building cancelled', 'info', 3000);
      }
      
      setTimeout(() => hideTraceProgress(), 1000);
    }
  }
  
  // ============================================
  // BUILD TREE
  // ============================================
  
  async function handleBuildTree() {
    const addressInput = document.getElementById('trace-address-input');
    const depthInput = document.getElementById('trace-depth-input');
    const limitInput = document.getElementById('trace-limit-input');
    
    if (!addressInput) return;
    
    const addresses = parseAddresses(addressInput.value);
    
    if (addresses.length === 0) {
      if (window.showNotification) {
        window.showNotification('⚠️ Please enter at least one valid address', 'warn', 3000);
      }
      return;
    }
    
    const maxDepth = parseInt(depthInput?.value) || 2;
    const maxTx = parseInt(limitInput?.value) || 50;
    
    // Reset queue
    if (traceQueue) {
      traceQueue.reset();
    }
    
    showTraceProgress();
    
    try {
      console.log(`🌳 Building tree for ${addresses.length} address(es)...`);
      
      // Build tree with rate limiting
      const treeData = await buildTransactionTree(addresses, maxDepth, maxTx);
      
      console.log('📊 Tree data:', treeData);
      
      // Display results
      displayTreeResults(treeData);
      
      // Show bubble map
      showBubbleMap(treeData);
      
      // Run pattern detection
      if (window.EnhancedPatternDetector) {
        const findings = await window.EnhancedPatternDetector.analyze(treeData);
        displayPatternFindings(findings);
      }
      
      if (window.showNotification) {
        window.showNotification('✅ Tree built successfully!', 'success', 3000);
      }
      
    } catch (error) {
      console.error('Tree building error:', error);
      
      if (window.showNotification) {
        window.showNotification(`❌ ${error.message}`, 'error', 5000);
      }
      
      hideTraceProgress();
    }
  }
  
  async function buildTransactionTree(addresses, maxDepth, maxTx) {
    const nodes = new Map();
    const edges = [];
    const processedTxs = new Set();
    
    // Queue for BFS traversal
    const queue = addresses.map(addr => ({ address: addr, depth: 0 }));
    const visited = new Set(addresses);
    
    while (queue.length > 0 && edges.length < maxTx) {
      const { address, depth } = queue.shift();
      
      if (depth >= maxDepth) continue;
      
      // Add node
      if (!nodes.has(address)) {
        nodes.set(address, {
          id: address,
          label: shortAddr(address),
          type: 'account'
        });
      }
      
      // Fetch transactions for this address
      const transactions = await fetchTransactionsQueued(address, 20);
      
      for (const tx of transactions) {
        if (edges.length >= maxTx) break;
        if (processedTxs.has(tx.hash)) continue;
        
        processedTxs.add(tx.hash);
        
        const txData = tx.tx || tx;
        const from = txData.Account;
        const to = txData.Destination || txData.Issuer;
        
        if (!from || !to) continue;
        
        // Add edge
        edges.push({
          from,
          to,
          type: txData.TransactionType,
          amount: extractAmount(txData),
          currency: extractCurrency(txData),
          hash: txData.hash,
          ledger_index: txData.ledger_index || tx.ledger_index,
          timestamp: tx.date || txData.date
        });
        
        // Add destination to nodes
        if (!nodes.has(to)) {
          nodes.set(to, {
            id: to,
            label: shortAddr(to),
            type: 'account'
          });
        }
        
        // Add to queue if not visited and within depth
        if (!visited.has(to) && depth + 1 < maxDepth) {
          visited.add(to);
          queue.push({ address: to, depth: depth + 1 });
        }
      }
    }
    
    return {
      nodes: Array.from(nodes.values()),
      edges,
      origin: addresses[0],
      origins: addresses,
      maxDepth,
      stats: {
        nodeCount: nodes.size,
        edgeCount: edges.length,
        addressCount: addresses.length
      }
    };
  }
  
  async function fetchTransactionsQueued(address, limit = 20) {
    if (!traceQueue) {
      // Fallback without queue
      return await fetchTransactionsDirect(address, limit);
    }
    
    return await traceQueue.enqueue(async () => {
      return await fetchTransactionsDirect(address, limit);
    }, 5, 3);
  }
  
  async function fetchTransactionsDirect(address, limit) {
    const params = { account: address, limit };
    
    if (window.xrplRequest) {
      const result = await window.xrplRequest('account_tx', params);
      return result?.transactions || [];
    }
    
    // Fallback to direct fetch
    const response = await fetch('https://xrplcluster.com/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'account_tx',
        params: [params]
      })
    });
    
    const data = await response.json();
    return data.result?.transactions || [];
  }
  
  // ============================================
  // DISPLAY RESULTS
  // ============================================
  
  function displayTreeResults(treeData) {
    const container = document.getElementById('trace-results-container');
    if (!container) return;
    
    const { nodes, edges, origins, stats } = treeData;
    
    let html = `
      <div class="result-section result-success">
        <h4>✅ Transaction Tree Built</h4>
        
        <div class="info-grid">
          <div class="info-card">
            <div class="info-card-label">Addresses Traced</div>
            <div class="info-card-value">${origins.length}</div>
          </div>
          <div class="info-card">
            <div class="info-card-label">Accounts Found</div>
            <div class="info-card-value">${stats.nodeCount}</div>
          </div>
          <div class="info-card">
            <div class="info-card-label">Transactions</div>
            <div class="info-card-value">${stats.edgeCount}</div>
          </div>
          <div class="info-card">
            <div class="info-card-label">Max Depth</div>
            <div class="info-card-value">${treeData.maxDepth}</div>
          </div>
        </div>
        
        <div style="margin-top: 20px;">
          <strong>Origin Address${origins.length > 1 ? 'es' : ''}:</strong>
          ${origins.map(addr => `<div style="margin: 5px 0;"><code>${addr}</code></div>`).join('')}
        </div>
      </div>
    `;
    
    // Transaction type breakdown
    const txTypes = {};
    edges.forEach(e => {
      txTypes[e.type] = (txTypes[e.type] || 0) + 1;
    });
    
    if (Object.keys(txTypes).length > 0) {
      html += `
        <div class="result-section">
          <h4>📊 Transaction Type Breakdown</h4>
          ${Object.entries(txTypes)
            .sort((a, b) => b[1] - a[1])
            .map(([type, count]) => `
              <div style="display: flex; justify-content: space-between; padding: 8px; border-bottom: 1px solid rgba(255,255,255,0.05);">
                <span>${type}</span>
                <strong>${count}</strong>
              </div>
            `).join('')}
        </div>
      `;
    }
    
    container.innerHTML = html;
  }
  
  function displayPatternFindings(findings) {
    if (!findings || findings.length === 0) return;
    
    const container = document.getElementById('trace-results-container');
    if (!container) return;
    
    let html = `
      <div class="result-section result-warning">
        <h4>⚠️ Pattern Detection Results</h4>
        <p>Found ${findings.length} suspicious pattern${findings.length === 1 ? '' : 's'}:</p>
    `;
    
    const highSeverity = findings.filter(f => f.severity === 'HIGH');
    const mediumSeverity = findings.filter(f => f.severity === 'MEDIUM');
    
    if (highSeverity.length > 0) {
      html += `<div style="margin-top: 15px;"><strong style="color: #ff6b6b;">🚨 High Severity (${highSeverity.length})</strong></div>`;
      highSeverity.forEach(f => {
        html += `
          <div class="result-detail" style="border-left: 3px solid #ff4444;">
            <strong>${f.type.replace(/_/g, ' ')}</strong>
            <p style="margin: 5px 0;">${f.description}</p>
          </div>
        `;
      });
    }
    
    if (mediumSeverity.length > 0) {
      html += `<div style="margin-top: 15px;"><strong style="color: #FFB74D;">⚠️ Medium Severity (${mediumSeverity.length})</strong></div>`;
      mediumSeverity.forEach(f => {
        html += `
          <div class="result-detail" style="border-left: 3px solid #ff9800;">
            <strong>${f.type.replace(/_/g, ' ')}</strong>
            <p style="margin: 5px 0;">${f.description}</p>
          </div>
        `;
      });
    }
    
    html += `</div>`;
    
    container.insertAdjacentHTML('beforeend', html);
  }
  
  // ============================================
  // BUBBLE MAP
  // ============================================
  
  function showBubbleMap(treeData) {
    const container = document.getElementById('inspector-bubble-map-container');
    const canvas = document.getElementById('inspector-bubble-map');
    
    if (!container || !canvas) {
      console.warn('⚠️ Bubble map container not found');
      return;
    }
    
    container.style.display = 'block';
    
    // Show controls
    const exportBtn = document.getElementById('export-bubble-svg');
    const resetBtn = document.getElementById('reset-bubble-view');
    if (exportBtn) exportBtn.style.display = 'inline-block';
    if (resetBtn) resetBtn.style.display = 'inline-block';
    
    // Initialize or update bubble map
    if (window.InspectorBubbleMap) {
      bubbleMapInstance = new window.InspectorBubbleMap('inspector-bubble-map');
      bubbleMapInstance.render(treeData);
      console.log('✅ Bubble map rendered');
    } else {
      console.warn('⚠️ InspectorBubbleMap not found');
      canvas.innerHTML = '<div class="bubble-map-empty">Bubble map visualization not available</div>';
    }
  }
  
  // ============================================
  // UTILITY FUNCTIONS
  // ============================================
  
  function shortAddr(addr) {
    const s = String(addr || '');
    if (s.length < 12) return s;
    return `${s.slice(0, 6)}…${s.slice(-4)}`;
  }
  
  function extractAmount(tx) {
    if (!tx.Amount) return 0;
    
    if (typeof tx.Amount === 'string') {
      return parseFloat(tx.Amount) / 1000000;
    } else if (typeof tx.Amount === 'object') {
      return parseFloat(tx.Amount.value) || 0;
    }
    
    return 0;
  }
  
  function extractCurrency(tx) {
    if (!tx.Amount) return 'XRP';
    
    if (typeof tx.Amount === 'string') {
      return 'XRP';
    } else if (typeof tx.Amount === 'object') {
      return tx.Amount.currency || 'XRP';
    }
    
    return 'XRP';
  }
  
  // ============================================
  // AUTO-INIT
  // ============================================
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  
  // ============================================
  // PUBLIC API
  // ============================================
  
  window.InspectorTraceTab = {
    version: VERSION,
    buildTree: handleBuildTree,
    parseAddresses,
    showBubbleMap
  };
  
  console.log(`✅ ${VERSION} loaded`);
  
})();