const axios = require('axios');

const MIN_B2C_AMOUNT = 10;
const MAX_B2C_AMOUNT = 250000;

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
  const env = (pickEnv('DARAJA_ENV', 'MPESA_ENV', 'MPESA_ENVIRONMENT') || 'production').toLowerCase();
  const isSandbox = env === 'sandbox' || env === 'test' || env === 'uat';
  const baseUrl = pickEnv('DARAJA_BASE_URL') || (isSandbox
    ? 'https://sandbox.safaricom.co.ke'
    : 'https://api.safaricom.co.ke');
  const legacyCallbackUrl = pickEnv('CALLBACK_URL', 'DARAJA_CALLBACK_URL', 'MPESA_CALLBACK_URL');
  const callbackUrl = pickEnv('DARAJA_RESULT_URL') || legacyCallbackUrl ||
    'https://dinheir-os.vercel.app/api/daraja/callback';

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
    callbackUrl,
    queueTimeOutUrl: pickEnv('DARAJA_QUEUE_TIMEOUT_URL') || legacyCallbackUrl ||
      'https://dinheir-os.vercel.app/api/daraja/timeout',
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
  const callbackIsHttps = [cfg.callbackUrl, cfg.queueTimeOutUrl].every(url =>
    /^https:\/\//i.test(url) && !/localhost|127\.0\.0\.1/i.test(url)
  );

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

function makeB2CRequestError(error) {
  const errorData = error.response && error.response.data;
  const status = error.response && error.response.status;
  const result = new Error(friendlyDarajaError(errorData, error.message || 'Daraja payout request failed.'));
  result.details = errorData || null;
  result.status = status || 502;
  result.outcomeUnknown = !status || status >= 500;
  return result;
}

function callbackUrlWithOriginatorId(callbackUrl, originatorConversationId) {
  const url = new URL(callbackUrl);
  url.searchParams.set('originatorConversationID', originatorConversationId);
  return url.toString();
}

/**
 * Sends an M-Pesa B2C disbursement from your till / shortcode to the user's phone.
 * The wallet reservation is managed by the caller until a Daraja callback confirms
 * the final outcome.
 */
async function sendB2C(amount, recipientPhone, walletName, originatorConversationId) {
  const cfg = getDarajaConfig();
  const normalizedPhone = normalizePhoneNumber(recipientPhone);
  const payoutAmount = Number(amount);

  if (!Number.isSafeInteger(payoutAmount) || payoutAmount < MIN_B2C_AMOUNT || payoutAmount > MAX_B2C_AMOUNT) {
    throw new Error(`Payout amount must be a whole number between Ksh ${MIN_B2C_AMOUNT} and Ksh ${MAX_B2C_AMOUNT}.`);
  }
  if (!isValidMsisdn(normalizedPhone)) {
    throw new Error(`Invalid M-Pesa number "${recipientPhone}". Use a Safaricom number like 0712 345 678.`);
  }
  if (!originatorConversationId || String(originatorConversationId).length > 20) {
    throw new Error('A valid OriginatorConversationID is required for a B2C payout.');
  }

  const missing = missingSettings(cfg);

  // Mock mode is only ever allowed outside production or when explicitly enabled.
  if (missing.length > 0) {
    if (allowsMock(cfg)) {
      console.log('[MOCK M-PESA] Simulated payout; no money moved.');
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

  const resultUrl = callbackUrlWithOriginatorId(cfg.callbackUrl, originatorConversationId);
  const queueTimeOutUrl = callbackUrlWithOriginatorId(cfg.queueTimeOutUrl, originatorConversationId);
  if (!/^https:\/\//i.test(resultUrl) || !/^https:\/\//i.test(queueTimeOutUrl)) {
    throw new Error('CALLBACK_URL must be a public HTTPS URL for Daraja B2C callbacks.');
  }

  const payload = {
    OriginatorConversationID: originatorConversationId,
    InitiatorName: cfg.initiatorName,
    SecurityCredential: cfg.securityCredential,
    CommandID: cfg.commandId,
    Amount: payoutAmount,
    PartyA: cfg.shortcode,
    PartyB: normalizedPhone,
    Remarks: `${cfg.remarks} (${walletName})`.slice(0, 100),
    QueueTimeOutURL: queueTimeOutUrl,
    ResultURL: resultUrl,
    Occassion: cfg.occasion.slice(0, 100)
  };
  const endpoint = `${cfg.baseUrl}/mpesa/b2c/v3/paymentrequest`;
  let token = await getAccessToken();
  let response;

  try {
    response = await axios.post(endpoint, payload, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 20000
    });
  } catch (error) {
    if (!error.response || error.response.status !== 401) {
      throw makeB2CRequestError(error);
    }

    try {
      token = await getAccessToken(true);
    } catch {
      const rejected = makeB2CRequestError(error);
      rejected.outcomeUnknown = false;
      throw rejected;
    }

    try {
      response = await axios.post(endpoint, payload, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 20000
      });
    } catch (retryError) {
      throw makeB2CRequestError(retryError);
    }
  }

  const responseCode = response.data && response.data.ResponseCode;
  if (String(responseCode) !== '0') {
    if (responseCode !== undefined && responseCode !== null) {
      throw new Error(friendlyDarajaError(response.data, 'Daraja refused the payout request.'));
    }
    const error = new Error('Daraja returned an incomplete payout response; awaiting callback confirmation.');
    error.outcomeUnknown = true;
    throw error;
  }

  return response.data;
}

module.exports = {
  sendB2C,
  getAccessToken,
  normalizePhoneNumber,
  getDarajaConfig,
  getMpesaStatus,
  MIN_B2C_AMOUNT,
  MAX_B2C_AMOUNT
};
