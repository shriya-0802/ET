/**
 * Authentication Module — JWT + bcrypt
 * File-based user storage for hackathon simplicity
 */

import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const USERS_FILE = join(__dirname, 'users.json');

export const JWT_SECRET = 'nexus-energy-hackathon-secret-2026';
const TOKEN_EXPIRY = '24h';

// ── User Store ──
function loadUsers() {
  if (!existsSync(USERS_FILE)) {
    // Seed with default admin
    const defaultUsers = [
      {
        id: uuidv4(),
        name: 'Admin',
        email: 'admin@nexus.energy',
        password: bcrypt.hashSync('admin123', 10),
        role: 'admin',
        createdAt: new Date().toISOString(),
      },
    ];
    writeFileSync(USERS_FILE, JSON.stringify(defaultUsers, null, 2));
    return defaultUsers;
  }
  return JSON.parse(readFileSync(USERS_FILE, 'utf-8'));
}

function saveUsers(users) {
  writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// ── Router ──
export const authRouter = express.Router();

// Signup
authRouter.post('/signup', async (req, res) => {
  const { name, email, password, role } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required' });
  }

  const users = loadUsers();

  if (users.find(u => u.email === email)) {
    return res.status(409).json({ error: 'Email already registered' });
  }

  const validRoles = ['user', 'admin'];
  const userRole = validRoles.includes(role) ? role : 'user';

  const hashedPassword = await bcrypt.hash(password, 10);
  const newUser = {
    id: uuidv4(),
    name,
    email,
    password: hashedPassword,
    role: userRole,
    createdAt: new Date().toISOString(),
  };

  users.push(newUser);
  saveUsers(users);

  const token = jwt.sign(
    { id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );

  res.cookie('token', token, { httpOnly: false, maxAge: 86400000 });
  res.json({
    token,
    user: { id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role },
  });
});

// Login
authRouter.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const users = loadUsers();
  const user = users.find(u => u.email === email);

  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign(
    { id: user.id, name: user.name, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );

  res.cookie('token', token, { httpOnly: false, maxAge: 86400000 });
  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
});

// Logout
authRouter.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logged out' });
});

// List users (admin only)
authRouter.get('/users', (req, res) => {
  const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

    const users = loadUsers().map(u => ({
      id: u.id, name: u.name, email: u.email, role: u.role, createdAt: u.createdAt,
    }));
    res.json(users);
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Reset DB (admin only)
authRouter.post('/reset-db', (req, res) => {
  const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    const defaultUsers = [
      {
        id: uuidv4(),
        name: 'Admin',
        email: 'admin@nexus.energy',
        password: bcrypt.hashSync('admin123', 10),
        role: 'admin',
        createdAt: new Date().toISOString(),
      },
    ];
    saveUsers(defaultUsers);
    res.json({ message: 'Database reset to default state' });
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// ── Middleware for protected API routes ──
export function verifyToken(req, res, next) {
  const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}
