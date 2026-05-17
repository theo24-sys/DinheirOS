import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import crypto from 'crypto';
import fs from 'fs/promises';
import nodeCron from 'node-cron';
import dotenv from 'dotenv';
import initSqlJs from 'sql.js';
import { WALLET_CONFIGS, evaluateGates, GateDecision } from './src/services/gatekeeper.js';
import { sendB2CPayment } from './src/services/darajaService.js';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || './dinheiros.db';
const PIN_HASH_PATH = process.env.PIN_HASH_PATH || './pin.hash';
const SESSION_SECRET = crypto.randomBytes(32).toString('hex');

// ============ AUTH STATE ============
interface Session {
  token: string;
  createdAt: number;
  expiresAt: number;
}

const sessions = new Map<string, Session>();
const SESSION_DURATION = 30 * 60 * 1000; // 30 minutes

// ============ PIN HELPERS ============
const DEFAULT_PIN = '42458184'; // Default PIN for convenience
const DEFAULT_PIN_HASH = crypto.createHash('sha256').update(DEFAULT_PIN).digest('hex');

async function hashPin(pin: string): Promise<string> {
  return crypto.createHash('sha256').update(pin).digest('hex');
}

async function isPinSet(): Promise<boolean> {
  try {
    await fs.access(PIN_HASH_PATH);
    return true;
  } catch {
    return false;
  }
}

async function getPinHash(): Promise<string | null> {
  try {
    return await fs.readFile(PIN_HASH_PATH, 'utf-8');
  } catch {
    return null;
  }
}

async function setupPin(pin: string): Promise<void> {
  if (pin.length < 4 || pin.length > 6) {
    throw new Error('PIN must be 4-6 digits');
  }
  if (!/^\d+$/.test(pin)) {
    throw new Error('PIN must contain only digits');
  }

  const hash = await hashPin(pin);
  await fs.writeFile(PIN_HASH_PATH, hash, { encoding: 'utf-8', mode: 0o600 });
}

// ============ SESSION MANAGEMENT ============
function createSession(): string {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  sessions.set(token, {
    token,
    createdAt: now,
    expiresAt: now + SESSION_DURATION
  });

  // Clean expired sessions
  for (const [key, session] of sessions.entries()) {
    if (session.expiresAt < Date.now()) {
      sessions.delete(key);
    }
  }

  return token;
}

