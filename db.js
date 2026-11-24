const { createClient } = require('@supabase/supabase-js');
const config = require('./config');

function getSupabaseConfig() {
  let url = process.env.SUPABASE_URL || '';
  let key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  // Strip accidental quotes if user copy-pasted with quotes e.g. "https://..."
  url = String(url).trim().replace(/^["']|["']$/g, '');
  key = String(key).trim().replace(/^["']|["']$/g, '');

  // Auto-detect and convert if user pasted postgresql://... connection string
  const postgresMatch = url.match(/@db\.([a-z0-9]+)\.supabase\.co/i);
  if (postgresMatch) {
    url = `https://${postgresMatch[1]}.supabase.co`;
  }

  // Add https:// if user entered domain without protocol
  if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }

  // Remove trailing slashes
  url = url.replace(/\/+$/, '');

  return { url, key };
}

function isPublicSupabaseKey(key) {
  if (key.startsWith('sb_publishable_')) return true;

  const payload = key.split('.')[1];
  if (!payload) return false;

  try {
    const encodedPayload = payload.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(encodedPayload, 'base64').toString('utf8')).role === 'anon';
  } catch {
    return false;
  }
}

let supabase = null;

function getClient() {
  if (supabase) return supabase;
  const { url, key } = getSupabaseConfig();

  if (!url || url.includes('your-project.supabase.co')) {
    throw new Error('SUPABASE_URL is not configured. Please add your real Supabase Project URL in Vercel Environment Variables.');
  }

  if (!key || key.includes('your-supabase-service-role')) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured. Add the Supabase service_role or secret API key in Vercel Environment Variables.');
  }

  if (isPublicSupabaseKey(key)) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY must be a server-side service_role or secret API key, not an anon or publishable key.');
  }

  try {
    new URL(url);
  } catch (e) {
    throw new Error(`Invalid SUPABASE_URL ("${url}"). Must be a valid URL like https://xyz.supabase.co`);
  }

  supabase = createClient(url, key, {
    auth: { persistSession: false }
  });
  return supabase;
}

// -------------------------------------------------------------
// User Management (Supports 1 to 5 Users)
// -------------------------------------------------------------
async function countUsers() {
  const client = getClient();
  if (!client) return 0;
  const { count, error } = await client
    .from('users')
    .select('*', { count: 'exact', head: true });
  if (error) throw error;
  return count || 0;
}

async function getAllUsers() {
  const client = getClient();
  if (!client) return [];
  const { data, error } = await client
    .from('users')
    .select('id, name, phone_number, is_active, created_at')
    .eq('is_active', true);
  if (error) throw error;
  return data || [];
}

