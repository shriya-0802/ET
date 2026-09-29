/**
 * Admin Client — Simulation Controls & User Management
 * Runs only on admin.html
 */

// ── Admin Only Check ──
const adminUserStr = localStorage.getItem('user');
if (!adminUserStr || JSON.parse(adminUserStr).role !== 'admin') {
  window.location.href = '/dashboard.html';
}

const tokenStr = localStorage.getItem('token');

// ── Sim Controls ──
const btnReset = document.getElementById('btn-reset');
const btnSpeed = document.getElementById('btn-speed');

let currentSpeed = 1;
const speeds = [1, 2, 5, 10];

function sendCommand(cmd, payload = {}) {
  const ws = window.getWS ? window.getWS() : null;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: cmd, ...payload }));
  }
}

btnReset.addEventListener('click', () => {
  sendCommand('reset');
});

btnSpeed.addEventListener('click', () => {
  const idx = speeds.indexOf(currentSpeed);
  currentSpeed = speeds[(idx + 1) % speeds.length];
  btnSpeed.textContent = `${currentSpeed}×`;
  sendCommand('speed', { speed: currentSpeed });
});

// ── Chaos Engineering ──
async function loadChaosEvents() {
  try {
    const res = await fetch('/api/chaos-events', {
      headers: { 'Authorization': `Bearer ${tokenStr}` }
    });
    if (!res.ok) return;
    const events = await res.json();
    
    const grid = document.getElementById('chaos-grid');
    if (!grid) return;
    
    grid.innerHTML = events.map(e => `
      <button class="chaos-btn" data-id="${e.id}" title="${e.description}">
        <span class="chaos-icon">${e.icon}</span>
        <span class="chaos-name">${e.name}</span>
      </button>
    `).join('');
    
    document.querySelectorAll('.chaos-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        sendCommand('chaos', { eventId: btn.dataset.id });
      });
    });
  } catch (err) {
    console.error('Failed to load chaos events', err);
  }
}

document.getElementById('btn-random-chaos')?.addEventListener('click', () => {
  sendCommand('random_chaos');
});

// ── User Management ──
async function loadUsers() {
  try {
    const res = await fetch('/api/auth/users', {
      headers: { 'Authorization': `Bearer ${tokenStr}` }
    });
    if (!res.ok) return;
    const users = await res.json();
    
    const countEl = document.getElementById('user-count');
    if (countEl) countEl.textContent = `${users.length} User${users.length !== 1 ? 's' : ''}`;
    
    const tbody = document.getElementById('users-tbody');
    if (!tbody) return;
    
    tbody.innerHTML = users.map(u => {
      const date = new Date(u.createdAt).toLocaleDateString();
      const roleCls = u.role === 'admin' ? 'admin' : 'user';
      return `
        <tr>
          <td><strong style="color:var(--text-primary)">${u.name}</strong></td>
          <td style="font-family:var(--font-mono)">${u.email}</td>
          <td><span class="role-tag ${roleCls}">${u.role}</span></td>
          <td>${date}</td>
        </tr>
      `;
    }).join('');
    
  } catch (err) {
    console.error('Failed to load users', err);
  }
}

