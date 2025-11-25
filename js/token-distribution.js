/* =========================================
   Enhanced Token Distribution Network Visualization
   Interactive bubble map with physics, dragging, and real XRPL data
   ========================================= */

let distributionCanvas = null;
let distributionCtx = null;
let animationFrame = null;
let hoveredNode = null;
let selectedToken = null;
let isPaused = false;
let isDragging = false;
let dragBubble = null;

// Enhanced bubble data
let bubbles = [];
let nodes = [];
let edges = [];

// Bubble Class with Enhanced Physics
class Bubble {
    constructor(x, y, radius, color, data, isIssuer = false) {
        this.x = x;
        this.y = y;
        this.radius = radius;
        this.color = color;
        this.data = data;
        this.isIssuer = isIssuer;
        
        // Physics properties
        this.vx = (Math.random() - 0.5) * 0.8;
        this.vy = (Math.random() - 0.5) * 0.8;
        this.baseRadius = radius;
        this.pulsePhase = Math.random() * Math.PI * 2;
        
        // For collision detection
        this.mass = radius * radius;
        this.fixed = isIssuer;
        
        // Display properties
        this.addressText = this.getAddressText();
        this.isHovered = false;
        this.isDragging = false;
        
        // Animation properties
        this.targetX = x;
        this.targetY = y;
        this.spring = 0.1;
        this.friction = 0.95;
    }
    
    getAddressText() {
        if (this.isIssuer) {
            return this.data.token.issuer ? truncateMiddle(this.data.token.issuer, 6, 4) : 'ISSUER';
        }
        return truncateMiddle(this.data.address, 6, 4);
    }
    
    update(canvas, allBubbles) {
        if (this.fixed || this.isDragging) return;
        
        // Apply gentle spring force toward target position
        this.vx += (this.targetX - this.x) * this.spring;
        this.vy += (this.targetY - this.y) * this.spring;
        
        // Apply friction
        this.vx *= this.friction;
        this.vy *= this.friction;
        
        // Update position
        this.x += this.vx;
        this.y += this.vy;
        
        // Handle collisions with other bubbles
        this.handleCollisions(allBubbles);
        
        // Handle wall collisions with padding
        const padding = this.radius;
        if (this.x - this.radius < padding) {
            this.x = padding + this.radius;
            this.vx *= -0.8;
        }
        if (this.x + this.radius > canvas.width - padding) {
            this.x = canvas.width - padding - this.radius;
            this.vx *= -0.8;
        }
        if (this.y - this.radius < padding) {
            this.y = padding + this.radius;
            this.vy *= -0.8;
        }
        if (this.y + this.radius > canvas.height - padding) {
            this.y = canvas.height - padding - this.radius;
            this.vy *= -0.8;
        }
        
        // Gentle pulsing animation when not hovered
        if (!this.isHovered) {
            this.pulsePhase += 0.03;
            this.radius = this.baseRadius * (1 + Math.sin(this.pulsePhase) * 0.03);
        }
    }
    
    handleCollisions(otherBubbles) {
        for (const other of otherBubbles) {
            if (other === this || other.isDragging) continue;
            
            const dx = other.x - this.x;
            const dy = other.y - this.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const minDistance = this.radius + other.radius;
            
            if (distance < minDistance) {
                // Collision detected - push bubbles apart
                const angle = Math.atan2(dy, dx);
                const targetX = this.x + Math.cos(angle + Math.PI) * minDistance;
                const targetY = this.y + Math.sin(angle + Math.PI) * minDistance;
                
                const ax = (targetX - other.x) * 0.05;
                const ay = (targetY - other.y) * 0.05;
                
                // Apply repulsion force
                if (!other.fixed) {
                    other.vx -= ax;
                    other.vy -= ay;
                }
                
                if (!this.fixed) {
                    this.vx += ax;
                    this.vy += ay;
                }
            }
        }
    }
    
