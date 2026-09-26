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
const btnPlay = document.getElementById('btn-play');
const iconPlay = document.getElementById('icon-play');
const iconPause = document.getElementById('icon-pause');
const btnReset = document.getElementById('btn-reset');
const btnStep = document.getElementById('btn-step');
const btnSpeed = document.getElementById('btn-speed');

let currentSpeed = 1;
const speeds = [1, 2, 5, 10];

function sendCommand(cmd, payload = {}) {
  const ws = window.getWS ? window.getWS() : null;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: cmd, ...payload }));
  }
}

btnPlay.addEventListener('click', () => {
  if (btnPlay.classList.contains('active')) {
    // Is playing, pause it
    sendCommand('pause');
    btnPlay.classList.remove('active');
    iconPlay.style.display = '';
    iconPause.style.display = 'none';
  } else {
    // Is paused, play it
    sendCommand('start');
    btnPlay.classList.add('active');
    iconPlay.style.display = 'none';
    iconPause.style.display = '';
  }
});

btnReset.addEventListener('click', () => {
  sendCommand('reset');
  btnPlay.classList.remove('active');
  iconPlay.style.display = '';
  iconPause.style.display = 'none';
});

btnStep.addEventListener('click', () => {
  sendCommand('step');
});

btnSpeed.addEventListener('click', () => {
  const idx = speeds.indexOf(currentSpeed);
  currentSpeed = speeds[(idx + 1) % speeds.length];
  btnSpeed.textContent = `${currentSpeed}×`;
  sendCommand('speed', { speed: currentSpeed });
});

// Sync Play button state with server status (from dashboard-client)
setInterval(() => {
  // `isRunning` is defined in dashboard-client.js
  if (window.isRunning && !btnPlay.classList.contains('active')) {
    btnPlay.classList.add('active');
    iconPlay.style.display = 'none';
    iconPause.style.display = '';
  } else if (!window.isRunning && btnPlay.classList.contains('active')) {
    btnPlay.classList.remove('active');
    iconPlay.style.display = '';
    iconPause.style.display = 'none';
  }
}, 500);

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
