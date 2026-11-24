const express = require('express');
const router = express.Router();

const db = require('./db');
const auth = require('./auth');
const { evaluateWithdrawal } = require('./gates');
const { sendB2C } = require('./mpesa');
const { resetDaily, resetWeekly } = require('./cron');

// -------------------------------------------------------------
// Health Check
// -------------------------------------------------------------
router.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// -------------------------------------------------------------
// Authentication Endpoints
// -------------------------------------------------------------

// Check if first-time setup is needed
router.get('/auth/status', async (req, res) => {
  try {
    const userCount = await db.countUsers();
    res.json({
      configured: userCount > 0,
      pinSet: userCount > 0,
      userCount,
      maxUsers: 5,
      dbConnected: true
    });
  } catch (err) {
    console.error('Error fetching auth status:', err);
    res.status(503).json({
      error: err.message || 'Database not connected',
      dbConnected: false,
      configured: false,
      pinSet: false
    });
  }
});

// Setup user (up to 5 users)
router.post('/auth/setup', async (req, res) => {
  try {
    const { name, pin, phoneNumber } = req.body || {};
    const result = await auth.setupUser({ name, pin, phoneNumber });
    if (!result.success) {
      return res.status(result.status || 400).json({ error: result.error });
    }
    res.json(result);
  } catch (err) {
    console.error('Setup error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Login with 4-digit PIN
router.post('/auth/login', async (req, res) => {
  try {
    const { pin } = req.body || {};
    const result = await auth.loginWithPin(pin);
    if (!result.success) {
      return res.status(result.status || 401).json({ error: result.error });
    }
    res.json(result);
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Lock / Logout session
router.post('/auth/lock', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '').trim();
    if (token) {
      await auth.logout(token);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Current user profile
router.get('/auth/me', auth.authMiddleware, async (req, res) => {
  res.json({ user: req.user });
});

// -------------------------------------------------------------
// Protected Wallet & Spending Endpoints
// -------------------------------------------------------------

// List all wallets for currently logged-in user
router.get('/status', auth.authMiddleware, async (req, res) => {
  try {
    const wallets = await db.getUserWallets(req.user.id);
    res.json({ user: req.user, wallets });
  } catch (err) {
    console.error('Error fetching wallets:', err);
    res.status(500).json({ error: err.message });
  }
});

// Request withdrawal from a wallet
router.post('/withdraw', auth.authMiddleware, async (req, res) => {
  try {
    const { wallet: walletName, amount } = req.body || {};
    if (!walletName || !amount) {
      return res.status(400).json({ error: 'Wallet name and amount are required' });
    }

    const numericAmount = Math.round(Number(amount));
    if (isNaN(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ error: 'Invalid amount requested' });
    }

    // 1. Fetch user's wallet
    const wallet = await db.getWalletByName(req.user.id, walletName);
    if (!wallet) {
      return res.status(404).json({ error: `Wallet "${walletName}" not found` });
    }

    // 2. Evaluate 3 Security Gates
    const gateCheck = evaluateWithdrawal(wallet, numericAmount);
    if (!gateCheck.allowed) {
      return res.status(403).json({ error: gateCheck.reason });
    }

    // 3. Trigger Safaricom M-Pesa B2C
    try {
      await sendB2C(numericAmount, req.user.phone_number, wallet.name);
    } catch (mpesaError) {
      console.error('M-Pesa payment failed:', mpesaError);
      return res.status(502).json({ error: 'M-Pesa transaction failed. Please try again later.' });
    }

    // 4. Update wallet balances & counters
    const newUsedToday = (wallet.used_today || 0) + 1;
    const newUsedThisWeek = (wallet.used_this_week || 0) + 1;
    const newBalance = wallet.balance - numericAmount;

    await db.updateWallet(wallet.id, {
      used_today: newUsedToday,
      used_this_week: newUsedThisWeek,
      balance: newBalance
    });

    // 5. Record immutable transaction log
    await db.createTransaction(
      req.user.id,
      wallet.id,
      'withdraw',
      numericAmount,
      `Passed all security gates. Sent to ${req.user.phone_number}`
    );

    res.json({
      success: true,
      message: `Ksh ${numericAmount} released from ${wallet.name}`,
      amount: numericAmount,
      wallet: wallet.name,
      newBalance
    });
  } catch (err) {
    console.error('Withdrawal error:', err);
    res.status(500).json({ error: err.message || 'Withdrawal processing error' });
  }
});

// Transaction history for currently logged-in user
router.get('/history', auth.authMiddleware, async (req, res) => {
  try {
    const transactions = await db.getUserTransactions(req.user.id, 30);
    res.json(transactions);
  } catch (err) {
    console.error('History error:', err);
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// Vercel Cron Trigger Endpoint
// -------------------------------------------------------------
router.all('/cron/reset', async (req, res) => {
  try {
    // Optional CRON_SECRET check
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = req.headers['authorization'];
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized cron request' });
    }

    await resetDaily();
    await resetWeekly();

    res.json({ success: true, message: 'Daily & Weekly reset executed successfully' });
  } catch (err) {
    console.error('Cron reset error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