    draw(ctx) {
        // Draw bubble with enhanced gradient
        const gradient = ctx.createRadialGradient(
            this.x - this.radius * 0.3, this.y - this.radius * 0.3, 0,
            this.x, this.y, this.radius
        );
        
        if (this.isHovered) {
            gradient.addColorStop(0, this.color + 'FF');
            gradient.addColorStop(0.7, this.color + 'AA');
            gradient.addColorStop(1, this.color + '66');
        } else {
            gradient.addColorStop(0, this.color + 'DD');
            gradient.addColorStop(0.7, this.color + '99');
            gradient.addColorStop(1, this.color + '55');
        }
        
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();
        
        // Draw border with enhanced effect
        ctx.strokeStyle = this.isHovered ? '#FFFFFF' : this.color + 'CC';
        ctx.lineWidth = this.isHovered ? 3 : 2;
        ctx.stroke();
        
        // Draw glow effect
        if (this.isHovered) {
            ctx.shadowColor = this.color;
            ctx.shadowBlur = 20;
            ctx.stroke();
            ctx.shadowBlur = 0;
        }
        
        // Draw address text
        ctx.fillStyle = this.isHovered ? '#000000' : '#FFFFFF';
        ctx.font = `bold ${Math.max(8, this.radius * 0.3)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.addressText, this.x, this.y);
        
        // Draw percentage for larger bubbles
        if (this.radius > 25 && !this.isIssuer) {
            ctx.fillStyle = this.isHovered ? '#000000' : '#CCCCCC';
            ctx.font = `bold ${Math.max(6, this.radius * 0.2)}px sans-serif`;
            ctx.fillText(`${this.data.percentage.toFixed(1)}%`, this.x, this.y + this.radius * 0.4);
        }
        
        // Draw issuer label
        if (this.isIssuer) {
            ctx.fillStyle = '#000000';
            ctx.font = `bold ${Math.max(10, this.radius * 0.4)}px sans-serif`;
            ctx.fillText('ISSUER', this.x, this.y - this.radius * 0.6);
        }
    }
    
    containsPoint(x, y) {
        const distance = Math.sqrt((x - this.x) ** 2 + (y - this.y) ** 2);
        return distance <= this.radius;
    }
    
    startDrag(x, y) {
        this.isDragging = true;
        this.dragOffsetX = x - this.x;
        this.dragOffsetY = y - this.y;
        this.vx = 0;
        this.vy = 0;
    }
    
    updateDrag(x, y) {
        if (this.isDragging) {
            this.x = x - this.dragOffsetX;
            this.y = y - this.dragOffsetY;
        }
    }
    
    endDrag() {
        this.isDragging = false;
        // Give a little momentum after drag
        this.vx = (this.x - this.prevX) * 0.5 || 0;
        this.vy = (this.y - this.prevY) * 0.5 || 0;
        this.prevX = this.x;
        this.prevY = this.y;
    }
}

/* ---------- HELPER FUNCTIONS ---------- */
function formatNumberLocal(number, decimals = 2) {
  if (typeof formatNumber === 'function') {
    return formatNumber(number, decimals);
  }
  // Fallback if formatNumber not available
  if (number === null || number === undefined || isNaN(number)) return '0';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(number);
}

function truncateMiddle(str, startLength = 6, endLength = 4) {
    if (!str) return '';
    if (str.length <= startLength + endLength) return str;
    return `${str.substring(0, startLength)}...${str.substring(str.length - endLength)}`;
}

function getHolderTypeInfo(type) {
    const types = {
        'exchange': { label: 'Exchange', color: '#FF6B6B', borderColor: '#FF4757' },
        'institution': { label: 'Institution', color: '#4ECDC4', borderColor: '#2BCBBA' },
        'whale': { label: 'Large Holder', color: '#45B7D1', borderColor: '#2A9BC6' },
        'holder': { label: 'Holder', color: '#96CEB4', borderColor: '#7BC29B' },
        'user': { label: 'User', color: '#FECA57', borderColor: '#F9BF3B' }
    };
    return types[type] || { label: 'Holder', color: '#CCCCCC', borderColor: '#AAAAAA' };
}

/* ---------- INITIALIZE DISTRIBUTION MAP ---------- */
function initDistributionMap() {
  console.log('🗺️ Initializing enhanced distribution map...');
  
  const container = document.getElementById('tokenDistributionChart');
  if (!container) {
    console.warn('⚠️ Distribution chart container not found');
    return;
  }
  
  // Enhanced HTML with better controls and instructions
  container.innerHTML = `
    <div style="position: relative; background: var(--bg-tertiary); border-radius: 12px; overflow: hidden;">
      <canvas id="distributionCanvas" 
              style="width: 100%; height: 500px; cursor: grab; display: block;"></canvas>
      
      <!-- Enhanced Tooltip -->
      <div id="distributionTooltip" style="
        position: absolute;
        background: var(--card-bg);
        border: 2px solid var(--accent-primary);
        border-radius: 8px;
        padding: 12px 14px;
        color: var(--text-primary);
        font-size: 0.85em;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.3s, transform 0.2s;
        z-index: 100;
        box-shadow: 0 8px 25px rgba(0,0,0,0.4);
        max-width: 280px;
        backdrop-filter: blur(12px);
        transform: scale(0.95);
        transform-origin: center;
      "></div>
      
      <!-- Enhanced Controls -->
      <div style="position: absolute; top: 10px; right: 10px; display: flex; gap: 10px; flex-direction: column;">
        <button onclick="toggleAnimation()" style="
          padding: 8px 16px;
          background: var(--accent-primary);
          border: none;
          border-radius: 8px;
          color: #000;
          font-weight: bold;
          cursor: pointer;
          font-size: 0.9em;
        ">
          <span id="animToggle">⏸ Pause</span>
        </button>
        <button onclick="resetBubblePositions()" style="
          padding: 8px 16px;
          background: var(--accent-tertiary);
          border: none;
          border-radius: 8px;
          color: #000;
          font-weight: bold;
          cursor: pointer;
          font-size: 0.9em;
        ">
          🔄 Reset
        </button>
        <button onclick="resetDistributionView()" style="
          padding: 8px 16px;
          background: var(--accent-secondary);
          border: none;
          border-radius: 8px;
          color: #000;
          font-weight: bold;
          cursor: pointer;
          font-size: 0.9em;
        ">
          🗺️ Reload
        </button>
      </div>
      
      <!-- Enhanced Legend -->
      <div style="position: absolute; bottom: 10px; left: 10px; background: rgba(0,0,0,0.8); padding: 12px; border-radius: 8px; font-size: 0.85em; border: 1px solid var(--accent-tertiary);">
        <div style="margin-bottom: 8px; font-weight: bold; color: var(--accent-secondary);">Holder Types</div>
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 5px;">
          <div style="width: 12px; height: 12px; background: #FFD700; border-radius: 50%; border: 2px solid #FFA500;"></div>
          <span>Issuer</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 5px;">
          <div style="width: 12px; height: 12px; background: #FF6B6B; border-radius: 50%; border: 2px solid #FF4757;"></div>
          <span>Exchanges</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 5px;">
          <div style="width: 12px; height: 12px; background: #4ECDC4; border-radius: 50%; border: 2px solid #2BCBBA;"></div>
          <span>Institutions</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 5px;">
          <div style="width: 12px; height: 12px; background: #45B7D1; border-radius: 50%; border: 2px solid #2A9BC6;"></div>
          <span>Large Holders</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 5px;">
          <div style="width: 12px; height: 12px; background: #96CEB4; border-radius: 50%; border: 2px solid #7BC29B;"></div>
          <span>Holders</span>
        </div>
        <div style="margin-top: 8px; font-size: 0.75em; color: var(--text-secondary);">
          💡 Drag bubbles • 🔍 Hover for details • 🌐 Click to explore
        </div>
      </div>
    </div>
  `;
  
  // Wait for DOM update
  setTimeout(() => {
    distributionCanvas = document.getElementById('distributionCanvas');
    if (!distributionCanvas) {
      console.error('❌ Failed to create distribution canvas');
      return;
    }
    
    distributionCtx = distributionCanvas.getContext('2d');
    
    // Set canvas size
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    
    // Enhanced mouse events with drag support
    setupEnhancedInteractivity();
    
    // Show placeholder
    renderPlaceholderDistribution();
    
    // Start enhanced animation
    animateEnhanced();
    
    console.log('✅ Enhanced distribution map initialized');
  }, 100);
}

/* ---------- ENHANCED INTERACTIVITY ---------- */
function setupEnhancedInteractivity() {
    if (!distributionCanvas) return;
    
    let mouseX = 0, mouseY = 0;
    
    // Mouse move for hover effects and dragging
    distributionCanvas.addEventListener('mousemove', (e) => {
        const rect = distributionCanvas.getBoundingClientRect();
        const scale = distributionCanvas.width / rect.width;
        mouseX = (e.clientX - rect.left) * scale;
        mouseY = (e.clientY - rect.top) * scale;
        
        // Update hover states
        let hoveredBubble = null;
        for (const bubble of bubbles) {
            const wasHovered = bubble.isHovered;
            bubble.isHovered = bubble.containsPoint(mouseX, mouseY);
            
            if (bubble.isHovered && !wasHovered) {
                hoveredBubble = bubble;
                distributionCanvas.style.cursor = 'pointer';
            }
        }
        
        // Update tooltip
        updateEnhancedTooltip(e.clientX, e.clientY, hoveredBubble);
        
        // Update drag if active
        if (isDragging && dragBubble) {
            dragBubble.updateDrag(mouseX, mouseY);
        }
    });
    
    // Mouse down for dragging
    distributionCanvas.addEventListener('mousedown', (e) => {
        const rect = distributionCanvas.getBoundingClientRect();
        const scale = distributionCanvas.width / rect.width;
        const x = (e.clientX - rect.left) * scale;
        const y = (e.clientY - rect.top) * scale;
        
        for (const bubble of bubbles) {
            if (bubble.containsPoint(x, y) && !bubble.fixed) {
                isDragging = true;
                dragBubble = bubble;
                bubble.startDrag(x, y);
                distributionCanvas.style.cursor = 'grabbing';
                break;
            }
        }
    });
    
    // Mouse up to release drag
    distributionCanvas.addEventListener('mouseup', () => {
        if (isDragging && dragBubble) {
            dragBubble.endDrag();
            isDragging = false;
            dragBubble = null;
            distributionCanvas.style.cursor = 'grab';
        }
    });
    
    // Mouse leave
    distributionCanvas.addEventListener('mouseleave', () => {
        // Clear all hover states
        bubbles.forEach(bubble => {
            bubble.isHovered = false;
        });
        
        // Hide tooltip
        const tooltip = document.getElementById('distributionTooltip');
        if (tooltip) {
            tooltip.style.opacity = '0';
        }
        
        distributionCanvas.style.cursor = 'grab';
    });
    
    // Click for XRPScan navigation
    distributionCanvas.addEventListener('click', (e) => {
        if (isDragging) return; // Don't trigger click if we were dragging
        
        const rect = distributionCanvas.getBoundingClientRect();
        const scale = distributionCanvas.width / rect.width;
        const x = (e.clientX - rect.left) * scale;
        const y = (e.clientY - rect.top) * scale;
        
        for (const bubble of bubbles) {
            if (bubble.containsPoint(x, y)) {
                if (bubble.isIssuer) {
                    openXRPScan(selectedToken.code, selectedToken.issuer);
                } else {
                    openAccountXRPScan(bubble.data.address);
                }
                break;
            }
        }
    });
}

function updateEnhancedTooltip(clientX, clientY, bubble) {
    const tooltip = document.getElementById('distributionTooltip');
    if (!tooltip) return;
    
    if (bubble) {
        tooltip.style.opacity = '1';
        tooltip.style.transform = 'scale(1)';
        tooltip.style.left = (clientX + 15) + 'px';
        tooltip.style.top = (clientY - 10) + 'px';
        
        if (bubble.isIssuer) {
            tooltip.innerHTML = `
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                    <div style="width: 12px; height: 12px; background: #FFD700; border-radius: 50%; border: 2px solid #FFA500;"></div>
                    <strong style="color: var(--text-primary);">Token Issuer</strong>
                </div>
                <div style="margin-bottom: 6px; font-size: 1.1em; font-weight: bold;">
                    ${bubble.data.token.icon || '🪙'} ${bubble.data.token.code}
                </div>
                <div style="margin-bottom: 4px; color: var(--text-secondary);">
                    ${bubble.data.token.name}
                </div>
                ${bubble.data.token.issuer ? `
                <div style="font-family: monospace; font-size: 0.8em; color: var(--accent-secondary); margin-bottom: 6px;">
                    ${bubble.data.token.issuer}
                </div>
                ` : ''}
                <div style="font-size: 0.8em; color: var(--text-secondary); border-top: 1px solid var(--accent-tertiary); padding-top: 6px;">
                    Click to view on XRPScan
                </div>
            `;
        } else {
            const typeInfo = getHolderTypeInfo(bubble.data.type);
            tooltip.innerHTML = `
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                    <div style="width: 12px; height: 12px; background: ${typeInfo.color}; border-radius: 50%; border: 2px solid ${typeInfo.borderColor};"></div>
                    <strong style="color: var(--text-primary);">${typeInfo.label}</strong>
                </div>
                <div style="margin-bottom: 6px; font-weight: bold; font-size: 1.1em;">
                    ${bubble.data.name}
                </div>
                <div style="font-family: monospace; font-size: 0.8em; color: var(--text-secondary); margin-bottom: 8px; word-break: break-all;">
                    ${bubble.data.address}
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px;">
                    <div style="text-align: center;">
                        <div style="font-size: 0.75em; color: var(--text-secondary);">Balance</div>
                        <div style="font-weight: bold; color: var(--accent-secondary);">
                            ${formatNumberLocal(bubble.data.balance, 0)}
                        </div>
                    </div>
                    <div style="text-align: center;">
                        <div style="font-size: 0.75em; color: var(--text-secondary);">Supply</div>
                        <div style="font-weight: bold; color: var(--accent-primary);">
                            ${bubble.data.percentage.toFixed(2)}%
                        </div>
                    </div>
                </div>
                <div style="font-size: 0.75em; color: var(--text-secondary); border-top: 1px solid var(--accent-tertiary); padding-top: 6px;">
                    Click to view account on XRPScan
                </div>
            `;
        }
    } else {
        tooltip.style.opacity = '0';
        tooltip.style.transform = 'scale(0.95)';
    }
}

/* ---------- ENHANCED ANIMATION LOOP ---------- */
function animateEnhanced() {
    if (!isPaused && distributionCtx && distributionCanvas) {
        updateEnhancedPhysics();
        renderEnhanced();
    }
    animationFrame = requestAnimationFrame(animateEnhanced);
}

function updateEnhancedPhysics() {
    if (!distributionCanvas) return;
    
    // Update bubble physics
    bubbles.forEach(bubble => {
        bubble.update(distributionCanvas, bubbles);
    });
}

function renderEnhanced() {
    if (!distributionCtx || !distributionCanvas) return;
    
    const ctx = distributionCtx;
    const width = distributionCanvas.width;
    const height = distributionCanvas.height;
    
    // Clear canvas with nice gradient background
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#1a1b26');
    gradient.addColorStop(1, '#2a2b3d');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    
    // Draw subtle grid
    drawGrid(ctx, width, height);
    
    // Draw connections from issuer to holders
    drawConnections(ctx);
    
    // Update and draw all bubbles (in reverse so larger ones don't cover smaller ones completely)
    bubbles.forEach(bubble => {
        bubble.update(distributionCanvas, bubbles);
    });
    
    // Draw bubbles in correct order
    [...bubbles].sort((a, b) => a.radius - b.radius).forEach(bubble => {
        bubble.draw(ctx);
    });
    
    // Draw title and info
    if (selectedToken) {
        drawTitleAndInfo(ctx, width, selectedToken, bubbles.filter(b => !b.isIssuer).length);
    }
}

function drawGrid(ctx, width, height) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    
    // Vertical lines
    for (let x = 0; x <= width; x += 50) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
    }
    
    // Horizontal lines
    for (let y = 0; y <= height; y += 50) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
    }
}

function drawConnections(ctx) {
    const issuer = bubbles.find(b => b.isIssuer);
    if (!issuer) return;
    
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    
    bubbles.forEach(bubble => {
        if (!bubble.isIssuer) {
            ctx.beginPath();
            ctx.moveTo(issuer.x, issuer.y);
            ctx.lineTo(bubble.x, bubble.y);
            ctx.stroke();
        }
    });
}

function drawTitleAndInfo(ctx, width, token, holderCount) {
    // Title with background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(width / 2 - 200, 10, 400, 60);
    
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${token.icon || '🪙'} ${token.code} Distribution Network`, width / 2, 35);
    
