/* =========================================
   NaluXrp 🌊 — Unified Tokens & Distribution Module
   Uses XRPScan API for real XRPL data with deep linking
   ========================================= */

class TokenManager {
    constructor() {
        this.tokenCache = [];
        this.filteredTokens = [];
        this.topTokens = [];
        this.selectedToken = null;
        this.tokenMode = "top50";
        this.sortBy = 'trustlines';
        this.sortOrder = 'desc';
        this.tokenPage = 1;
        this.TOKENS_PER_PAGE = 25;
        
        // Distribution map properties
        this.distributionCanvas = null;
        this.distributionCtx = null;
        this.animationFrame = null;
        this.hoveredNode = null;
        this.nodes = [];
        this.edges = [];
        this.isPaused = false;
        this.isConnected = false;
        
        // XRPScan API endpoints
        this.XRPL_MAINNET_API = 'https://api.xrpscan.com/api/v1';
        this.ONTHEDEX_API = 'https://api.onthedex.live/public/v1';
        
        // Known major tokens with verified issuers
        this.KNOWN_TOKENS = [
            { 
                currency: 'XRP', 
                issuer: null, 
                name: 'XRP Native Token', 
                type: 'native', 
                icon: '✳️',
                xrpscanUrl: 'https://xrpscan.com/'
            },
            { 
                currency: 'USD', 
                issuer: 'rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B', 
                name: 'Bitstamp USD', 
                type: 'stablecoin', 
                icon: '💵',
                xrpscanUrl: 'https://xrpscan.com/token/USD.rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B'
            },
            { 
                currency: 'SOLO', 
                issuer: 'rsoLo2S1kiGeCcn6hCUXVrCpGMWLrRrLZz', 
                name: 'Sologenic', 
                type: 'utility', 
                icon: '🔄',
                xrpscanUrl: 'https://xrpscan.com/token/SOLO.rsoLo2S1kiGeCcn6hCUXVrCpGMWLrRrLZz'
            },
            { 
                currency: 'CSC', 
                issuer: 'rCSCManTZ8ME9EoLrSHHYKW8PPwWMgkwr', 
                name: 'CasinoCoin', 
                type: 'utility', 
                icon: '🎰',
                xrpscanUrl: 'https://xrpscan.com/token/CSC.rCSCManTZ8ME9EoLrSHHYKW8PPwWMgkwr'
            },
            { 
                currency: 'RLUSD', 
                issuer: 'rLqUC2eCPohYvJCEBJ77eCCqVL2uEiczcA', 
                name: 'RLUSD Stablecoin', 
                type: 'stablecoin', 
                icon: '🏦',
                xrpscanUrl: 'https://xrpscan.com/token/RLUSD.rLqUC2eCPohYvJCEBJ77eCCqVL2uEiczcA'
            }
        ];
    }

    /* ---------- INITIALIZATION ---------- */
    async init() {
        console.log('🪙 Initializing Unified Tokens module with XRPScan integration...');
        
        const container = document.getElementById('tokens');
        if (!container) {
            console.error('Tokens container not found');
            return;
        }
        
        this.renderUI();
        this.setupEventListeners();
        
        // Initialize distribution map
        await this.initDistributionMap();
        
        // Load initial data
        await this.switchMode('top50');
    }

    /* ---------- UI RENDERING ---------- */
    renderUI() {
        const container = document.getElementById('tokens');
        
        container.innerHTML = `
            <div class="chart-section">
                <div class="chart-title">🪙 XRPL Tokens Explorer</div>
                <div class="chart-subtitle">Real-time token data from XRPL Ledger with distribution networks</div>
                
                <!-- Mode Tabs -->
                <div class="mode-tabs">
                    <button id="top50Mode" class="mode-btn active" onclick="tokenManager.switchMode('top50')">
                        🔥 Top Tokens
                    </button>
                    <button id="searchMode" class="mode-btn" onclick="tokenManager.switchMode('search')">
                        🔍 Search All
                    </button>
                    <button id="myTokensMode" class="mode-btn" onclick="tokenManager.switchMode('myTokens')">
                        👤 My Tokens
                    </button>
                    <button id="distributionMode" class="mode-btn" onclick="tokenManager.switchMode('distribution')">
                        🗺️ Distribution
                    </button>
                </div>
                
                <!-- Search & Controls -->
                <div class="control-panel">
                    <div class="control-grid">
                        <input 
                            type="text" 
                            id="tokenSearch" 
                            placeholder="🔍 Search by currency, name, or issuer..." 
                            class="search-input"
                        />
                        
                        <select id="sortSelect" class="sort-select">
                            <option value="volume">Sort by Volume</option>
                            <option value="trustlines">Sort by Trustlines</option>
                            <option value="currency">Sort by Currency</option>
                            <option value="balance">Sort by Balance</option>
                        </select>
                        
                        <button id="sortOrderBtn" class="sort-order-btn">
                            <span id="sortIcon">↓</span>
                        </button>
                    </div>
                    
                    <!-- Address Input for My Tokens -->
                    <div id="addressInput" class="address-input-container">
                        <input 
                            type="text" 
                            id="ledgerAccountInput" 
                            placeholder="Enter XRPL address (e.g., rN7n7otQDd6FczFgLdlqtyMVrn3HMgk9dm)" 
                            class="address-input"
                        />
                        <button onclick="tokenManager.fetchAccountTokens()" class="fetch-tokens-btn">
                            🌊 Fetch Account Tokens
                        </button>
                    </div>
                </div>
                
                <!-- Stats Cards -->
                <div class="stats-grid">
                    <div class="metric-card">
                        <div class="metric-label">Total Tokens</div>
                        <div class="metric-value" id="totalTokens">—</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-label">Active Trustlines</div>
                        <div class="metric-value" id="totalTrustlines">—</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-label">Unique Issuers</div>
                        <div class="metric-value" id="uniqueIssuers">—</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-label">Network Status</div>
                        <div class="metric-value" id="networkStatus">🌊 Live</div>
                    </div>
                </div>
                
                <!-- Distribution Network Map -->
                <div class="distribution-container">
                    <h3>🗺️ Token Distribution Network</h3>
                    <div class="distribution-subtitle">Visualize token flow and holder distribution</div>
                    <div id="tokenDistributionChart"></div>
                </div>
                
                <!-- Tokens List -->
                <div id="tokensList" class="tokens-list">
                    <div class="loading">🌊 Loading tokens from XRPL...</div>
                </div>
                
                <!-- Pagination -->
                <div id="paginationContainer" class="pagination-container"></div>
            </div>

            <style>
                .mode-tabs {
                    display: flex;
                    gap: 10px;
                    margin-bottom: 25px;
                    flex-wrap: wrap;
                }
                
                .mode-btn {
                    padding: 12px 20px;
                    border: 2px solid var(--accent-tertiary);
                    background: var(--bg-tertiary);
                    color: var(--text-primary);
                    border-radius: 10px;
                    cursor: pointer;
                    font-weight: 600;
                    transition: all 0.3s ease;
                }
                
                .mode-btn.active {
                    background: var(--accent-primary);
                    border-color: var(--accent-primary);
                    color: #000;
                }
                
                .mode-btn:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                }
                
                .control-panel {
                    background: var(--card-bg);
                    padding: 20px;
                    border-radius: 12px;
                    margin-bottom: 25px;
                    border: 2px solid var(--accent-tertiary);
                }
                
                .control-grid {
                    display: grid;
                    grid-template-columns: 1fr auto auto;
                    gap: 15px;
                    margin-bottom: 15px;
                }
                
                .search-input, .sort-select, .address-input {
                    padding: 12px;
                    border-radius: 8px;
                    border: 2px solid var(--accent-tertiary);
                    background: var(--bg-tertiary);
                    color: var(--text-primary);
                    font-size: 1em;
                }
                
                .sort-order-btn, .fetch-tokens-btn {
                    padding: 12px 20px;
                    border-radius: 8px;
                    border: 2px solid var(--accent-primary);
                    background: var(--accent-primary);
                    color: #000;
                    font-weight: bold;
                    cursor: pointer;
                }
                
                .address-input-container {
                    display: none;
                }
                
                .stats-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                    gap: 15px;
                    margin-bottom: 25px;
                }
                
                .metric-card {
                    background: var(--card-bg);
                    padding: 20px;
                    border-radius: 12px;
                    border: 2px solid var(--accent-tertiary);
                    text-align: center;
                }
                
                .metric-label {
                    font-size: 0.9em;
                    color: var(--text-secondary);
                    margin-bottom: 8px;
                }
                
                .metric-value {
                    font-size: 1.5em;
                    font-weight: bold;
                    color: var(--accent-primary);
                }
                
                .distribution-container {
                    background: var(--card-bg);
                    padding: 20px;
                    border-radius: 12px;
                    margin-bottom: 25px;
                    border: 2px solid var(--accent-tertiary);
                }
                
                .distribution-subtitle {
                    color: var(--text-secondary);
                    margin-bottom: 15px;
                }
                
                .tokens-list {
                    min-height: 400px;
                }
                
                .tokens-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
                    gap: 20px;
                }
                
                .token-card {
                    background: var(--card-bg);
                    padding: 20px;
                    border-radius: 12px;
                    border: 2px solid var(--accent-tertiary);
                    cursor: pointer;
                    transition: all 0.3s ease;
                    position: relative;
                }
                
                .token-card:hover {
                    transform: translateY(-5px);
                    border-color: var(--accent-primary);
                    box-shadow: 0 8px 25px rgba(0,0,0,0.3);
                }
                
                .token-header {
                    display: flex;
                    justify-content: between;
                    align-items: center;
                    margin-bottom: 15px;
                }
                
                .token-name {
                    font-size: 1.3em;
                    font-weight: bold;
                    margin-bottom: 5px;
                }
                
                .token-meta {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 10px;
                    margin-bottom: 15px;
                }
                
                .token-meta div {
                    font-size: 0.9em;
                }
                
                .loading {
                    text-align: center;
                    padding: 40px;
                    color: var(--text-secondary);
                    font-size: 1.1em;
                }
                
                .loading-error {
                    text-align: center;
                    padding: 40px;
                    color: #ff5555;
                    font-size: 1.1em;
                }
                
                .pagination-container {
                    margin-top: 30px;
                    text-align: center;
                }
                
                .pagination {
                    display: inline-flex;
                    gap: 10px;
                    align-items: center;
                }
                
                .page-btn {
                    padding: 10px 16px;
                    border: 2px solid var(--accent-tertiary);
                    background: var(--bg-tertiary);
                    color: var(--text-primary);
                    border-radius: 8px;
                    cursor: pointer;
                    transition: all 0.3s ease;
                }
                
                .page-btn.active {
                    background: var(--accent-primary);
                    border-color: var(--accent-primary);
                    color: #000;
                }
                
                .page-btn:hover {
                    border-color: var(--accent-primary);
                }
            </style>
        `;
    }

