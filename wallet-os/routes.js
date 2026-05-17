// routes.js – Express API endpoints for FinanceOS (Async)
const express = require('express');
const router = express.Router();

const { runQuery, execStmt } = require('./db');
const { evaluateWithdrawal } = require('./gates');
const { sendB2C } = require('./mpesa');
const { wallets: walletRules } = require('./config');

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
