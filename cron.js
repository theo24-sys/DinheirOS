const cron = require('node-cron');
const db = require('./db');

async function resetDaily() {
  console.log('[CRON] Executing daily reset...');
  await db.resetDailyWallets();
  console.log('[CRON] Daily reset complete.');
}

async function resetWeekly() {
  console.log('[CRON] Executing weekly budget reset & rollover...');
  await db.resetWeeklyWallets();
  console.log('[CRON] Weekly budget reset complete.');
}

// Scheduled for Monday at 00:00 UTC (if running as continuous Node process)
try {
  cron.schedule('0 0 * * MON', async () => {
    try {
      await resetDaily();
      await resetWeekly();
    } catch (err) {
      console.error('[CRON ERROR]', err);
    }
  });

  // Daily reset at 00:00 UTC every day
  cron.schedule('0 0 * * *', async () => {
    try {
      await resetDaily();
    } catch (err) {
      console.error('[CRON ERROR]', err);
    }
  });
} catch (e) {
  // Ignored if in serverless environment where node-cron schedule isn't persistent
}

module.exports = {
  resetDaily,
  resetWeekly
};
