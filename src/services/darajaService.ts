import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

let cachedToken: string | null = null;
let tokenExpiry: number = 0;

export async function getDarajaAccessToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiry) {
    return cachedToken;
  }

  const consumerKey = process.env.DARAJA_CONSUMER_KEY;
  const consumerSecret = process.env.DARAJA_CONSUMER_SECRET;

  if (!consumerKey || !consumerSecret) {
    throw new Error('DARAJA_CONSUMER_KEY or DARAJA_CONSUMER_SECRET is missing');
  }

  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');

  try {
    const response = await axios.get(
      'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
      {
        headers: {
          Authorization: `Basic ${auth}`,
        },
      }
    );

    cachedToken = response.data.access_token;
    // Buffer for safety (expire 1 minute early)
    tokenExpiry = now + (parseInt(response.data.expires_in) * 1000) - 60000;
    return cachedToken;
  } catch (error: any) {
    console.error('Failed to fetch Daraja Access Token:', error.response?.data || error.message);
    throw new Error('Authentication failed with Daraja');
  }
}

export async function sendB2CPayment(phone: string, amount: number) {
  const token = await getDarajaAccessToken();
  const shortcode = process.env.DARAJA_B2C_SHORTCODE;
  const initiator = process.env.DARAJA_B2C_INITIATOR_NAME;
  const securityCredential = process.env.DARAJA_B2C_SECURITY_CREDENTIAL;

  if (!shortcode || !initiator || !securityCredential) {
    throw new Error('Daraja B2C configuration is incomplete');
  }

  // Use sandbox URL for development
  const url = 'https://sandbox.safaricom.co.ke/mpesa/b2c/v1/paymentrequest';

  const payload = {
    InitiatorName: initiator,
    SecurityCredential: securityCredential,
    CommandID: 'BusinessPayment',
    Amount: amount,
    PartyA: shortcode,
    PartyB: phone.replace('+', ''), // Format: 2547XXXXXXXX
    Remarks: 'FinanceOS Withdrawal',
    QueueTimeOutURL: `${process.env.APP_URL}/api/daraja/timeout`,
    ResultURL: `${process.env.APP_URL}/api/daraja/result`,
    Occasion: 'FinanceOS_Event',
  };

  try {
    const response = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    return response.data;
  } catch (error: any) {
    console.error('Daraja B2C Request Failed:', error.response?.data || error.message);
    throw new Error('Daraja B2C Payment Request failed');
  }
}