    ctx.font = '14px sans-serif';
    ctx.fillStyle = '#cccccc';
    ctx.fillText(`Total Holders: ${holderCount} | Supply: ${formatNumberLocal(token.supply || 0, 0)} ${token.code}`, width / 2, 55);
}

/* ---------- RESIZE CANVAS ---------- */
function resizeCanvas() {
    if (!distributionCanvas) return;
    
    const rect = distributionCanvas.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    
    distributionCanvas.width = rect.width * scale;
    distributionCanvas.height = rect.height * scale;
    
    distributionCtx.scale(scale, scale);
    
    // Redraw current content
    if (selectedToken && bubbles.length > 0) {
        renderEnhanced();
    } else {
        renderPlaceholderDistribution();
    }
}

/* ---------- RENDER DISTRIBUTION FOR TOKEN ---------- */
async function renderTokenDistribution(token) {
    console.log('🗺️ Rendering enhanced distribution for token:', token);
    
    if (!token) {
        renderPlaceholderDistribution();
        return;
    }
    
    selectedToken = token;
    
    // Clear existing animation
    if (animationFrame) {
        cancelAnimationFrame(animationFrame);
        bubbles = [];
    }
    
    // Check if we have real XRPL data or need to use simulated data
    if (window.xrplClient?.isConnected && token.issuer) {
        await renderRealXRPLDistribution(token);
    } else {
        renderSimulatedDistribution(token);
    }
    
    // Restart animation
    animateEnhanced();
}