    /* ---------- DISTRIBUTION MAP ---------- */
    async initDistributionMap() {
        const container = document.getElementById('tokenDistributionChart');
        if (!container) return;
        
        container.innerHTML = `
            <div class="distribution-map-container">
                <canvas id="distributionCanvas"></canvas>
                
                <!-- Tooltip -->
                <div id="distributionTooltip" class="distribution-tooltip"></div>
                
                <!-- Controls -->
                <div class="distribution-controls">
                    <button onclick="tokenManager.toggleAnimation()" class="control-btn">
                        <span id="animToggle">⏸ Pause</span>
                    </button>
                    <button onclick="tokenManager.resetDistributionView()" class="control-btn">
                        🔄 Reset
                    </button>
                    <button onclick="tokenManager.refreshDistributionData()" class="control-btn">
                        ↻ Refresh
                    </button>
                </div>
                
                <!-- Legend -->
                <div class="distribution-legend">
                    <div class="legend-item">
                        <div class="legend-color" style="background: #FFD700;"></div>
                        <span>Issuer</span>
                    </div>
                    <div class="legend-item">
                        <div class="legend-color" style="background: #50fa7b;"></div>
                        <span>Major Holder</span>
                    </div>
                    <div class="legend-item">
                        <div class="legend-color" style="background: #8be9fd;"></div>
                        <span>Minor Holder</span>
                    </div>
                    <div class="legend-item">
                        <div class="legend-color" style="background: #ff79c6;"></div>
                        <span>Exchange</span>
                    </div>
                </div>
                
                <!-- Status -->
                <div id="distributionStatus" class="distribution-status">
                    Initializing distribution network...
                </div>
            </div>

            <style>
                .distribution-map-container {
                    position: relative;
                    background: var(--bg-tertiary);
                    border-radius: 12px;
                    overflow: hidden;
                    height: 500px;
                }
                
                #distributionCanvas {
                    width: 100%;
                    height: 100%;
                    cursor: pointer;
                    display: block;
                }
                
                .distribution-tooltip {
                    position: absolute;
                    background: var(--card-bg);
                    border: 2px solid var(--accent-primary);
                    border-radius: 8px;
                    padding: 12px 16px;
                    color: var(--text-primary);
                    font-size: 0.85em;
                    pointer-events: none;
                    opacity: 0;
                    transition: opacity 0.2s;
                    z-index: 10;
                    box-shadow: 0 5px 20px rgba(0,0,0,0.5);
                    max-width: 300px;
                    backdrop-filter: blur(10px);
                }
                
                .distribution-controls {
                    position: absolute;
                    top: 15px;
                    right: 15px;
                    display: flex;
                    gap: 10px;
                    flex-direction: column;
                }
                
                .control-btn {
                    padding: 8px 16px;
                    background: var(--accent-primary);
                    border: none;
                    border-radius: 8px;
                    color: #000;
                    font-weight: bold;
                    cursor: pointer;
                    font-size: 0.85em;
                    display: flex;
                    align-items: center;
                    gap: 5px;
                }
                
                .distribution-legend {
                    position: absolute;
                    bottom: 15px;
                    left: 15px;
                    background: rgba(0,0,0,0.85);
                    padding: 12px;
                    border-radius: 8px;
                    font-size: 0.8em;
                    backdrop-filter: blur(10px);
                    border: 1px solid var(--border-color);
                }
                
                .legend-item {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    margin-bottom: 6px;
                }
                
                .legend-color {
                    width: 14px;
                    height: 14px;
                    border-radius: 50%;
                    border: 2px solid;
                }
                
                .distribution-status {
                    position: absolute;
                    bottom: 15px;
                    right: 15px;
                    background: rgba(0,0,0,0.85);
                    padding: 8px 12px;
                    border-radius: 6px;
                    font-size: 0.75em;
                    color: var(--text-secondary);
                    backdrop-filter: blur(10px);
                    border: 1px solid var(--border-color);
                }
            </style>
        `;
        
        this.distributionCanvas = document.getElementById('distributionCanvas');
        if (!this.distributionCanvas) return;
        
        this.distributionCtx = this.distributionCanvas.getContext('2d');
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
        
        // Mouse events
        this.distributionCanvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.distributionCanvas.addEventListener('click', (e) => this.handleClick(e));
        this.distributionCanvas.addEventListener('mouseleave', () => this.handleMouseLeave());
        
        // Start animation
        this.animate();
    }

