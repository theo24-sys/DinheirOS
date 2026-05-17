// gates.js – three‑gate evaluation logic for FinanceOS (Async)
// ------------------------------------------------------------
const { runQuery, execStmt } = require('./db');
const { wallets: walletRules } = require('./config');

function getWalletConfig(name) {
  const cfg = walletRules[name];
  if (!cfg) throw new Error(`Unknown wallet: ${name}`);
  return cfg;
}

async function getCounters(name) {
  const rows = await runQuery('SELECT used_today, used_this_week, weekly_max_count FROM wallets WHERE name = ?', [name]);
  if (rows.length === 0) {
    await execStmt('INSERT INTO wallets (name, used_today, used_this_week, weekly_max_count, weekly_amount, daily_limit, rollover, balance) VALUES (?,0,0,0,?,?,?,?)', 
      [name, walletRules[name].weeklyAmount, walletRules[name].dailyLimit ? 1 : 0, walletRules[name].rollover ? 1 : 0, walletRules[name].weeklyAmount]);
    return { used_today: 0, used_this_week: 0, weekly_count: 0 };
  }
  return {
    used_today: rows[0].used_today,
    used_this_week: rows[0].used_this_week,
    weekly_count: rows[0].weekly_max_count
  };
}

async function checkDailyLimit(name) {
  const cfg = getWalletConfig(name);
  const counters = await getCounters(name);
  if (cfg.dailyLimit && counters.used_today >= 1) {
    return { allowed: false, reason: 'Daily limit reached' };
  }
  return { allowed: true };
}

async function checkWeeklyCount(name) {
  const cfg = getWalletConfig(name);
  const counters = await getCounters(name);
  if (counters.used_this_week >= cfg.maxCount) {
    return { allowed: false, reason: 'Weekly withdrawal count exhausted' };
  }
  return { allowed: true };
}

async function checkBalance(name, amount) {
  const cfg = getWalletConfig(name);
  const counters = await getCounters(name);
  const remaining = cfg.weeklyAmount - (counters.used_this_week * cfg.perAccessAmount);
  if (amount > remaining) {
    return { allowed: false, reason: 'Insufficient weekly allocation' };
  }
  return { allowed: true };
}

async function evaluateWithdrawal(name, amount) {
  const d1 = await checkDailyLimit(name);
  if (!d1.allowed) return d1;

  const d2 = await checkWeeklyCount(name);
  if (!d2.allowed) return d2;

  const d3 = await checkBalance(name, amount);
  if (!d3.allowed) return d3;

  return { allowed: true };
}

module.exports = {
  evaluateWithdrawal,
  checkDailyLimit,
  checkWeeklyCount,
  checkBalance
};