async function renderRealXRPLDistribution(token) {
    try {
        console.log('📡 Fetching real XRPL token holders for:', token.code, 'issued by', token.issuer);
        
        const holders = [];
        let marker = undefined;
        let iterations = 0;
        const maxIterations = 3; // Limit for performance
        
        do {
            const request = {
                command: 'account_lines',
                account: token.issuer,
                ledger_index: 'validated',
                limit: 400
            };
            
            if (marker) request.marker = marker;
            
            const response = await window.xrplClient.request(request);
            const lines = response?.result?.lines || [];
            
            // Filter for this specific currency and positive balances (holders)
            const tokenHolders = lines.filter(line => {
                const balance = parseFloat(line.balance) || 0;
                return line.currency === token.code && balance < 0;
            });
            
            holders.push(...tokenHolders);
            marker = response?.result?.marker;
            iterations++;
            
            console.log(`📊 Batch ${iterations}: Found ${tokenHolders.length} holders (${holders.length} total)`);
            
        } while (marker && iterations < maxIterations);
        
        console.log(`✅ Total real holders found: ${holders.length}`);
        
        if (holders.length === 0) {
            console.warn('⚠️ No real holders found, using simulated data');
            renderSimulatedDistribution(token);
            return;
        }
        
        createEnhancedNetworkData(token, holders, true);
        
    } catch (error) {
        console.error('❌ Error fetching real XRPL data:', error);
        renderSimulatedDistribution(token);
    }
}

