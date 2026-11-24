// gates.js – Server-side security gatekeeper for withdrawals

/**
 * Evaluates whether a withdrawal is permitted based on the 3 security gates.
 *
 * @param {object} wallet - The user's wallet record from the database
 * @param {number} amount - The requested withdrawal amount
 * @returns {{ allowed: boolean, reason?: string }}
 */
function evaluateWithdrawal(wallet, amount) {
  if (!wallet) {
    return { allowed: false, reason: 'Wallet does not exist' };
  }

  const requestedAmount = Number(amount);
  if (isNaN(requestedAmount) || requestedAmount <= 0) {
    return { allowed: false, reason: 'Invalid withdrawal amount' };
  }

  // Gate 1: Daily limit check
  if (wallet.daily_limit > 0 && Number(wallet.used_today || 0) >= wallet.daily_limit) {
    return {
      allowed: false,
      reason: `Daily limit reached for ${wallet.name}. Only ${wallet.daily_limit} withdrawal allowed per day.`
    };
  }

  // Gate 2: Weekly access count check
  if (Number(wallet.used_this_week || 0) >= Number(wallet.weekly_max_count || 1)) {
    return {
      allowed: false,
      reason: `Weekly access quota exhausted for ${wallet.name} (${wallet.weekly_max_count} of ${wallet.weekly_max_count} used). Resets Monday.`
    };
  }

  // Gate 3: Balance / Allocation check
  if (requestedAmount > Number(wallet.balance || 0)) {
    return {
      allowed: false,
      reason: `Insufficient allocation in ${wallet.name}. Remaining: Ksh ${wallet.balance}`
    };
  }

  return { allowed: true };
}

module.exports = {
  evaluateWithdrawal
};