// ── Init Admin ──
document.addEventListener('DOMContentLoaded', () => {
  loadChaosEvents();
  loadUsers();
});
// ── Admin Real-Time Metrics Update ──
// Taps into the global `latestData` and `isRunning` provided by dashboard-client.js
setInterval(() => {
  if (typeof latestData !== 'undefined' && latestData) {
    // 1. Simulation Engine Status
    const tickVal = document.getElementById('admin-tick-val');
    if (tickVal) tickVal.textContent = latestData.tick;
    
    const timeVal = document.getElementById('admin-time-val');
    if (timeVal) {
      const d = Math.floor(latestData.tick / 96) + 1;
      const h = Math.floor(latestData.hour).toString().padStart(2, '0');
      const m = Math.floor((latestData.hour % 1) * 60).toString().padStart(2, '0');
      timeVal.textContent = `Day ${d} - ${h}:${m}`;
    }
    
    const tickRate = document.getElementById('admin-tick-rate');
    // currentSpeed is from admin-client.js (1, 2, 5, 10). Base is 1.0s.
    if (tickRate) tickRate.textContent = (1.0 / currentSpeed).toFixed(2) + 's / tick';
    
    // 2. Server Resources (Dynamic Mocks correlated with tick/chaos)
    if (isRunning) {
      // CPU
      const cpu = 14 + Math.floor(Math.sin(latestData.tick * 0.5) * 5) + (currentSpeed * 2);
      const cpuTxt = document.getElementById('admin-cpu-text');
      const cpuBar = document.getElementById('admin-cpu-bar');
      if (cpuTxt) cpuTxt.textContent = `${cpu}%`;
      if (cpuBar) {
        cpuBar.style.width = `${cpu}%`;
        cpuBar.style.background = cpu > 80 ? 'var(--c-danger)' : cpu > 50 ? 'var(--c-warning)' : 'var(--c-success)';
      }

      // Memory
      const memBase = 245;
      const mem = memBase + (latestData.tick % 50) + (currentSpeed * 10);
      const memTxt = document.getElementById('admin-mem-text');
      const memBar = document.getElementById('admin-mem-bar');
      if (memTxt) memTxt.textContent = `${mem}MB / 4GB`;
      if (memBar) {
        const memPct = (mem / 4000) * 100;
        memBar.style.width = `${Math.max(10, memPct)}%`;
      }

      // Latency
      const lat = 24 + Math.floor(Math.random() * 8) + (currentSpeed * 5);
      const latTxt = document.getElementById('admin-net-text');
      const latBar = document.getElementById('admin-net-bar');
      if (latTxt) latTxt.textContent = `${lat}ms`;
      if (latBar) {
        latBar.style.width = `${Math.min(100, lat / 2)}%`;
        latBar.style.background = lat > 100 ? 'var(--c-danger)' : lat > 50 ? 'var(--c-warning)' : 'var(--c-success)';
      }

      // Gemini Latency
      const gemLat = document.getElementById('admin-gemini-lat');
      if (gemLat) {
        const gl = 120 + Math.floor(Math.sin(latestData.tick * 0.1) * 30);
        gemLat.textContent = `${gl}ms`;
        gemLat.style.color = gl > 140 ? 'var(--c-warning)' : 'var(--text-secondary)';
      }
      
      // Active Chaos Events Update
      const chaosList = document.getElementById('chaos-active-list');
      if (chaosList && latestData.chaosEvents) {
        if (latestData.chaosEvents.length === 0) {
          chaosList.innerHTML = '<div style="color:var(--text-muted);font-size:0.8rem;text-align:center;padding:20px">No active chaos events</div>';
        } else {
          chaosList.innerHTML = latestData.chaosEvents.map(ev => `
            <div style="background:var(--bg-surface); border:1px solid var(--border-light); border-radius:6px; padding:12px; margin-bottom:8px; display:flex; align-items:center; gap:12px;">
              <div style="font-size:1.5rem">${ev.icon}</div>
              <div style="flex:1;">
                <div style="font-size:0.85rem; font-weight:700;">${ev.name}</div>
                <div style="font-size:0.75rem; color:var(--text-muted);">${ev.description}</div>
              </div>
              <div style="text-align:right;">
                <div style="font-size:0.7rem; color:var(--c-danger); font-weight:700;">${ev.severity}</div>
                <div style="font-size:0.7rem; color:var(--text-muted);">${ev.ticksRemaining} ticks</div>
              </div>
            </div>
          `).join('');
        }
      }
      
      // System Logs append
      const sysLogs = document.getElementById('system-logs');
      if (sysLogs && latestData.tick % 5 === 0) {
        const logs = [
          `[SYS] TICK ${latestData.tick}: Engine state committed.`,
          `[AI] NEXUS evaluated Pareto constraints (Cost: ${latestData.cumulativeMetrics.totalCostK.toFixed(0)}K).`,
          `[NET] Synced OpenWeather data (Cloud Cover: ${(latestData.weather.cloudCover*100).toFixed(0)}%).`,
          `[WS] Broadcasted snapshot to ${Math.floor(Math.random()*5)+1} clients.`,
          `[MARKET] Mercury bid evaluated at ₹${latestData.market.electricityPrice}.`
        ];
        const logLine = logs[Math.floor(Math.random() * logs.length)];
        sysLogs.textContent += `\n${logLine}`;
        // Keep scroll at bottom
        if (sysLogs.parentElement) {
          sysLogs.parentElement.scrollTop = sysLogs.parentElement.scrollHeight;
        }
        // Limit log size
        if (sysLogs.textContent.length > 5000) {
          sysLogs.textContent = sysLogs.textContent.substring(sysLogs.textContent.length - 3000);
        }
      }
    }
  }
}, 500);

// ── Global Config Save ──
document.addEventListener('DOMContentLoaded', () => {
  const saveBtn = document.querySelector('.dash-grid .panel:last-child .tab-btn');
  const tickInput = document.getElementById('admin-tick-input');
  const chaosInput = document.getElementById('admin-chaos-max');
  
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      saveBtn.textContent = 'Saving...';
      saveBtn.style.opacity = 0.7;
      
      // Dispatch WS command
      const configPayload = {};
      if (tickInput) configPayload.baseTick = parseInt(tickInput.value, 10);
      if (chaosInput) configPayload.maxChaos = parseInt(chaosInput.value, 10);
      sendCommand('config', configPayload);
      
      setTimeout(() => {
        saveBtn.textContent = 'Configuration Saved ✓';
        saveBtn.style.background = 'var(--c-success)';
        saveBtn.style.color = '#fff';
        saveBtn.style.opacity = 1;
        setTimeout(() => {
          saveBtn.textContent = 'Save Configuration';
          saveBtn.style.background = '';
          saveBtn.style.color = '';
        }, 2000);
      }, 800);
    });
  }
});
