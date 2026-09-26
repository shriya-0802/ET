/**
 * Dashboard Client — Real-time updates via WebSocket
 * Used by both User and Admin dashboards
 */

// ── Auth Check ──
const token = localStorage.getItem('token');
const userStr = localStorage.getItem('user');
if (!token || !userStr) {
  window.location.href = '/';
}
const user = JSON.parse(userStr);

// UI setup
document.getElementById('user-name').textContent = user.name;
document.getElementById('user-role').textContent = user.role.toUpperCase();
if (user.role === 'admin') {
  document.getElementById('user-role').className = 'role-tag admin';
} else {
  document.getElementById('user-role').className = 'role-tag user';
}

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  fetch('/api/auth/logout', { method: 'POST' }).then(() => {
    window.location.href = '/';
  });
}

// ── Globals ──
let ws;
let isRunning = false;
let latestData = null;
let historicalData = [];

// Colors
const COLORS = {
  nexus: '#A100FF', helios: '#F59F00', aeolus: '#339AF0', voltaic: '#0CA678',
  mercury: '#E64980', oracle: '#FD7E14', sentinel: '#FA5252',
  bgGrid: '#E9ECEF', textLight: '#212529', textMuted: '#868E96'
};

// ── Setup WebSocket ──
function connectWS() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.host}?token=${token}`);

  ws.onopen = () => console.log('WebSocket Connected');
  
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'error') {
      console.error('WS Error:', msg.message);
      if (msg.message === 'Authentication failed') logout();
    } else if (msg.type === 'sim_status') {
      isRunning = msg.running;
      updateSimStatusUI(msg);
    } else if (msg.type === 'snapshot') {
      latestData = msg.data;
      historicalData.push(msg.data);
      if (historicalData.length > 50) historicalData.shift();
      updateDashboard(msg.data);
    } else if (msg.type === 'reset') {
      historicalData = [];
      if (window.mainChart) window.mainChart.data.labels = [];
      if (window.mainChart) window.mainChart.data.datasets.forEach(d => d.data = []);
      if (window.mainChart) window.mainChart.update();
      drawEnergyFlow(null);
    }
  };

  ws.onclose = () => {
    console.log('WebSocket Disconnected. Reconnecting in 3s...');
    document.getElementById('sim-badge').style.color = 'var(--c-danger)';
    document.getElementById('sim-badge').textContent = '● OFFLINE';
    setTimeout(connectWS, 3000);
  };
}

// Ensure ws is accessible to admin script
window.getWS = () => ws;

function updateSimStatusUI(status) {
  const badge = document.getElementById('sim-badge');
  if (badge) {
    if (status.running) {
      badge.textContent = '● LIVE';
      badge.style.color = 'var(--c-success)';
      badge.style.animation = 'livePulse 2s ease-in-out infinite';
    } else {
      badge.textContent = '● PAUSED';
      badge.style.color = 'var(--c-warning)';
      badge.style.animation = 'none';
    }
  }
}

// ── Chart.js Setup ──
Chart.defaults.color = COLORS.textMuted;
Chart.defaults.font.family = 'Inter';
let currentChartMode = 'generation';
let chartInstance = null;

function initChart() {
  const ctx = document.getElementById('chart-canvas');
  if (!ctx) return;
  
  chartInstance = new Chart(ctx, {
    type: 'line',
    data: { labels: [], datasets: [] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 0 },
      scales: {
        x: { grid: { color: COLORS.bgGrid }, ticks: { maxTicksLimit: 10 } },
        y: { grid: { color: COLORS.bgGrid }, beginAtZero: true }
      },
      plugins: {
        legend: { position: 'top', labels: { usePointStyle: true, boxWidth: 8 } },
        tooltip: { mode: 'index', intersect: false }
      },
      elements: { point: { radius: 0, hitRadius: 10 }, line: { tension: 0.4, borderWidth: 2 } }
    }
  });
  window.mainChart = chartInstance;
  
  // Tab listeners
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      currentChartMode = e.target.dataset.chart;
      updateChart(historicalData);
    });
  });
}

function updateChart(history) {
  if (!chartInstance || history.length === 0) return;
  
  const labels = history.map(s => {
    const h = Math.floor(s.hour);
    const m = Math.floor((s.hour % 1) * 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  });
  
  let datasets = [];
  if (currentChartMode === 'generation') {
    datasets = [
      { label: 'Demand', data: history.map(s => s.energyFlow.demand), borderColor: COLORS.textLight, borderDash: [5, 5] },
      { label: 'Solar', data: history.map(s => s.energyFlow.solar), borderColor: COLORS.helios, backgroundColor: COLORS.helios + '20', fill: true },
      { label: 'Wind', data: history.map(s => s.energyFlow.wind), borderColor: COLORS.aeolus, backgroundColor: COLORS.aeolus + '20', fill: true }
    ];
  } else if (currentChartMode === 'price') {
    datasets = [
      { label: 'Electricity Price (₹)', data: history.map(s => s.market.electricityPrice), borderColor: COLORS.mercury, backgroundColor: COLORS.mercury + '20', fill: true, yAxisID: 'y' }
    ];
    chartInstance.options.scales.y.title = { display: true, text: '₹ / MWh' };
  } else if (currentChartMode === 'battery') {
    datasets = [
      { label: 'Battery 1 SoC (%)', data: history.map(s => s.agents.voltaic.batteryStates[0].soc * 100), borderColor: COLORS.voltaic, fill: false },
      { label: 'Charge (MW)', data: history.map(s => s.energyFlow.batteryCharge), borderColor: COLORS.nexus, fill: false }
    ];
    chartInstance.options.scales.y.max = 100;
  }
  
  if (currentChartMode !== 'battery') {
    delete chartInstance.options.scales.y.max;
  }
  
  chartInstance.data.labels = labels;
  chartInstance.data.datasets = datasets;
  chartInstance.update();
}

// ── Energy Flow Canvas ──
let flowParticles = [];
function drawEnergyFlow(data) {
  const canvas = document.getElementById('flow-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  // Set resolution
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
  
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!data) return;
  
  const w = canvas.width, h = canvas.height;
  const cx = w * 0.5, cy = h * 0.5;
  
  const nodes = {
    solar: { x: cx - 120, y: cy - 80, label: 'Solar Farm', color: COLORS.helios, icon: '☀️', val: data.energyFlow.solar },
    wind: { x: cx - 120, y: cy + 80, label: 'Wind Farm', color: COLORS.aeolus, icon: '💨', val: data.energyFlow.wind },
    battery: { x: cx, y: cy - 100, label: 'BESS', color: COLORS.voltaic, icon: '🔋', val: data.energyFlow.batteryCharge > 0 ? -data.energyFlow.batteryCharge : data.energyFlow.batteryDischarge },
    grid: { x: cx, y: cy + 100, label: 'Grid', color: COLORS.sentinel, icon: '⚡', val: data.energyFlow.gridImport > 0 ? data.energyFlow.gridImport : -data.energyFlow.gridExport },
    hub: { x: cx, y: cy, label: 'NEXUS', color: COLORS.nexus, icon: '🤖', val: 0 },
    consumer: { x: cx + 140, y: cy, label: 'City Demand', color: COLORS.textLight, icon: '🏢', val: data.energyFlow.demand }
  };
  
  // Draw lines
  ctx.lineWidth = 2;
  const drawLine = (n1, n2, color, active, dash) => {
    ctx.beginPath();
    ctx.moveTo(n1.x, n1.y);
    // Bezier curve
    if (n1.x !== n2.x && n1.y !== n2.y) {
      ctx.bezierCurveTo(n1.x + (n2.x - n1.x) / 2, n1.y, n1.x + (n2.x - n1.x) / 2, n2.y, n2.x, n2.y);
    } else {
      ctx.lineTo(n2.x, n2.y);
    }
    if (dash) ctx.setLineDash([5, 5]); else ctx.setLineDash([]);
    const grad = ctx.createLinearGradient(n1.x, n1.y, n2.x, n2.y);
    grad.addColorStop(0, color + (active ? 'aa' : '33'));
    grad.addColorStop(1, color + (active ? 'aa' : '33'));
    ctx.strokeStyle = grad;
    ctx.stroke();
    
    // Add particle logic
    if (active && Math.random() < 0.2) {
      flowParticles.push({
        x: n1.x, y: n1.y, tx: n2.x, ty: n2.y,
        px: n1.x, py: n1.y, cx1: n1.x + (n2.x - n1.x) / 2, cy1: n1.y,
        cx2: n1.x + (n2.x - n1.x) / 2, cy2: n2.y,
        color: color, progress: 0, speed: 0.01 + Math.random() * 0.02
      });
    }
  };
  
  drawLine(nodes.solar, nodes.hub, COLORS.helios, data.energyFlow.solar > 0);
  drawLine(nodes.wind, nodes.hub, COLORS.aeolus, data.energyFlow.wind > 0);
  
  if (data.energyFlow.batteryCharge > 0) drawLine(nodes.hub, nodes.battery, COLORS.voltaic, true);
  else drawLine(nodes.battery, nodes.hub, COLORS.voltaic, data.energyFlow.batteryDischarge > 0);
  
  if (data.energyFlow.gridImport > 0) drawLine(nodes.grid, nodes.hub, COLORS.sentinel, true);
  else drawLine(nodes.hub, nodes.grid, COLORS.sentinel, data.energyFlow.gridExport > 0);
  
  drawLine(nodes.hub, nodes.consumer, COLORS.textLight, true);
  
  // Draw particles
  ctx.setLineDash([]);
  for (let i = flowParticles.length - 1; i >= 0; i--) {
    let p = flowParticles[i];
    p.progress += p.speed;
    if (p.progress >= 1) {
      flowParticles.splice(i, 1);
      continue;
    }
    // Cubic bezier
    const t = p.progress;
    const inv = 1 - t;
    const px = inv*inv*inv*p.px + 3*inv*inv*t*p.cx1 + 3*inv*t*t*p.cx2 + t*t*t*p.tx;
    const py = inv*inv*inv*p.py + 3*inv*inv*t*p.cy1 + 3*inv*t*t*p.cy2 + t*t*t*p.ty;
    
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  
  // Draw nodes
  Object.values(nodes).forEach(n => {
    ctx.beginPath();
    ctx.arc(n.x, n.y, 24, 0, Math.PI * 2);
    ctx.fillStyle = n.color + '22';
    ctx.strokeStyle = n.color;
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();
    
    ctx.fillStyle = '#fff';
    ctx.font = '20px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(n.icon, n.x, n.y);
    
    ctx.font = '10px Inter';
    ctx.fillStyle = COLORS.textMuted;
    ctx.fillText(n.label, n.x, n.y - 32);
    
    if (n.val !== undefined) {
      ctx.fillStyle = n.val > 0 ? COLORS.textLight : (n.val < 0 ? COLORS.c_warning : COLORS.textMuted);
      ctx.font = 'bold 11px JetBrains Mono';
      let valText = Math.abs(n.val).toFixed(0) + ' MW';
      if (n === nodes.battery && n.val < 0) valText = 'Chg ' + valText;
      if (n === nodes.battery && n.val > 0) valText = 'Dis ' + valText;
      if (n === nodes.grid && n.val < 0) valText = 'Exp ' + valText;
      if (n === nodes.grid && n.val > 0) valText = 'Imp ' + valText;
      ctx.fillText(valText, n.x, n.y + 36);
    }
  });
}

function animateFlow() {
  if (latestData && isRunning) drawEnergyFlow(latestData);
  requestAnimationFrame(animateFlow);
}

// ── Dashboard Updates ──
function updateDashboard(data) {
  // Clock
  const h = Math.floor(data.hour);
  const m = Math.floor((data.hour % 1) * 60);
  const d = Math.floor(data.tick / 96) + 1;
  const clockEl = document.getElementById('clock-value');
  if (clockEl) clockEl.textContent = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  const dayEl = document.getElementById('clock-day');
  if (dayEl) dayEl.textContent = `Day ${d}`;
  
  // Top Metrics
  document.getElementById('val-renewable').textContent = Math.round(data.paretoMetrics.totalRenewable);
  document.getElementById('val-demand').textContent = Math.round(data.energyFlow.demand);
  document.getElementById('val-price').textContent = `₹${data.market.electricityPrice}`;
  document.getElementById('val-renew-pct').textContent = `${data.paretoMetrics.renewableUtil}%`;
  document.getElementById('val-freq').textContent = data.agents.sentinel.decision.frequency.toFixed(2);
  document.getElementById('val-cost').textContent = `₹${data.cumulativeMetrics.totalCostK.toFixed(0)}K`;
  
  // Weather Overlay (if exists)
  const wTemp = document.getElementById('weather-temp');
  if (wTemp) {
    wTemp.textContent = `${data.weather.temperature.toFixed(1)}°C`;
    document.getElementById('weather-clouds').textContent = `☁️ ${Math.round(data.weather.cloudCover * 100)}%`;
    const wIcon = document.getElementById('weather-icon');
    if (data.weather.stormActive) { wIcon.textContent = '🌩️'; document.body.classList.add('storm'); }
    else { wIcon.textContent = data.weather.cloudCover > 0.6 ? '☁️' : '☀️'; document.body.classList.remove('storm'); }
  }
  
  // Charts
  updateChart(historicalData);
  
  // Active Chaos Events (for User/Admin views)
  const activeList = document.getElementById('chaos-active-list');
  if (activeList) {
    if (data.chaosEvents.length === 0) {
      activeList.innerHTML = '<div style="color:var(--text-muted);font-size:0.7rem;padding:8px">No active events</div>';
    } else {
      activeList.innerHTML = data.chaosEvents.map(e => `
        <div class="chaos-event-active">
          <span style="font-size:1.2rem">${e.icon}</span>
          <div>
            <div class="chaos-evt-name">${e.name}</div>
            <div class="chaos-evt-desc">${e.description}</div>
          </div>
          <div class="chaos-evt-timer">${e.ticksRemaining}t left</div>
        </div>
      `).join('');
    }
  }

  // Regional Live Nodes
  const nodesGrid = document.getElementById('nodes-grid');
  if (nodesGrid) {
    let html = '';
    data.weather.solarNodes.forEach(n => {
      html += `<div class="node-card"><div class="node-title">☀️ ${n.name}</div><div class="node-data">${n.temp.toFixed(1)}°C | ${n.desc}</div></div>`;
    });
    data.weather.windNodes.forEach(n => {
      html += `<div class="node-card"><div class="node-title">💨 ${n.name}</div><div class="node-data">${n.speed.toFixed(1)} m/s | ${n.temp.toFixed(1)}°C</div></div>`;
    });
    nodesGrid.innerHTML = html;
  }

  // Carbon Ledger
  const carbonVal = document.getElementById('carbon-val');
  if (carbonVal && data.agents.mercury && data.agents.mercury.carbonCredits !== undefined) {
    carbonVal.textContent = Math.round(data.agents.mercury.carbonCredits).toLocaleString();
  }

  // Battery Health (Predictive)
  const healthContainer = document.getElementById('battery-health-container');
  if (healthContainer && data.agents.voltaic && data.agents.voltaic.batteryStates) {
    healthContainer.innerHTML = data.agents.voltaic.batteryStates.map(b => `
      <div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;font-size:0.75rem;font-weight:600">
          <span>${b.id.toUpperCase()}</span>
          <span>${(b.health * 100).toFixed(1)}% SoH</span>
        </div>
        <div class="battery-health-bar">
          <div class="battery-health-fill" style="width:${b.health * 100}%; background:${b.health > 0.85 ? 'var(--c-success)' : (b.health > 0.75 ? 'var(--c-warning)' : 'var(--c-danger)')}"></div>
        </div>
        ${b.maintenanceAlert ? '<div class="maintenance-alert">⚠️ AI PREDICTIVE ALERT: COOLING STRESS</div>' : ''}
      </div>
    `).join('');
  }

  // Separate Agent Panels
  updateAgentPanels(data);
}

function updateAgentPanels(data) {
  const container = document.getElementById('agent-panels-container');
  if (!container) return;
  
  const agents = [
    { id: 'nexus', name: 'NEXUS', role: 'Chief Orchestrator', color: COLORS.nexus, icon: '🤖', d: data.agents.nexus,
      metricL: 'Status', valL: data.agents.nexus.status.toUpperCase(), metricR: 'Nash Product', valR: data.nash.nashProduct.toExponential(1) },
    { id: 'helios', name: 'HELIOS', role: 'Solar Agent', color: COLORS.helios, icon: '☀️', d: data.agents.helios,
      metricL: 'Gen', valL: Math.round(data.energyFlow.solar) + ' MW', metricR: 'Curtail', valR: Math.round(data.energyFlow.curtailment) + ' MW' },
    { id: 'aeolus', name: 'AEOLUS', role: 'Wind Agent', color: COLORS.aeolus, icon: '💨', d: data.agents.aeolus,
      metricL: 'Gen', valL: Math.round(data.energyFlow.wind) + ' MW', metricR: 'Curtail', valR: '0 MW' },
    { id: 'voltaic', name: 'VOLTAIC', role: 'Battery Fleet', color: COLORS.voltaic, icon: '🔋', d: data.agents.voltaic,
      metricL: 'Action', valL: data.energyFlow.batteryCharge > 0 ? 'CHARGING' : (data.energyFlow.batteryDischarge > 0 ? 'DISCHARGING' : 'IDLE'), metricR: 'Avg SoC', valR: data.agents.voltaic.decision ? data.agents.voltaic.decision.avgSoC + '%' : '0%' },
    { id: 'mercury', name: 'MERCURY', role: 'Market Trader', color: COLORS.mercury, icon: '💰', d: data.agents.mercury,
      metricL: 'Carbon', valL: Math.round(data.agents.mercury.carbonCredits) + ' CC', metricR: 'Net Cost', valR: '₹' + data.cumulativeMetrics.totalCostK.toFixed(0) + 'K' },
    { id: 'sentinel', name: 'SENTINEL', role: 'Grid Security', color: COLORS.sentinel, icon: '〰️', d: data.agents.sentinel,
      metricL: 'Freq', valL: data.agents.sentinel.decision ? data.agents.sentinel.decision.frequency.toFixed(2) + ' Hz' : '50.0', metricR: 'Line Load', valR: data.agents.sentinel.decision ? data.agents.sentinel.decision.maxLineLoad + '%' : '0%' },
    { id: 'oracle', name: 'ORACLE', role: 'Weather Forecaster', color: COLORS.oracle, icon: '🌩️', d: data.agents.oracle,
      metricL: 'Temp', valL: data.weather.temperature.toFixed(1) + '°C', metricR: 'Clouds', valR: Math.round(data.weather.cloudCover * 100) + '%' }
  ];
  
  let html = '';
  agents.forEach(a => {
    let standardThought = 'Analyzing...';
    let geminiInsight = null;
    
    if (a.d && a.d.reasoning) {
      const geminiLog = [...a.d.reasoning].reverse().find(r => r.message.startsWith('✨ AI Insight:'));
      if (geminiLog) geminiInsight = geminiLog.message.replace('✨ AI Insight:', '').trim();
      
      const standardLog = [...a.d.reasoning].reverse().find(r => !r.message.startsWith('✨ AI Insight:'));
      if (standardLog) standardThought = standardLog.message;
    }
    
    html += `
      <div class="agent-panel" style="--agent-c: ${a.color}">
        <div class="agent-p-header">
          <div class="agent-p-title"><span>${a.icon}</span> ${a.name}</div>
          <div class="agent-p-role">${a.role}</div>
        </div>
        <div class="agent-p-body">
          <div class="agent-p-metrics">
            <div><span style="color:var(--text-muted);font-size:0.7rem">${a.metricL}:</span> ${a.valL}</div>
            <div><span style="color:var(--text-muted);font-size:0.7rem">${a.metricR}:</span> ${a.valR}</div>
          </div>
          <div class="agent-p-thought">${standardThought}</div>
          ${geminiInsight ? `<div class="agent-p-gemini">✨ ${geminiInsight}</div>` : ''}
        </div>
      </div>
    `;
  });
  
  container.innerHTML = html;
}

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
  initChart();
  connectWS();
  animateFlow();
});
