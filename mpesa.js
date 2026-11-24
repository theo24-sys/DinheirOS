const axios = require('axios');

let tokenCache = { token: null, expiry: 0, baseUrl: '' };

function clean(value) {
  return String(value || '').trim().replace(/^["']|["']$/g, '');
}

function pickEnv(...names) {
  for (const name of names) {
    const value = clean(process.env[name]);
    if (value) return value;
  }
  return '';
}

/**
 * Daraja configuration.
 *
 * B2C payouts (money leaving your organisation account) are addressed by the
 * business shortcode that Safaricom approved for B2C — the same organisation
 * that owns the Till. `DARAJA_SHORTCODE` wins, with the common aliases below
 * accepted so an existing Vercel setup keeps working unchanged.
 */
function getDarajaConfig() {
  const env = (pickEnv('DARAJA_ENV', 'MPESA_ENV') || 'production').toLowerCase();
  const isSandbox = env === 'sandbox' || env === 'test' || env === 'uat';
  const baseUrl = pickEnv('DARAJA_BASE_URL') || (isSandbox
    ? 'https://sandbox.safaricom.co.ke'
    : 'https://api.safaricom.co.ke');

  return {
    isSandbox,
    baseUrl,
    consumerKey: pickEnv('DARAJA_CONSUMER_KEY', 'MPESA_CONSUMER_KEY'),
    consumerSecret: pickEnv('DARAJA_CONSUMER_SECRET', 'MPESA_CONSUMER_SECRET'),
    shortcode: pickEnv(
      'DARAJA_SHORTCODE',
      'DARAJA_TILL_NUMBER',
      'DARAJA_STORE_NUMBER',
      'DARAJA_B2C_SHORTCODE',
      'MPESA_SHORTCODE',
      'MPESA_TILL_NUMBER',
      'MPESA_B2C_SHORTCODE'
    ),
    initiatorName: pickEnv('DARAJA_INITIATOR_NAME', 'DARAJA_B2C_INITIATOR_NAME', 'MPESA_INITIATOR_NAME'),
    securityCredential: pickEnv(
      'DARAJA_SECURITY_CREDENTIAL',
      'DARAJA_B2C_SECURITY_CREDENTIAL',
      'MPESA_SECURITY_CREDENTIAL'
    ),
    callbackUrl: pickEnv('CALLBACK_URL', 'DARAJA_CALLBACK_URL', 'MPESA_CALLBACK_URL') ||
      'https://dinheir-os.vercel.app/api/daraja/callback',
    commandId: pickEnv('DARAJA_COMMAND_ID') || 'BusinessPayment',
    remarks: pickEnv('DARAJA_REMARKS') || 'DinheirOS payout',
    occasion: pickEnv('DARAJA_OCCASION') || 'Wallet withdrawal',
    mockAllowed: clean(process.env.DARAJA_ALLOW_MOCK).toLowerCase() === 'true'
  };
}

function missingSettings(cfg) {
  const missing = [];
  if (!cfg.consumerKey) missing.push('DARAJA_CONSUMER_KEY');
  if (!cfg.consumerSecret) missing.push('DARAJA_CONSUMER_SECRET');
  if (!cfg.shortcode) missing.push('DARAJA_SHORTCODE');
  if (!cfg.initiatorName) missing.push('DARAJA_INITIATOR_NAME');
  if (!cfg.securityCredential) missing.push('DARAJA_SECURITY_CREDENTIAL');
  return missing;
}

function allowsMock(cfg) {
  return cfg.mockAllowed || process.env.NODE_ENV !== 'production';
}

function maskShortcode(shortcode) {
  const value = String(shortcode || '');
  if (!value) return '';
  if (value.length <= 3) return '•'.repeat(value.length);
  return `${value.slice(0, 2)}${'•'.repeat(Math.max(1, value.length - 4))}${value.slice(-2)}`;
}

/**
 * Safe, non-secret summary used by the app's settings screen.
 */
function getMpesaStatus() {
  const cfg = getDarajaConfig();
  const missing = missingSettings(cfg);
  const configured = missing.length === 0;
  const mode = configured ? 'live' : (allowsMock(cfg) ? 'mock' : 'unconfigured');
  const callbackIsHttps = /^https:\/\//i.test(cfg.callbackUrl) &&
    !/localhost|127\.0\.0\.1/i.test(cfg.callbackUrl);

  return {
    configured,
    mode,
    environment: cfg.isSandbox ? 'sandbox' : 'production',
    shortcodeMasked: maskShortcode(cfg.shortcode),
    callbackUrl: cfg.callbackUrl,
    callbackIsHttps,
    commandId: cfg.commandId,
    missing
  };
}

function normalizePhoneNumber(phone) {
  let p = String(phone || '').trim().replace(/[\s\-+()]/g, '');
  if (p.startsWith('0')) {
    p = `254${p.slice(1)}`;
  } else if (p.startsWith('7') || p.startsWith('1')) {
    p = `254${p}`;
  }
  return p;
}

function isValidMsisdn(phone) {
  return /^254(7|1)\d{8}$/.test(phone);
}

async function getAccessToken(forceRefresh = false) {
  const cfg = getDarajaConfig();
  if (!cfg.consumerKey || !cfg.consumerSecret) {
    throw new Error('Daraja credentials are missing (DARAJA_CONSUMER_KEY / DARAJA_CONSUMER_SECRET).');
  }

  if (!forceRefresh && tokenCache.token && tokenCache.baseUrl === cfg.baseUrl && Date.now() < tokenCache.expiry) {
    return tokenCache.token;
  }

  const basic = Buffer.from(`${cfg.consumerKey}:${cfg.consumerSecret}`).toString('base64');
  const response = await axios.get(
    `${cfg.baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
    {
      headers: { Authorization: `Basic ${basic}` },
      timeout: 15000
    }
  );

  const token = response.data && response.data.access_token;
  if (!token) {
    throw new Error('Daraja did not return an access token. Check the consumer key/secret and DARAJA_ENV.');
  }

  const expiresIn = Number(response.data.expires_in || 3600);
  tokenCache = {
    token,
    baseUrl: cfg.baseUrl,
    expiry: Date.now() + Math.max(60, expiresIn - 60) * 1000
  };
  return token;
}

function friendlyDarajaError(errorData, fallback) {
  const code = errorData && (errorData.errorCode || errorData.ResponseCode);
  const messages = {
    '404.001.03': 'Daraja rejected the credentials. Check DARAJA_CONSUMER_KEY / DARAJA_CONSUMER_SECRET and that DARAJA_ENV matches the keys (sandbox vs production).',
    '400.002.02': 'Daraja rejected the payout request. Confirm DARAJA_SHORTCODE is the shortcode approved for B2C payouts and that the amount is within limits.',
    '401.002.01': 'Daraja rejected the initiator. Check DARAJA_INITIATOR_NAME and that DARAJA_SECURITY_CREDENTIAL was generated for that initiator.',
    '500.001.1001': 'Daraja could not reach your callback. CALLBACK_URL must be a public HTTPS URL ending in /api/daraja/callback.'
  };
  const detail = errorData && (errorData.errorMessage || errorData.ResponseDescription);
  return messages[code] || detail || fallback;
}

/**
 * Sends an M-Pesa B2C disbursement from your till / shortcode to the user's phone.
 * Throws a descriptive error when the payout cannot be initiated, so the wallet
 * balance is never touched for a transfer that never left the till.
 */
async function sendB2C(amount, recipientPhone, walletName) {
  const cfg = getDarajaConfig();
  const normalizedPhone = normalizePhoneNumber(recipientPhone);
  const payoutAmount = Math.round(Number(amount));

  if (!Number.isFinite(payoutAmount) || payoutAmount <= 0) {
    throw new Error('Invalid payout amount.');
  }
  if (!isValidMsisdn(normalizedPhone)) {
    throw new Error(`Invalid M-Pesa number "${recipientPhone}". Use a Safaricom number like 0712 345 678.`);
  }

  const missing = missingSettings(cfg);

  // Mock mode is only ever allowed outside production or when explicitly enabled.
  if (missing.length > 0) {
    if (allowsMock(cfg)) {
      console.log(`[MOCK M-PESA] Would send Ksh ${payoutAmount} from ${walletName} to ${normalizedPhone} (missing: ${missing.join(', ')})`);
      return {
        ResponseCode: '0',
        ResponseDescription: 'Accepted (MOCK — no money moved)',
        mock: true
      };
    }
    const error = new Error(
      `M-Pesa payouts are not configured. Missing: ${missing.join(', ')}. Add these in Vercel → Settings → Environment Variables, then redeploy.`
    );
    error.details = { missing };
    throw error;
  }

  if (!/^\d{5,7}$/.test(cfg.shortcode)) {
    throw new Error(`DARAJA_SHORTCODE "${cfg.shortcode}" is not a valid M-Pesa shortcode. Use the numeric business shortcode approved for B2C payouts.`);
  }

  try {
    const token = await getAccessToken();
    const payload = {
      InitiatorName: cfg.initiatorName,
      SecurityCredential: cfg.securityCredential,
      CommandID: cfg.commandId,
      Amount: payoutAmount,
      PartyA: cfg.shortcode,
      PartyB: normalizedPhone,
      Remarks: `${cfg.remarks} (${walletName})`.slice(0, 100),
      QueueTimeOutURL: cfg.callbackUrl,
      ResultURL: cfg.callbackUrl,
      Occassion: cfg.occasion.slice(0, 100)
    };

    console.log(`[DARAJA] B2C Ksh ${payload.Amount} from shortcode ${payload.PartyA} to ${payload.PartyB}`);

    const response = await axios.post(
      `${cfg.baseUrl}/mpesa/b2c/v1/paymentrequest`,
      payload,
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 20000
      }
    );

    console.log('[DARAJA RESPONSE]', response.data);

    if (response.data && response.data.ResponseCode && response.data.ResponseCode !== '0') {
      throw new Error(friendlyDarajaError(response.data, 'Daraja refused the payout request.'));
    }

    return response.data;
  } catch (error) {
    // A stale token can surface as 401 — retry once with a fresh one.
    if (error.response && error.response.status === 401) {
      try {
        const token = await getAccessToken(true);
        const retry = await axios.post(
          `${cfg.baseUrl}/mpesa/b2c/v1/paymentrequest`,
          {
            InitiatorName: cfg.initiatorName,
            SecurityCredential: cfg.securityCredential,
            CommandID: cfg.commandId,
            Amount: payoutAmount,
            PartyA: cfg.shortcode,
            PartyB: normalizedPhone,
            Remarks: `${cfg.remarks} (${walletName})`.slice(0, 100),
            QueueTimeOutURL: cfg.callbackUrl,
            ResultURL: cfg.callbackUrl,
            Occassion: cfg.occasion.slice(0, 100)
          },
          { headers: { Authorization: `Bearer ${token}` }, timeout: 20000 }
        );
        return retry.data;
      } catch (retryError) {
        error = retryError;
      }
    }

    const errorData = error.response && error.response.data;
    console.error('M-Pesa B2C transfer error:', error.message, errorData || '');
    const friendly = new Error(friendlyDarajaError(errorData, error.message));
    friendly.details = errorData || null;
    friendly.status = error.response ? error.response.status : 502;
    throw friendly;
  }
}

module.exports = {
  sendB2C,
  getAccessToken,
  normalizePhoneNumber,
  getDarajaConfig,
  getMpesaStatus
};
