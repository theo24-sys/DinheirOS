const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} = require('@simplewebauthn/server');

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

function getWebAuthnConfig() {
  const rpID = process.env.WEBAUTHN_RP_ID || 'dinheir-os.vercel.app';
  const origin = process.env.WEBAUTHN_ORIGIN || `https://${rpID}`;
  return { rpID, origin };
}

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

router.get('/auth/passkey/status', async (req, res) => {
  try {
    const credentials = await db.getAllPasskeyCredentials();
    res.json({ available: credentials.length > 0 });
  } catch (error) {
    console.error('Passkey status error:', error);
    res.status(503).json({ error: 'Could not check passkey availability.' });
  }
});

router.post('/auth/passkey/register/options', auth.authMiddleware, async (req, res) => {
  try {
    const { rpID } = getWebAuthnConfig();
    const credentials = await db.getPasskeyCredentials(req.user.id);
    const options = await generateRegistrationOptions({
      rpName: 'DinheirOS',
      rpID,
      userName: req.user.name,
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'required',
        authenticatorAttachment: 'platform'
      },
      supportedAlgorithmIDs: [-7, -257],
      excludeCredentials: credentials.map(credential => ({
        id: credential.credential_id,
        transports: credential.transports
      }))
    });

    await db.createPasskeyChallenge(options.challenge, 'registration', req.user.id);
    res.json({ challenge: options.challenge, options });
  } catch (error) {
    console.error('Passkey registration options error:', error);
    res.status(500).json({ error: 'Could not start passkey setup.' });
  }
});

router.post('/auth/passkey/register/verify', auth.authMiddleware, async (req, res) => {
  try {
    const { challenge, credential } = req.body || {};
    if (!challenge || !credential) {
      return res.status(400).json({ error: 'Passkey registration response is incomplete.' });
    }

    const pending = await db.consumePasskeyChallenge(challenge, 'registration', req.user.id);
    if (!pending) {
      return res.status(400).json({ error: 'Passkey setup expired. Please try again.' });
    }

    const { rpID, origin } = getWebAuthnConfig();
    const verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge: pending.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true
    });
    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: 'The device could not verify this passkey.' });
    }

    const { credential: registeredCredential } = verification.registrationInfo;
    await db.savePasskeyCredential({
      credentialId: registeredCredential.id,
      userId: req.user.id,
      publicKey: Buffer.from(registeredCredential.publicKey).toString('base64url'),
      signCount: registeredCredential.counter,
      transports: registeredCredential.transports || []
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Passkey registration verification error:', error);
    res.status(400).json({ error: 'Passkey setup failed. Please try again.' });
  }
});

router.post('/auth/passkey/login/options', async (req, res) => {
  try {
    const credentials = await db.getAllPasskeyCredentials();
    if (!credentials.length) {
      return res.status(404).json({ error: 'No passkey is registered. Sign in with your PIN and set one up in Settings.' });
    }

    const { rpID } = getWebAuthnConfig();
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: 'required',
      allowCredentials: credentials.map(credential => ({
        id: credential.credential_id,
        transports: credential.transports
      }))
    });

    await db.createPasskeyChallenge(options.challenge, 'authentication');
    res.json({ challenge: options.challenge, options });
  } catch (error) {
    console.error('Passkey login options error:', error);
    res.status(500).json({ error: 'Could not start passkey sign-in.' });
  }
});

router.post('/auth/passkey/login/verify', async (req, res) => {
  try {
    const { challenge, credential } = req.body || {};
    if (!challenge || !credential || !credential.id) {
      return res.status(400).json({ error: 'Passkey response is incomplete.' });
    }

    const pending = await db.consumePasskeyChallenge(challenge, 'authentication');
    if (!pending) {
      return res.status(400).json({ error: 'Passkey sign-in expired. Please try again.' });
    }

    const storedCredential = await db.getPasskeyCredential(credential.id);
    if (!storedCredential) {
      return res.status(401).json({ error: 'This passkey is not registered. Use your PIN.' });
    }

    const { rpID, origin } = getWebAuthnConfig();
    const verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge: pending.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: storedCredential.credential_id,
        publicKey: Buffer.from(storedCredential.public_key, 'base64url'),
        counter: Number(storedCredential.sign_count),
        transports: storedCredential.transports || []
      }
    });
    if (!verification.verified) {
      return res.status(401).json({ error: 'Passkey verification failed. Use your PIN.' });
    }

    const user = await db.getUserById(storedCredential.user_id);
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'This user is inactive. Use an active account.' });
    }

    await db.updatePasskeyCounter(
      storedCredential.credential_id,
      verification.authenticationInfo.newCounter
    );

    const token = crypto.randomUUID();
    await db.createSession(user.id, token);
    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        phoneNumber: user.phone_number
      }
    });
  } catch (error) {
    console.error('Passkey login verification error:', error);
    res.status(401).json({ error: 'Passkey verification failed. Use your PIN.' });
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

router.patch('/wallets/:walletId/budget', auth.authMiddleware, async (req, res) => {
  const walletId = Number(req.params.walletId);
  const weeklyAmount = Number(req.body && req.body.weeklyAmount);
  if (!Number.isSafeInteger(walletId) || walletId < 1) {
    return res.status(400).json({ error: 'Invalid wallet.' });
  }
  if (!Number.isSafeInteger(weeklyAmount) || weeklyAmount < 1 || weeklyAmount > 1000000) {
    return res.status(400).json({ error: 'Weekly budget must be a whole number between Ksh 1 and Ksh 1,000,000.' });
  }

  try {
    const wallet = await db.updateWalletWeeklyBudget(req.user.id, walletId, weeklyAmount);
    res.json({ success: true, wallet });
  } catch (error) {
    if (/Wallet not found/i.test(error.message || '')) {
      return res.status(404).json({ error: 'Wallet not found.' });
    }
    console.error('Wallet budget update error:', error);
    res.status(500).json({ error: 'Could not update the wallet budget.' });
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
