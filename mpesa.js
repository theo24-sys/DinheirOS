const axios = require('axios');

let cachedToken = null;
let tokenExpiry = null;

function getDarajaConfig() {
  return {
    consumerKey: process.env.DARAJA_CONSUMER_KEY,
    consumerSecret: process.env.DARAJA_CONSUMER_SECRET,
    shortcode: process.env.DARAJA_SHORTCODE || process.env.DARAJA_B2C_SHORTCODE,
    initiatorName: process.env.DARAJA_INITIATOR_NAME || process.env.DARAJA_B2C_INITIATOR_NAME,
    securityCredential: process.env.DARAJA_SECURITY_CREDENTIAL || process.env.DARAJA_B2C_SECURITY_CREDENTIAL,
    callbackUrl: process.env.CALLBACK_URL || 'https://example.com/api/daraja/callback'
  };
}

function normalizePhoneNumber(phone) {
  let p = String(phone).trim().replace(/[\s\-\+]/g, '');
  if (p.startsWith('0')) {
    p = '254' + p.slice(1);
  }
  return p;
}

async function getAccessToken() {
  const cfg = getDarajaConfig();
  if (!cfg.consumerKey || !cfg.consumerSecret) {
    return null;
  }

  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  const auth = Buffer.from(`${cfg.consumerKey}:${cfg.consumerSecret}`).toString('base64');
  const response = await axios.get(
    'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
    { headers: { Authorization: `Basic ${auth}` } }
  );

  cachedToken = response.data.access_token;
  tokenExpiry = Date.now() + (Number(response.data.expires_in || 3600) * 1000) - 60000;
  return cachedToken;
}

/**
 * Sends a B2C disbursement to the user's phone number.
 * If credentials are not configured, it runs in Mock mode.
 */
async function sendB2C(amount, recipientPhone, walletName) {
  const cfg = getDarajaConfig();
  const normalizedPhone = normalizePhoneNumber(recipientPhone);

  // If no credentials configured, run in Mock mode for safe testing
  if (!cfg.consumerKey || !cfg.consumerSecret || !cfg.shortcode) {
    console.log(`[MOCK M-PESA] Disbursed Ksh ${amount} from ${walletName} to ${normalizedPhone}`);
    return {
      ResponseCode: '0',
      ResponseDescription: 'Accept the service request successfully (MOCK)',
      mock: true
    };
  }

  try {
    const token = await getAccessToken();
    const response = await axios.post(
      'https://api.safaricom.co.ke/mpesa/b2c/v1/paymentrequest',
      {
        InitiatorName: cfg.initiatorName,
        SecurityCredential: cfg.securityCredential,
        CommandID: 'BusinessPayment',
        Amount: Math.round(Number(amount)),
        PartyA: cfg.shortcode,
        PartyB: normalizedPhone,
        Remarks: `DinheirOS ${walletName} withdrawal`,
        QueueTimeOutURL: cfg.callbackUrl,
        ResultURL: cfg.callbackUrl,
        Occassion: walletName
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    return response.data;
  } catch (error) {
    console.error('M-Pesa B2C Transfer Error:', error.message);
    if (error.response && error.response.data) {
      console.error('M-Pesa API Error Details:', JSON.stringify(error.response.data, null, 2));
    }
    throw error;
  }
}

module.exports = {
  sendB2C,
  getAccessToken,
  normalizePhoneNumber
};
