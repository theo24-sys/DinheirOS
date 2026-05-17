// routes.js – Express API endpoints for FinanceOS (Async)
const express = require('express');
const router = express.Router();

const { runQuery, execStmt } = require('./db');
const { evaluateWithdrawal } = require('./gates');
const { sendB2C } = require('./mpesa');
const { wallets: walletRules } = require('./config');
const auth = require('./auth');

async function getWalletInfo(name) {
  const walletConfig = walletRules[name];
  if (!walletConfig) throw new Error(`Unknown wallet: ${name}`);

  const rows = await runQuery('SELECT * FROM wallets WHERE name = ?', [name]);
  let walletRow = rows[0];
  
  if (!walletRow) {
    await execStmt('INSERT INTO wallets (name, weekly_amount, daily_limit, weekly_max_count, rollover, balance) VALUES (?,?,?,?,?,?)', 
      [name, walletConfig.weeklyAmount, walletConfig.dailyLimit ? 1 : 0, walletConfig.maxCount, walletConfig.rollover ? 1 : 0, walletConfig.weeklyAmount]);
    const updatedRows = await runQuery('SELECT * FROM wallets WHERE name = ?', [name]);
    walletRow = updatedRows[0];
  } else {
    // Sync DB if config has been updated
    const configDailyLimit = walletConfig.dailyLimit ? 1 : 0;
    const configRollover = walletConfig.rollover ? 1 : 0;
    
    if (walletRow.weekly_amount !== walletConfig.weeklyAmount || 
        walletRow.weekly_max_count !== walletConfig.maxCount ||
        walletRow.daily_limit !== configDailyLimit ||
        walletRow.rollover !== configRollover) {
      
      const newBalance = walletConfig.weeklyAmount - (walletRow.used_this_week * (walletConfig.perAccessAmount || (walletConfig.weeklyAmount / walletConfig.maxCount)));
      
      await execStmt('UPDATE wallets SET weekly_amount = ?, daily_limit = ?, weekly_max_count = ?, rollover = ?, balance = ? WHERE name = ?', 
        [walletConfig.weeklyAmount, configDailyLimit, walletConfig.maxCount, configRollover, newBalance, name]);
      
      const updatedRows = await runQuery('SELECT * FROM wallets WHERE name = ?', [name]);
      walletRow = updatedRows[0];
    }
  }
  return { walletConfig, walletRow };
}

router.get('/status', async (req, res) => {
  try {
    const wallets = [];
    for (const name of Object.keys(walletRules)) {
      const info = await getWalletInfo(name);
      wallets.push(info.walletRow);
    }
    res.json({ wallets });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Auth endpoints ---
router.get('/auth/status', async (req, res) => {
  try {
    const pinSet = await auth.isPinSet();
    res.json({ pinSet });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/auth/setup', async (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin || String(pin).length !== 4) return res.status(400).json({ error: 'PIN must be 4 digits' });
    if (await auth.isPinSet()) return res.status(400).json({ error: 'PIN already set' });
    await auth.setPin(String(pin));
    const token = await auth.createSession();
    res.json({ success: true, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/auth/login', async (req, res) => {
  try {
    const { pin, biometric } = req.body || {};
    if (await auth.isLockedOut()) {
      return res.status(429).json({ error: 'Too many failed attempts. Wait 10 minutes.' });
    }

    // Biometric flow: client-side WebAuthn should verify; here we accept a biometric flag as a bridge
    if (biometric) {
      const token = await auth.createSession();
      await auth.logAttempt(true);
      return res.json({ success: true, token });
    }

    if (!pin) return res.status(400).json({ error: 'PIN required' });
    if (await auth.verifyPin(String(pin))) {
      await auth.logAttempt(true);
      const token = await auth.createSession();
      return res.json({ success: true, token });
    }
    await auth.logAttempt(false);
    res.status(401).json({ error: 'Wrong PIN' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/auth/lock', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) await auth.deleteSession(token);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// App lock endpoint (mounted at /api/lock)
router.post('/lock', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) await auth.deleteSession(token);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Middleware to protect /api/withdraw
router.use('/withdraw', async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token || !(await auth.validateSession(token))) {
      return res.status(401).json({ error: 'Unauthorized. Please login.' });
    }
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/withdraw', async (req, res) => {
  try {
    const { wallet, amount } = req.body;
    if (!wallet || typeof amount !== 'number') {
      return res.status(400).json({ error: 'wallet and amount required' });
    }

    const { walletConfig, walletRow } = await getWalletInfo(wallet);

    // Gate Checks
    const gateResult = await evaluateWithdrawal(wallet, amount);
    if (!gateResult.allowed) {
      return res.status(403).json({ error: gateResult.reason });
    }

    // Try Mpesa B2C (Mock if secrets not present or failure)
    try {
      if (process.env.DARAJA_CONSUMER_KEY) {
        await sendB2C(wallet, amount);
      } else {
        console.log(`[MOCK] B2C transfer of ${amount} to ${wallet} successful.`);
      }
    } catch (mpesaError) {
       console.error("Mpesa Error:", mpesaError.message);
       return res.status(500).json({ error: 'M-Pesa transaction failed' });
    }

    // Update counters on success
    await execStmt('UPDATE wallets SET used_today = used_today + 1, used_this_week = used_this_week + 1, balance = balance - ? WHERE name = ?', [amount, wallet]);
    await execStmt('INSERT INTO withdrawals (wallet_id, amount) VALUES (?, ?)', [walletRow.id, amount]);
    await execStmt('INSERT INTO transactions (wallet_id, type, amount, note) VALUES (?, ?, ?, ?)', [walletRow.id, 'withdraw', amount, 'Gate passed, Mpesa sent']);

    res.json({ message: 'Withdrawal successful', amount, wallet });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
