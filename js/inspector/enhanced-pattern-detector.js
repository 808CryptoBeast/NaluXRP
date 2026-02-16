/* =========================================================
   FILE: js/inspector/enhanced-pattern-detector.js
   Multi-Asset Pattern Detection Engine + Request Queue Manager
   
   DETECTS:
   ✅ NFT wash trading & floor manipulation
   ✅ AMM rug pulls & liquidity drains
   ✅ LP sandwich attacks
   ✅ DEX manipulation
   ✅ Payment circular flows
   ✅ Fake volume across all asset types
   
   FEATURES:
   ✅ Request queue with rate limiting
   ✅ Progress bar with real-time updates
   ✅ Cancel button to stop searches
   ✅ Forensic analysis for draining events
   ✅ Token distribution tracking
   ========================================================= */

(function () {
  "use strict";

  const VERSION = "enhanced-pattern-detector@3.0.0";

  // ============================================
  // REQUEST QUEUE MANAGER (prevents ERR_CONNECTION_RESET)
  // ============================================
  
  class RequestQueueManager {
    constructor(maxConcurrent = 2, delayBetweenBatches = 300) {
      this.maxConcurrent = maxConcurrent;
      this.delayBetweenBatches = delayBetweenBatches;
      this.queue = [];
      this.activeRequests = 0;
      this.isPaused = false;
      this.isCancelled = false;
      
      this.stats = {
        total: 0,
        completed: 0,
        failed: 0,
        retried: 0
      };
      
      this.onProgress = null;
      this.onComplete = null;
      this.onError = null;
    }
    
    enqueue(requestFn, priority = 0, maxRetries = 3) {
      return new Promise((resolve, reject) => {
        this.queue.push({
          requestFn,
          priority,
          maxRetries,
          currentRetry: 0,
          resolve,
          reject,
          timestamp: Date.now()
        });
        
        this.stats.total++;
        this.queue.sort((a, b) => b.priority - a.priority);
        this.processQueue();
      });
    }
    
    async processQueue() {
      if (this.isPaused || this.isCancelled) return;
      
      while (this.activeRequests < this.maxConcurrent && this.queue.length > 0) {
        const item = this.queue.shift();
        this.activeRequests++;
        this.executeRequest(item);
      }
      
      if (this.onProgress) {
        this.onProgress({
          total: this.stats.total,
          completed: this.stats.completed,
          failed: this.stats.failed,
          pending: this.queue.length,
          active: this.activeRequests
        });
      }
      
      if (this.activeRequests === 0 && this.queue.length === 0 && this.stats.total > 0) {
        if (this.onComplete) {
          this.onComplete(this.stats);
        }
      }
    }
    
    async executeRequest(item) {
      try {
        const result = await item.requestFn();
        this.stats.completed++;
        this.activeRequests--;
        item.resolve(result);
        await this.delay(50);
        this.processQueue();
        
      } catch (error) {
        if (item.currentRetry < item.maxRetries && !this.isCancelled) {
          item.currentRetry++;
          this.stats.retried++;
          const backoffDelay = Math.min(1000 * Math.pow(2, item.currentRetry), 10000);
          console.log(`⚠️ Retry ${item.currentRetry}/${item.maxRetries} after ${backoffDelay}ms`);
          await this.delay(backoffDelay);
          this.queue.unshift(item);
          this.activeRequests--;
          this.processQueue();
        } else {
          this.stats.failed++;
          this.activeRequests--;
          if (this.onError) this.onError(error, item);
          item.reject(error);
          this.processQueue();
        }
      }
    }
    
    cancel() {
      this.isCancelled = true;
      while (this.queue.length > 0) {
        const item = this.queue.shift();
        item.reject(new Error('Request cancelled by user'));
      }
      this.stats.failed += this.queue.length;
      console.log('🛑 Request queue cancelled');
      if (this.onComplete) {
        this.onComplete({ ...this.stats, cancelled: true });
      }
    }
    
    reset() {
      this.queue = [];
      this.activeRequests = 0;
      this.isPaused = false;
      this.isCancelled = false;
      this.stats = { total: 0, completed: 0, failed: 0, retried: 0 };
    }
    
    delay(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }
  }

  // ============================================
  // PATTERN DETECTION THRESHOLDS
  // ============================================
  
  const THRESHOLDS = {
    WASH_TRADE_MIN_OCCURRENCES: 3,
    CIRCULAR_FLOW_MAX_HOPS: 6,
    RAPID_SUCCESSION_LEDGERS: 50,
    HIGH_FREQUENCY_TRADES: 10,
    SANDWICH_ATTACK_WINDOW: 5,
    RUG_PULL_WITHDRAWAL_PERCENT: 0.7,
    FLOOR_MANIPULATION_DEVIATION: 0.3
  };

  // ============================================
  // UTILITY FUNCTIONS
  // ============================================
  
  function shortAddr(addr) {
    const s = String(addr || "");
    if (s.length < 12) return s;
    return `${s.slice(0, 6)}…${s.slice(-4)}`;
  }
  
  function parseAmount(amount) {
    if (typeof amount === 'string') {
      return { value: (parseInt(amount) / 1000000).toString(), currency: 'XRP' };
    } else if (typeof amount === 'object') {
      return amount;
    }
    return { value: '0', currency: 'XRP' };
  }

  // ============================================
  // PROGRESS UI MANAGEMENT
  // ============================================
  
  let requestQueue = null;
  
  function initializeProgressUI() {
    const inspectorSection = document.getElementById('inspector');
    if (!inspectorSection) return;
    
    // Check if already injected
    if (document.getElementById('inspector-progress-container')) return;
    
    const progressHTML = `
      <div id="inspector-progress-container" style="display: none; margin: 20px 0; padding: 20px; background: rgba(0,0,0,0.2); border-radius: 8px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
          <div>
            <strong id="progress-title">🔍 Analyzing Account...</strong>
            <div id="progress-subtitle" style="font-size: 0.9em; opacity: 0.8; margin-top: 5px;">Initializing...</div>
          </div>
          <button id="cancel-inspection-btn" style="background: #ff4444; color: white; padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">
            🛑 Cancel
          </button>
        </div>
        
        <div style="background: rgba(0,0,0,0.3); border-radius: 4px; height: 30px; overflow: hidden; position: relative;">
          <div id="progress-bar-fill" style="height: 100%; background: linear-gradient(90deg, #4CAF50, #8BC34A); width: 0%; transition: width 0.3s ease; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 0.9em;">
            <span id="progress-percentage">0%</span>
          </div>
        </div>
        
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-top: 15px; font-size: 0.9em;">
          <div><span style="opacity: 0.8;">Completed:</span> <strong id="progress-completed">0</strong></div>
          <div><span style="opacity: 0.8;">Pending:</span> <strong id="progress-pending">0</strong></div>
          <div><span style="opacity: 0.8;">Failed:</span> <strong id="progress-failed" style="color: #ff6b6b;">0</strong></div>
          <div><span style="opacity: 0.8;">Total:</span> <strong id="progress-total">0</strong></div>
        </div>
        
        <div id="progress-warnings" style="margin-top: 15px; display: none;">
          <div style="background: rgba(255,152,0,0.2); border-left: 3px solid #ff9800; padding: 10px; border-radius: 4px;">
            <strong>⚠️ Connection Issues</strong>
            <p style="margin: 5px 0 0 0; font-size: 0.9em;">Retrying failed requests...</p>
          </div>
        </div>
      </div>
    `;
    
    const quickInspectArea = inspectorSection.querySelector('.inspector-quick-inspect') || 
                             inspectorSection.querySelector('#inspectorQuickInspectBtn')?.parentElement;
    
    if (quickInspectArea) {
      quickInspectArea.insertAdjacentHTML('afterend', progressHTML);
      
      const cancelBtn = document.getElementById('cancel-inspection-btn');
      if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
          if (requestQueue) {
            requestQueue.cancel();
            if (window.showNotification) {
              window.showNotification('🛑 Inspection cancelled', 'info', 3000);
            }
            setTimeout(() => hideProgress(), 1000);
          }
        });
      }
      
      console.log('✅ Progress UI injected');
    }
  }
  
  function showProgress(title = '🔍 Analyzing Account...') {
    const container = document.getElementById('inspector-progress-container');
    if (container) {
      container.style.display = 'block';
      const titleEl = document.getElementById('progress-title');
      if (titleEl) titleEl.textContent = title;
      updateProgressBar({ total: 0, completed: 0, failed: 0, pending: 0 });
    }
  }
  
  function hideProgress() {
    const container = document.getElementById('inspector-progress-container');
    if (container) container.style.display = 'none';
  }
  
  function updateProgressBar(stats) {
    const { total, completed, failed, pending } = stats;
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
    
    const fillEl = document.getElementById('progress-bar-fill');
    const percentEl = document.getElementById('progress-percentage');
    if (fillEl) fillEl.style.width = `${percentage}%`;
    if (percentEl) percentEl.textContent = `${percentage}%`;
    
    const completedEl = document.getElementById('progress-completed');
    const pendingEl = document.getElementById('progress-pending');
    const failedEl = document.getElementById('progress-failed');
    const totalEl = document.getElementById('progress-total');
    
    if (completedEl) completedEl.textContent = completed;
    if (pendingEl) pendingEl.textContent = pending;
    if (failedEl) failedEl.textContent = failed;
    if (totalEl) totalEl.textContent = total;
    
    const subtitleEl = document.getElementById('progress-subtitle');
    if (subtitleEl) {
      if (pending > 0) {
        subtitleEl.textContent = `Fetching data... (${pending} requests queued)`;
      } else if (completed === total && total > 0) {
        subtitleEl.textContent = `✅ Complete! Processed ${total} requests.`;
      } else {
        subtitleEl.textContent = `Processing ${completed} of ${total}...`;
      }
    }
    
    const warningsEl = document.getElementById('progress-warnings');
    if (warningsEl) {
      warningsEl.style.display = failed > 0 ? 'block' : 'none';
    }
  }

  // ============================================
  // ENHANCED QUICK INSPECT WITH RATE LIMITING
  // ============================================
  
  async function enhancedQuickInspect(address) {
    console.log('🔍 Enhanced inspection:', address);
    
    if (!address || typeof address !== 'string') {
      if (window.showNotification) {
        window.showNotification('⚠️ Invalid address', 'warn', 3000);
      }
      return;
    }
    
    // Initialize queue
    if (!requestQueue) {
      requestQueue = new RequestQueueManager(2, 300);
      requestQueue.onProgress = updateProgressBar;
      requestQueue.onComplete = (stats) => {
        console.log('✅ Inspection complete:', stats);
        setTimeout(() => hideProgress(), 3000);
      };
    }
    
    requestQueue.reset();
    showProgress('🔍 Analyzing Account...');
    
    try {
      // Fetch account info
      const accountInfo = await queuedRequest(() => fetchAccountInfo(address), 10);
      
      if (!accountInfo) {
        throw new Error('Could not fetch account info');
      }
      
      // Fetch transactions (limited to 100)
      const transactions = await fetchTransactionsQueued(address, 100);
      console.log(`📜 Found ${transactions.length} transactions`);
      
      // Forensic analysis
      const drainAnalysis = analyzeDrainingPatterns(transactions, address);
      const distributionAnalysis = analyzeTokenDistribution(transactions, address);
      
      // Display results
      displayForensicResults({
        address,
        accountInfo,
        transactions,
        drainAnalysis,
        distributionAnalysis
      });
      
    } catch (error) {
      console.error('Inspection error:', error);
      if (window.showNotification) {
        window.showNotification(`❌ ${error.message}`, 'error', 5000);
      }
      hideProgress();
    }
  }
  
  async function queuedRequest(requestFn, priority = 0) {
    if (!requestQueue) {
      return await requestFn();
    }
    return await requestQueue.enqueue(requestFn, priority, 3);
  }
  
  async function fetchAccountInfo(address) {
    return await queuedRequest(async () => {
      if (window.xrplRequest) {
        return await window.xrplRequest('account_info', { account: address });
      }
      
      const response = await fetch('https://xrplcluster.com/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'account_info',
          params: [{ account: address }]
        })
      });
      
      const data = await response.json();
      return data.result;
    }, 10);
  }
  
  async function fetchTransactionsQueued(address, limit = 100) {
    const transactions = [];
    let marker = null;
    let requestCount = 0;
    const maxRequests = Math.ceil(limit / 20);
    
    while (requestCount < maxRequests) {
      const result = await queuedRequest(async () => {
        const params = {
          account: address,
          limit: Math.min(20, limit - transactions.length)
        };
        
        if (marker) params.marker = marker;
        
        if (window.xrplRequest) {
          return await window.xrplRequest('account_tx', params);
        }
        
        const response = await fetch('https://xrplcluster.com/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            method: 'account_tx',
            params: [params]
          })
        });
        
        const data = await response.json();
        return data.result;
      }, 5);
      
      if (result && result.transactions) {
        transactions.push(...result.transactions);
        marker = result.marker;
        requestCount++;
        
        if (!marker || transactions.length >= limit) break;
      } else {
        break;
      }
    }
    
    return transactions;
  }

  // ============================================
  // FORENSIC ANALYSIS
  // ============================================
  
  function analyzeDrainingPatterns(transactions, address) {
    const analysis = {
      isDrained: false,
      drainEvents: [],
      suspiciousPatterns: [],
      fundFlow: { outgoing: [], destinations: {} },
      timeline: []
    };
    
    for (const tx of transactions) {
      const txData = tx.tx || tx;
      
      if (txData.TransactionType === 'Payment' && txData.Account === address) {
        const amount = parseAmount(txData.Amount);
        const destination = txData.Destination;
        
        analysis.fundFlow.outgoing.push({
          hash: txData.hash,
          destination,
          amount,
          timestamp: tx.date || txData.date,
          currency: amount.currency || 'XRP'
        });
        
        if (!analysis.fundFlow.destinations[destination]) {
          analysis.fundFlow.destinations[destination] = {
            address: destination,
            totalReceived: 0,
            count: 0,
            transactions: []
          };
        }
        
        analysis.fundFlow.destinations[destination].totalReceived += parseFloat(amount.value || amount);
        analysis.fundFlow.destinations[destination].count++;
        analysis.fundFlow.destinations[destination].transactions.push(txData.hash);
      }
    }
    
    // Detect draining
    const totalOut = analysis.fundFlow.outgoing.reduce((sum, tx) => 
      sum + parseFloat(tx.amount.value || tx.amount), 0);
    
    for (const [dest, data] of Object.entries(analysis.fundFlow.destinations)) {
      const percentage = (data.totalReceived / totalOut) * 100;
      
      if (percentage > 50) {
        analysis.suspiciousPatterns.push({
          type: 'major_drain',
          destination: dest,
          percentage: percentage.toFixed(2),
          amount: data.totalReceived,
          description: `${percentage.toFixed(1)}% of outgoing funds went to this address`
        });
        analysis.isDrained = true;
      }
    }
    
    // Detect rapid sequences
    const sortedTx = [...analysis.fundFlow.outgoing].sort((a, b) => a.timestamp - b.timestamp);
    
    for (let i = 1; i < sortedTx.length; i++) {
      const timeDiff = sortedTx[i].timestamp - sortedTx[i-1].timestamp;
      
      if (timeDiff < 10 && sortedTx[i].destination === sortedTx[i-1].destination) {
        analysis.suspiciousPatterns.push({
          type: 'rapid_sequence',
          transactions: [sortedTx[i-1].hash, sortedTx[i].hash],
          destination: sortedTx[i].destination,
          description: 'Multiple transactions to same address within 10 seconds'
        });
      }
    }
    
    return analysis;
  }
  
  function analyzeTokenDistribution(transactions, issuerAddress) {
    const analysis = {
      isIssuer: false,
      tokensIssued: {},
      distributionPaths: {},
      initialDistribution: [],
      currentHolders: {}
    };
    
    const trustLines = transactions.filter(tx => {
      const txData = tx.tx || tx;
      return txData.TransactionType === 'TrustSet' && txData.Account !== issuerAddress;
    });
    
    if (trustLines.length > 0) {
      analysis.isIssuer = true;
    }
    
    for (const tx of transactions) {
      const txData = tx.tx || tx;
      
      if (txData.TransactionType === 'Payment' && txData.Account === issuerAddress) {
        const amount = parseAmount(txData.Amount);
        
        if (amount.currency && amount.currency !== 'XRP') {
          const currency = amount.currency;
          
          if (!analysis.tokensIssued[currency]) {
            analysis.tokensIssued[currency] = {
              currency,
              totalIssued: 0,
              recipients: {},
              firstDistribution: tx.date || txData.date
            };
          }
          
          analysis.tokensIssued[currency].totalIssued += parseFloat(amount.value);
          
          const recipient = txData.Destination;
          if (!analysis.tokensIssued[currency].recipients[recipient]) {
            analysis.tokensIssued[currency].recipients[recipient] = {
              address: recipient,
              received: 0,
              count: 0
            };
          }
          
          analysis.tokensIssued[currency].recipients[recipient].received += parseFloat(amount.value);
          analysis.tokensIssued[currency].recipients[recipient].count++;
        }
      }
    }
    
    return analysis;
  }
  
  function displayForensicResults(results) {
    const { address, accountInfo, transactions, drainAnalysis, distributionAnalysis } = results;
    
    let html = `
      <div class="inspector-forensic-results" style="margin-top: 20px;">
        <h3>🔍 Forensic Analysis Results</h3>
        
        <div style="background: rgba(0,0,0,0.2); padding: 15px; border-radius: 8px; margin: 15px 0;">
          <h4>📊 Account Overview</h4>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin-top: 10px;">
            <div><span style="opacity: 0.8;">Address:</span><br/><code>${address}</code></div>
            <div><span style="opacity: 0.8;">Balance:</span><br/><strong>${accountInfo?.account_data?.Balance ? (accountInfo.account_data.Balance / 1000000).toFixed(2) : '—'} XRP</strong></div>
            <div><span style="opacity: 0.8;">Transactions:</span><br/><strong>${transactions.length}</strong></div>
          </div>
        </div>
    `;
    
    // Draining patterns
    if (drainAnalysis.isDrained || drainAnalysis.suspiciousPatterns.length > 0) {
      html += `
        <div style="background: rgba(255,68,68,0.2); border-left: 3px solid #ff4444; padding: 15px; border-radius: 8px; margin: 15px 0;">
          <h4>🚨 Draining Patterns Detected</h4>
      `;
      
      for (const pattern of drainAnalysis.suspiciousPatterns) {
        html += `
          <div style="margin: 10px 0; padding: 10px; background: rgba(0,0,0,0.3); border-radius: 4px;">
            <strong>${pattern.type.replace(/_/g, ' ').toUpperCase()}</strong><br/>
            <span>${pattern.description}</span><br/>
            ${pattern.destination ? `<code>→ ${pattern.destination}</code>` : ''}
          </div>
        `;
      }
      
      html += `</div>`;
    }
    
    // Top destinations
    if (Object.keys(drainAnalysis.fundFlow.destinations).length > 0) {
      const topDests = Object.entries(drainAnalysis.fundFlow.destinations)
        .sort((a, b) => b[1].totalReceived - a[1].totalReceived)
        .slice(0, 5);
      
      html += `
        <div style="background: rgba(0,0,0,0.2); padding: 15px; border-radius: 8px; margin: 15px 0;">
          <h4>💸 Top Fund Recipients</h4>
      `;
      
      for (const [dest, data] of topDests) {
        html += `
          <div style="display: flex; justify-content: space-between; padding: 8px; border-bottom: 1px solid rgba(255,255,255,0.1);">
            <code>${dest}</code>
            <strong>${data.totalReceived.toFixed(2)} XRP (${data.count} tx)</strong>
          </div>
        `;
      }
      
      html += `</div>`;
    }
    
    // Token distribution
    if (distributionAnalysis.isIssuer && Object.keys(distributionAnalysis.tokensIssued).length > 0) {
      html += `
        <div style="background: rgba(76,175,80,0.2); border-left: 3px solid #4CAF50; padding: 15px; border-radius: 8px; margin: 15px 0;">
          <h4>🪙 Token Issuer Analysis</h4>
      `;
      
      for (const [currency, data] of Object.entries(distributionAnalysis.tokensIssued)) {
        html += `
          <div style="margin: 10px 0; padding: 10px; background: rgba(0,0,0,0.3); border-radius: 4px;">
            <strong>Currency: ${currency}</strong><br/>
            <span>Issued: ${data.totalIssued.toFixed(2)}</span><br/>
            <span>Recipients: ${Object.keys(data.recipients).length}</span>
          </div>
        `;
      }
      
      html += `</div>`;
    }
    
    html += `</div>`;
    
    const inspectorSection = document.getElementById('inspector');
    if (inspectorSection) {
      const resultsContainer = inspectorSection.querySelector('#inspector-results') || 
                               document.createElement('div');
      resultsContainer.id = 'inspector-results';
      resultsContainer.innerHTML = html;
      
      if (!inspectorSection.contains(resultsContainer)) {
        inspectorSection.appendChild(resultsContainer);
      }
    }
    
    if (window.showNotification) {
      window.showNotification('✅ Analysis complete!', 'success', 3000);
    }
  }

  // ============================================
  // PATTERN DETECTION (ORIGINAL FUNCTIONS)
  // ============================================
  
  async function detectCircularPayments(traceData) {
    const findings = [];
    const { edges, origin } = traceData;
    
    const paymentEdges = edges.filter(e => e.type === 'Payment');
    if (paymentEdges.length === 0) return findings;

    const adj = new Map();
    paymentEdges.forEach(e => {
      if (!adj.has(e.from)) adj.set(e.from, []);
      adj.get(e.from).push(e);
    });

    const cycles = [];
    const visited = new Set();

    function dfs(start, current, path, depth) {
      if (depth > THRESHOLDS.CIRCULAR_FLOW_MAX_HOPS) return;
      if (path.length > 1 && current === start) {
        cycles.push([...path]);
        return;
      }
      if (visited.has(current) && current !== start) return;

      visited.add(current);
      const neighbors = adj.get(current) || [];
      
      for (const edge of neighbors) {
        dfs(start, edge.to, [...path, edge], depth + 1);
      }
      
      visited.delete(current);
    }

    const nodeDegrees = new Map();
    paymentEdges.forEach(e => {
      nodeDegrees.set(e.from, (nodeDegrees.get(e.from) || 0) + 1);
    });

    const startNodes = [origin, ...Array.from(nodeDegrees.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([addr]) => addr)];

    for (const start of startNodes) {
      visited.clear();
      dfs(start, start, [], 0);
    }

    for (const cycle of cycles) {
      if (cycle.length < 3) continue;

      const totalAmount = cycle.reduce((sum, e) => {
        if (e.currency === 'XRP') {
          return sum + (parseFloat(e.amount) || 0);
        }
        return sum;
      }, 0);

      const cycleAccounts = cycle.map(e => e.from);
      const uniqueAccounts = new Set(cycleAccounts);

      findings.push({
        type: 'CIRCULAR_PAYMENT_FLOW',
        severity: totalAmount > 1000 ? 'HIGH' : 'MEDIUM',
        confidence: uniqueAccounts.size >= 3 ? 0.85 : 0.65,
        assetType: 'Payment',
        description: `Circular payment flow: ${uniqueAccounts.size} accounts, ${totalAmount.toFixed(2)} XRP through ${cycle.length} hops. May indicate money laundering.`,
        recommendation: 'Investigate business relationships and verify legitimate reasons.',
        edges: cycle,
        metadata: {
          accounts: Array.from(uniqueAccounts),
          totalAmount,
          hopCount: cycle.length
        }
      });
    }

    return findings;
  }

  async function detectRapidPaymentBursts(traceData) {
    const findings = [];
    const { edges } = traceData;
    
    const paymentEdges = edges.filter(e => e.type === 'Payment' && e.ledger_index);
    if (paymentEdges.length < 5) return findings;

    const bySender = new Map();
    paymentEdges.forEach(e => {
      if (!bySender.has(e.from)) bySender.set(e.from, []);
      bySender.get(e.from).push(e);
    });

    for (const [sender, txs] of bySender) {
      if (txs.length < THRESHOLDS.HIGH_FREQUENCY_TRADES) continue;

      const sorted = txs.sort((a, b) => a.ledger_index - b.ledger_index);
      
      let burstStart = 0;
      for (let i = 0; i < sorted.length; i++) {
        const windowEnd = i;
        while (windowEnd < sorted.length - 1 && 
               sorted[windowEnd + 1].ledger_index - sorted[burstStart].ledger_index <= THRESHOLDS.RAPID_SUCCESSION_LEDGERS) {
          i++;
        }

        const burstSize = i - burstStart + 1;
        if (burstSize >= THRESHOLDS.HIGH_FREQUENCY_TRADES) {
          const burstTxs = sorted.slice(burstStart, i + 1);
          const totalAmount = burstTxs.reduce((sum, e) => {
            if (e.currency === 'XRP') {
              return sum + (parseFloat(e.amount) || 0);
            }
            return sum;
          }, 0);

          findings.push({
            type: 'RAPID_PAYMENT_BURST',
            severity: burstSize > 20 ? 'HIGH' : 'MEDIUM',
            confidence: 0.75,
            assetType: 'Payment',
            description: `${burstSize} payments from ${shortAddr(sender)} in ${sorted[i].ledger_index - sorted[burstStart].ledger_index} ledgers. Total: ${totalAmount.toFixed(2)} XRP. Bot activity or dumping.`,
            recommendation: 'Verify if legitimate trading or manipulation.',
            edges: burstTxs,
            metadata: { sender, burstSize, totalAmount }
          });
        }

        burstStart = i + 1;
      }
    }

    return findings;
  }

  async function detectNFTWashTrading(traceData) {
    const findings = [];
    const { edges } = traceData;
    
    const nftEdges = edges.filter(e => 
      e.type === 'NFTokenAcceptOffer' || 
      e.type === 'NFTokenCreateOffer'
    );

    if (nftEdges.length < THRESHOLDS.WASH_TRADE_MIN_OCCURRENCES) return findings;

    const byNFT = new Map();
    nftEdges.forEach(e => {
      const nftID = e.nftID || e.metadata?.nftID;
      if (!nftID) return;
      if (!byNFT.has(nftID)) byNFT.set(nftID, []);
      byNFT.get(nftID).push(e);
    });

    for (const [nftID, txs] of byNFT) {
      if (txs.length < THRESHOLDS.WASH_TRADE_MIN_OCCURRENCES) continue;

      const tradePairs = new Map();
      
      txs.forEach(e => {
        if (e.to) {
          const pair = [e.from, e.to].sort().join('|');
          tradePairs.set(pair, (tradePairs.get(pair) || 0) + 1);
        }
      });

      for (const [pair, count] of tradePairs) {
        if (count >= THRESHOLDS.WASH_TRADE_MIN_OCCURRENCES) {
          const [addr1, addr2] = pair.split('|');
          
          findings.push({
            type: 'NFT_WASH_TRADING',
            severity: 'HIGH',
            confidence: 0.9,
            assetType: 'NFT',
            description: `NFT wash trading: ${shortAddr(addr1)} and ${shortAddr(addr2)} traded ${nftID.slice(0, 16)}... back and forth ${count} times. Artificially inflates volume.`,
            recommendation: 'Flag accounts, exclude from volume calculations.',
            edges: txs.filter(e => 
              (e.from === addr1 && e.to === addr2) || 
              (e.from === addr2 && e.to === addr1)
            ),
            metadata: { nftID, accounts: [addr1, addr2], tradeCount: count }
          });
        }
      }
    }

    return findings;
  }

  async function detectNFTFloorManipulation(traceData) {
    const findings = [];
    const { edges } = traceData;
    
    const nftSales = edges.filter(e => 
      e.type === 'NFTokenAcceptOffer' && 
      e.currency === 'XRP' &&
      e.amount
    );

    if (nftSales.length < 5) return findings;

    const prices = nftSales.map(e => parseFloat(e.amount) || 0).filter(p => p > 0);
    if (prices.length < 5) return findings;

    prices.sort((a, b) => a - b);
    const median = prices[Math.floor(prices.length / 2)];

    const outliers = nftSales.filter(e => {
      const price = parseFloat(e.amount) || 0;
      return price > 0 && Math.abs(price - median) / median > THRESHOLDS.FLOOR_MANIPULATION_DEVIATION;
    });

    if (outliers.length >= 2) {
      const lowOutliers = outliers.filter(e => parseFloat(e.amount) < median);

      if (lowOutliers.length >= 2) {
        findings.push({
          type: 'NFT_FLOOR_MANIPULATION_LOW',
          severity: 'MEDIUM',
          confidence: 0.7,
          assetType: 'NFT',
          description: `${lowOutliers.length} NFT sales below median ${median.toFixed(2)} XRP. Potential floor manipulation.`,
          recommendation: 'Check if buyers/sellers are connected.',
          edges: lowOutliers,
          metadata: { medianPrice: median, outlierCount: lowOutliers.length }
        });
      }
    }

    return findings;
  }

  async function detectNFTFakeVolume(traceData) {
    const findings = [];
    const { edges } = traceData;
    
    const nftTrades = edges.filter(e => 
      e.type === 'NFTokenAcceptOffer' && 
      e.ledger_index
    );

    if (nftTrades.length < 10) return findings;

    const pairActivity = new Map();
    nftTrades.forEach(e => {
      const pair = [e.from, e.to].filter(Boolean).sort().join('|');
      if (!pairActivity.has(pair)) {
        pairActivity.set(pair, { trades: [], totalVolume: 0 });
      }
      const activity = pairActivity.get(pair);
      activity.trades.push(e);
      if (e.currency === 'XRP') {
        activity.totalVolume += parseFloat(e.amount) || 0;
      }
    });

    for (const [pair, activity] of pairActivity) {
      if (activity.trades.length < 5) continue;

      const [addr1, addr2] = pair.split('|');

      if (activity.trades.length >= 10 || activity.totalVolume > 1000) {
        findings.push({
          type: 'NFT_FAKE_VOLUME',
          severity: activity.trades.length > 20 ? 'HIGH' : 'MEDIUM',
          confidence: 0.8,
          assetType: 'NFT',
          description: `Suspicious NFT volume: ${shortAddr(addr1)} ↔ ${shortAddr(addr2)}: ${activity.trades.length} trades, ${activity.totalVolume.toFixed(2)} XRP.`,
          recommendation: 'Investigate relationship, flag if wash trading.',
          edges: activity.trades,
          metadata: { accounts: [addr1, addr2], tradeCount: activity.trades.length }
        });
      }
    }

    return findings;
  }

  async function detectAMMRugPulls(traceData) {
    const findings = [];
    const { edges } = traceData;
    
    const ammWithdraws = edges.filter(e => e.type === 'AMMWithdraw');
    const ammDeposits = edges.filter(e => e.type === 'AMMDeposit');

    if (ammWithdraws.length === 0) return findings;

    const pools = new Map();
    [...ammDeposits, ...ammWithdraws].forEach(e => {
      const poolID = e.ammID || e.metadata?.ammID;
      if (!poolID) return;
      if (!pools.has(poolID)) {
        pools.set(poolID, { deposits: [], withdrawals: [] });
      }
      const pool = pools.get(poolID);
      if (e.type === 'AMMDeposit') {
        pool.deposits.push(e);
      } else {
        pool.withdrawals.push(e);
      }
    });

    for (const [poolID, activity] of pools) {
      if (activity.withdrawals.length === 0) continue;

      const creators = new Set(activity.deposits.map(e => e.from));
      const creatorWithdrawals = activity.withdrawals.filter(e => creators.has(e.from));
      
      if (creatorWithdrawals.length > 0) {
        const totalDeposits = activity.deposits.length;
        const withdrawalRatio = creatorWithdrawals.length / (totalDeposits || 1);

        if (withdrawalRatio > THRESHOLDS.RUG_PULL_WITHDRAWAL_PERCENT) {
          const creator = creatorWithdrawals[0].from;
          
          findings.push({
            type: 'AMM_RUG_PULL',
            severity: 'HIGH',
            confidence: 0.85,
            assetType: 'AMM',
            description: `AMM rug pull: Pool creator ${shortAddr(creator)} withdrew after ${totalDeposits} deposits (${(withdrawalRatio * 100).toFixed(0)}%). Abandoning pool.`,
            recommendation: 'URGENT: Warn LPs.',
            edges: creatorWithdrawals,
            metadata: { poolID, creator, withdrawalRatio }
          });
        }
      }
    }

    return findings;
  }

  async function detectLiquidityDrains(traceData) {
    const findings = [];
    const { edges } = traceData;
    
    const ammWithdraws = edges.filter(e => 
      e.type === 'AMMWithdraw' && 
      e.ledger_index
    );

    if (ammWithdraws.length < 3) return findings;

    const poolWithdrawals = new Map();
    ammWithdraws.forEach(e => {
      const poolID = e.ammID || e.metadata?.ammID;
      if (!poolID) return;
      if (!poolWithdrawals.has(poolID)) poolWithdrawals.set(poolID, []);
      poolWithdrawals.get(poolID).push(e);
    });

    for (const [poolID, withdrawals] of poolWithdrawals) {
      if (withdrawals.length < 3) continue;

      const sorted = withdrawals.sort((a, b) => a.ledger_index - b.ledger_index);
      const ledgerSpan = sorted[sorted.length - 1].ledger_index - sorted[0].ledger_index;

      if (ledgerSpan < 100) {
        const withdrawers = new Set(withdrawals.map(e => e.from));
        
        findings.push({
          type: 'AMM_LIQUIDITY_DRAIN',
          severity: withdrawers.size === 1 ? 'HIGH' : 'MEDIUM',
          confidence: 0.75,
          assetType: 'AMM',
          description: `Rapid liquidity drain: ${withdrawals.length} withdrawals in ${ledgerSpan} ledgers. ${withdrawers.size === 1 ? 'Single account = coordinated attack' : 'Panic exit'}.`,
          recommendation: 'Check for trigger event or exploit.',
          edges: withdrawals,
          metadata: { poolID, withdrawalCount: withdrawals.length }
        });
      }
    }

    return findings;
  }

  async function detectDEXSandwichAttacks(traceData) {
    const findings = [];
    const { edges } = traceData;
    
    const offers = edges.filter(e => e.type === 'OfferCreate' && e.ledger_index);
    if (offers.length < 3) return findings;

    const sorted = offers.sort((a, b) => a.ledger_index - b.ledger_index);

    for (let i = 0; i < sorted.length - 2; i++) {
      const buy = sorted[i];
      const potential = sorted[i + 1];
      const sell = sorted[i + 2];

      const window = sell.ledger_index - buy.ledger_index;
      if (window > THRESHOLDS.SANDWICH_ATTACK_WINDOW) continue;

      if (buy.from === sell.from && potential.from !== buy.from) {
        findings.push({
          type: 'DEX_SANDWICH_ATTACK',
          severity: 'HIGH',
          confidence: 0.8,
          assetType: 'DEX',
          description: `Sandwich attack: ${shortAddr(buy.from)} surrounds ${shortAddr(potential.from)}'s trade. Front-running.`,
          recommendation: 'Consider MEV protections.',
          edges: [buy, potential, sell],
          metadata: { attacker: buy.from, victim: potential.from }
        });
      }
    }

    return findings;
  }

  async function detectDEXWashTrading(traceData) {
    const findings = [];
    const { edges } = traceData;
    
    const offers = edges.filter(e => e.type === 'OfferCreate');
    if (offers.length < 6) return findings;

    const pairTrades = new Map();
    offers.forEach(e => {
      const metadata = e.metadata || {};
      const pair = 'trading-pair'; // Simplified
      const key = `${e.from}|${pair}`;
      
      if (!pairTrades.has(key)) pairTrades.set(key, []);
      pairTrades.get(key).push(e);
    });

    for (const [key, trades] of pairTrades) {
      if (trades.length < 6) continue;

      const [account] = key.split('|');
      
      findings.push({
        type: 'DEX_WASH_TRADING',
        severity: trades.length > 15 ? 'HIGH' : 'MEDIUM',
        confidence: 0.75,
        assetType: 'DEX',
        description: `DEX wash trading: ${shortAddr(account)} placed ${trades.length} offers. Fake volume.`,
        recommendation: 'Check order book depth.',
        edges: trades,
        metadata: { account, offerCount: trades.length }
      });
    }

    return findings;
  }

  async function detectCrossPlatformManipulation(traceData) {
    const findings = [];
    const { edges } = traceData;

    const accountActivity = new Map();
    
    edges.forEach(e => {
      if (!accountActivity.has(e.from)) {
        accountActivity.set(e.from, { payment: 0, nft: 0, amm: 0, dex: 0 });
      }
      const activity = accountActivity.get(e.from);
      
      if (e.type === 'Payment') activity.payment++;
      else if (e.type.startsWith('NFToken')) activity.nft++;
      else if (e.type.startsWith('AMM')) activity.amm++;
      else if (e.type.startsWith('Offer')) activity.dex++;
    });

    for (const [account, activity] of accountActivity) {
      const activeTypes = Object.values(activity).filter(v => v > 0).length;
      const totalActivity = Object.values(activity).reduce((a, b) => a + b, 0);

      if (activeTypes >= 3 && totalActivity >= 15) {
        findings.push({
          type: 'CROSS_PLATFORM_MANIPULATION',
          severity: 'MEDIUM',
          confidence: 0.6,
          assetType: 'Multi-Asset',
          description: `Cross-platform activity: ${shortAddr(account)} active in ${activeTypes} asset types. Sophisticated manipulation possible.`,
          recommendation: 'Profile for legitimacy vs manipulation.',
          edges: edges.filter(e => e.from === account),
          metadata: { account, activity }
        });
      }
    }

    return findings;
  }

  // ============================================
  // MAIN ANALYSIS FUNCTION
  // ============================================
  
  async function analyze(traceData) {
    if (!traceData || !traceData.edges || traceData.edges.length === 0) {
      return [];
    }

    const findings = [];

    findings.push(...await detectCircularPayments(traceData));
    findings.push(...await detectRapidPaymentBursts(traceData));
    findings.push(...await detectNFTWashTrading(traceData));
    findings.push(...await detectNFTFloorManipulation(traceData));
    findings.push(...await detectNFTFakeVolume(traceData));
    findings.push(...await detectAMMRugPulls(traceData));
    findings.push(...await detectLiquidityDrains(traceData));
    findings.push(...await detectDEXSandwichAttacks(traceData));
    findings.push(...await detectDEXWashTrading(traceData));
    findings.push(...await detectCrossPlatformManipulation(traceData));

    return findings;
  }

  function generateReport(findings) {
    const summary = {
      total: findings.length,
      high: findings.filter(f => f.severity === 'HIGH').length,
      medium: findings.filter(f => f.severity === 'MEDIUM').length,
      low: findings.filter(f => f.severity === 'LOW').length,
      byType: {}
    };

    findings.forEach(f => {
      summary.byType[f.type] = (summary.byType[f.type] || 0) + 1;
    });

    return {
      version: VERSION,
      timestamp: new Date().toISOString(),
      summary,
      findings
    };
  }

  // ============================================
  // INITIALIZATION
  // ============================================
  
  function initializeEnhancements() {
    initializeProgressUI();
    
    // Override quickInspectAddress if it exists
    if (window.quickInspectAddress) {
      window.originalQuickInspectAddress = window.quickInspectAddress;
    }
    
    window.quickInspectAddress = enhancedQuickInspect;
    
    console.log('✅ Enhanced Pattern Detector initialized with forensic capabilities');
  }
  
  // Auto-initialize
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeEnhancements);
  } else {
    initializeEnhancements();
  }

  // ============================================
  // PUBLIC API
  // ============================================
  
  window.EnhancedPatternDetector = {
    version: VERSION,
    analyze,
    generateReport,
    thresholds: THRESHOLDS,
    enhancedQuickInspect,
    RequestQueueManager
  };

  console.log(`✅ ${VERSION} loaded - Multi-Asset Pattern Detection + Forensics Ready`);
})();