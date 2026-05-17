// cron.js – Monday reset & rollover job (Async)
const cron = require('node-cron');
const { runQuery, execStmt } = require('./db');

async function resetDaily() {
  await execStmt('UPDATE wallets SET used_today = 0');
}

async function resetWeekly() {
  const wallets = await runQuery('SELECT id, used_this_week, weekly_max_count, rollover, balance FROM wallets');

  for (const w of wallets) {
    let newCount = 0;
    if (w.rollover && w.used_this_week < w.weekly_max_count) {
      newCount = Math.min(w.weekly_max_count, w.used_this_week + 1);
    }
    await execStmt('UPDATE wallets SET used_this_week = ?, balance = ? WHERE id = ?', [0, w.balance, w.id]);
  }
}

cron.schedule('0 0 * * MON', async () => {
  console.log('--- Monday reset job started ---');
  await resetDaily();
  await resetWeekly();
  console.log('--- Monday reset job completed ---');
});

module.exports = { resetDaily, resetWeekly };