function renderSimulatedDistribution(token) {
    console.log('🎮 Using simulated distribution data for:', token.code);
    const simulatedHolders = generateRealisticHolders(token);
    createEnhancedNetworkData(token, simulatedHolders, false);
}

function generateRealisticHolders(token) {
    const holders = [];
    const totalSupply = token.supply || 1000000000;
    
    // Major exchanges with realistic distributions
    const majorHolders = [
        { name: 'Binance', address: 'rMQ98K56yXJbDGv49ZSmW51sLn94Xe1mu1', percentage: 15.2 },
        { name: 'GateHub', address: 'rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq', percentage: 9.8 },
        { name: 'Bitstamp', address: 'rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B', percentage: 7.5 },
        { name: 'Uphold', address: 'rEsnqhdvmv2JVQqjcjD8eIt9KPY7a1KrK6', percentage: 5.2 },
        { name: 'Kraken', address: 'rLhz5dEuRPXJgoZSAFtvP3GkNo1WyLtucC', percentage: 4.8 }
    ];
    
    // Add major holders
    majorHolders.forEach(holder => {
        holders.push({
            name: holder.name,
            address: holder.address,
            balance: totalSupply * holder.percentage / 100,
            percentage: holder.percentage,
            type: 'exchange'
        });
    });
    
    // Add other holder types
    let remainingPercentage = 100 - majorHolders.reduce((sum, h) => sum + h.percentage, 0);
    
    // Institutional holders
    const institutionalCount = 4;
    for (let i = 0; i < institutionalCount; i++) {
        if (remainingPercentage <= 3) break;
        const percentage = 3 + Math.random() * 5;
        if (percentage <= remainingPercentage) {
            holders.push({
                name: `Fund ${String.fromCharCode(65 + i)}`,
                address: `rFund${i}${Math.random().toString(36).substr(2, 8)}`,
                balance: totalSupply * percentage / 100,
                percentage: percentage,
                type: 'institution'
            });
            remainingPercentage -= percentage;
        }
    }
    
    // Whale holders
    const whaleCount = 8;
    for (let i = 0; i < whaleCount; i++) {
        if (remainingPercentage <= 1) break;
        const percentage = 1 + Math.random() * 2;
        if (percentage <= remainingPercentage) {
            holders.push({
                name: `Whale ${i + 1}`,
                address: `rWhale${i}${Math.random().toString(36).substr(2, 8)}`,
                balance: totalSupply * percentage / 100,
                percentage: percentage,
                type: 'whale'
            });
            remainingPercentage -= percentage;
        }
    }
    
    // Regular holders
    const holderCount = 15;
    for (let i = 0; i < holderCount; i++) {
        if (remainingPercentage <= 0.2) break;
        const percentage = 0.2 + Math.random() * 0.8;
        if (percentage <= remainingPercentage) {
            holders.push({
                name: `Holder ${i + 1}`,
                address: `rHolder${i}${Math.random().toString(36).substr(2, 8)}`,
                balance: totalSupply * percentage / 100,
                percentage: percentage,
                type: 'holder'
            });
            remainingPercentage -= percentage;
        }
    }
    
    return holders;
}

