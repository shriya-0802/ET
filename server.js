/**
 * NEXUS Server — Express + WebSocket + Auth
 * Runs simulation server-side, broadcasts real-time data via WebSocket
 */

import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { authRouter, verifyToken, JWT_SECRET } from './src/server/auth.js';
import { Simulation } from './src/engine/simulation.js';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ── Middleware ──
app.use(express.json());
app.use(cookieParser());
app.use(express.static(join(__dirname, 'public')));

// ── Auth Routes ──
app.use('/api/auth', authRouter);

// ── Protected page middleware ──
function requireAuth(req, res, next) {
  const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
  if (!token) return res.redirect('/');
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.redirect('/');
  }
}

function requireAdmin(req, res, next) {
  const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
  if (!token) return res.redirect('/');
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') return res.redirect('/dashboard.html');
    req.user = decoded;
    next();
  } catch {
    return res.redirect('/');
  }
}

// ── Protected HTML pages ──
app.get('/dashboard.html', requireAuth, (req, res) => {
  res.sendFile(join(__dirname, 'public', 'dashboard.html'));
});
app.get('/admin.html', requireAdmin, (req, res) => {
  res.sendFile(join(__dirname, 'public', 'admin.html'));
});

// ── API: Current user ──
app.get('/api/me', (req, res) => {
  const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    res.json({ user: decoded });
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// ── Simulation Engine (server-side) ──
const sim = new Simulation();
global.sim = sim;
let simRunning = false;
let simInterval = null;
let simSpeed = 1;
let simBaseTick = 1000;
let latestSnapshot = null;

function startSimulation() {
  if (simRunning) return;
  simRunning = true;
  simInterval = setInterval(() => {
    latestSnapshot = sim.step();
    broadcastSnapshot(latestSnapshot);
  }, simBaseTick / simSpeed);
}

function pauseSimulation() {
  simRunning = false;
  if (simInterval) {
    clearInterval(simInterval);
    simInterval = null;
  }
}

function setSimSpeed(speed) {
  simSpeed = speed;
  if (simRunning) {
    pauseSimulation();
    startSimulation();
  }
}

function setSimBaseTick(tickMs) {
  simBaseTick = tickMs;
  if (simRunning) {
    pauseSimulation();
    startSimulation();
  }
}

// Auto-start simulation
startSimulation();

// ── WebSocket ──
const wsClients = new Map();

wss.on('connection', (ws, req) => {
  // Parse token from URL query
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get('token');
  let user = null;

  try {
    user = jwt.verify(token, JWT_SECRET);
  } catch {
    ws.send(JSON.stringify({ type: 'error', message: 'Authentication failed' }));
    ws.close();
    return;
  }

  wsClients.set(ws, user);
  console.log(`⚡ WebSocket connected: ${user.name} (${user.role})`);

  // Send current state immediately
  if (latestSnapshot) {
    ws.send(JSON.stringify({ type: 'snapshot', data: latestSnapshot }));
  }
  ws.send(JSON.stringify({
    type: 'sim_status',
    running: simRunning,
    speed: simSpeed,
    tick: sim.tick,
  }));

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);

      // Only admins can control simulation
      if (user.role !== 'admin' && ['start', 'pause', 'speed', 'chaos', 'random_chaos', 'step', 'config'].includes(msg.type)) {
        ws.send(JSON.stringify({ type: 'error', message: 'Admin privileges required' }));
        return;
      }

      switch (msg.type) {
        case 'start':
          startSimulation();
          broadcastStatus();
          break;
        case 'pause':
          pauseSimulation();
          broadcastStatus();
          break;
        case 'reset':
          pauseSimulation();
          sim.reset();
          latestSnapshot = null;
          startSimulation();
          broadcastStatus();
          broadcast({ type: 'reset' });
          break;
        case 'step':
          if (!simRunning) {
            latestSnapshot = sim.step();
            broadcastSnapshot(latestSnapshot);
          }
          break;
        case 'speed':
          setSimSpeed(msg.speed || 1);
          broadcastStatus();
          break;
        case 'config':
          if (msg.baseTick) setSimBaseTick(msg.baseTick);
          if (msg.maxChaos) sim.chaos.maxConcurrentEvents = msg.maxChaos;
          broadcastStatus();
          break;
        case 'chaos':
          sim.injectChaos(msg.eventId);
          break;
        case 'random_chaos':
          sim.randomChaos();
          break;
      }
    } catch (e) {
      console.error('WS message error:', e);
    }
  });

  ws.on('close', () => {
    wsClients.delete(ws);
    console.log(`🔌 WebSocket disconnected: ${user?.name}`);
  });
});

function broadcast(message) {
  const data = JSON.stringify(message);
  for (const [ws] of wsClients) {
    if (ws.readyState === ws.OPEN) {
      ws.send(data);
    }
  }
}

function broadcastSnapshot(snapshot) {
  broadcast({ type: 'snapshot', data: snapshot });
}

function broadcastStatus() {
  broadcast({
    type: 'sim_status',
    running: simRunning,
    speed: simSpeed,
    tick: sim.tick,
  });
}

// ── API: Chaos events list (for admin panel) ──
app.get('/api/chaos-events', verifyToken, (req, res) => {
  res.json(sim.getChaosEvents().map(e => ({
    id: e.id,
    name: e.name,
    icon: e.icon,
    description: e.description,
    severity: e.severity,
    duration: e.duration,
  })));
});

// ── API: Simulation history ──
app.get('/api/history', verifyToken, (req, res) => {
  res.json(sim.snapshots.slice(-50));
});

// ── API: Dataset info ──
app.get('/api/dataset', verifyToken, (req, res) => {
  res.json({
    solarFarms: 5,
    windFarms: 3,
    batteries: 2,
    consumers: 5,
    transmissionLines: 3,
    totalCapacitySolarMW: 580,
    totalCapacityWindMW: 500,
    totalBatteryMWh: 700,
    dataSource: 'Simulated from MNRE/NIWE/IEX patterns',
    updateFrequency: '15-min intervals (real-time)',
  });
});

// ── API: Gemini Chatbot ──
app.post('/api/chat', verifyToken, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required' });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY is not configured in .env' });

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-3.6-flash" });

    const prompt = `You are NEXUS, an advanced AI orchestrator managing a renewable energy microgrid (solar, wind, batteries). Provide a concise, professional, and helpful response to the operator's query. Answer in plain text (no markdown formatting if possible) to fit cleanly in a small dashboard panel.

User Query: ${message}`;
    
    const result = await model.generateContent(prompt);
    res.json({ response: result.response.text() });
  } catch (err) {
    console.error('Chat API Error:', err.message || err);
    res.status(500).json({ error: err.message || 'Failed to generate response.' });
  }
});

// ── Start Server ──
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('');
  console.log('  ⚡ NEXUS Energy Orchestrator');
  console.log(`  🌐 http://localhost:${PORT}`);
  console.log(`  📡 WebSocket: ws://localhost:${PORT}`);
  console.log(`  🔄 Simulation: ${simRunning ? 'RUNNING' : 'PAUSED'}`);
  console.log('');
});
