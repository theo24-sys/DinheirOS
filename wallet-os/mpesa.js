const axios = require('axios');
require('dotenv').config();

let cachedToken = null;
let tokenExpiry = null;

async function getAccessToken() {
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
    return cachedToken;
  }
  const auth = Buffer.from(
    `${process.env.DARAJA_CONSUMER_KEY}:${process.env.DARAJA_CONSUMER_SECRET}`
  ).toString('base64');
  const response = await axios.get(
    'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
    { headers: { Authorization: `Basic ${auth}` } }
  );
  cachedToken = response.data.access_token;
  tokenExpiry = Date.now() + (response.data.expires_in * 1000) - 60000;
  return cachedToken;
}

async function sendB2C(amount, walletName) {
  try {
    const token = await getAccessToken();
    const response = await axios.post(
      'https://api.safaricom.co.ke/mpesa/b2c/v1/paymentrequest',
      {
        InitiatorName: process.env.DARAJA_INITIATOR_NAME,
        SecurityCredential: process.env.DARAJA_SECURITY_CREDENTIAL,
        CommandID: 'BusinessPayment',
        Amount: amount,
        PartyA: process.env.DARAJA_SHORTCODE,
        PartyB: process.env.PERSONAL_MPESA_NUMBER,
        Remarks: `FedhaOS ${walletName} withdrawal`,
        QueueTimeOutURL: process.env.CALLBACK_URL,
        ResultURL: process.env.CALLBACK_URL,
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


module.exports = { getAccessToken, sendB2C };