function createEnhancedNetworkData(token, holders, isRealData) {
    if (!distributionCanvas) return;
    
    const width = distributionCanvas.width;
    const height = distributionCanvas.height;
    
    bubbles = [];
    
    // Issuer bubble (center, fixed position)
    const issuerBubble = new Bubble(
        width / 2,
        height / 2,
        60,
        '#FFD700',
        { type: 'issuer', token: token },
        true
    );
    bubbles.push(issuerBubble);
    
    // Create holder bubbles with non-overlapping initial positions
    const angleStep = (Math.PI * 2) / holders.length;
    const baseDistance = 150;
    
    holders.forEach((holder, index) => {
        const typeInfo = getHolderTypeInfo(holder.type);
        
        // Calculate bubble size based on percentage (min 20px, max 90px for non-issuer)
        const radius = Math.max(20, Math.min(90, holder.percentage * 4));
        
        // Position in circular pattern around issuer
        const angle = index * angleStep;
        const distance = baseDistance + (holder.percentage * 2);
        const x = width / 2 + Math.cos(angle) * distance;
        const y = height / 2 + Math.sin(angle) * distance;
        
        const bubble = new Bubble(x, y, radius, typeInfo.color, holder);
        bubble.targetX = x;
        bubble.targetY = y;
        bubbles.push(bubble);
    });
    
    console.log(`✅ Created ${bubbles.length} bubbles (${isRealData ? 'real XRPL data' : 'simulated data'})`);
}

