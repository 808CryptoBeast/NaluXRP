# 🏗️ NaluXRP Architecture - Deep Flow Analysis System

## Overview

NaluXRP is architected to go beyond surface-level blockchain exploration. This document explains how we achieve deep flow analysis, pattern detection, and rhythm understanding of the XRP Ledger.

---

## Core Architectural Principles

### 1. **Stream-First, Not Poll-Based**

Unlike typical explorers that poll for data periodically, NaluXRP maintains persistent WebSocket connections to XRPL nodes and processes the **raw transaction stream** in real-time.

```
Traditional Explorer:
[Poll] → [Get Data] → [Display] → [Wait] → [Repeat]

NaluXRP:
[Stream Connected] → [Continuous Transaction Flow] → [Real-time Analysis] → [Pattern Detection]
```

### 2. **Multi-Layer Analytics Pipeline**

```
┌─────────────────────────────────────────────────────────────┐
│                    Raw XRPL Stream                          │
│          (Transactions, Ledgers, Validations)               │
└────────────────────┬────────────────────────────────────────┘
                     │
         ┌───────────▼───────────┐
         │   Normalization       │
         │   - Clean data        │
         │   - Extract metadata  │
         └───────────┬───────────┘
                     │
         ┌───────────▼───────────┐
         │   Temporal Window     │
         │   - Buffering         │
         │   - Time-series       │
         └───────────┬───────────┘
                     │
         ┌───────────▼───────────┐
         │   Pattern Detection   │
         │   - Burst analysis    │
         │   - Clustering        │
         │   - Correlation       │
         └───────────┬───────────┘
                     │
         ┌───────────▼───────────┐
         │   Visualization       │
         │   - Charts            │
         │   - Graphs            │
         │   - Metrics           │
         └───────────────────────┘
```

### 3. **Graph-Based Relationship Modeling**

Accounts, transactions, and trust lines form a dynamic **directed graph**:

- **Nodes**: Accounts, Tokens, AMM Pools
- **Edges**: Transactions, Trust Lines, Payment Paths
- **Weights**: Volume, frequency, time

This enables:
- Fund tracing through multiple hops
- Cluster detection (related accounts)
- Flow analysis (where value goes)
- Issuer tree visualization

---

## Component Architecture

### XRPL Connection Module (`xrpl-connection.js`)

**Purpose**: Maintain persistent, resilient connection to XRPL with raw transaction streaming

```javascript
Features:
- Multi-server failover
- Automatic reconnection with exponential backoff
- Raw transaction stream subscription
- Ledger-by-ledger tracking
- Validation event monitoring
```

**Key Innovation**: Instead of just tracking counts, we store **the last N transactions** (default 800) in a sliding window, enabling:
- Pattern analysis on recent activity
- Burst detection
- Flow analysis
- Temporal correlation

```javascript
window.XRPL.state = {
  recentTransactions: [],   // Last 800 raw transactions
  recentLedgers: [],        // Last 60 ledger summaries
  transactionTypes: {},     // Distribution tracking
  // ...
}
```

### Deep Analytics Engine (`analytics.js`)

**Purpose**: Extract patterns from transaction streams that basic explorers miss

#### Anomaly Detection

```javascript
Detects:
- Sudden TPS spikes (burst activity)
- Unusual fee patterns (network stress)
- Transaction type distribution changes
- Ledger close time variance
```

**Algorithm**: Statistical z-score analysis on sliding windows

```javascript
For each metric:
  1. Calculate mean and std dev over history
  2. Compare current value to distribution
  3. Flag if |z-score| > threshold (typically 2.5σ)
```

#### Correlation Analysis

**Reveals hidden relationships** between metrics:

```javascript
Examples:
- Do higher fees correlate with longer close times?
- Do validator counts affect TPS?
- Do transaction bursts precede fee spikes?
```

**Algorithm**: Pearson correlation on time-series data

```javascript
r = (n·Σxy - Σx·Σy) / √[(n·Σx² - (Σx)²)(n·Σy² - (Σy)²)]

Interpretation:
  r > +0.7  : Strong positive correlation
  r < -0.7  : Strong negative correlation
  |r| < 0.3 : Weak/no correlation
```

#### Burst Detection

**Identifies transaction clustering in time**

```javascript
Algorithm:
1. Divide time into windows (e.g., 10-second buckets)
2. Count transactions per window
3. Identify windows exceeding threshold (mean + 2σ)
4. Group adjacent burst windows
5. Characterize burst (duration, intensity, types)
```