function verifySession(token: string): boolean {
  const session = sessions.get(token);
  if (!session) return false;
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

// ============ DATABASE SETUP ============
let SQL: any;
let db: any;

async function initDatabase() {
  SQL = await initSqlJs();

  try {
    const buffer = await fs.readFile(DB_PATH);
    db = new SQL.Database(buffer);
  } catch {
    db = new SQL.Database();
    // Create schema
    db.run(`
      CREATE TABLE IF NOT EXISTS wallets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        allocation REAL NOT NULL,
        maxFrequency INTEGER NOT NULL,
        usedFrequency INTEGER NOT NULL,
        perWithdrawalAmount REAL NOT NULL,
        lastWithdrawalDate TEXT,
        locked INTEGER NOT NULL,
        rolloverBonus INTEGER NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        walletId TEXT NOT NULL,
        amount REAL NOT NULL,
        timestamp TEXT NOT NULL,
        status TEXT NOT NULL,
        reason TEXT,
        darajaConversationId TEXT,
        FOREIGN KEY(walletId) REFERENCES wallets(id)
      );
    `);

    // Seed initial wallets
    for (const config of WALLET_CONFIGS) {
      db.run(
        `INSERT INTO wallets (id, name, allocation, maxFrequency, usedFrequency, perWithdrawalAmount, lastWithdrawalDate, locked, rolloverBonus, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          config.id,
          config.name,
          config.allocation,
          config.maxFrequency,
          0,
          config.perWithdrawalAmount,
          null,
          0,
          0,
          new Date().toISOString()
        ]
      );
    }

    await saveDatabase();
  }
}

async function saveDatabase() {
  const data = db.export();
  const buffer = Buffer.from(data);
  await fs.writeFile(DB_PATH, buffer);
}

// ============ API ENDPOINTS ============

// AUTH: Setup PIN (first time only)
app.post('/api/auth/setup-pin', async (req, res) => {
  try {
    const pinSet = await isPinSet();
    if (pinSet) {
      return res.status(403).json({ message: 'PIN already set' });
    }

    const { pin } = req.body;
    if (!pin) {
      return res.status(400).json({ message: 'PIN required' });
    }

    await setupPin(pin);
    res.json({ message: 'PIN setup successful' });
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// AUTH: Check if PIN is set
app.get('/api/auth/status', async (req, res) => {
  const pinSet = await isPinSet();
  res.json({ isPinSet: pinSet });
});

// AUTH: Login with PIN
app.post('/api/auth/pin', async (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin) {
      return res.status(400).json({ message: 'PIN required' });
    }

    let storedHash = await getPinHash();
    
    // If no PIN set yet, use default PIN
    if (!storedHash) {
      storedHash = DEFAULT_PIN_HASH;
    }

    const inputHash = await hashPin(pin);
    if (inputHash !== storedHash) {
      return res.status(401).json({ message: 'Invalid PIN' });
    }

    const token = createSession();
    res.json({ token });
  } catch (error: any) {
    res.status(500).json({ message: 'Authentication failed' });
  }
});

// Middleware: Verify authentication
app.use('/api/wallets', (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || !verifySession(token)) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  next();
});

app.use('/api/transactions', (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || !verifySession(token)) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  next();
});

app.use('/api/withdraw', (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || !verifySession(token)) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  next();
});

// GET: All wallets
app.get('/api/wallets', async (req, res) => {
  try {
    const stmt = db.prepare('SELECT * FROM wallets ORDER BY name');
    const wallets = [];
    while (stmt.step()) {
      wallets.push(stmt.getAsObject());
    }
    stmt.free();
    res.json(wallets);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// GET: Transactions
app.get('/api/transactions', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const stmt = db.prepare(
      'SELECT * FROM transactions ORDER BY timestamp DESC LIMIT ?'
    );
    stmt.bind([limit]);
    const transactions = [];
    while (stmt.step()) {
      transactions.push(stmt.getAsObject());
    }
    stmt.free();
    res.json(transactions);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// POST: Withdraw
app.post('/api/withdraw', async (req, res) => {
  const { walletId } = req.body;
  if (!walletId) {
    return res.status(400).json({ message: 'walletId required' });
  }

  try {
    // Get wallet
    const stmt = db.prepare('SELECT * FROM wallets WHERE id = ?');
    stmt.bind([walletId]);
    if (!stmt.step()) {
      return res.status(404).json({ message: 'Wallet not found' });
    }

    const walletData = stmt.getAsObject();
    stmt.free();

    // Reconstruct wallet object for evaluation
    const wallet = {
      id: walletData.id,
      name: walletData.name,
      allocation: walletData.allocation,
      maxFrequency: walletData.maxFrequency,
      usedFrequency: walletData.usedFrequency,
      perWithdrawalAmount: walletData.perWithdrawalAmount,
      lastWithdrawalDate: walletData.lastWithdrawalDate,
      locked: walletData.locked === 1,
      rolloverBonus: walletData.rolloverBonus
    };

    // Evaluate gates
    const decision = evaluateGates(wallet);

    // Record transaction (denied or pending)
    const txId = `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    if (decision !== GateDecision.APPROVED) {
      db.run(
        `INSERT INTO transactions (id, walletId, amount, timestamp, status, reason)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [txId, walletId, wallet.perWithdrawalAmount, new Date().toISOString(), 'denied', decision]
      );
      await saveDatabase();
      return res.status(403).json({
        decision,
        message: `Access Denied: ${decision}`
      });
    }

    // Process payment via Daraja
    const phone = process.env.PERSONAL_PHONE_NUMBER;
    if (!phone) {
      throw new Error('PERSONAL_PHONE_NUMBER not configured');
    }

    let paymentResponse: any;
    try {
      paymentResponse = await sendB2CPayment(phone, wallet.perWithdrawalAmount);
    } catch (error: any) {
      console.error('Payment failed:', error);
      db.run(
        `INSERT INTO transactions (id, walletId, amount, timestamp, status, reason)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [txId, walletId, wallet.perWithdrawalAmount, new Date().toISOString(), 'denied', 'PAYMENT_FAILED']
      );
      await saveDatabase();
      return res.status(500).json({ message: 'Payment processing failed' });
    }

    // Update wallet: increment frequency and set last withdrawal date
    db.run(
      `UPDATE wallets SET usedFrequency = usedFrequency + 1, lastWithdrawalDate = ?, updatedAt = ? WHERE id = ?`,
      [new Date().toISOString(), new Date().toISOString(), walletId]
    );

    // Record successful transaction
    const darajaId = paymentResponse.ConversationID || txId;
    db.run(
      `INSERT INTO transactions (id, walletId, amount, timestamp, status, darajaConversationId)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [darajaId, walletId, wallet.perWithdrawalAmount, new Date().toISOString(), 'success', paymentResponse.ConversationID]
    );

    await saveDatabase();

    res.json({
      decision: GateDecision.APPROVED,
      amount: wallet.perWithdrawalAmount,
      transaction: darajaId
    });
  } catch (error: any) {
    console.error('Withdrawal error:', error);
    res.status(500).json({ message: 'System error', error: error.message });
  }
});

// CRON: Weekly Reset (Monday 00:00)
nodeCron.schedule('0 0 * * 1', async () => {
  console.log('Running Weekly Reset Cycle...');
  try {
    const stmt = db.prepare('SELECT * FROM wallets');
    const wallets = [];
    while (stmt.step()) {
      wallets.push(stmt.getAsObject());
    }
    stmt.free();

    for (const wallet of wallets) {
      const effectiveMax = wallet.maxFrequency + wallet.rolloverBonus;
      const newRolloverBonus = wallet.usedFrequency < effectiveMax ? 1 : 0;

      db.run(
        `UPDATE wallets SET usedFrequency = 0, rolloverBonus = ?, locked = 0, updatedAt = ? WHERE id = ?`,
        [newRolloverBonus, new Date().toISOString(), wallet.id]
      );
    }

    await saveDatabase();
    console.log('Weekly Reset Complete.');
  } catch (error) {
    console.error('Reset error:', error);
  }
});

// Daraja callbacks
app.post('/api/daraja/result', (req, res) => {
  console.log('Daraja Result:', JSON.stringify(req.body, null, 2));
  res.json({ ResultCode: 0, ResultDesc: 'Success' });
});

app.post('/api/daraja/timeout', (req, res) => {
  console.log('Daraja Timeout:', req.body);
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', environment: 'local', dbPath: DB_PATH });
});

// ============ VITE DEV SERVER (OPTIONAL) ============
async function startServer() {
  try {
    // Initialize database first
    await initDatabase();
    console.log('✓ Database initialized');

    // Optionally use Vite for dev
    if (process.env.NODE_ENV !== 'production') {
      const vite = await createViteServer({
        server: { middlewareMode: true }
      });
      app.use(vite.middlewares);
    }

    // Serve static files
    app.use(express.static('public'));

    // Fallback to index.html for SPA
    app.get('/', (req, res) => {
      res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
    });

    app.listen(PORT, '127.0.0.1', () => {
      console.log(`
╔════════════════════════════════════════╗
║     FinanceOS - Local Server Ready     ║
╠════════════════════════════════════════╣
║ URL: http://127.0.0.1:${PORT}
║ Database: ${DB_PATH}
║ Mode: Local PIN Authentication
║ Rules: ENFORCED SERVER-SIDE
╚════════════════════════════════════════╝
      `);
    });
  } catch (error) {
    console.error('Server startup error:', error);
    process.exit(1);
  }
}

startServer();
