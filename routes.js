const express = require('express');
const router = express.Router();
const crypto = require('crypto');

const db = require('./db');
const auth = require('./auth');
const { evaluateWithdrawal } = require('./gates');
const {
  sendB2C,
  getMpesaStatus,
  MIN_B2C_AMOUNT,
  MAX_B2C_AMOUNT
} = require('./mpesa');
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

// M-Pesa till / Daraja payout readiness (no secrets exposed)
router.get('/mpesa/status', auth.authMiddleware, (req, res) => {
  try {
    res.json(getMpesaStatus());
  } catch (err) {
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

    const numericAmount = Number(amount);
    if (!Number.isSafeInteger(numericAmount) || numericAmount < MIN_B2C_AMOUNT || numericAmount > MAX_B2C_AMOUNT) {
      return res.status(400).json({
        error: `Amount must be a whole number between Ksh ${MIN_B2C_AMOUNT} and Ksh ${MAX_B2C_AMOUNT}.`
      });
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

    // Reserve wallet funds and quota atomically before contacting Daraja.
    const originatorConversationId = crypto.randomBytes(10).toString('hex').slice(0, 19);
    let reservation;
    try {
      reservation = await db.reserveWalletWithdrawal(
        req.user.id,
        wallet.id,
        numericAmount,
        originatorConversationId,
        `Withdrawal requested for ${req.user.phone_number}`
      );
    } catch (error) {
      if (/Daily limit|Weekly access quota|Insufficient allocation|Wallet not found|previous payout is still awaiting/i.test(error.message || '')) {
        return res.status(409).json({ error: error.message });
      }
      console.error('Could not reserve wallet funds:', error.message);
      return res.status(503).json({ error: 'Could not reserve wallet funds. Please try again.' });
    }

    // Submit the payout. Its reservation stays in place until the callback settles it.
    let mpesaResult;
    try {
      mpesaResult = await sendB2C(
        numericAmount,
        req.user.phone_number,
        wallet.name,
        originatorConversationId
      );
    } catch (mpesaError) {
      console.error('M-Pesa payout initiation failed:', {
        originatorConversationId,
        message: mpesaError.message,
        outcomeUnknown: Boolean(mpesaError.outcomeUnknown)
      });

      if (mpesaError.outcomeUnknown) {
        try {
          await db.markWithdrawalUnknown(
            originatorConversationId,
            'Daraja response was inconclusive; wallet funds remain reserved pending callback.'
          );
        } catch (error) {
          console.error('Could not mark uncertain payout:', originatorConversationId, error.message);
        }
        return res.status(202).json({
          success: true,
          status: 'unknown',
          message: 'Safaricom has not confirmed the payout yet. The amount is reserved; check transaction history for updates.',
          amount: numericAmount,
          wallet: wallet.name,
          reference: originatorConversationId
        });
      }

      try {
        await db.finishWalletWithdrawal({
          originatorConversationId,
          success: false,
          statusNote: mpesaError.message || 'Daraja rejected the payout request.'
        });
      } catch (error) {
        console.error('Could not refund rejected payout:', originatorConversationId, error.message);
        return res.status(503).json({
          error: 'Safaricom rejected the request, but the wallet refund is awaiting reconciliation.',
          status: 'pending',
          reference: originatorConversationId
        });
      }

      return res.status(502).json({
        error: mpesaError.message || 'M-Pesa transaction failed. The reserved amount has been returned.',
        status: 'failed',
        refunded: true
      });
    }

    if (mpesaResult && mpesaResult.mock) {
      const settlement = await db.finishWalletWithdrawal({
        originatorConversationId,
        success: true
      });
      return res.json({
        success: true,
        status: settlement.final_status,
        message: `Ksh ${numericAmount} simulated from ${wallet.name}`,
        amount: numericAmount,
        wallet: wallet.name,
        newBalance: reservation.wallet_balance,
        mock: true,
        reference: originatorConversationId
      });
    }

    try {
      await db.saveWithdrawalConversationId(
        originatorConversationId,
        mpesaResult && mpesaResult.ConversationID
      );
    } catch (error) {
      // The callback can still settle by OriginatorConversationID; do not refund an accepted request.
      console.error('Could not store Daraja conversation ID:', originatorConversationId, error.message);
    }

    return res.status(202).json({
      success: true,
      status: 'pending',
      message: `Ksh ${numericAmount} payout requested. The amount is reserved until Safaricom confirms the result.`,
      amount: numericAmount,
      wallet: wallet.name,
      newBalance: reservation.wallet_balance,
      mock: false,
      reference: originatorConversationId
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

// -------------------------------------------------------------
// Safaricom Daraja Webhooks & Callbacks
// -------------------------------------------------------------
router.post(['/daraja/callback', '/daraja/result', '/daraja/timeout'], async (req, res) => {
  const body = req.body || {};
  const result = body.Result || {};
  const originatorConversationId =
    result.OriginatorConversationID ||
    body.OriginatorConversationID ||
    (req.query && req.query.originatorConversationID);

  if (!originatorConversationId) {
    console.error('Daraja callback did not include an OriginatorConversationID.');
    return res.status(400).json({ ResultCode: 1, ResultDesc: 'OriginatorConversationID is required' });
  }

  try {
    if (result.ResultCode === undefined || result.ResultCode === null) {
      await db.markWithdrawalUnknown(
        originatorConversationId,
        'Daraja queue timeout callback received; awaiting a final result.'
      );
      return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }

    const resultCode = Number(result.ResultCode);
    if (!Number.isFinite(resultCode)) {
      await db.markWithdrawalUnknown(
        originatorConversationId,
        'Daraja returned an unrecognized result; awaiting confirmation.'
      );
      return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }

    const parameters = result.ResultParameters && result.ResultParameters.ResultParameter;
    const transactionReceipt = Array.isArray(parameters)
      ? (parameters.find(parameter => parameter.Key === 'TransactionReceipt') || {}).Value
      : null;

    await db.finishWalletWithdrawal({
      originatorConversationId,
      success: resultCode === 0,
      conversationId: result.ConversationID || null,
      transactionReceipt: transactionReceipt || null,
      statusNote: resultCode === 0
        ? null
        : (result.ResultDesc || `Daraja payout failed with result code ${resultCode}.`)
    });

    return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (error) {
    console.error('Could not reconcile Daraja callback:', originatorConversationId, error.message);
    return res.status(503).json({ ResultCode: 1, ResultDesc: 'Payout callback could not be saved' });
  }
});

module.exports = router;