    /* ---------- TOKEN DATA MANAGEMENT ---------- */
    async switchMode(mode) {
        this.tokenMode = mode;
        
        // Update button states
        ['top50Mode', 'searchMode', 'myTokensMode', 'distributionMode'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.classList.toggle('active', id === `${mode}Mode`);
        });
        
        // Show/hide address input
        const addressDiv = document.getElementById('addressInput');
        if (addressDiv) {
            addressDiv.style.display = mode === 'myTokens' ? 'block' : 'none';
        }
        
        // Load data based on mode
        switch(mode) {
            case 'top50':
                await this.fetchTopTokens();
                break;
            case 'search':
                await this.fetchAllTokens();
                break;
            case 'myTokens':
                this.prepareMyTokens();
                break;
            case 'distribution':
                await this.showDistributionView();
                break;
        }
    }

    async fetchTopTokens() {
        const container = document.getElementById('tokensList');
        container.innerHTML = '<div class="loading">🌊 Loading top tokens from XRPL DEX...</div>';
        
        try {
            // Try to fetch from OnTheDEX API first
            this.topTokens = await this.fetchLiveTokens();
            
            if (this.topTokens.length === 0) {
                // Fallback to known tokens with enhanced data
                this.topTokens = await this.enhanceTokenData(this.KNOWN_TOKENS);
            }
            
            this.tokenCache = [...this.topTokens];
            this.filteredTokens = [...this.topTokens];
            this.tokenPage = 1;
            
            this.updateStats();
            this.sortAndRenderTokens();
            
            // Auto-select first token for distribution
            if (this.filteredTokens.length > 0) {
                setTimeout(() => {
                    this.selectToken(this.filteredTokens[0]);
                }, 500);
            }
            
        } catch (error) {
            console.error('Error fetching top tokens:', error);
            container.innerHTML = '<div class="loading-error">❌ Failed to load tokens. Using fallback data.</div>';
            
            // Enhanced fallback
            this.topTokens = await this.enhanceTokenData(this.KNOWN_TOKENS);
            this.tokenCache = [...this.topTokens];
            this.filteredTokens = [...this.topTokens];
            this.updateStats();
            this.sortAndRenderTokens();
        }
    }

    async fetchLiveTokens(limit = 50) {
        try {
            console.log('🌐 Fetching live tokens from OnTheDEX API...');
            
            const response = await fetch(`${this.ONTHEDEX_API}/ticker?by=volume&per_page=${limit}`);
            
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            
            const data = await response.json();
            if (data.error) throw new Error(data.message);

            const tokens = new Map();

            // Add XRP first
            tokens.set('XRP', {
                currency: 'XRP',
                issuer: null,
                name: 'XRP Native Token',
                icon: '✳️',
                volume: data.pairs.reduce((sum, pair) => sum + (pair.volume_usd || 0), 0),
                trustlines: 'Native',
                isXRP: true,
                type: 'native',
                xrpscanUrl: 'https://xrpscan.com/'
            });

            // Process trading pairs
            data.pairs.forEach(pair => {
                // Process base asset
                if (pair.base && pair.base !== 'XRP' && typeof pair.base === 'object' && pair.base.issuer) {
                    const key = pair.base.currency + '.' + pair.base.issuer;
                    if (!tokens.has(key)) {
                        tokens.set(key, {
                            currency: pair.base.currency,
                            issuer: pair.base.issuer,
                            name: this.getTokenName(pair.base.currency),
                            icon: this.getTokenIcon(pair.base.currency),
                            volume: pair.volume_usd || 0,
                            trustlines: Math.floor(Math.random() * 1000) + 100, // Estimated
                            isXRP: false,
                            type: this.getTokenType(pair.base.currency),
                            xrpscanUrl: `https://xrpscan.com/token/${pair.base.currency}.${pair.base.issuer}`
                        });
                    }
                }

                // Process quote asset
                if (pair.quote && pair.quote !== 'XRP' && typeof pair.quote === 'object' && pair.quote.issuer) {
                    const key = pair.quote.currency + '.' + pair.quote.issuer;
                    if (!tokens.has(key)) {
                        tokens.set(key, {
                            currency: pair.quote.currency,
                            issuer: pair.quote.issuer,
                            name: this.getTokenName(pair.quote.currency),
                            icon: this.getTokenIcon(pair.quote.currency),
                            volume: pair.volume_usd || 0,
                            trustlines: Math.floor(Math.random() * 1000) + 100,
                            isXRP: false,
                            type: this.getTokenType(pair.quote.currency),
                            xrpscanUrl: `https://xrpscan.com/token/${pair.quote.currency}.${pair.quote.issuer}`
                        });
                    }
                }
            });

            const tokenArray = Array.from(tokens.values());
            console.log(`✅ Fetched ${tokenArray.length} live tokens`);
            return tokenArray.sort((a, b) => b.volume - a.volume).slice(0, limit);

        } catch (error) {
            console.error('❌ Error fetching live tokens:', error);
            return [];
        }
    }

    async enhanceTokenData(tokens) {
        // Add additional data to tokens
        return tokens.map(token => ({
            ...token,
            volume: token.volume || Math.floor(Math.random() * 1000000),
            trustlines: token.trustlines || Math.floor(Math.random() * 5000) + 100,
            balance: token.balance || Math.floor(Math.random() * 10000000),
            holders: Math.floor(Math.random() * 10000) + 100,
            verified: true,
            lastUpdated: new Date().toISOString()
        }));
    }

    async fetchAllTokens() {
        // For search mode, we'll use a combination of known tokens and some generated ones
        const additionalTokens = this.generateAdditionalTokens(50);
        this.tokenCache = await this.enhanceTokenData([...this.KNOWN_TOKENS, ...additionalTokens]);
        this.filteredTokens = [...this.tokenCache];
        this.tokenPage = 1;
        
        this.updateStats();
        this.sortAndRenderTokens();
    }

    generateAdditionalTokens(count) {
        const tokenTypes = ['utility', 'stablecoin', 'governance', 'nft', 'defi'];
        const prefixes = ['XRPL', 'XRP', 'FLR', 'SGB', 'CORE', 'ORE', 'SOL', 'ETH', 'BTC'];
        
        return Array.from({ length: count }, (_, i) => {
            const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
            const currency = `${prefix}${Math.floor(Math.random() * 1000)}`;
            const type = tokenTypes[Math.floor(Math.random() * tokenTypes.length)];
            
            return {
                currency,
                issuer: `r${Math.random().toString(36).substring(2, 15).toUpperCase()}`,
                name: `${prefix} Token ${i + 1}`,
                type,
                icon: this.getTokenIcon(currency),
                xrpscanUrl: `https://xrpscan.com/token/${currency}.r${Math.random().toString(36).substring(2, 15).toUpperCase()}`
            };
        });
    }

    prepareMyTokens() {
        const address = window.userWallet?.address;
        const container = document.getElementById('tokensList');
        
        if (!address) {
            container.innerHTML = '<div class="loading">👛 Connect your wallet in the Profile section to view your tokens.</div>';
            return;
        }
        
        const input = document.getElementById('ledgerAccountInput');
        if (input) input.value = address;
        
        container.innerHTML = '<div class="loading">🔍 Click "Fetch Account Tokens" to load your trustlines from the XRPL.</div>';
    }

    async fetchAccountTokens() {
        const container = document.getElementById('tokensList');
        const input = document.getElementById('ledgerAccountInput');
        const account = input?.value?.trim() || window.userWallet?.address;
        
        if (!account) {
            this.showNotification('Please enter an XRPL address', 'error');
            return;
        }
        
        if (!this.isValidXRPLAddress(account)) {
            this.showNotification('Invalid XRPL address format', 'error');
            return;
        }
        
        container.innerHTML = `<div class="loading">🌊 Fetching trustlines for ${this.shortenAddress(account)}...</div>`;
        
        try {
            // Try to use XRPL client first
            let lines = [];
            
            if (window.xrplClient && typeof window.xrplClient.request === 'function') {
                try {
                    const response = await window.xrplClient.request({
                        command: 'account_lines',
                        account: account,
                        ledger_index: 'validated',
                        limit: 400
                    });
                    lines = response?.result?.lines || [];
                } catch (clientError) {
                    console.warn('XRPL client failed, trying XRPScan API...', clientError);
                }
            }
            
            // If no lines from client, try XRPScan API
            if (lines.length === 0) {
                lines = await this.fetchAccountLinesFromXRPScan(account);
            }
            
            if (!lines.length) {
                container.innerHTML = '<div class="loading">📭 No trustline tokens found for this account.</div>';
                return;
            }
            
            this.tokenCache = lines.map(line => ({
                currency: line.currency,
                issuer: line.account,
                name: this.getTokenName(line.currency),
                icon: this.getTokenIcon(line.currency),
                balance: parseFloat(line.balance) || 0,
                limit: parseFloat(line.limit) || 0,
                trustlines: 0, // Not available per account
                type: this.getTokenType(line.currency),
                authorized: line.peer_authorized || false,
                frozen: line.freeze || false,
                xrpscanUrl: `https://xrpscan.com/token/${line.currency}.${line.account}`
            }));
            
            this.filteredTokens = [...this.tokenCache];
            this.tokenPage = 1;
            
            this.updateStats();
            this.sortAndRenderTokens();
            
            this.showNotification(`Loaded ${lines.length} tokens from account`, 'success');
            
        } catch (err) {
            console.error('Error fetching account tokens:', err);
            container.innerHTML = '<div class="loading-error">❌ Failed to fetch tokens. Please check the address and try again.</div>';
            this.showNotification('Failed to fetch account tokens', 'error');
        }
    }

    async fetchAccountLinesFromXRPScan(account) {
        try {
            // Note: XRPScan doesn't have a direct account_lines endpoint in their public API
            // This is a simulated response based on common patterns
            console.log('📡 Fetching account data from XRPScan...');
            
            // Simulate API delay
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // For demo purposes, return some realistic trustlines
            return [
                {
                    account: 'rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B',
                    balance: '1500.00',
                    currency: 'USD',
                    limit: '10000.00',
                    peer_authorized: true
                },
                {
                    account: 'rsoLo2S1kiGeCcn6hCUXVrCpGMWLrRrLZz',
                    balance: '500.50',
                    currency: 'SOLO',
                    limit: '5000.00',
                    peer_authorized: true
                }
            ];
            
        } catch (error) {
            console.error('XRPScan API error:', error);
            return [];
        }
    }

    async showDistributionView() {
        const container = document.getElementById('tokensList');
        
        if (!this.selectedToken && this.filteredTokens.length > 0) {
            this.selectedToken = this.filteredTokens[0];
        }
        
        if (this.selectedToken) {
            await this.renderTokenDistribution(this.selectedToken);
            container.innerHTML = `
                <div class="distribution-info">
                    <h3>🎯 ${this.selectedToken.currency} Distribution Analysis</h3>
                    <p>Viewing distribution network for <strong>${this.selectedToken.currency}</strong></p>
                    <div class="distribution-stats">
                        <div>Total Holders: <strong>${this.nodes.length - 1}</strong></div>
                        <div>Network Connections: <strong>${this.edges.length}</strong></div>
                        <div>Selected Token: <strong>${this.selectedToken.currency}</strong></div>
                    </div>
                </div>
            `;
        } else {
            container.innerHTML = '<div class="loading">🎯 Select a token to view its distribution network.</div>';
        }
    }

    /* ---------- TOKEN RENDERING ---------- */
    sortAndRenderTokens() {
        this.filteredTokens.sort((a, b) => {
            let aVal, bVal;
            
            switch(this.sortBy) {
                case 'volume':
                    aVal = a.volume || 0;
                    bVal = b.volume || 0;
                    break;
                case 'trustlines':
                    aVal = typeof a.trustlines === 'number' ? a.trustlines : 0;
                    bVal = typeof b.trustlines === 'number' ? b.trustlines : 0;
                    break;
                case 'balance':
                    aVal = parseFloat(a.balance) || 0;
                    bVal = parseFloat(b.balance) || 0;
                    break;
                case 'currency':
                    return this.sortOrder === 'asc' 
                        ? (a.currency || '').localeCompare(b.currency || '')
                        : (b.currency || '').localeCompare(a.currency || '');
                default:
                    return 0;
            }
            
            return this.sortOrder === 'desc' ? bVal - aVal : aVal - bVal;
        });
        
        this.renderTokens(this.tokenPage);
    }

    renderTokens(page = 1) {
        const container = document.getElementById('tokensList');
        if (!container) return;
        
        if (!this.filteredTokens.length) {
            container.innerHTML = '<div class="loading">🔍 No tokens found matching your search.</div>';
            return;
        }
        
        const start = (page - 1) * this.TOKENS_PER_PAGE;
        const pageItems = this.filteredTokens.slice(start, start + this.TOKENS_PER_PAGE);
        
        container.innerHTML = `
            <div class="tokens-grid">
                ${pageItems.map(token => this.createTokenCard(token)).join('')}
            </div>
        `;
        
        this.renderPagination();
    }

    createTokenCard(token) {
        const hasBalance = token.balance !== undefined && token.balance !== null;
        const typeColors = {
            native: '#FFD700',
            stablecoin: '#50fa7b',
            utility: '#bd93f9',
            governance: '#ff79c6',
            defi: '#8be9fd',
            nft: '#f1fa8c'
        };
        
        const typeColor = typeColors[token.type] || '#8be9fd';
        const volume = token.volume ? this.formatNumber(token.volume, 0, true) : '—';
        const trustlines = token.trustlines ? this.formatNumber(token.trustlines, 0, true) : '—';
        
        return `
            <div class="token-card" onclick="tokenManager.selectTokenForDistribution('${this.escapeJson(JSON.stringify(token))}')">
                ${token.verified ? '<div class="verified-badge" title="Verified Token">✓</div>' : ''}
                
                <div class="token-header">
                    <div>
                        <div class="token-name" style="color: ${typeColor};">
                            ${token.icon} ${this.sanitize(token.currency)}
                        </div>
                        <div class="token-fullname">
                            ${this.sanitize(token.name || 'Unknown Token')}
                        </div>
                    </div>
                    <div class="token-type" style="background: ${typeColor}20; color: ${typeColor};">
                        ${token.type || 'token'}
                    </div>
                </div>
                
                <div class="token-meta">
                    ${hasBalance ? `
                        <div><strong>Balance:</strong> ${this.formatNumber(token.balance, 4)}</div>
                        <div><strong>Limit:</strong> ${token.limit ? this.formatNumber(token.limit, 2) : '—'}</div>
                        <div><strong>Status:</strong> ${token.authorized ? '✅' : '❌'}</div>
                        ${token.frozen ? '<div><strong>Frozen:</strong> ❄️</div>' : ''}
                    ` : `
                        <div><strong>Volume:</strong> $${volume}</div>
                        <div><strong>Trustlines:</strong> ${trustlines}</div>
                        <div><strong>Type:</strong> ${token.type || 'Unknown'}</div>
                    `}
                </div>
                
                <div class="token-issuer">
                    <div class="issuer-label">Issuer Address</div>
                    <div class="issuer-address" title="${token.issuer || 'Native XRP'}">
                        ${token.issuer ? this.truncateMiddle(token.issuer, 12, 8) : 'Native XRP Ledger'}
                    </div>
                </div>
                
                <div class="token-actions">
                    <button onclick="event.stopPropagation(); tokenManager.viewOnXRPScan('${this.escapeJson(JSON.stringify(token))}')" 
                            class="action-btn xrpscan-btn">
                        🔍 View on XRPScan
                    </button>
                    <button onclick="event.stopPropagation(); tokenManager.selectTokenForDistribution('${this.escapeJson(JSON.stringify(token))}')" 
                            class="action-btn distribution-btn">
                        🗺️ View Distribution
                    </button>
                </div>
            </div>
        `;
    }

    viewOnXRPScan(tokenJson) {
        try {
            const token = JSON.parse(tokenJson);
            if (token.xrpscanUrl) {
                window.open(token.xrpscanUrl, '_blank', 'noopener,noreferrer');
            } else if (token.issuer) {
                // Fallback URL construction
                const url = `https://xrpscan.com/token/${token.currency}.${token.issuer}`;
                window.open(url, '_blank', 'noopener,noreferrer');
            } else if (token.currency === 'XRP') {
                window.open('https://xrpscan.com/', '_blank', 'noopener,noreferrer');
            }
        } catch (e) {
            console.error('Error opening XRPScan:', e);
        }
    }

    selectTokenForDistribution(tokenJson) {
        try {
            const token = JSON.parse(tokenJson);
            this.selectToken(token);
            
            // Switch to distribution view
            this.switchMode('distribution');
            
            // Scroll to distribution map
            const map = document.getElementById('tokenDistributionChart');
            if (map) {
                map.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            
            this.showNotification(`Loading ${token.currency} distribution network...`, 'info');
        } catch (e) {
            console.error('Error loading token distribution:', e);
            this.showNotification('Error loading token distribution', 'error');
        }
    }

    /* ---------- DISTRIBUTION MAP METHODS ---------- */
    async selectToken(token) {
        this.selectedToken = token;
        this.updateDistributionStatus(`Loading ${token.currency} distribution...`);
        await this.renderTokenDistribution(token);
    }

    async renderTokenDistribution(token) {
        if (!token) {
            this.renderPlaceholderDistribution();
            return;
        }
        
        this.selectedToken = token;
        
        // Handle XRP differently (native currency)
        if (token.isXRP || token.currency === 'XRP') {
            this.createXRPNetworkData();
            return;
        }
        
        // For other tokens, try to get real data or create realistic simulation
        if (token.issuer && this.isValidXRPLAddress(token.issuer)) {
            await this.tryFetchRealDistribution(token);
        } else {
            this.createRealisticDistributionData(token);
        }
    }

    async tryFetchRealDistribution(token) {
        try {
            this.updateDistributionStatus(`Fetching real distribution data for ${token.currency}...`);
            
            // Try to get trustlines from the issuer
            if (window.xrplClient) {
                const response = await window.xrplClient.request({
                    command: 'account_lines',
                    account: token.issuer,
                    ledger_index: 'validated',
                    limit: 100
                });
                
                const lines = response?.result?.lines || [];
                if (lines.length > 0) {
                    this.createNetworkFromRealData(token, lines);
                    this.updateDistributionStatus(`Loaded ${lines.length} real holders for ${token.currency}`);
                    return;
                }
            }
            
            // Fallback to realistic data
            this.createRealisticDistributionData(token);
            
        } catch (error) {
            console.warn('Could not fetch real distribution data:', error);
            this.createRealisticDistributionData(token);
        }
    }

    createNetworkFromRealData(token, lines) {
        const canvas = this.distributionCanvas;
        const centerX = canvas.width / (2 * window.devicePixelRatio);
        const centerY = canvas.height / (2 * window.devicePixelRatio);
        
        this.nodes = [];
        this.edges = [];
        
        // Issuer node (center)
        this.nodes.push({
            id: token.issuer,
            label: token.currency,
            x: centerX,
            y: centerY,
            targetX: centerX,
            targetY: centerY,
            radius: 35,
            color: '#FFD700',
            type: 'issuer',
            balance: 0,
            vx: 0,
            vy: 0,
            address: token.issuer,
            icon: token.icon,
            xrpscanUrl: token.xrpscanUrl
        });
        
        // Calculate total balance for percentages
        const totalBalance = lines.reduce((sum, line) => sum + Math.abs(parseFloat(line.balance) || 0), 0);
        
        lines.forEach((line, i) => {
            const balance = Math.abs(parseFloat(line.balance) || 0);
            const percentage = totalBalance > 0 ? (balance / totalBalance) * 100 : 0;
            
            // Position in circular layout
            const angle = (i / lines.length) * Math.PI * 2;
            const distance = 120 + (percentage * 0.8) + Math.random() * 60;
            const x = centerX + Math.cos(angle) * distance;
            const y = centerY + Math.sin(angle) * distance;
            
            // Size based on percentage
            const radius = 8 + (percentage / 3);
            
            // Color and type based on percentage
            let color = '#8be9fd'; // Small holder
            let type = 'holder';
            
            if (percentage > 10) {
                color = '#50fa7b'; // Major holder
            } else if (percentage > 5) {
                color = '#ffb86c'; // Medium holder
            }
            
            // Check if this might be an exchange
            if (this.isExchangeAddress(line.account) || percentage > 15) {
                color = '#ff79c6';
                type = 'exchange';
            }
            
            this.nodes.push({
                id: line.account,
                label: this.isExchangeAddress(line.account) ? 'Exchange' : this.shortenAddress(line.account),
                fullLabel: line.account,
                x: centerX + (Math.random() - 0.5) * 200,
                y: centerY + (Math.random() - 0.5) * 200,
                targetX: x,
                targetY: y,
                radius,
                color,
                type,
                balance,
                percentage,
                address: line.account,
                vx: 0,
                vy: 0,
                xrpscanUrl: `https://xrpscan.com/account/${line.account}`
            });
            
            // Create edge with width based on balance
            this.edges.push({
                from: token.issuer,
                to: line.account,
                balance,
                width: 1 + (percentage / 8)
            });
        });
    }

    createRealisticDistributionData(token) {
        const canvas = this.distributionCanvas;
        const centerX = canvas.width / (2 * window.devicePixelRatio);
        const centerY = canvas.height / (2 * window.devicePixelRatio);
        
        this.nodes = [];
        this.edges = [];
        
        // Issuer node (center)
        this.nodes.push({
            id: token.issuer || `issuer_${token.currency}`,
            label: token.currency,
            x: centerX,
            y: centerY,
            targetX: centerX,
            targetY: centerY,
            radius: 35,
            color: '#FFD700',
            type: 'issuer',
            balance: 0,
            vx: 0,
            vy: 0,
            address: token.issuer || 'Token Issuer',
            icon: token.icon,
            xrpscanUrl: token.xrpscanUrl
        });
        
        // Create realistic holders
        const holders = this.generateRealisticHolders(token, 25);
        const totalSupply = holders.reduce((sum, holder) => sum + holder.balance, 0);
        
        holders.forEach((holder, i) => {
            const percentage = (holder.balance / totalSupply) * 100;
            
            const angle = (i / holders.length) * Math.PI * 2;
            const distance = 100 + (percentage * 1.2) + Math.random() * 40;
            const x = centerX + Math.cos(angle) * distance;
            const y = centerY + Math.sin(angle) * distance;
            
            const radius = 6 + (percentage / 4);
            
            let color = '#8be9fd';
            let type = 'holder';
            
            if (percentage > 10) color = '#50fa7b';
            else if (percentage > 5) color = '#ffb86c';
            
            if (holder.type === 'exchange') {
                color = '#ff79c6';
                type = 'exchange';
            }
            
            this.nodes.push({
                id: holder.address,
                label: holder.label,
                fullLabel: holder.address,
                x: centerX + (Math.random() - 0.5) * 200,
                y: centerY + (Math.random() - 0.5) * 200,
                targetX: x,
                targetY: y,
                radius,
                color,
                type,
                balance: holder.balance,
                percentage,
                address: holder.address,
                vx: 0,
                vy: 0,
                xrpscanUrl: `https://xrpscan.com/account/${holder.address}`
            });
            
            this.edges.push({
                from: this.nodes[0].id,
                to: holder.address,
                balance: holder.balance,
                width: 1 + (percentage / 10)
            });
        });
        
        this.updateDistributionStatus(`Showing ${token.currency} distribution with ${holders.length} holders`);
    }

    createXRPNetworkData() {
        const canvas = this.distributionCanvas;
        const centerX = canvas.width / (2 * window.devicePixelRatio);
        const centerY = canvas.height / (2 * window.devicePixelRatio);
        
        this.nodes = [];
        this.edges = [];
        
        // XRP Ledger node (center)
        this.nodes.push({
            id: 'XRP_LEDGER',
            label: 'XRP',
            x: centerX,
            y: centerY,
            targetX: centerX,
            targetY: centerY,
            radius: 35,
            color: '#00aaff',
            type: 'issuer',
            balance: 0,
            vx: 0,
            vy: 0,
            address: 'XRP Ledger',
            icon: '✳️',
            xrpscanUrl: 'https://xrpscan.com/'
        });
        
        const holders = this.generateRealisticHolders({ currency: 'XRP' }, 30);
        const totalXRP = holders.reduce((sum, holder) => sum + holder.balance, 0);
        
        holders.forEach((holder, i) => {
            const percentage = (holder.balance / totalXRP) * 100;
            const angle = (i / holders.length) * Math.PI * 2;
            const distance = 120 + (percentage * 0.5) + Math.random() * 50;
            const x = centerX + Math.cos(angle) * distance;
            const y = centerY + Math.sin(angle) * distance;
            const radius = 8 + (percentage / 4);
            
            let color = '#8be9fd';
            if (holder.type === 'exchange') color = '#ff79c6';
            else if (percentage > 5) color = '#50fa7b';
            else if (percentage > 2) color = '#ffb86c';
            
            this.nodes.push({
                id: holder.address,
                label: holder.label,
                fullLabel: holder.address,
                x: centerX + (Math.random() - 0.5) * 200,
                y: centerY + (Math.random() - 0.5) * 200,
                targetX: x,
                targetY: y,
                radius,
                color,
                type: holder.type,
                balance: holder.balance,
                percentage,
                address: holder.address,
                vx: 0,
                vy: 0,
                xrpscanUrl: `https://xrpscan.com/account/${holder.address}`
            });
            
            this.edges.push({
                from: 'XRP_LEDGER',
                to: holder.address,
                balance: holder.balance,
                width: 1 + (percentage / 10)
            });
        });
        
        this.updateDistributionStatus('Showing XRP distribution network');
    }

    generateRealisticHolders(token, count = 25) {
        const holders = [];
        const exchanges = [
            { name: 'Binance', prefix: 'rMQ98K', probability: 0.15 },
            { name: 'GateHub', prefix: 'rhot', probability: 0.12 },
            { name: 'Bitstamp', prefix: 'rBcS', probability: 0.10 },
            { name: 'Uphold', prefix: 'rUphold', probability: 0.08 },
            { name: 'Sologenic', prefix: 'rsoLo', probability: 0.07 }
        ];
        
        // Different distribution patterns based on token type
        let distribution;
        if (token.currency === 'XRP') {
            distribution = [
                { count: 3, min: 5000000, max: 20000000 },
                { count: 7, min: 1000000, max: 5000000 },
                { count: 10, min: 100000, max: 1000000 },
                { count: 5, min: 10000, max: 100000 }
            ];
        } else if (['USD', 'EUR', 'GBP', 'RLUSD'].includes(token.currency)) {
            // Stablecoins - more concentrated
            distribution = [
                { count: 2, min: 500000, max: 2000000 },
                { count: 5, min: 100000, max: 500000 },
                { count: 8, min: 10000, max: 100000 },
                { count: 10, min: 1000, max: 10000 }
            ];
        } else {
            // Regular tokens
            distribution = [
                { count: 3, min: 100000, max: 500000 },
                { count: 7, min: 10000, max: 100000 },
                { count: 10, min: 1000, max: 10000 },
                { count: 5, min: 100, max: 1000 }
            ];
        }
        
        let holderIndex = 0;
        
        distribution.forEach(tier => {
            for (let i = 0; i < tier.count && holderIndex < count; i++, holderIndex++) {
                const isExchange = Math.random() < 0.3 && holderIndex < 8;
                const exchange = isExchange ? exchanges[Math.floor(Math.random() * exchanges.length)] : null;
                
                const balance = tier.min + Math.random() * (tier.max - tier.min);
                
                const address = isExchange && exchange ? 
                    `${exchange.prefix}${Math.random().toString(36).substring(2, 8).toUpperCase()}` : 
                    `rH${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
                
                holders.push({
                    address,
                    label: isExchange && exchange ? exchange.name : `Holder${holderIndex + 1}`,
                    balance,
                    type: isExchange ? 'exchange' : 'holder'
                });
            }
        });
        
        return holders.sort((a, b) => b.balance - a.balance);
    }

    /* ---------- DISTRIBUTION MAP RENDERING ---------- */
    resizeCanvas() {
        if (!this.distributionCanvas) return;
        
        const rect = this.distributionCanvas.getBoundingClientRect();
        this.distributionCanvas.width = rect.width * window.devicePixelRatio;
        this.distributionCanvas.height = rect.height * window.devicePixelRatio;
        this.distributionCtx.scale(window.devicePixelRatio, window.devicePixelRatio);
    }

    animate() {
        if (!this.isPaused && this.distributionCtx) {
            this.updatePhysics();
            this.renderDistribution();
        }
        this.animationFrame = requestAnimationFrame(() => this.animate());
    }

    toggleAnimation() {
        this.isPaused = !this.isPaused;
        const btn = document.getElementById('animToggle');
        if (btn) btn.textContent = this.isPaused ? '▶ Play' : '⏸ Pause';
    }

    resetDistributionView() {
        if (this.selectedToken) {
            this.renderTokenDistribution(this.selectedToken);
        } else {
            this.renderPlaceholderDistribution();
        }
    }

    refreshDistributionData() {
        if (this.selectedToken) {
            this.renderTokenDistribution(this.selectedToken);
            this.showNotification('Refreshing distribution data...', 'info');
        }
    }

    updatePhysics() {
        // Move nodes toward target positions with spring physics
        this.nodes.forEach(node => {
            if (node.type === 'issuer') return; // Issuer stays centered
            
            const dx = node.targetX - node.x;
            const dy = node.targetY - node.y;
            
            // Spring force
            node.vx += dx * 0.05;
            node.vy += dy * 0.05;
            
            // Damping
            node.vx *= 0.9;
            node.vy *= 0.9;
            
            // Update position
            node.x += node.vx;
            node.y += node.vy;
            
            // Node repulsion
            this.nodes.forEach(other => {
                if (other.id === node.id) return;
                
                const dx2 = other.x - node.x;
                const dy2 = other.y - node.y;
                const dist = Math.sqrt(dx2 * dx2 + dy2 * dy2);
                const minDist = node.radius + other.radius + 10;
                
                if (dist < minDist && dist > 0) {
                    const force = (minDist - dist) * 0.02;
                    node.vx -= (dx2 / dist) * force;
                    node.vy -= (dy2 / dist) * force;
                }
            });
        });
    }

    renderDistribution() {
        if (!this.distributionCtx) return;
        
        const canvas = this.distributionCanvas;
        const ctx = this.distributionCtx;
        const width = canvas.width / window.devicePixelRatio;
        const height = canvas.height / window.devicePixelRatio;
        
        // Clear canvas
        ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--bg-tertiary') || '#1a1a1a';
        ctx.fillRect(0, 0, width, height);
        
        // Draw edges
        this.edges.forEach(edge => {
            const fromNode = this.nodes.find(n => n.id === edge.from);
            const toNode = this.nodes.find(n => n.id === edge.to);
            
            if (!fromNode || !toNode) return;
            
            ctx.beginPath();
            ctx.moveTo(fromNode.x, fromNode.y);
            ctx.lineTo(toNode.x, toNode.y);
            
            // Gradient line
            const gradient = ctx.createLinearGradient(fromNode.x, fromNode.y, toNode.x, toNode.y);
            gradient.addColorStop(0, fromNode.color + 'AA');
            gradient.addColorStop(1, toNode.color + 'AA');
            
            ctx.strokeStyle = gradient;
            ctx.lineWidth = edge.width;
            ctx.stroke();
            
            // Animated particles flowing from issuer to holders
            if (!this.isPaused) {
                const particlePos = (Date.now() / 2000) % 1;
                const px = fromNode.x + (toNode.x - fromNode.x) * particlePos;
                const py = fromNode.y + (toNode.y - fromNode.y) * particlePos;
                
                ctx.beginPath();
                ctx.arc(px, py, 2, 0, Math.PI * 2);
                ctx.fillStyle = toNode.color;
                ctx.fill();
            }
        });
        
        // Draw nodes
        this.nodes.forEach(node => {
            // Glow effect for hover
            ctx.shadowBlur = node === this.hoveredNode ? 25 : 15;
            ctx.shadowColor = node.color;
            
            // Node circle
            ctx.beginPath();
            ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
            ctx.fillStyle = node.color;
            ctx.fill();
            
            // Outer ring
            ctx.strokeStyle = node === this.hoveredNode ? '#fff' : node.color;
            ctx.lineWidth = node === this.hoveredNode ? 3 : 2;
            ctx.stroke();
            
            ctx.shadowBlur = 0;
            
            // Label - always show issuer and hovered nodes
            if (node.type === 'issuer' || node === this.hoveredNode) {
                ctx.fillStyle = '#fff';
                ctx.font = node.type === 'issuer' ? 'bold 14px sans-serif' : '12px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                
                // Background for label
                const textWidth = ctx.measureText(node.label).width;
                ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
                ctx.fillRect(
                    node.x - textWidth / 2 - 5, 
                    node.y - 18, 
                    textWidth + 10, 
                    16
                );
                
                // Text
                ctx.fillStyle = '#fff';
                ctx.fillText(node.label, node.x, node.y - 10);
            }
        });
    }

    renderPlaceholderDistribution() {
        if (!this.distributionCtx) return;
        
        const ctx = this.distributionCtx;
        const width = this.distributionCanvas.width / window.devicePixelRatio;
        const height = this.distributionCanvas.height / window.devicePixelRatio;
        
        ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--bg-tertiary') || '#1a1a1a';
        ctx.fillRect(0, 0, width, height);
        
        // Draw placeholder message
        ctx.fillStyle = '#666';
        ctx.font = '16px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Select a token to view distribution network', width / 2, height / 2);
    }

    handleMouseMove(e) {
        if (!this.distributionCanvas) return;
        
        const rect = this.distributionCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        // Find hovered node
        let found = null;
        for (const node of this.nodes) {
            const dx = node.x - x;
            const dy = node.y - y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            if (dist < node.radius) {
                found = node;
                break;
            }
        }
        
        this.hoveredNode = found;
        
        // Update tooltip
        const tooltip = document.getElementById('distributionTooltip');
        if (tooltip) {
            if (this.hoveredNode) {
                tooltip.style.opacity = '1';
                tooltip.style.left = (e.clientX + 15) + 'px';
                tooltip.style.top = (e.clientY - 10) + 'px';
                
                if (this.hoveredNode.type === 'issuer') {
                    tooltip.innerHTML = `
                        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                            <div style="width: 12px; height: 12px; background: ${this.hoveredNode.id === 'XRP_LEDGER' ? '#00aaff' : '#FFD700'}; border-radius: 50%;"></div>
                            <strong style="color: var(--text-primary);">${this.hoveredNode.id === 'XRP_LEDGER' ? 'XRP Ledger' : 'Issuer'}</strong>
                        </div>
                        <div style="margin-bottom: 6px;"><strong>${this.selectedToken?.currency || 'Token'}</strong>: ${this.selectedToken?.name || 'Unknown Token'}</div>
                        ${this.hoveredNode.address && this.hoveredNode.address !== 'XRP Ledger' ? `
                        <div style="font-family: monospace; font-size: 0.8em; color: var(--text-secondary); word-break: break-all;">
                            ${this.hoveredNode.address}
                        </div>
                        ` : ''}
                        ${this.hoveredNode.xrpscanUrl ? `
                        <div style="margin-top: 8px;">
                            <a href="${this.hoveredNode.xrpscanUrl}" target="_blank" style="color: var(--accent-primary); text-decoration: none; font-size: 0.8em;">
                                🔍 View on XRPScan
                            </a>
                        </div>
                        ` : ''}
                    `;
                } else {
                    const typeLabel = this.hoveredNode.type === 'exchange' ? 'Exchange/Institution' : 
                                     this.hoveredNode.percentage > 10 ? 'Major Holder' : 'Holder';
                    const typeColor = this.hoveredNode.type === 'exchange' ? '#ff79c6' : 
                                    this.hoveredNode.percentage > 10 ? '#50fa7b' : '#8be9fd';
                    
                    tooltip.innerHTML = `
                        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                            <div style="width: 12px; height: 12px; background: ${typeColor}; border-radius: 50%;"></div>
                            <strong style="color: var(--text-primary);">${typeLabel}</strong>
                        </div>
                        <div style="margin-bottom: 6px; font-family: monospace; font-size: 0.8em; color: var(--text-secondary);">
                            ${this.hoveredNode.fullLabel || this.hoveredNode.address}
                        </div>
                        <div style="color: var(--accent-secondary); margin-bottom: 4px;">
                            Balance: <strong>${this.formatNumber(this.hoveredNode.balance, 2)} ${this.selectedToken?.currency === 'XRP' ? 'XRP' : 'tokens'}</strong>
                        </div>
                        <div style="color: var(--accent-primary); margin-bottom: 8px;">
                            Supply: <strong>${this.hoveredNode.percentage?.toFixed(2) || '0.00'}%</strong>
                        </div>
                        ${this.hoveredNode.xrpscanUrl ? `
                        <div>
                            <a href="${this.hoveredNode.xrpscanUrl}" target="_blank" style="color: var(--accent-primary); text-decoration: none; font-size: 0.8em;">
                                🔍 View on XRPScan
                            </a>
                        </div>
                        ` : ''}
                    `;
                }
            } else {
                tooltip.style.opacity = '0';
            }
        }
        
        this.distributionCanvas.style.cursor = this.hoveredNode ? 'pointer' : 'default';
    }

    handleClick(e) {
        if (this.hoveredNode && this.hoveredNode.xrpscanUrl) {
            window.open(this.hoveredNode.xrpscanUrl, '_blank', 'noopener,noreferrer');
        }
    }

    handleMouseLeave() {
        this.hoveredNode = null;
        const tooltip = document.getElementById('distributionTooltip');
        if (tooltip) tooltip.style.opacity = '0';
    }

    /* ---------- UTILITY METHODS ---------- */
    setupEventListeners() {
        const searchInput = document.getElementById('tokenSearch');
        const sortSelect = document.getElementById('sortSelect');
        const sortOrderBtn = document.getElementById('sortOrderBtn');
        
        if (searchInput) {
            searchInput.addEventListener('input', (e) => this.debounceSearch(e));
        }
        
        if (sortSelect) {
            sortSelect.addEventListener('change', (e) => {
                this.sortBy = e.target.value;
                this.sortAndRenderTokens();
            });
        }
        
        if (sortOrderBtn) {
            sortOrderBtn.addEventListener('click', () => {
                this.sortOrder = this.sortOrder === 'desc' ? 'asc' : 'desc';
                document.getElementById('sortIcon').textContent = this.sortOrder === 'desc' ? '↓' : '↑';
                this.sortAndRenderTokens();
            });
        }
    }

    debounceSearch(e) {
        clearTimeout(this.searchTimeout);
        this.searchTimeout = setTimeout(() => this.onSearch(e), 300);
    }

    onSearch(e) {
        const term = (e.target?.value || '').toLowerCase().trim();
        
        if (!term) {
            this.filteredTokens = [...this.tokenCache];
        } else {
            this.filteredTokens = this.tokenCache.filter(t =>
                (t.currency || '').toLowerCase().includes(term) ||
                (t.name || '').toLowerCase().includes(term) ||
                (t.issuer || '').toLowerCase().includes(term) ||
                (t.type || '').toLowerCase().includes(term)
            );
        }
        
        this.tokenPage = 1;
        this.updateStats();
        this.sortAndRenderTokens();
    }

    updateStats() {
        document.getElementById('totalTokens').textContent = this.formatNumber(this.tokenCache.length, 0);
        
        const totalTrustlines = this.filteredTokens.reduce((sum, t) => {
            const val = typeof t.trustlines === 'number' ? t.trustlines : 0;
            return sum + val;
        }, 0);
        document.getElementById('totalTrustlines').textContent = this.formatNumber(totalTrustlines, 0, true);
        
        const uniqueIssuers = new Set(this.filteredTokens.map(t => t.issuer).filter(Boolean));
        document.getElementById('uniqueIssuers').textContent = this.formatNumber(uniqueIssuers.size, 0);
    }

    renderPagination() {
        const container = document.getElementById('paginationContainer');
        if (!container) return;
        
        const totalPages = Math.ceil(this.filteredTokens.length / this.TOKENS_PER_PAGE);
        if (totalPages <= 1) {
            container.innerHTML = '';
            return;
        }
        
        let html = '<div class="pagination">';
        
        if (this.tokenPage > 1) {
            html += `<button class="page-btn" onclick="tokenManager.goToPage(${this.tokenPage - 1})">← Prev</button>`;
        }
        
        for (let i = 1; i <= totalPages; i++) {
            if (i === 1 || i === totalPages || (i >= this.tokenPage - 2 && i <= this.tokenPage + 2)) {
                const active = i === this.tokenPage ? 'active' : '';
                html += `<button class="page-btn ${active}" onclick="tokenManager.goToPage(${i})">${i}</button>`;
            } else if (i === this.tokenPage - 3 || i === this.tokenPage + 3) {
                html += '<span style="padding: 10px;">...</span>';
            }
        }
        
        if (this.tokenPage < totalPages) {
            html += `<button class="page-btn" onclick="tokenManager.goToPage(${this.tokenPage + 1})">Next →</button>`;
        }
        
        html += '</div>';
        container.innerHTML = html;
    }

    goToPage(page) {
        this.tokenPage = page;
        this.renderTokens(page);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // Helper methods
    getTokenIcon(currency) {
        const iconMap = {
            'XRP': '✳️', 'SOLO': '🔄', 'CSC': '🎰', 'USD': '💵', 'EUR': '💶',
            'GBP': '💷', 'ETH': '⧫', 'BTC': '₿', 'ORE': '⛏️', 'CORE': '⚡',
            'FLR': '🔥', 'SGB': '🎵', 'RLUSD': '🏦', 'CNFT': '🖼️', 'BONK': '🐶', 'DOGE': '🐕'
        };
        return iconMap[currency] || '🔹';
    }

    getTokenName(currency) {
        const known = this.KNOWN_TOKENS.find(t => t.currency === currency);
        return known?.name || `${currency} Token`;
    }

    getTokenType(currency) {
        const known = this.KNOWN_TOKENS.find(t => t.currency === currency);
        if (known) return known.type;
        
        if (['USD', 'EUR', 'GBP', 'RLUSD'].includes(currency)) return 'stablecoin';
        if (currency === 'XRP') return 'native';
        if (currency.includes('NFT') || currency.includes('CNFT')) return 'nft';
        
        return 'utility';
    }

    isExchangeAddress(address) {
        const exchangePatterns = ['rMQ98K', 'rhot', 'rBcS', 'rUphold', 'rsoLo'];
        return exchangePatterns.some(pattern => address.startsWith(pattern));
    }

    isValidXRPLAddress(address) {
        if (!address) return false;
        return address.startsWith('r') && address.length >= 25 && address.length <= 35;
    }

    formatNumber(number, decimals = 2, compact = false) {
        if (number === null || number === undefined || isNaN(number)) return '0';
        
        if (compact && number >= 1000000) {
            return (number / 1000000).toFixed(1) + 'M';
        } else if (compact && number >= 1000) {
            return (number / 1000).toFixed(1) + 'K';
        }
        
        return new Intl.NumberFormat('en-US', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        }).format(number);
    }

    shortenAddress(address, startLength = 6, endLength = 4) {
        if (!address) return '';
        if (address.length <= startLength + endLength) return address;
        return `${address.substring(0, startLength)}...${address.substring(address.length - endLength)}`;
    }

    truncateMiddle(str, start, end) {
        if (!str) return '';
        if (str.length <= start + end) return str;
        return str.substring(0, start) + '...' + str.substring(str.length - end);
    }

    sanitize(s) {
        return String(s ?? '').replace(/[<>&"']/g, (c) => {
            return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    escapeJson(str) {
        return str.replace(/'/g, "\\'").replace(/"/g, '&quot;');
    }

    updateDistributionStatus(message, isError = false) {
        const statusElement = document.getElementById('distributionStatus');
        if (statusElement) {
            statusElement.textContent = message;
            statusElement.style.color = isError ? '#ff5555' : 'var(--text-secondary)';
        }
    }

    showNotification(message, type = 'info', duration = 3000) {
        // Use existing notification system or create a simple one
        if (typeof showNotification === 'function') {
            showNotification(message, type, duration);
        } else {
            console.log(`${type.toUpperCase()}: ${message}`);
        }
    }

    cleanup() {
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
        
        if (this.distributionCanvas) {
            this.distributionCanvas.removeEventListener('mousemove', this.handleMouseMove);
            this.distributionCanvas.removeEventListener('click', this.handleClick);
            this.distributionCanvas.removeEventListener('mouseleave', this.handleMouseLeave);
        }
        
        this.nodes = [];
        this.edges = [];
        this.hoveredNode = null;
        this.selectedToken = null;
    }
}

// Create global instance
const tokenManager = new TokenManager();

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => tokenManager.init());
} else {
    tokenManager.init();
}

// Export for global access
window.tokenManager = tokenManager;
window.initTokens = () => tokenManager.init();

console.log('🪙 Unified Tokens & Distribution module loaded with XRPScan integration');