### Unified Inspector (`js/inspector-trace-tab.js`)

**Purpose**: Deep account analysis beyond balance checking

#### Issuer Tree Building

**Maps trust networks** starting from an issuer/gateway:

```
Algorithm (BFS with constraints):
1. Start with root account
2. Query account_lines (trust lines)
3. For each holder:
   a. Add as node in graph
   b. Create edge (issuer → holder) with balance
   c. Query their transactions (limited)
   d. Find activation transaction
   e. Add to queue for next depth level
4. Repeat until max depth or account limit
```

**What this reveals**:
- Who trusts whom
- Token distribution concentration
- Account relationship networks
- Creation chains (who activated whom)

#### Fund Tracing

**Follows payment chains across multiple hops**:

```
Algorithm (BFS on payment graph):
1. Start with source account + time range
2. Query account_tx for Payments
3. For each payment:
   a. Identify destination
   b. Add to graph: source → destination (amount, tx hash, time)
   c. If destination not visited, add to queue
4. Repeat for next hop until max depth
5. Export complete payment graph
```

**Use cases**:
- Forensic analysis
- Flow tracing
- Multi-hop path analysis
- Liquidity routing study

#### Token/IOU Analysis

**Reveals issuance vs. holding patterns**:

```javascript
For an issuer account:
1. Query account_lines
2. For each trust line:
   - If balance < 0 → issued tokens (owed by issuer)
   - If balance > 0 → received tokens (not typical for issuers)
3. Aggregate:
   - Total issued per currency
   - Number of holders
   - Distribution statistics
```

---

## Flow Analysis Methodology

### Understanding "Flow" vs. "Activity"

**Activity** (what basic explorers show):
- Transaction count
- Account balance
- Payment amount

**Flow** (what NaluXRP reveals):
- Transaction *chains* (multi-hop paths)
- Payment *velocity* (how fast value moves)
- Settlement *timing* (consensus → execution)
- Network *pulse* (rhythmic patterns)

### Temporal Flow Windows

We track metrics in **multiple time scales**:

```
┌─────────────────────────────────────────────┐
│  Real-time (per-transaction)                │
│  - Each transaction as it arrives           │
│  - No aggregation                           │
└─────────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────────┐
│  Short-term (3-5 seconds, per-ledger)       │
│  - Transactions per ledger                  │
│  - Ledger close time                        │
│  - Fee distribution                         │
└─────────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────────┐
│  Medium-term (1-5 minutes, windowed)        │
│  - TPS trends                               │
│  - Burst detection                          │
│  - Pattern emergence                        │
└─────────────────────────────────────────────┘
         ↓
┌───────────────────��─────────────────────────┐
│  Long-term (hours/days, historical)         │
│  - Network health trends                    │
│  - Behavioral patterns                      │
│  - Correlation analysis                     │
└─────────────────────────────────────────────┘
```

### Settlement Choreography Tracking

**Consensus → Execution Flow**:

```
1. Transaction Submitted
   ↓
2. Enters Transaction Queue
   ↓ (track: queue time)
3. Validators Propose Transaction Set
   ↓ (track: consensus timing)
4. Validators Reach Agreement
   ↓ (track: agreement count)
5. Ledger Closes
   ↓ (track: close time, variance)
6. Transaction Executes
   ↓ (track: execution result)
7. State Updated
   ↓ (track: cascade effects)
8. Confirmation Propagates
   (track: propagation delay)
```

**What we measure**:
- **Queue Depth**: How many transactions waiting
- **Close Time**: How long between ledgers (target ~3-5s)
- **Close Time Variance**: Stability indicator
- **Transaction Distribution**: What types are settling
- **Fee Market**: Competition for inclusion

---

## Performance Optimizations

### 1. **Sliding Windows** (Not Full History)

```javascript
// Instead of storing everything:
history.push(transaction);

// We maintain fixed-size windows:
if (window.length >= MAX_SIZE) {
  window.shift(); // Remove oldest
}
window.push(transaction);
```

### 2. **Lazy Evaluation**

```javascript
// Expensive analytics only run when:
// - User views analytics page
// - Sufficient new data accumulated
// - Minimum time interval passed

if (needsUpdate && timeSinceLastUpdate > THRESHOLD) {
  performExpensiveAnalysis();
}
```

### 3. **Web Workers** (Planned)

Move heavy computation off main thread:

```
Main Thread (UI)  ←→  Web Worker (Analytics)
```

### 4. **Caching**

