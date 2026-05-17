import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import firebaseConfig from './firebase-applet-config.json' with { type: 'json' };
import { WALLET_CONFIGS, evaluateGates, GateDecision } from './src/services/gatekeeper.js';
import { sendB2CPayment } from './src/services/darajaService.js';
import nodeCron from 'node-cron';
import dotenv from 'dotenv';

dotenv.config();

// Initialize Firebase Admin with explicit project context
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: firebaseConfig.projectId,
  });
}

const db = getFirestore(admin.app(), firebaseConfig.firestoreDatabaseId);

const app = express();
app.use(express.json());

const PORT = 3000;

// Seed wallets if empty
async function seedWallets() {
  try {
    const walletsRef = db.collection('wallets');
    const snapshot = await walletsRef.get();
    
    if (snapshot.empty) {
      console.log('Seeding initial wallet configurations...');
      for (const config of WALLET_CONFIGS) {
        await walletsRef.doc(config.id).set({
          ...config,
          usedFrequency: 0,
          rolloverBonus: 0,
          lastWithdrawalDate: null,
          locked: false,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
    }
  } catch (error) {
    console.error('Error seeding wallets (check if Firebase Admin is authorized):', error);
  }
}

// Monday Reset Cron Job (Monday 00:00)
nodeCron.schedule('0 0 * * 1', async () => {
  console.log('Running Weekly Reset Cycle...');
  const walletsRef = db.collection('wallets');
  const snapshot = await walletsRef.get();

  for (const walletDoc of snapshot.docs) {
    const data = walletDoc.data();
    const effectiveMax = data.maxFrequency + data.rolloverBonus;
    
    const newRolloverBonus = data.usedFrequency < effectiveMax ? 1 : 0;

    await walletDoc.ref.update({
      usedFrequency: 0,
      rolloverBonus: newRolloverBonus,
      locked: false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }
  console.log('Weekly Reset Complete.');
});

// Withdrawal Endpoint
app.post('/api/withdraw', async (req, res) => {
  const { walletId } = req.body;
  if (!walletId) return res.status(400).json({ error: 'walletId is required' });

  try {
    const walletRef = db.collection('wallets').doc(walletId);
    const walletSnap = await walletRef.get();

    if (!walletSnap.exists) {
      return res.status(404).json({ error: 'Wallet not found' });
    }

    const wallet = walletSnap.data() as any;
    const decision = evaluateGates(wallet);

    if (decision !== GateDecision.APPROVED) {
      await db.collection('transactions').add({
        walletId,
        amount: wallet.perWithdrawalAmount,
        timestamp: new Date().toISOString(),
        status: 'denied',
        reason: decision
      });
      return res.status(403).json({ decision, message: `Access Denied: ${decision}` });
    }

    const phone = process.env.PERSONAL_PHONE_NUMBER;
    if (!phone) throw new Error('PERSONAL_PHONE_NUMBER not configured');

    const paymentResponse = await sendB2CPayment(phone, wallet.perWithdrawalAmount);

    await walletRef.update({
      usedFrequency: admin.firestore.FieldValue.increment(1),
      lastWithdrawalDate: new Date().toISOString(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    const txId = paymentResponse.ConversationID || `tx_${Date.now()}`;
    await db.collection('transactions').doc(txId).set({
      walletId,
      amount: wallet.perWithdrawalAmount,
      timestamp: new Date().toISOString(),
      status: 'success',
      darajaConversationId: paymentResponse.ConversationID
    });

    res.json({ decision: GateDecision.APPROVED, transaction: txId });

  } catch (error: any) {
    console.error('Withdrawal Error:', error);
    res.status(500).json({ error: 'System Error', message: error.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Daraja Callbacks
app.post('/api/daraja/result', (req, res) => {
  console.log('Daraja Result Callback:', JSON.stringify(req.body, null, 2));
  // In a real app, we would update the transaction status here based on ResultCode
  res.json({ ResultCode: 0, ResultDesc: 'Success' });
});

app.post('/api/daraja/timeout', (req, res) => {
  console.log('Daraja Timeout Callback:', req.body);
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

async function startServer() {
  // Validate Required Env Vars
  const requiredVars = [
    'DARAJA_CONSUMER_KEY',
    'DARAJA_CONSUMER_SECRET',
    'PERSONAL_PHONE_NUMBER',
    'APP_URL'
  ];
  
  const missing = requiredVars.filter(v => !process.env[v]);
  if (missing.length > 0) {
    console.warn(`⚠️ WARNING: Missing environment variables: ${missing.join(', ')}`);
    console.warn('Daraja B2C functionality will be disabled until these are configured.');
  }

  await seedWallets();

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`FinanceOS Running on http://localhost:${PORT}`);
  });
}

startServer();