/* ---------- PLACEHOLDER VISUALIZATION ---------- */
function renderPlaceholderDistribution() {
    if (!distributionCtx || !distributionCanvas) return;
    
    const ctx = distributionCtx;
    const width = distributionCanvas.width;
    const height = distributionCanvas.height;
    
    // Clear with gradient
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#1a1b26');
    gradient.addColorStop(1, '#2a2b3d');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    
    // Draw placeholder message
    ctx.fillStyle = '#aaa';
    ctx.font = '18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Select a token to view interactive distribution network', width / 2, height / 2);
    
    // Draw instructions
    ctx.fillStyle = '#666';
    ctx.font = '14px sans-serif';
    ctx.fillText('💡 Bubbles show token holders • 🔍 Hover for details • 🖱️ Drag to explore', width / 2, height / 2 + 30);
}

/* ---------- CONTROL FUNCTIONS ---------- */
function toggleAnimation() {
    isPaused = !isPaused;
    const btn = document.getElementById('animToggle');
    if (btn) btn.textContent = isPaused ? '▶ Play' : '⏸ Pause';
}

function resetBubblePositions() {
    if (!selectedToken || bubbles.length === 0) return;
    
    const width = distributionCanvas.width;
    const height = distributionCanvas.height;
    const holders = bubbles.filter(b => !b.isIssuer);
    const angleStep = (Math.PI * 2) / holders.length;
    const baseDistance = 150;
    
    // Reset positions in circular pattern
    holders.forEach((bubble, index) => {
        const angle = index * angleStep;
        const distance = baseDistance + (bubble.data.percentage * 2);
        bubble.x = width / 2 + Math.cos(angle) * distance;
        bubble.y = height / 2 + Math.sin(angle) * distance;
        bubble.targetX = bubble.x;
        bubble.targetY = bubble.y;
        bubble.vx = 0;
        bubble.vy = 0;
    });
    
    if (typeof showNotification === 'function') {
        showNotification('Bubble positions reset', 'info', 2000);
    }
}