async function getUserById(id) {
  const client = getClient();
  if (!client) return null;
  const { data, error } = await client
    .from('users')
    .select('id, name, phone_number, is_active, created_at')
    .eq('id', id)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

async function getUsersForPinAuth() {
  const client = getClient();
  if (!client) return [];
  const { data, error } = await client
    .from('users')
    .select('id, name, phone_number, is_active, pin_hash, pin_salt')
    .eq('is_active', true);
  if (error) throw error;
  return data || [];
}

async function updateUserPinCredentials(userId, pinHash, pinSalt) {
  const client = getClient();
  if (!client) throw new Error('Supabase client not initialized');

  const { data, error } = await client
    .from('users')
    .update({ pin_hash: pinHash, pin_salt: pinSalt })
    .eq('id', userId)
    .eq('is_active', true)
    .select('id')
    .single();
  if (error) throw error;
  return data;
}

async function createUser(name, pinHash, pinSalt, phoneNumber) {
  const client = getClient();
  if (!client) throw new Error('Supabase client not initialized');

  const currentCount = await countUsers();
  if (currentCount >= (config.maxUsers || 5)) {
    throw new Error(`Maximum user limit (${config.maxUsers || 5}) reached for this personal installation.`);
  }

  // 1. Insert user
  const { data: user, error: userError } = await client
    .from('users')
    .insert([{ name, pin_hash: pinHash, pin_salt: pinSalt, phone_number: phoneNumber }])
    .select()
    .single();
  if (userError) throw userError;

  // 2. Initialize default wallets for this user
  const walletsToInsert = config.defaultWallets.map(w => ({
    user_id: user.id,
    name: w.name,
    weekly_amount: w.weeklyAmount,
    daily_limit: w.dailyLimit || 0,
    weekly_max_count: w.weeklyMaxCount,
    per_access_amount: w.perAccessAmount,
    rollover: w.rollover !== false,
    used_today: 0,
    used_this_week: 0,
    balance: w.weeklyAmount
  }));

  const { error: walletError } = await client
    .from('wallets')
    .insert(walletsToInsert);
  if (walletError) throw walletError;

  return user;
}

// -------------------------------------------------------------
// Wallets
// -------------------------------------------------------------
async function getUserWallets(userId) {
  const client = getClient();
  if (!client) return [];
  const { data, error } = await client
    .from('wallets')
    .select('*')
    .eq('user_id', userId)
    .order('id', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function getWalletByName(userId, walletName) {
  const client = getClient();
  if (!client) return null;
  const { data, error } = await client
    .from('wallets')
    .select('*')
    .eq('user_id', userId)
    .eq('name', walletName)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

async function updateWallet(walletId, updates) {
  const client = getClient();
  if (!client) return;
  const { data, error } = await client
    .from('wallets')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', walletId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// -------------------------------------------------------------
// Transactions
// -------------------------------------------------------------
async function createTransaction(userId, walletId, type, amount, note) {
  const client = getClient();
  if (!client) return;
  const { data, error } = await client
    .from('transactions')
    .insert([{
      user_id: userId,
      wallet_id: walletId,
      type,
      amount,
      note
    }])
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function reserveWalletWithdrawal(userId, walletId, amount, originatorConversationId, note) {
  const client = getClient();
  const { data, error } = await client.rpc('reserve_wallet_withdrawal', {
    p_user_id: userId,
    p_wallet_id: walletId,
    p_amount: amount,
    p_originator_conversation_id: originatorConversationId,
    p_note: note
  });
  if (error) throw error;

  const reservation = Array.isArray(data) ? data[0] : data;
  if (!reservation) {
    throw new Error('Wallet reservation did not return a transaction.');
  }
  return reservation;
}

async function saveWithdrawalConversationId(originatorConversationId, conversationId) {
  if (!conversationId) return;
  const client = getClient();
  const { error } = await client
    .from('transactions')
    .update({ conversation_id: conversationId })
    .eq('originator_conversation_id', originatorConversationId)
    .in('status', ['pending', 'unknown']);
  if (error) throw error;
}

async function markWithdrawalUnknown(originatorConversationId, statusNote) {
  const client = getClient();
  const { data, error } = await client
    .from('transactions')
    .update({
      status: 'unknown',
      status_note: String(statusNote || 'Waiting for Safaricom confirmation').slice(0, 250)
    })
    .eq('originator_conversation_id', originatorConversationId)
    .in('status', ['pending', 'unknown'])
    .select('id')
    .maybeSingle();
  if (error) throw error;

  if (!data) {
    const { data: transaction, error: lookupError } = await client
      .from('transactions')
      .select('status')
      .eq('originator_conversation_id', originatorConversationId)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!transaction) throw new Error('Payout transaction not found.');
  }
}

async function finishWalletWithdrawal({
  originatorConversationId,
  success,
  conversationId = null,
  transactionReceipt = null,
  statusNote = null
}) {
  const client = getClient();
  const { data, error } = await client.rpc('finish_wallet_withdrawal', {
    p_originator_conversation_id: originatorConversationId,
    p_success: success,
    p_conversation_id: conversationId,
    p_transaction_receipt: transactionReceipt,
    p_status_note: statusNote
  });
  if (error) throw error;

  const settlement = Array.isArray(data) ? data[0] : data;
  if (!settlement) {
    throw new Error('Payout settlement did not return a transaction status.');
  }
  return settlement;
}

async function getUserTransactions(userId, limit = 20) {
  const client = getClient();
  if (!client) return [];
  const { data, error } = await client
    .from('transactions')
    .select(`
      id,
      user_id,
      wallet_id,
      type,
      amount,
      timestamp,
      note,
      status,
      transaction_receipt,
      wallets ( name )
    `)
    .eq('user_id', userId)
    .order('timestamp', { ascending: false })
    .limit(limit);
  if (error) throw error;

  return (data || []).map(tx => ({
    id: tx.id,
    user_id: tx.user_id,
    wallet_id: tx.wallet_id,
    wallet_name: tx.wallets ? tx.wallets.name : 'Unknown',
    type: tx.type,
    amount: tx.amount,
    timestamp: tx.timestamp,
    note: tx.note,
    status: tx.status || 'completed',
    transaction_receipt: tx.transaction_receipt
  }));
}

// -------------------------------------------------------------
// Sessions
// -------------------------------------------------------------
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

async function createSession(userId, token) {
  const client = getClient();
  if (!client) return;
  const now = Date.now();
  const { error } = await client
    .from('sessions')
    .insert([{ token, user_id: userId, created_at: now, last_active: now }]);
  if (error) throw error;
}

async function validateSession(token) {
  const client = getClient();
  if (!client || !token) return null;

  const { data, error } = await client
    .from('sessions')
    .select('token, user_id, last_active, users ( id, name, phone_number, is_active )')
    .eq('token', token)
    .single();

  if (error || !data) return null;

  const cutoff = Date.now() - SESSION_TTL_MS;
  if (data.last_active < cutoff) {
    await deleteSession(token);
    return null;
  }

  // Update last_active
  await client
    .from('sessions')
    .update({ last_active: Date.now() })
    .eq('token', token);

  return data.users;
}

async function deleteSession(token) {
  const client = getClient();
  if (!client || !token) return;
  await client.from('sessions').delete().eq('token', token);
}

async function cleanupExpiredSessions() {
  const client = getClient();
  if (!client) return;
  const cutoff = Date.now() - SESSION_TTL_MS;
  await client.from('sessions').delete().lt('last_active', cutoff);
}

// -------------------------------------------------------------
// PIN Attempts & Lockout
// -------------------------------------------------------------
async function logPinAttempt(userId, success) {
  const client = getClient();
  if (!client) return;
  await client.from('pin_attempts').insert([{
    user_id: userId || null,
    success: success ? 1 : 0
  }]);
}

async function isUserLockedOut(userId) {
  const client = getClient();
  if (!client) return false;
  const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  
  let query = client
    .from('pin_attempts')
    .select('*', { count: 'exact', head: true })
    .eq('success', 0)
    .gt('timestamp', cutoff);

  if (userId) {
    query = query.eq('user_id', userId);
  }

  const { count, error } = await query;
  if (error) return false;
  return (count || 0) >= 3;
}

// -------------------------------------------------------------
// Resets (Cron)
// -------------------------------------------------------------
async function resetDailyWallets() {
  const client = getClient();
  if (!client) return;
  const { error } = await client
    .from('wallets')
    .update({ used_today: 0, updated_at: new Date().toISOString() })
    .neq('used_today', 0);
  if (error) throw error;
}

async function resetWeeklyWallets() {
  const client = getClient();
  if (!client) return;

  // Retrieve all wallets
  const { data: wallets, error } = await client.from('wallets').select('*');
  if (error) throw error;

  for (const w of (wallets || [])) {
    // If rollover is enabled and user didn't exhaust allocation, preserve unspent balance or reset to weeklyAmount
    let newBalance = w.weekly_amount;
    if (w.rollover && w.balance > 0) {
      // Allow remaining balance to roll over (capped at 2x weekly amount to prevent runaway hoarding)
      newBalance = Math.min(w.weekly_amount * 2, w.balance + w.weekly_amount);
    }

    await client
      .from('wallets')
      .update({
        used_today: 0,
        used_this_week: 0,
        balance: newBalance,
        updated_at: new Date().toISOString()
      })
      .eq('id', w.id);
  }
}

module.exports = {
  getClient,
  countUsers,
  getAllUsers,
  getUserById,
  getUsersForPinAuth,
  updateUserPinCredentials,
  createUser,
  getUserWallets,
  getWalletByName,
  updateWallet,
  createTransaction,
  reserveWalletWithdrawal,
  saveWithdrawalConversationId,
  markWithdrawalUnknown,
  finishWalletWithdrawal,
  getUserTransactions,
  createSession,
  validateSession,
  deleteSession,
  cleanupExpiredSessions,
  logPinAttempt,
  isUserLockedOut,
  resetDailyWallets,
  resetWeeklyWallets
};
