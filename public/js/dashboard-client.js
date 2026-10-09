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

async function resetDB() {
  try {
    const res = await fetch('/api/auth/reset-db', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'reset' }));
      }
      setTimeout(() => {
        window.location.reload();
      }, 500);
    } else {
      const data = await res.json();
      alert(`Error: ${data.error || 'Failed to reset DB'}`);
    }
  } catch (err) {
    console.error('Failed to reset DB', err);
    alert('Failed to connect to server');
  }
}

// ── Globals ──
let ws;
let isRunning = false;
let latestData = null;
let historicalData = [];
let userCity = '';
try { const u = JSON.parse(localStorage.getItem('user')); if (u && u.city) userCity = u.city; } catch(e){}
let cityHeatmapCache = new Array(28).fill(0);
let lastHeatmapTick = 0;

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
      window.updateDashboard(msg.data);
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

function initTabs() {
  document.querySelectorAll('.nav-item[data-tab-btn]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');
      
      const targetPane = e.currentTarget.dataset.tabBtn;
      
      document.querySelectorAll('[data-tab-pane]').forEach(pane => {
        if (pane.dataset.tabPane === targetPane) {
          pane.classList.remove('tab-pane-hidden');
          pane.style.display = ''; // Clear any inline display property
        } else {
          pane.classList.add('tab-pane-hidden');
        }
      });
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
  
  // Inject User City Info Widget
  if (userCity && !document.getElementById('user-city-widget')) {
    const overviewGrid = document.querySelector('[data-tab-pane="overview"]');
    if (overviewGrid) {
      const widget = document.createElement('div');
      widget.id = 'user-city-widget';
      widget.style.gridColumn = 'span 3';
      widget.className = 'panel';
      widget.innerHTML = `<div class="panel-header"><h2>📍 Live Local Feed: ${userCity}</h2><span class="panel-badge" style="background:var(--c-success-light);color:var(--c-success)">Synchronized</span></div><div class="panel-body" style="padding:16px;font-size:0.9rem" id="user-city-data">Fetching local grid telemetry...</div>`;
      overviewGrid.insertBefore(widget, overviewGrid.firstChild);
    }
  }
  if (userCity) {
    const widgetData = document.getElementById('user-city-data');
    if (widgetData) {
      const node = data.weather.solarNodes.find(n => n.name.includes(userCity));
      if (node) {
        widgetData.innerHTML = `<strong>Status:</strong> ${node.desc} &nbsp;|&nbsp; <strong>Temp:</strong> ${node.temp.toFixed(1)}°C &nbsp;|&nbsp; <strong>Cloud Cover:</strong> ${(node.clouds*100).toFixed(0)}% &nbsp;|&nbsp; <strong>Capacity:</strong> 100 MW (User Node) &nbsp;|&nbsp; <strong>Generation:</strong> ${(node.irradiance * 100).toFixed(1)} MW<br><div style="margin-top:8px;font-size:0.8rem;color:var(--text-muted)">The Historical Outage Heatmap and Global Arrays have been updated with ${userCity}'s telemetry.</div>`;
      }
    }
  }
  
  // Top Metrics
  const elRenewable = document.getElementById('val-renewable');
  if(elRenewable) elRenewable.textContent = Math.round(data.paretoMetrics.totalRenewable);
  
  const elDemand = document.getElementById('val-demand');
  if(elDemand) elDemand.textContent = Math.round(data.energyFlow.demand);
  
  const elPrice = document.getElementById('val-price');
  if(elPrice) elPrice.textContent = `₹${data.market.electricityPrice}`;
  
  const elRenewPct = document.getElementById('val-renew-pct');
  if(elRenewPct) elRenewPct.textContent = `${data.paretoMetrics.renewableUtil}%`;
  
  const elFreq = document.getElementById('val-freq');
  if(elFreq) elFreq.textContent = data.agents.sentinel.decision.frequency.toFixed(2);
  
  const elCost = document.getElementById('val-cost');
  if(elCost) elCost.textContent = `₹${data.cumulativeMetrics.totalCostK.toFixed(0)}K`;
  
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
  const carbonSaved = document.getElementById('carbon-saved');
  const drEvents = document.getElementById('dr-events');
  
  if (carbonVal && data.agents.mercury && data.agents.mercury.carbonCredits !== undefined) {
    carbonVal.textContent = Math.round(data.agents.mercury.carbonCredits).toLocaleString();
  }
  if (carbonSaved && data.tick) {
    carbonSaved.textContent = `${Math.round(12400 + data.tick * 1.5).toLocaleString()} t`;
  }
  if (drEvents && data.tick) {
    drEvents.textContent = `${14 + Math.floor(data.tick / 10)}`;
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

  // Transmission Grid
  const transmissionLines = document.getElementById('transmission-lines');
  if (transmissionLines && data.energyFlow) {
    const gridPower = Math.abs(data.energyFlow.gridImport);
    const flowColor = data.energyFlow.gridImport > 0 ? 'var(--c-danger)' : 'var(--c-success)';
    const statusText = data.energyFlow.gridImport > 0 ? 'Importing from Main Grid' : 'Exporting to Main Grid';
    
    transmissionLines.innerHTML = `
      <div style="display:flex; align-items:center; gap:16px; margin-bottom:12px;">
        <div style="font-size:2rem; animation: pulse 2s infinite;">⚡</div>
        <div>
          <div style="font-weight:700; font-size:1.1rem; color:${flowColor};">${Math.round(gridPower)} MW</div>
          <div style="font-size:0.75rem; color:var(--text-muted);">${statusText}</div>
        </div>
      </div>
      <div style="width:100%; height:4px; background:var(--border-light); border-radius:2px; position:relative; overflow:hidden;">
        <div style="position:absolute; top:0; left:0; height:100%; width:100%; background:linear-gradient(90deg, transparent, ${flowColor}, transparent); animation: slide 1.5s infinite linear ${data.energyFlow.gridImport > 0 ? '' : 'reverse'};"></div>
      </div>
    `;
  }

  // Separate Agent Panels
  updateAgentPanels(data);

  // Dynamic Panels
  if (typeof updateDynamicPanels === 'function') {
    updateDynamicPanels(data);
  }

  // Extra Tab Panels
  updateExtraPanels(data);
}

function updateExtraPanels(data) {
  // Carbon Ledger Tab: Dynamic Real-time Updates
  
  // 1. P2P Energy Trading
  const p2pTrading = document.getElementById('p2p-trading');
  if (p2pTrading && data.tick) {
    const t1 = Math.round(14 + Math.sin(data.tick * 0.1) * 3);
    const t2 = Math.round(32 + Math.cos(data.tick * 0.15) * 5);
    const t3 = Math.round(5 + Math.sin(data.tick * 0.05) * 2);
    p2pTrading.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid var(--border-light);">
        <div style="font-size:0.8rem; font-weight:600;">Textile Mill <span style="color:var(--acn-purple)">→</span> City District</div>
        <div style="font-size:0.8rem; color:var(--c-success); font-weight:700;">+${t1} MWh</div>
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid var(--border-light);">
        <div style="font-size:0.8rem; font-weight:600;">Steel Mfg <span style="color:var(--acn-purple)">→</span> Chemical Plant</div>
        <div style="font-size:0.8rem; color:var(--c-success); font-weight:700;">+${t2} MWh</div>
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0;">
        <div style="font-size:0.8rem; font-weight:600;">Data Center <span style="color:var(--acn-purple)">→</span> Grid</div>
        <div style="font-size:0.8rem; color:var(--c-info); font-weight:700;">+${t3} MWh</div>
      </div>
    `;
  }

  // 2. Decarbonization Trajectory
  const decarbTrajectory = document.getElementById('decarb-trajectory');
  if (decarbTrajectory && data.tick) {
    const currentCarbon = -22000 - (data.tick * 5); // Simulate active decarbonization
    const targetCarbon = -50000;
    const pct = Math.min(100, Math.max(0, (currentCarbon / targetCarbon) * 100));
    decarbTrajectory.innerHTML = `
      <div style="width: 80%; height: 8px; background: var(--border-light); border-radius: 4px; overflow: hidden; margin-bottom: 12px;">
        <div style="width: ${pct}%; height: 100%; background: linear-gradient(90deg, var(--c-warning), var(--c-success)); transition: width 0.5s;"></div>
      </div>
      <div style="display:flex; width: 80%; justify-content:space-between; font-size:0.75rem; color:var(--text-muted); font-weight:600;">
        <span>Current: ${currentCarbon.toLocaleString()}t</span>
        <span>Target: ${targetCarbon.toLocaleString()}t</span>
      </div>
    `;
  }

  // 3. Consumer Green Leaderboard
  const greenLeaderboard = document.getElementById('green-leaderboard');
  if (greenLeaderboard && data.tick) {
    const lb1 = 1204 + Math.floor(data.tick / 2);
    const lb2 = 890 + Math.floor(data.tick / 3);
    const lb3 = 540 + Math.floor(data.tick / 4);
    greenLeaderboard.innerHTML = `
      <div style="display:flex; justify-content:space-between; padding:6px; background:var(--bg-surface); border-radius:4px; margin-bottom:6px;">
        <span style="font-size:0.8rem; font-weight:700;">1. Data Center</span><span style="color:var(--c-success); font-size:0.8rem; font-weight:800;">-${lb1}t</span>
      </div>
      <div style="display:flex; justify-content:space-between; padding:6px; margin-bottom:6px;">
        <span style="font-size:0.8rem; font-weight:600; color:var(--text-secondary);">2. Tech Park</span><span style="color:var(--c-success); font-size:0.8rem; font-weight:700;">-${lb2}t</span>
      </div>
      <div style="display:flex; justify-content:space-between; padding:6px;">
        <span style="font-size:0.8rem; font-weight:600; color:var(--text-secondary);">3. Residential Suburb</span><span style="color:var(--c-success); font-size:0.8rem; font-weight:700;">-${lb3}t</span>
      </div>
    `;
  }

  // 4. Green Hydrogen Storage
  const hydrogenStorage = document.getElementById('hydrogen-storage');
  if (hydrogenStorage && data.energyFlow) {
    // Derive hydrogen storage from wind power (excess wind is used for electrolysis)
    const baseStorage = 45; 
    const currentStorage = Math.min(100, baseStorage + (data.energyFlow.wind > 20 ? (data.tick%20) * 0.1 : 0));
    hydrogenStorage.innerHTML = `
      <div style="width:40px; height:100px; border:2px solid var(--border-light); border-radius:20px; overflow:hidden; position:relative; background:var(--bg-surface);">
        <div style="position:absolute; bottom:0; width:100%; height:${currentStorage}%; background:var(--c-info); transition: height 1s;"></div>
      </div>
      <div>
        <div style="font-size:1.5rem; font-weight:800; color:var(--text-primary);">${currentStorage.toFixed(1)}%</div>
        <div style="font-size:0.7rem; color:var(--text-muted); font-weight:600; text-transform:uppercase;">Tank Level (800kg)</div>
      </div>
    `;
  }

  // 5. Carbon Credit Value
  const carbonCreditValue = document.getElementById('carbon-credit-value');
  if (carbonCreditValue && data.market) {
    const baseValue = 42.50;
    const variation = (data.market.electricityPrice - 40) * 0.05; // Correlate with electricity price
    const currentValue = baseValue + variation;
    const diff = currentValue - baseValue;
    const diffColor = diff >= 0 ? 'var(--c-success)' : 'var(--c-danger)';
    const diffSign = diff >= 0 ? '▲+' : '▼';
    carbonCreditValue.innerHTML = `
      <div style="font-size:2.2rem; font-weight:800; color:var(--text-primary); margin-bottom:4px;">$${currentValue.toFixed(2)}<span style="font-size:1rem; color:${diffColor};">${diffSign}$${Math.abs(diff).toFixed(2)}</span></div>
      <div style="font-size:0.7rem; color:var(--text-muted); font-weight:600;">Per Tonne CO2e / NSE Trading</div>
    `;
  }

  // 6. Emissions Compliance Log
  const emissionsLog = document.getElementById('emissions-log');
  if (emissionsLog && data.tick) {
    // We'll generate dynamic but deterministic transaction logs based on tick
    const transactions = [
      { id: '0x8f...2a1b', p: 'City District Govt.', vol: 450 + Math.floor(data.tick/2), val: 19125, status: 'Settled', isNeg: false },
      { id: '0x1c...9d8e', p: 'Steel Mfg Corp', vol: -120, val: 5100, status: 'Settled', isNeg: true },
      { id: '0x5e...7f4a', p: 'Tech Park Consortium', vol: 310 + Math.floor(data.tick/4), val: 13175, status: data.tick % 10 < 5 ? 'Pending' : 'Settled', isNeg: false }
    ];
    
    // Rotate rows organically
    if (data.tick % 15 === 0) {
      transactions.unshift({ id: '0x' + Math.random().toString(16).substr(2,8), p: 'Industrial Hub', vol: Math.floor(Math.random()*200), val: Math.floor(Math.random()*10000), status: 'Pending', isNeg: Math.random()>0.5 });
      transactions.pop();
    }
    
    const rowsHtml = transactions.map(t => {
      const volColor = t.isNeg ? 'var(--c-danger)' : 'var(--c-success)';
      const volSign = t.isNeg ? '' : '+';
      const statColor = t.status === 'Settled' ? 'var(--c-success)' : 'var(--c-warning)';
      return `
        <tr style="border-bottom:1px solid var(--border-light);">
          <td style="padding:8px; font-family:monospace; color:var(--acn-purple);">${t.id}</td>
          <td style="padding:8px;">${t.p}</td>
          <td style="padding:8px; color:${volColor}; font-weight:bold;">${volSign}${t.vol}t</td>
          <td style="padding:8px;">$${t.val.toLocaleString()}</td>
          <td style="padding:8px; color:${statColor};">${t.status}</td>
        </tr>
      `;
    }).join('');

    emissionsLog.innerHTML = `
      <table style="width:100%; border-collapse: collapse; font-size: 0.8rem; text-align: left;">
        <thead>
          <tr style="border-bottom:1px solid var(--border-light); color:var(--text-muted);">
            <th style="padding:8px; font-weight:600;">Transaction ID</th>
            <th style="padding:8px; font-weight:600;">Participant</th>
            <th style="padding:8px; font-weight:600;">Volume (CO2e)</th>
            <th style="padding:8px; font-weight:600;">Value (USD)</th>
            <th style="padding:8px; font-weight:600;">Status</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    `;
  }

  // Alerts Tab: Pareto Metrics
  if (data.paretoMetrics) {
    const rel = document.getElementById('pareto-reliability');
    if(rel) rel.textContent = '100%';
    const ren = document.getElementById('pareto-renewable');
    if(ren) ren.textContent = `${data.paretoMetrics.renewableUtil || 0}%`;
    const rev = document.getElementById('pareto-revenue');
    if(rev) rev.textContent = `₹${(data.cumulativeMetrics.totalCostK || 0).toFixed(0)}K`;
    const peak = document.getElementById('pareto-peak');
    if(peak) peak.textContent = `${Math.round(data.energyFlow.demand)} MW`;
  }

  // Alerts Tab: Alerts Feed
  const alertsFeed = document.getElementById('alerts-feed');
  const alertCount = document.getElementById('alert-count');
  const alertsData = data.automatedIncidentResponse || data.chaosEvents || [];
  
  if (alertsFeed) {
    if (alertsData.length === 0) {
      alertsFeed.innerHTML = '<div style="color:var(--text-muted);font-size:0.8rem;text-align:center;padding:24px">No active alerts</div>';
      if(alertCount) alertCount.textContent = '0 Active';
    } else {
      alertsFeed.innerHTML = alertsData.map(inc => {
        const icon = inc.icon || (inc.type === 'critical' ? '🔴' : inc.type === 'warning' ? '⚡' : '🔵');
        const color = inc.severity === 'critical' || inc.type === 'critical' ? 'var(--c-danger)' : inc.type === 'warning' ? 'var(--c-warning)' : 'var(--c-info)';
        const bg = inc.severity === 'critical' || inc.type === 'critical' ? 'var(--c-danger-light)' : inc.type === 'warning' ? 'var(--c-warning-light)' : 'var(--c-info-light)';
        const name = inc.name || `${inc.type} Alert`;
        return `
        <div style="display:flex; align-items:flex-start; gap:12px; padding:10px; border-radius:6px; background:${bg}; border-left:3px solid ${color}; margin-bottom:8px;">
          <div style="font-size:0.8rem; color:var(--text-primary); font-weight:600; text-transform:capitalize;">${icon} ${name}</div>
          <div style="font-size:0.7rem; color:var(--text-muted);">${inc.description || inc.message}</div>
        </div>`;
      }).join('');
      if(alertCount) alertCount.textContent = `${alertsData.length} Active`;
    }
  }

  // Alerts Tab: Price Forecast (Dynamic visual)
  const priceForecast = document.getElementById('price-forecast');
  if (priceForecast && data.market) {
    let bars = '';
    const basePrice = data.market.electricityPrice;
    const maxPrice = basePrice > 0 ? basePrice * 1.2 : 100;
    for(let i=0; i<8; i++) {
      const p = Math.max(0, basePrice + (Math.random()*(basePrice*0.2) - (basePrice*0.1)));
      const pct = Math.min(100, Math.max(10, (p / maxPrice) * 100));
      bars += `<div style="flex:1; background:var(--c-info); height:${pct}%; margin:0 2px; border-radius:2px 2px 0 0; transition: height 0.5s ease-in-out;" title="₹${p.toFixed(0)}/MWh"></div>`;
    }
    priceForecast.innerHTML = `<div style="display:flex; height:100%; width:100%; align-items:flex-end;">${bars}</div>`;
  }

  // Alerts Tab: Grid Frequency Stability
  const freqPolyline = document.getElementById('freq-polyline');
  if (freqPolyline && data.agents && data.agents.sentinel && data.agents.sentinel.decision) {
    if (!window.freqHistory) window.freqHistory = Array(11).fill(50.0);
    window.freqHistory.shift();
    window.freqHistory.push(data.agents.sentinel.decision.frequency);
    
    let points = '';
    window.freqHistory.forEach((f, i) => {
      const x = i * 10;
      // Map 49.5-50.5 to 100-0 Y coordinates
      const y = Math.max(0, Math.min(100, 100 - ((f - 49.5) * 100)));
      points += `${x},${y.toFixed(1)} `;
    });
    freqPolyline.setAttribute('points', points.trim());
  }

  // Nodes Tab: Consumer List
  const consumerList = document.getElementById('consumer-list');
  const totalDemandBadge = document.getElementById('total-demand-badge');
  if (consumerList && data.energyFlow) {
    const d = data.energyFlow.demand;
    if(totalDemandBadge) totalDemandBadge.textContent = `${Math.round(d)} MW`;
    consumerList.innerHTML = `
      <div style="display:flex; justify-content:space-between; font-size:0.8rem; margin-bottom:10px; border-bottom:1px solid var(--border-light); padding-bottom:4px;">
        <span>City District A</span> <span>${Math.round(d * 0.4)} MW</span>
      </div>
      <div style="display:flex; justify-content:space-between; font-size:0.8rem; margin-bottom:10px; border-bottom:1px solid var(--border-light); padding-bottom:4px;">
        <span>Industrial Hub</span> <span>${Math.round(d * 0.35)} MW</span>
      </div>
      <div style="display:flex; justify-content:space-between; font-size:0.8rem; margin-bottom:10px;">
        <span>Tech Park</span> <span>${Math.round(d * 0.25)} MW</span>
      </div>
    `;
  }

  // Nodes Tab: Telemetry Feed
  const telemetryFeed = document.getElementById('live-telemetry');
  if (telemetryFeed) {
    const timestamp = new Date().toISOString().split('T')[1].substring(0,12);
    const log = `[${timestamp}] NEXUS: SYNC freq=${data.agents.sentinel.decision.frequency.toFixed(3)}Hz\n[${timestamp}] HELIOS: rad=${data.weather.cloudCover.toFixed(2)} p=${Math.round(data.energyFlow.solar)}MW`;
    telemetryFeed.textContent = log + '\n' + telemetryFeed.textContent.substring(0, 300);
  }

  // Nodes Tab: Weather Anomaly Radar
  const weatherRadar = document.getElementById('weather-radar');
  if (weatherRadar && data.weather) {
    const temp = data.weather.temperature;
    const cloud = data.weather.cloudCover;
    const windSpeed = data.weather.windNodes ? data.weather.windNodes[0].speed : 5;
    const anomalies = [];
    
    if (cloud > 0.6) {
      anomalies.push({ title: 'Heavy Cloud Cover Detected', detail: `Cloud density at ${(cloud*100).toFixed(0)}% — solar output degraded`, color: 'var(--c-warning)', bg: 'rgba(245,158,11,0.1)' });
    } else if (cloud > 0.3) {
      anomalies.push({ title: 'Partial Cloud Cover', detail: `Cloud density at ${(cloud*100).toFixed(0)}% — minor solar impact`, color: 'var(--c-info)', bg: 'rgba(59,130,246,0.1)' });
    } else {
      anomalies.push({ title: 'Clear Skies — Peak Solar', detail: `Cloud density at ${(cloud*100).toFixed(0)}% — maximum irradiance`, color: 'var(--c-success)', bg: 'rgba(16,185,129,0.1)' });
    }
    
    if (windSpeed > 15) {
      anomalies.push({ title: '⚠️ High Wind Advisory', detail: `Wind at ${windSpeed.toFixed(1)} m/s — turbine feathering active`, color: 'var(--c-danger)', bg: 'rgba(239,68,68,0.1)' });
    } else if (windSpeed > 8) {
      anomalies.push({ title: 'Optimal Wind Conditions', detail: `Wind at ${windSpeed.toFixed(1)} m/s — peak generation`, color: 'var(--c-success)', bg: 'rgba(16,185,129,0.1)' });
    } else {
      anomalies.push({ title: 'Low Wind Regime', detail: `Wind at ${windSpeed.toFixed(1)} m/s — below rated capacity`, color: 'var(--c-warning)', bg: 'rgba(245,158,11,0.1)' });
    }

    if (temp > 40) {
      anomalies.push({ title: 'Extreme Heat Warning', detail: `${temp.toFixed(1)}°C — panel derating expected`, color: 'var(--c-danger)', bg: 'rgba(239,68,68,0.1)' });
    }

    weatherRadar.innerHTML = anomalies.map(a => `
      <div style="padding:8px; border-radius:6px; background:${a.bg}; border-left:3px solid ${a.color};">
        <div style="font-size:0.75rem; color:var(--text-primary); font-weight:600;">${a.title}</div>
        <div style="font-size:0.65rem; color:var(--text-muted);">${a.detail}</div>
      </div>`).join('');
  }

  // Nodes Tab: Microgrid Topology
  const topologyView = document.getElementById('topology-view');
  if (topologyView && data.energyFlow) {
    const solar = Math.round(data.energyFlow.solar);
    const wind = Math.round(data.energyFlow.wind);
    const batt = data.energyFlow.batteryCharge > 0 ? `+${Math.round(data.energyFlow.batteryCharge)}` : `-${Math.round(data.energyFlow.batteryDischarge)}`;
    const battColor = data.energyFlow.batteryCharge > 0 ? 'var(--c-info)' : 'var(--c-warning)';
    const demand = Math.round(data.energyFlow.demand);
    const grid = Math.round(data.energyFlow.gridImport);
    
    topologyView.innerHTML = `
      <div style="text-align:center; padding:10px; background:var(--bg-surface); border-radius:8px; border:1px solid var(--border-light); min-width:100px;">
        <div style="font-size:1.5rem;">☀️</div>
        <div style="font-size:0.7rem; font-weight:700;">SOLAR</div>
        <div style="font-size:0.85rem; font-weight:800; color:var(--c-helios);">${solar} MW</div>
      </div>
      <div style="font-size:1.2rem; color:var(--c-success);">→</div>
      <div style="text-align:center; padding:10px; background:var(--bg-surface); border-radius:8px; border:2px solid var(--acn-purple); min-width:100px; box-shadow:0 0 12px var(--acn-purple-light);">
        <div style="font-size:1.5rem;">⚡</div>
        <div style="font-size:0.7rem; font-weight:700; color:var(--acn-purple-dark);">BUS</div>
        <div style="font-size:0.85rem; font-weight:800;">${demand} MW</div>
      </div>
      <div style="font-size:1.2rem; color:var(--c-warning);">→</div>
      <div style="text-align:center; padding:10px; background:var(--bg-surface); border-radius:8px; border:1px solid var(--border-light); min-width:100px;">
        <div style="font-size:1.5rem;">🏭</div>
        <div style="font-size:0.7rem; font-weight:700;">LOAD</div>
        <div style="font-size:0.85rem; font-weight:800; color:var(--c-danger);">${demand} MW</div>
      </div>
      <div style="display:flex; gap:12px; width:100%; justify-content:space-around; margin-top:4px;">
        <div style="text-align:center; padding:8px; background:var(--bg-surface); border-radius:6px; border:1px solid var(--border-light); flex:1;">
          <div style="font-size:0.9rem;">💨</div>
          <div style="font-size:0.65rem; font-weight:700;">WIND</div>
          <div style="font-size:0.75rem; font-weight:800; color:var(--c-aeolus);">${wind} MW</div>
        </div>
        <div style="text-align:center; padding:8px; background:var(--bg-surface); border-radius:6px; border:1px solid var(--border-light); flex:1;">
          <div style="font-size:0.9rem;">🔋</div>
          <div style="font-size:0.65rem; font-weight:700;">BESS</div>
          <div style="font-size:0.75rem; font-weight:800; color:${battColor};">${batt} MW</div>
        </div>
        <div style="text-align:center; padding:8px; background:var(--bg-surface); border-radius:6px; border:1px solid var(--border-light); flex:1;">
          <div style="font-size:0.9rem;">🔌</div>
          <div style="font-size:0.65rem; font-weight:700;">GRID</div>
          <div style="font-size:0.75rem; font-weight:800; color:var(--c-info);">${grid} MW</div>
        </div>
      </div>`;
  }

  // Nodes Tab: 48h Weather Trend
  const weatherTrend = document.getElementById('weather-trend');
  if (weatherTrend && data.weather) {
    const baseTemp = data.weather.temperature;
    const slots = [
      { hr: '+4h', delta: -1, icon: (data.weather.cloudCover < 0.3) ? '☀️' : '⛅' },
      { hr: '+8h', delta: -3, icon: '⛅' },
      { hr: '+12h', delta: -8, icon: '🌧️' },
      { hr: '+16h', delta: -12, icon: '🌙' },
      { hr: '+24h', delta: +1, icon: '☀️' },
    ];
    weatherTrend.innerHTML = slots.map(s => {
      const t = (baseTemp + s.delta + (Math.random()*2 - 1)).toFixed(0);
      return `<div style="text-align:center;"><div style="font-size:1.2rem;">${s.icon}</div><div style="font-size:0.7rem; font-weight:700;">${s.hr}</div><div style="font-size:0.65rem; color:var(--text-muted);">${t}°C</div></div>`;
    }).join('');
  }

  // Nodes Tab: Solar Irradiance Heatmap
  const irradianceValue = document.getElementById('irradiance-value');
  const irradianceBody = document.getElementById('irradiance-body');
  if (irradianceValue && data.weather) {
    const cloud = data.weather.cloudCover;
    const irradiance = Math.round(1000 * (1 - cloud * 0.85));
    irradianceValue.textContent = `${irradiance} W/m² ${irradiance > 800 ? '(Peak)' : irradiance > 400 ? '(Moderate)' : '(Low)'}`;
    const intensity = Math.min(1, irradiance / 1000);
    irradianceBody.style.background = `linear-gradient(135deg, rgba(245,158,11,${0.1 + intensity*0.3}), rgba(239,68,68,${0.1 + intensity*0.3}))`;
  }

  // Nodes Tab: Wind Farm Status
  const windFarmStatus = document.getElementById('wind-farm-status');
  if (windFarmStatus && data.energyFlow) {
    const totalWind = data.energyFlow.wind;
    const turbines = [
      { name: 'Turbine Alpha', share: 0.4 },
      { name: 'Turbine Beta', share: 0.35 },
      { name: 'Turbine Gamma', share: 0.15 },
      { name: 'Turbine Delta', share: 0.1 },
    ];
    windFarmStatus.innerHTML = turbines.map(t => {
      const mw = Math.round(totalWind * t.share);
      const isMaint = (t.name === 'Turbine Gamma' && totalWind < 20);
      const status = isMaint ? `<span style="color:var(--c-warning);">Maint. (${mw} MW)</span>` : `<span style="color:var(--c-success);">Online (${mw} MW)</span>`;
      return `<div style="display:flex; justify-content:space-between; margin-bottom:8px; font-size:0.75rem;"><span style="font-weight:600;">${t.name}</span>${status}</div>`;
    }).join('');
  }
}

function updateDynamicPanels(data) {
  // 1. Automated Incident Response
  const incidentList = document.getElementById('dyn-incident-list');
  const mitigatedCountEl = document.getElementById('dyn-mitigated-count');
  const responseTimeEl = document.getElementById('dyn-response-time');
  
  if (mitigatedCountEl && data.tick) {
    // Dynamically increase mitigated events based on tick count (simulate scaling up)
    mitigatedCountEl.textContent = 142 + Math.floor(data.tick / 3);
  }
  if (responseTimeEl) {
    // Add jitter to response time to make it look alive
    responseTimeEl.textContent = (0.8 + (Math.random() * 0.4 - 0.2)).toFixed(2) + 's';
  }

  // 1b. Live AI Agent Network Matrix
  const matrixFlow = document.getElementById('dyn-matrix-flow');
  if (matrixFlow && data.tick) {
    matrixFlow.style.opacity = (data.tick % 2 === 0) ? '0.8' : '0.3';
    
    const nexus = document.getElementById('dyn-matrix-nexus');
    if (nexus) nexus.style.boxShadow = (data.tick % 2 === 0) ? '0 0 25px var(--acn-purple-light)' : '0 0 10px var(--acn-purple-light)';
    
    const helios = document.getElementById('dyn-matrix-helios');
    if (helios) helios.style.borderColor = (data.tick % 3 === 0) ? 'var(--c-success)' : 'var(--border-light)';
    
    const mercury = document.getElementById('dyn-matrix-mercury');
    if (mercury) mercury.style.borderColor = (data.tick % 3 === 1) ? 'var(--c-warning)' : 'var(--border-light)';
    
    const nexusText = document.getElementById('dyn-matrix-nexus-text');
    if (nexusText) nexusText.textContent = `Syncing ${Math.floor(8 + Math.random()*5)}ms`;
  }

  if (incidentList && data.automatedIncidentResponse) {
    incidentList.innerHTML = data.automatedIncidentResponse.map(inc => {
      const icon = inc.type === 'critical' ? '🔴' : inc.type === 'warning' ? '⚡' : '🔵';
      const color = inc.type === 'critical' ? 'var(--c-danger)' : inc.type === 'warning' ? 'var(--c-warning)' : 'var(--c-info)';
      const bg = inc.type === 'critical' ? 'var(--c-danger-light)' : inc.type === 'warning' ? 'var(--c-warning-light)' : 'var(--c-info-light)';
      return `
        <div style="display:flex; align-items:flex-start; gap:12px; padding:8px 10px; border-bottom:1px solid var(--border-light);">
          <div style="background:${bg}; color:${color}; padding:4px; border-radius:4px; font-size:1.1rem;">${icon}</div>
          <div>
            <div style="font-size:0.75rem; font-weight:700; text-transform:capitalize;">${inc.type} Alert</div>
            <div style="font-size:0.7rem; color:var(--text-muted);">${inc.message}</div>
          </div>
        </div>`;
    }).join('');
  }

  // 2. Grid Security Monitor
  if (data.gridSecurityMonitor) {
    const isSecure = data.gridSecurityMonitor === 'System Secure';
    const setElText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    setElText('dyn-grid-security-icon', isSecure ? '🛡️' : '⚠️');
    
    const textEl = document.getElementById('dyn-grid-security-text');
    if (textEl) {
      textEl.textContent = data.gridSecurityMonitor;
      textEl.style.color = isSecure ? 'var(--c-success)' : 'var(--c-danger)';
    }
    setElText('dyn-grid-security-sub', isSecure ? 'Network integrity verified.' : 'Threat mitigation active.');
  }

  // 3. Agent Confidence Scores
  if (data.agentConfidenceScores) {
    const setElText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    setElText('dyn-agent-conf-helios', data.agentConfidenceScores.helios + '%');
    const bHelios = document.getElementById('dyn-bar-helios');
    if(bHelios) bHelios.style.width = data.agentConfidenceScores.helios + '%';

    setElText('dyn-agent-conf-voltaic', data.agentConfidenceScores.voltaic + '%');
    const bVoltaic = document.getElementById('dyn-bar-voltaic');
    if(bVoltaic) bVoltaic.style.width = data.agentConfidenceScores.voltaic + '%';

    setElText('dyn-agent-conf-mercury', data.agentConfidenceScores.mercury + '%');
    const bMercury = document.getElementById('dyn-bar-mercury');
    if(bMercury) bMercury.style.width = data.agentConfidenceScores.mercury + '%';
  }

  // 4. Grid Inertia Monitor
  if (data.gridInertia) {
    const setElText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    setElText('dyn-grid-inertia-value', data.gridInertia + 's');
    const inertiaFloat = parseFloat(data.gridInertia);
    const isSafe = inertiaFloat > 3.0;
    
    const subEl = document.getElementById('dyn-grid-inertia-sub');
    if (subEl) {
      subEl.textContent = isSafe ? 'Safe Margin (>3.0s)' : 'Critical Margin (<3.0s)';
      subEl.style.color = isSafe ? 'var(--c-success)' : 'var(--c-danger)';
    }

    const syntheticVal = Math.max(0, inertiaFloat - 1.8).toFixed(1);
    setElText('dyn-synthetic-inertia', syntheticVal + 's');
    
    const maxInertia = 6.0;
    const synthPct = (syntheticVal / maxInertia) * 100;
    const synthBar = document.getElementById('dyn-synthetic-bar');
    if (synthBar) synthBar.style.width = synthPct + '%';
  }

  // 5. Historical Outage Heatmap
  const heatmapGrid = document.getElementById('dyn-outage-heatmap-grid');
  if (heatmapGrid && data.historicalOutageHeatmap) {
    const setElText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    
    let renderMap = data.historicalOutageHeatmap;
    let label = '0 Outages';
    
    if (userCity) {
      const titleEl = document.getElementById('heatmap-title');
      if (titleEl) titleEl.textContent = `🗺️ Local Weather Disruptions: ${userCity}`;
      
      const node = data.weather.solarNodes.find(n => n.name.includes(userCity));
      if (node && data.tick - lastHeatmapTick >= 5) {
        cityHeatmapCache.shift();
        let severity = 0;
        if (node.clouds > 0.8 || data.weather.stormActive) severity = 2;
        else if (node.clouds > 0.4) severity = 1;
        cityHeatmapCache.push(severity);
        lastHeatmapTick = data.tick;
      }
      renderMap = cityHeatmapCache;
      const disruptions = renderMap.filter(v => v > 0).length;
      label = disruptions === 0 ? '0 Disruptions' : disruptions + ' Disruptions';
    } else {
      const eventsCount = renderMap.filter(v => v > 0).length;
      label = eventsCount === 0 ? '0 Outages' : eventsCount + ' Outages';
    }
    
    heatmapGrid.innerHTML = renderMap.map(val => {
      const color = val === 0 ? 'var(--c-success-light)' : val === 1 ? 'var(--c-warning)' : 'var(--c-danger)';
      return `<div style="width:14%; aspect-ratio:1; background:${color}; border-radius:2px; box-shadow:inset 0 0 0 1px rgba(0,0,0,0.05);"></div>`;
    }).join('');
    
    setElText('dyn-outage-heatmap-sub', label);
  }
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
      metricL: 'Temp', valL: data.weather.temperature.toFixed(1) + '°C', metricR: 'Clouds', valR: Math.round(data.weather.cloudCover * 100) + '%' },
    { id: 'vulcan', name: 'VULCAN', role: 'Baseload/Thermal', color: '#f97316', icon: '🌋', d: { reasoning: [{ message: 'Baseload running at optimal thermal efficiency.'}] },
      metricL: 'Gen', valL: Math.round(420 + Math.sin(data.tick * 0.1) * 5) + ' MW', metricR: 'Ramp', valR: (1.2 + Math.cos(data.tick * 0.2) * 0.3).toFixed(1) + ' MW/min' },
    { id: 'gaia', name: 'GAIA', role: 'Carbon/ESG Agent', color: '#10b981', icon: '🌍', d: { reasoning: [{ message: 'Offsetting recent peaker dispatch via P2P trades.'}] },
      metricL: 'Offsets', valL: (12.4 + data.tick * 0.05).toFixed(1) + ' tCO2e', metricR: 'ESG Score', valR: Math.round(92 + Math.sin(data.tick * 0.05) * 2) + '/100' }
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
  initTabs();
  initChatbot();
});

// ── AI Chatbot Logic ──
function initChatbot() {
  const sendBtn = document.getElementById('chat-send');
  const input = document.getElementById('chat-input');
  const messages = document.getElementById('chat-messages');
  if (!sendBtn || !input || !messages) return;

  const appendMessage = (sender, text, isAI) => {
    const div = document.createElement('div');
    div.style.cssText = `background:var(${isAI ? '--bg-surface' : '--c-info-light'}); padding:16px; border-radius:12px; align-self:${isAI ? 'flex-start' : 'flex-end'}; max-width:85%; border:1px solid var(--border-light); line-height: 1.5; color: ${isAI ? 'var(--text-primary)' : 'var(--c-info-dark)'};`;
    div.innerHTML = `<strong>${sender}:</strong><br><br>${text.replace(/\n/g, '<br>')}`;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  };

  const sendMessage = async (overrideMsg) => {
    const msg = overrideMsg || input.value.trim();
    if (!msg) return;
    
    appendMessage(user.name, msg, false);
    if (!overrideMsg) input.value = '';
    sendBtn.textContent = '...';
    sendBtn.disabled = true;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ message: msg })
      });
      const data = await res.json();
      
      if (res.ok) {
        appendMessage('NEXUS Orchestrator', data.response, true);
        showToast('info', '🤖 NEXUS replied', 'AI response received from Gemini');
      } else {
        appendMessage('System Error', data.error || 'Failed to get response', true);
        showToast('danger', 'AI Error', data.error || 'Failed to get response');
      }
    } catch (err) {
      appendMessage('System Error', 'Network error. Could not reach AI server.', true);
      showToast('danger', 'Network Error', 'Could not reach AI server');
    }
    
    sendBtn.textContent = 'Send';
    sendBtn.disabled = false;
  };

  sendBtn.addEventListener('click', () => sendMessage());
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
  });

  // Quick Prompt Chips
  document.querySelectorAll('.prompt-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const prompt = chip.dataset.prompt;
      // Switch to chatbot tab
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      const chatbotBtn = document.querySelector('[data-tab-btn="chatbot"]');
      if (chatbotBtn) chatbotBtn.classList.add('active');
      document.querySelectorAll('[data-tab-pane]').forEach(pane => {
        pane.classList.toggle('tab-pane-hidden', pane.dataset.tabPane !== 'chatbot');
      });
      // Send the prompt
      setTimeout(() => sendMessage(prompt), 100);
    });
  });
}

// ── Toast Notification System ──
function showToast(type, title, message, duration = 4000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const icons = { success: '✅', warning: '⚠️', danger: '🔴', info: 'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <div class="toast-icon">${icons[type] || 'ℹ️'}</div>
    <div class="toast-body">
      <div class="toast-title">${title}</div>
      <div class="toast-msg">${message}</div>
    </div>
    <button class="toast-close" onclick="this.parentElement.remove()">✕</button>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}
window.showToast = showToast;

// ── Export Modal ──
function openExportModal() {
  const existing = document.getElementById('nexus-export-modal');
  if (existing) existing.remove();

  const snapshot = latestData;
  const backdrop = document.createElement('div');
  backdrop.className = 'nexus-modal-backdrop';
  backdrop.id = 'nexus-export-modal';

  const summary = snapshot ? `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;">
      <div style="background:var(--bg-surface);padding:12px;border-radius:8px;border:1px solid var(--border-light)">
        <div style="font-size:0.7rem;color:var(--text-muted);font-weight:700;">TICK</div>
        <div style="font-size:1.3rem;font-weight:800;">${snapshot.tick}</div>
      </div>
      <div style="background:var(--bg-surface);padding:12px;border-radius:8px;border:1px solid var(--border-light)">
        <div style="font-size:0.7rem;color:var(--text-muted);font-weight:700;">HISTORY POINTS</div>
        <div style="font-size:1.3rem;font-weight:800;">${historicalData.length}</div>
      </div>
      <div style="background:var(--bg-surface);padding:12px;border-radius:8px;border:1px solid var(--border-light)">
        <div style="font-size:0.7rem;color:var(--text-muted);font-weight:700;">RENEWABLE MW</div>
        <div style="font-size:1.3rem;font-weight:800;color:var(--c-success)">${Math.round(snapshot.paretoMetrics?.totalRenewable || 0)}</div>
      </div>
      <div style="background:var(--bg-surface);padding:12px;border-radius:8px;border:1px solid var(--border-light)">
        <div style="font-size:0.7rem;color:var(--text-muted);font-weight:700;">CARBON CREDITS</div>
        <div style="font-size:1.3rem;font-weight:800;color:var(--c-success)">${Math.round(snapshot.agents?.mercury?.carbonCredits || 0)}</div>
      </div>
    </div>
  ` : '<p style="color:var(--text-muted)">No simulation data available yet.</p>';

  backdrop.innerHTML = `
    <div class="nexus-modal">
      <div class="nexus-modal-header">
        <h3>📤 Export Simulation Data</h3>
        <button class="nexus-modal-close" onclick="document.getElementById('nexus-export-modal').remove()">✕</button>
      </div>
      <div class="nexus-modal-body">
        <p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:16px;">
          Download the current simulation snapshot or full history for analysis.
        </p>
        ${summary}
        <div style="display:flex;flex-direction:column;gap:10px;">
          <button onclick="exportJSON()" class="tab-btn active" style="width:100%;padding:12px;border-radius:8px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:8px;">
            <span>📄</span> Export Current Snapshot (JSON)
          </button>
          <button onclick="exportHistoryCSV()" class="btn-export" style="width:100%;padding:12px;border-radius:8px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:8px;font-size:0.9rem;">
            <span>📊</span> Export History as CSV (${historicalData.length} rows)
          </button>
          <button onclick="exportHistoryJSON()" class="btn-export" style="width:100%;padding:12px;border-radius:8px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:8px;font-size:0.9rem;">
            <span>🗂️</span> Export Full History (JSON)
          </button>
        </div>
      </div>
    </div>
  `;

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.remove();
  });
  document.body.appendChild(backdrop);
}

function exportJSON() {
  if (!latestData) return;
  const blob = new Blob([JSON.stringify(latestData, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `nexus-snapshot-tick${latestData.tick}.json`; a.click();
  showToast('success', 'Export Complete', 'Snapshot downloaded as JSON');
  document.getElementById('nexus-export-modal')?.remove();
}

function exportHistoryJSON() {
  if (!historicalData.length) return;
  const blob = new Blob([JSON.stringify(historicalData, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `nexus-history-${Date.now()}.json`; a.click();
  showToast('success', 'Export Complete', `${historicalData.length} snapshots downloaded`);
  document.getElementById('nexus-export-modal')?.remove();
}

function exportHistoryCSV() {
  if (!historicalData.length) return;
  const rows = [['tick','hour','solar_mw','wind_mw','demand_mw','battery_soc_pct','grid_price','renewable_pct','carbon_credits','frequency']];
  historicalData.forEach(s => {
    rows.push([
      s.tick,
      s.hour?.toFixed(2),
      Math.round(s.energyFlow?.solar || 0),
      Math.round(s.energyFlow?.wind || 0),
      Math.round(s.energyFlow?.demand || 0),
      ((s.agents?.voltaic?.batteryStates?.[0]?.soc || 0) * 100).toFixed(1),
      s.market?.electricityPrice || 0,
      s.paretoMetrics?.renewableUtil || 0,
      Math.round(s.agents?.mercury?.carbonCredits || 0),
      s.agents?.sentinel?.decision?.frequency?.toFixed(3) || '50.000'
    ]);
  });
  const csv = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `nexus-history-${Date.now()}.csv`; a.click();
  showToast('success', 'Export Complete', `${historicalData.length} rows exported as CSV`);
  document.getElementById('nexus-export-modal')?.remove();
}

// ── User Sim Toggle (Play/Pause) ──
function userToggleSim() {
  const btn = document.getElementById('btn-user-pause');
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    showToast('warning', 'Not Connected', 'WebSocket is not connected');
    return;
  }
  if (isRunning) {
    ws.send(JSON.stringify({ type: 'pause' }));
    showToast('warning', 'Simulation Paused', 'Grid simulation is now paused');
    if (btn) {
      btn.className = 'sim-ctrl-btn play';
      btn.innerHTML = '<svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg> Resume';
    }
  } else {
    ws.send(JSON.stringify({ type: 'start' }));
    showToast('success', 'Simulation Running', 'Grid simulation resumed');
    if (btn) {
      btn.className = 'sim-ctrl-btn pause';
      btn.innerHTML = '<svg viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Pause';
    }
  }
}

// ── AI Ticker ──
const tickerMessages = [
  '⚡ NEXUS Coordinator actively balancing multi-objective Pareto frontier.',
  '☀️ HELIOS forecasting peak solar generation in the next 2 hours.',
  '🔋 VOLTAIC optimizing battery SoC for evening demand peak.',
  '💰 MERCURY scanning IEX market for arbitrage opportunities.',
  '〰️ SENTINEL maintaining grid frequency within ±0.1 Hz tolerance.',
  '🌩️ ORACLE predicts moderate cloud cover — solar dispatch adjusted.',
  '🤝 Nash Bargaining equilibrium converged across all 7 agents.',
  '🌿 Carbon credits being accumulated — ESG targets on track.',
  '🛡️ Grid security: Zero-trust node authentication verified.',
];
let tickerIdx = 0;

function rotateTicker(data) {
  const el = document.getElementById('ticker-text');
  if (!el) return;
  
  // Prioritize live data insights
  let msg = tickerMessages[tickerIdx % tickerMessages.length];
  if (data) {
    if (data.chaosEvents?.length > 0) {
      msg = `⚠️ CHAOS ACTIVE: ${data.chaosEvents[0].name} — ${data.chaosEvents[0].description} | Ticks remaining: ${data.chaosEvents[0].ticksRemaining}`;
    } else if (data.agents?.sentinel?.decision?.frequency) {
      const freq = data.agents.sentinel.decision.frequency.toFixed(3);
      const isOk = Math.abs(freq - 50) < 0.15;
      msg = isOk
        ? `✅ Grid stable at ${freq} Hz | Solar: ${Math.round(data.energyFlow?.solar || 0)} MW | Wind: ${Math.round(data.energyFlow?.wind || 0)} MW | Demand: ${Math.round(data.energyFlow?.demand || 0)} MW`
        : `⚠️ Grid frequency deviation: ${freq} Hz | SENTINEL initiating corrective action`;
    }
  }
  
  el.style.animation = 'none';
  el.offsetHeight; // reflow
  el.textContent = msg;
  el.style.animation = 'tickerScroll 30s linear infinite';
  tickerIdx++;
}

// ── Alert toasts for chaos events ──
let lastChaosEventCount = 0;
function checkChaosAlerts(data) {
  if (!data?.chaosEvents) return;
  const current = data.chaosEvents.length;
  if (current > lastChaosEventCount) {
    const newest = data.chaosEvents[0];
    showToast('danger', `⚠️ Chaos Detected: ${newest.name}`, newest.description);
  } else if (current === 0 && lastChaosEventCount > 0) {
    showToast('success', '✅ Grid Stabilized', 'All chaos events have been resolved by NEXUS.');
  }
  lastChaosEventCount = current;
}

// Override the ws onmessage to include our new features since function hoisting breaks simple wrapping
const originalWsOnMessage = window.onmessage; // Not window.onmessage, ws.onmessage is assigned inside connectWS

// Safer approach: Just patch the global updateDashboard by replacing it.
const originalUpdate = updateDashboard;
window.updateDashboard = function(data) {
  originalUpdate(data);
  checkChaosAlerts(data);
  if (data.tick % 30 === 0) rotateTicker(data);
};