```javascript
// Cache expensive API calls:
- Validator lists (refreshed hourly)
- Token metadata (refreshed daily)
- Account activation (permanent once found)
- Trust line snapshots (refreshed on demand)
```

---

## Data Structures

### Transaction Graph

```javascript
{
  nodes: Map<address, {
    type: 'account' | 'issuer' | 'amm',
    metadata: { balance, created, ... },
    inbound: Set<edgeId>,
    outbound: Set<edgeId>
  }>,
  
  edges: Map<edgeId, {
    from: address,
    to: address,
    type: 'payment' | 'trustline' | 'offer',
    weight: number (amount or frequency),
    metadata: { tx hash, time, ... }
  }>
}
```

### Time-Series Buffer

```javascript
{
  timestamps: RingBuffer<number>,
  values: RingBuffer<number>,
  metadata: RingBuffer<any>
}
```

### Pattern Registry

```javascript
{
  anomalies: [{
    type: 'burst' | 'spike' | 'drop',
    metric: 'tps' | 'fee' | 'closeTime',
    timestamp: number,
    magnitude: number,
    context: { ... }
  }],
  
  correlations: [{
    metrics: [string, string],
    coefficient: number,
    significance: number,
    window: [start, end]
  }]
}
```

---

## API Architecture

### Public API Surface

```javascript
// XRPL Connection
window.XRPL.client           // xrpl.js Client instance
window.XRPL.connected        // boolean
window.XRPL.state            // Current metrics
window.requestXrpl(payload)  // Generic RPC request

// Inspector
window.UnifiedInspector.quickInspect(address)
window.UnifiedInspector.buildIssuerTree(issuer, options)
window.UnifiedInspector.traceFunds(account, options)
window.UnifiedInspector.getTokenSummary(issuer)

// Analytics
window.DeepAnalytics.getPatterns()
window.DeepAnalytics.getAnomalies()
window.DeepAnalytics.getCorrelations()

// UI
window.UI.switchPage(pageId)
window.UI.currentTheme
```

---

## Security Considerations

### 1. **No Private Key Storage**

```javascript
// Seeds/private keys are:
- Memory-only by default
- Optional encrypted vault (AES-GCM + PBKDF2)
- User passphrase never stored
- Sensitive UI cleared on lock/unload
```

### 2. **CORS & Proxy**

```javascript
// Optional proxy server for:
- Token API access (CORS bypass)
- Validator data aggregation
- Rate limiting protection

// All sensitive operations remain client-side
```

### 3. **Input Validation**

```javascript
// All user inputs validated:
- XRP addresses (regex + checksum)
- Transaction hashes (format + length)
- Amounts (range + precision)
```

---

## Extensibility

### Adding New Analytics

```javascript
// 1. Hook into transaction stream:
window.addEventListener('xrpl:ledger', (event) => {
  const { transactions, ledgerIndex } = event.detail;
  // Your analysis here
});

// 2. Or implement in analytics.js:
function analyzeNewPattern(txWindow) {
  // Extract features
  // Detect patterns
  // Return findings
}
```

### Adding New Visualizations

```javascript
// 1. Create chart component
// 2. Register data source
// 3. Add to page layout
// 4. Wire up real-time updates
```

---

## Future Architecture Enhancements

### 1. **Machine Learning Integration**

```javascript
// Train models on historical patterns:
- Anomaly detection (autoencoder)
- Burst prediction (LSTM)
- Flow forecasting (time-series models)
```

### 2. **Distributed Processing**

```javascript
// Multiple browser tabs cooperate:
- Share XRPL connection
- Distribute analytics workload
- Sync state via BroadcastChannel
```

### 3. **Historical Data Layer**

```javascript
// Optional backend for:
- Long-term pattern storage
- Historical query API
- Aggregated statistics
```

---

## Conclusion

NaluXRP's architecture is designed from the ground up for **deep flow analysis**, not just superficial monitoring. By combining:

- **Real-time streaming** (not polling)
- **Graph-based modeling** (relationships, not just balances)
- **Pattern detection** (intelligence, not just display)
- **Multi-scale temporal analysis** (rhythm, not just snapshots)

...we reveal the XRP Ledger's inner workings in ways traditional explorers cannot.

**The ledger isn't just a database. It's a living system with rhythms, patterns, and flows. NaluXRP makes them visible.**

---

*For more details, see:*
- *[Ledger Flow Dynamics](LEDGER_FLOW.md)*
- *[Analytics Guide](ANALYTICS_GUIDE.md)*
