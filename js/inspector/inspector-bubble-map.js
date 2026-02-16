/* =========================================================
   FILE: js/inspector/inspector-bubble-map.js
   NaluXRP - Interactive Bubble Map for Fund Flow Visualization
   Shows: XRP → NFTs, AMM, Offers, Payments, etc.
   ========================================================= */

(function () {
  'use strict';

  const BUBBLE_CONFIG = {
    canvas: {
      width: 1200,
      height: 700,
      padding: 60
    },
    bubbles: {
      minRadius: 20,
      maxRadius: 100,
      centerRadius: 60
    },
    colors: {
      center: '#FFD700',
      payment: '#50fa7b',
      nft: '#bd93f9',
      amm: '#00d4ff',
      offer: '#ffb86c',
      trustline: '#ff79c6',
      escrow: '#f1fa8c',
      check: '#8be9fd',
      unknown: '#6272a4'
    },
    animation: {
      enabled: true,
      speed: 0.02,
      friction: 0.92
    }
  };

  let canvas, ctx, bubbles = [];
  let animationFrame = null;
  let hoveredBubble = null;
  let selectedBubble = null;
  let isDragging = false;
  let draggedBubble = null;

  class TraceBubble {
    constructor(data) {
      this.address = data.address;
      this.type = data.type;
      this.amount = data.amount || 0;
      this.txCount = data.txCount || 0;
      this.edges = data.edges || [];
      
      this.x = data.x || Math.random() * BUBBLE_CONFIG.canvas.width;
      this.y = data.y || Math.random() * BUBBLE_CONFIG.canvas.height;
      this.targetX = this.x;
      this.targetY = this.y;
      
      this.vx = 0;
      this.vy = 0;
      this.radius = this.calculateRadius();
      this.color = BUBBLE_CONFIG.colors[this.type] || BUBBLE_CONFIG.colors.unknown;
      
      this.pulseOffset = Math.random() * Math.PI * 2;
      this.opacity = 1;
      this.isCenter = this.type === 'center';
    }

    calculateRadius() {
      const { minRadius, maxRadius, centerRadius } = BUBBLE_CONFIG.bubbles;
      if (this.type === 'center') return centerRadius;
      
      const value = Math.max(this.amount, this.txCount);
      const scale = Math.log10(Math.max(1, value)) / 7;
      return minRadius + (maxRadius - minRadius) * Math.min(1, scale);
    }

    update(allBubbles) {
      if (this.isCenter || draggedBubble === this) return;
      
      this.applyForces(allBubbles);
      
      this.vx *= BUBBLE_CONFIG.animation.friction;
      this.vy *= BUBBLE_CONFIG.animation.friction;
      this.x += this.vx;
      this.y += this.vy;
      
      const padding = BUBBLE_CONFIG.canvas.padding;
      if (this.x - this.radius < padding) {
        this.x = padding + this.radius;
        this.vx *= -0.5;
      }
      if (this.x + this.radius > BUBBLE_CONFIG.canvas.width - padding) {
        this.x = BUBBLE_CONFIG.canvas.width - padding - this.radius;
        this.vx *= -0.5;
      }
      if (this.y - this.radius < padding) {
        this.y = padding + this.radius;
        this.vy *= -0.5;
      }
      if (this.y + this.radius > BUBBLE_CONFIG.canvas.height - padding) {
        this.y = BUBBLE_CONFIG.canvas.height - padding - this.radius;
        this.vy *= -0.5;
      }
    }

    applyForces(allBubbles) {
      const dx = this.targetX - this.x;
      const dy = this.targetY - this.y;
      this.vx += dx * 0.008;
      this.vy += dy * 0.008;
      
      allBubbles.forEach(other => {
        if (other === this) return;
        const dx = this.x - other.x;
        const dy = this.y - other.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const minDist = this.radius + other.radius + 15;
        
        if (dist < minDist && dist > 0) {
          const force = (minDist - dist) / dist * 0.5;
          this.vx += dx * force;
          this.vy += dy * force;
        }
      });
    }

    draw(ctx, time) {
      const pulse = Math.sin(time * 0.003 + this.pulseOffset) * 3;
      const r = this.radius + pulse;
      
      const gradient = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, r * 1.5);
      gradient.addColorStop(0, this.color + '60');
      gradient.addColorStop(0.5, this.color + '30');
      gradient.addColorStop(1, this.color + '00');
      ctx.fillStyle = gradient;
      ctx.fillRect(this.x - r * 1.5, this.y - r * 1.5, r * 3, r * 3);
      
      ctx.beginPath();
      ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
      ctx.fillStyle = this.color + (this.isCenter ? 'CC' : '99');
      ctx.fill();
      
      ctx.strokeStyle = this.color;
      ctx.lineWidth = this.isCenter ? 4 : 2;
      ctx.stroke();
      
      if (hoveredBubble === this || selectedBubble === this) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 4;
        ctx.stroke();
      }
      
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${r * 0.5}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const icon = this.getIcon();
      ctx.fillText(icon, this.x, this.y);
      
      if (this.txCount > 0 && r > 30) {
        ctx.font = `bold ${Math.min(r * 0.25, 14)}px Arial`;
        ctx.fillStyle = '#ffffff';
        ctx.fillText(this.txCount, this.x, this.y + r * 0.6);
      }
    }

    getIcon() {
      const icons = {
        center: '🎯',
        payment: '💸',
        nft: '🎨',
        amm: '💧',
        offer: '📊',
        trustline: '🤝',
        escrow: '🔒',
        check: '✓',
        unknown: '❓'
      };
      return icons[this.type] || icons.unknown;
    }

    contains(x, y) {
      const dx = x - this.x;
      const dy = y - this.y;
      return Math.sqrt(dx * dx + dy * dy) <= this.radius;
    }
  }

  function initBubbleMap(containerEl) {
    canvas = document.createElement('canvas');
    canvas.id = 'bubble-map-canvas';
    canvas.width = BUBBLE_CONFIG.canvas.width;
    canvas.height = BUBBLE_CONFIG.canvas.height;
    canvas.style.width = '100%';
    canvas.style.height = 'auto';
    canvas.style.maxHeight = '700px';
    canvas.style.borderRadius = '16px';
    canvas.style.background = 'rgba(0, 0, 0, 0.4)';
    canvas.style.border = '1px solid rgba(255, 255, 255, 0.15)';
    canvas.style.cursor = 'grab';
    canvas.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.4), inset 0 2px 8px rgba(0, 0, 0, 0.3)';
    
    containerEl.innerHTML = '';
    containerEl.appendChild(canvas);
    
    ctx = canvas.getContext('2d');
    
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('click', handleClick);
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseleave', handleMouseLeave);
    
    return canvas;
  }

  function buildBubbleMap(traceData) {
    bubbles = [];
    
    const centerX = BUBBLE_CONFIG.canvas.width / 2;
    const centerY = BUBBLE_CONFIG.canvas.height / 2;
    
    bubbles.push(new TraceBubble({
      address: traceData.origin,
      type: 'center',
      x: centerX,
      y: centerY,
      txCount: traceData.edges?.length || 0
    }));
    
    const destMap = new Map();
    
    (traceData.edges || []).forEach(edge => {
      const key = edge.to;
      if (!destMap.has(key)) {
        destMap.set(key, {
          address: edge.to,
          type: categorizeEdgeType(edge),
          amount: 0,
          txCount: 0,
          edges: []
        });
      }
      const dest = destMap.get(key);
      dest.amount += parseFloat(edge.amount) || 0;
      dest.txCount += 1;
      dest.edges.push(edge);
    });
    
    const entries = Array.from(destMap.values());
    const totalBubbles = entries.length;
    
    entries.forEach((data, i) => {
      const angle = (i / totalBubbles) * Math.PI * 2;
      const distance = 180 + Math.random() * 80;
      
      data.x = centerX + Math.cos(angle) * distance;
      data.y = centerY + Math.sin(angle) * distance;
      data.targetX = data.x;
      data.targetY = data.y;
      
      bubbles.push(new TraceBubble(data));
    });
    
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animate();
  }

  function categorizeEdgeType(edge) {
    const type = (edge.type || '').toLowerCase();
    
    if (type.includes('nft') || type.includes('nftoken')) return 'nft';
    if (type.includes('amm')) return 'amm';
    if (type.includes('offer')) return 'offer';
    if (type.includes('trust')) return 'trustline';
    if (type.includes('escrow')) return 'escrow';
    if (type.includes('check')) return 'check';
    if (type.includes('payment')) return 'payment';
    
    return 'unknown';
  }

  function animate() {
    const time = Date.now();
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    drawConnections();
    
    bubbles.forEach(bubble => {
      if (BUBBLE_CONFIG.animation.enabled) {
        bubble.update(bubbles);
      }
      bubble.draw(ctx, time);
    });
    
    animationFrame = requestAnimationFrame(animate);
  }

  function drawConnections() {
    const centerBubble = bubbles[0];
    if (!centerBubble) return;
    
    bubbles.slice(1).forEach(bubble => {
      ctx.beginPath();
      ctx.moveTo(centerBubble.x, centerBubble.y);
      ctx.lineTo(bubble.x, bubble.y);
      
      const gradient = ctx.createLinearGradient(
        centerBubble.x, centerBubble.y,
        bubble.x, bubble.y
      );
      gradient.addColorStop(0, centerBubble.color + '40');
      gradient.addColorStop(1, bubble.color + '40');
      ctx.strokeStyle = gradient;
      
      ctx.lineWidth = Math.max(2, Math.log10(bubble.txCount + 1) * 1.5);
      ctx.stroke();
      
      const angle = Math.atan2(bubble.y - centerBubble.y, bubble.x - centerBubble.x);
      const arrowLength = 12;
      const arrowX = bubble.x - Math.cos(angle) * (bubble.radius + 8);
      const arrowY = bubble.y - Math.sin(angle) * (bubble.radius + 8);
      
      ctx.beginPath();
      ctx.moveTo(arrowX, arrowY);
      ctx.lineTo(
        arrowX - arrowLength * Math.cos(angle - Math.PI / 6),
        arrowY - arrowLength * Math.sin(angle - Math.PI / 6)
      );
      ctx.lineTo(
        arrowX - arrowLength * Math.cos(angle + Math.PI / 6),
        arrowY - arrowLength * Math.sin(angle + Math.PI / 6)
      );
      ctx.closePath();
      ctx.fillStyle = bubble.color + '80';
      ctx.fill();
    });
  }

  function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  }

  function handleMouseMove(e) {
    const pos = getMousePos(e);
    
    if (isDragging && draggedBubble) {
      draggedBubble.x = pos.x;
      draggedBubble.y = pos.y;
      draggedBubble.targetX = pos.x;
      draggedBubble.targetY = pos.y;
      canvas.style.cursor = 'grabbing';
      return;
    }
    
    hoveredBubble = bubbles.find(b => b.contains(pos.x, pos.y)) || null;
    canvas.style.cursor = hoveredBubble ? 'pointer' : 'grab';
    
    showTooltip(e.clientX, e.clientY, hoveredBubble);
  }

  function handleMouseDown(e) {
    const pos = getMousePos(e);
    draggedBubble = bubbles.find(b => b.contains(pos.x, pos.y));
    if (draggedBubble && !draggedBubble.isCenter) {
      isDragging = true;
      canvas.style.cursor = 'grabbing';
    }
  }

  function handleMouseUp() {
    isDragging = false;
    draggedBubble = null;
    canvas.style.cursor = hoveredBubble ? 'pointer' : 'grab';
  }

  function handleMouseLeave() {
    isDragging = false;
    draggedBubble = null;
    hoveredBubble = null;
    hideTooltip();
  }

  function handleClick(e) {
    if (hoveredBubble) {
      selectedBubble = selectedBubble === hoveredBubble ? null : hoveredBubble;
      showBubbleDetails(selectedBubble);
    }
  }

  function showTooltip(x, y, bubble) {
    let tooltip = document.getElementById('bubble-tooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.id = 'bubble-tooltip';
      tooltip.style.cssText = `
        position: fixed;
        background: rgba(0, 0, 0, 0.95);
        color: white;
        padding: 14px;
        border-radius: 12px;
        border: 2px solid rgba(0, 255, 240, 0.4);
        pointer-events: none;
        z-index: 10000;
        font-size: 13px;
        max-width: 280px;
        display: none;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6), 0 0 20px rgba(0, 255, 240, 0.3);
        font-family: 'Outfit', sans-serif;
      `;
      document.body.appendChild(tooltip);
    }
    
    if (bubble) {
      const typeLabel = bubble.type.replace(/([A-Z])/g, ' $1').toUpperCase();
      tooltip.innerHTML = `
        <div style="font-weight: 900; margin-bottom: 8px; font-size: 14px; color: ${bubble.color};">
          ${bubble.getIcon()} ${typeLabel}
        </div>
        <div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; opacity: 0.85; margin-bottom: 10px; word-break: break-all;">
          ${bubble.address.slice(0, 10)}...${bubble.address.slice(-8)}
        </div>
        <div style="margin-bottom: 4px;"><strong>Amount:</strong> ${bubble.amount.toFixed(2)} XRP</div>
        <div style="margin-bottom: 4px;"><strong>Transactions:</strong> ${bubble.txCount}</div>
        <div style="margin-top: 10px; font-size: 11px; opacity: 0.7; font-style: italic;">
          Click for details • Drag to reposition
        </div>
      `;
      tooltip.style.display = 'block';
      tooltip.style.left = (x + 20) + 'px';
      tooltip.style.top = (y + 20) + 'px';
    } else {
      tooltip.style.display = 'none';
    }
  }

  function hideTooltip() {
    const tooltip = document.getElementById('bubble-tooltip');
    if (tooltip) tooltip.style.display = 'none';
  }

  function showBubbleDetails(bubble) {
    const detailsEl = document.getElementById('bubble-details');
    if (!detailsEl) return;
    
    if (!bubble) {
      detailsEl.innerHTML = '<div style="opacity: 0.7; padding: 20px; text-align: center;">Click a bubble to see details</div>';
      return;
    }
    
    const typeLabel = bubble.type.replace(/([A-Z])/g, ' $1').toUpperCase();
    
    detailsEl.innerHTML = `
      <div style="padding: 18px; background: rgba(0, 0, 0, 0.5); border-radius: 16px; border: 2px solid ${bubble.color}40;">
        <h3 style="margin: 0 0 12px 0; color: ${bubble.color}; font-size: 18px; font-weight: 900;">
          ${bubble.getIcon()} ${typeLabel} Details
        </h3>
        
        <div style="font-family: 'JetBrains Mono', monospace; font-size: 12px; margin-bottom: 16px; word-break: break-all; opacity: 0.9;">
          <strong>Address:</strong> ${bubble.address}
        </div>
        
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px;">
          <div style="padding: 12px; background: rgba(255, 255, 255, 0.05); border-radius: 10px;">
            <div style="opacity: 0.7; font-size: 11px; margin-bottom: 4px;">TOTAL AMOUNT</div>
            <div style="font-size: 18px; font-weight: 900; color: ${bubble.color};">${bubble.amount.toFixed(6)} XRP</div>
          </div>
          <div style="padding: 12px; background: rgba(255, 255, 255, 0.05); border-radius: 10px;">
            <div style="opacity: 0.7; font-size: 11px; margin-bottom: 4px;">TRANSACTIONS</div>
            <div style="font-size: 18px; font-weight: 900; color: ${bubble.color};">${bubble.txCount}</div>
          </div>
        </div>
        
        <div style="margin-bottom: 12px;">
          <strong style="font-size: 13px;">Recent Transactions (${Math.min(bubble.edges.length, 5)}/${bubble.edges.length})</strong>
        </div>
        
        <div style="max-height: 250px; overflow-y: auto;">
          ${bubble.edges.slice(0, 5).map(e => `
            <div style="padding: 10px; margin-bottom: 6px; background: rgba(255, 255, 255, 0.05); border-radius: 8px; font-size: 12px; border-left: 3px solid ${bubble.color};">
              <div style="font-weight: 900; margin-bottom: 4px;">${e.amount} ${e.currency || 'XRP'}</div>
              <div style="opacity: 0.75;">Type: ${e.type || 'Unknown'}</div>
              <div style="opacity: 0.75;">Ledger: ${e.ledger_index || 'N/A'}</div>
              ${e.date ? `<div style="opacity: 0.65; font-size: 11px; margin-top: 4px;">${e.date}</div>` : ''}
            </div>
          `).join('')}
        </div>
        
        ${bubble.edges.length > 5 ? `
          <div style="margin-top: 12px; padding: 10px; background: rgba(0, 255, 240, 0.1); border-radius: 8px; font-size: 11px; opacity: 0.8; text-align: center;">
            Showing first 5 of ${bubble.edges.length} transactions
          </div>
        ` : ''}
      </div>
    `;
  }

  function exportBubbleData() {
    return {
      timestamp: new Date().toISOString(),
      bubbles: bubbles.map(b => ({
        address: b.address,
        type: b.type,
        amount: b.amount,
        txCount: b.txCount,
        position: { x: b.x, y: b.y }
      }))
    };
  }

  window.InspectorBubbleMap = {
    init: initBubbleMap,
    build: buildBubbleMap,
    clear: () => {
      bubbles = [];
      if (animationFrame) cancelAnimationFrame(animationFrame);
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      hideTooltip();
      const detailsEl = document.getElementById('bubble-details');
      if (detailsEl) detailsEl.innerHTML = '';
    },
    toggleAnimation: () => {
      BUBBLE_CONFIG.animation.enabled = !BUBBLE_CONFIG.animation.enabled;
      return BUBBLE_CONFIG.animation.enabled;
    },
    export: exportBubbleData,
    resetPositions: () => {
      const centerX = BUBBLE_CONFIG.canvas.width / 2;
      const centerY = BUBBLE_CONFIG.canvas.height / 2;
      const totalBubbles = bubbles.length - 1;
      
      bubbles.forEach((bubble, i) => {
        if (bubble.isCenter) {
          bubble.targetX = centerX;
          bubble.targetY = centerY;
        } else {
          const angle = ((i - 1) / totalBubbles) * Math.PI * 2;
          const distance = 180;
          bubble.targetX = centerX + Math.cos(angle) * distance;
          bubble.targetY = centerY + Math.sin(angle) * distance;
        }
      });
    }
  };

  console.log('✅ Inspector Bubble Map loaded');
})();