function resetDistributionView() {
    if (selectedToken) {
        renderTokenDistribution(selectedToken);
    } else {
        renderPlaceholderDistribution();
    }
}

function openXRPScan(code, issuer) {
    let url;
    if (code === 'XRP') {
        url = 'https://xrpscan.com';
    } else if (issuer) {
        url = `https://xrpscan.com/token/${code}.${issuer}`;
    } else {
        url = 'https://xrpscan.com';
    }
    window.open(url, '_blank');
}

function openAccountXRPScan(address) {
    const url = `https://xrpscan.com/account/${address}`;
    window.open(url, '_blank');
}

/* ---------- CLEANUP ---------- */
function cleanupDistributionMap() {
    if (animationFrame) {
        cancelAnimationFrame(animationFrame);
        animationFrame = null;
    }
    
    if (distributionCanvas) {
        distributionCanvas.removeEventListener('mousemove', handleMouseMove);
        distributionCanvas.removeEventListener('click', handleClick);
        distributionCanvas.removeEventListener('mouseleave', handleMouseLeave);
    }
    
    bubbles = [];
    nodes = [];
    edges = [];
    hoveredNode = null;
    selectedToken = null;
    isDragging = false;
    dragBubble = null;
}

/* ---------- EXPORTS ---------- */
window.initDistributionMap = initDistributionMap;
window.renderTokenDistribution = renderTokenDistribution;
window.toggleAnimation = toggleAnimation;
window.resetDistributionView = resetDistributionView;
window.resetBubblePositions = resetBubblePositions;
window.cleanupDistributionMap = cleanupDistributionMap;

console.log('🗺️ Enhanced Token Distribution Map loaded with physics and real XRPL data');