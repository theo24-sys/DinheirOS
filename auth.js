const crypto = require('crypto');
const { runQuery, execStmt } = require('./db');

const SALT = 'DinheirOS_salt_2024';

function hashPin(pin) {
  return crypto.createHash('sha256').update(pin + SALT).digest('hex');
}

async function isPinSet() {
  const rows = await runQuery('SELECT hash FROM pin WHERE id = 1');
  return rows.length > 0;
}

async function setPin(pin) {
  const hash = hashPin(pin);
  await execStmt('DELETE FROM pin');
  await execStmt('INSERT INTO pin (id, hash) VALUES (1, ?)', [hash]);
  return true;
}

async function verifyPin(pin) {
  const rows = await runQuery('SELECT hash FROM pin WHERE id = 1');
  if (rows.length === 0) return false;
  return rows[0].hash === hashPin(pin);
}

async function isLockedOut() {
  const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const rows = await runQuery(
    'SELECT COUNT(*) as count FROM pin_attempts WHERE success = 0 AND timestamp > ?',
    [cutoff]
  );
  return rows.length > 0 && rows[0].count >= 3;
}

async function createSession() {
  const token = crypto.randomUUID();
  const now = Date.now();
  await execStmt('INSERT INTO sessions (token, created_at, last_active) VALUES (?, ?, ?)', [token, now, now]);
  return token;
}

async function validateSession(token) {
  const cutoff = Date.now() - 30 * 60 * 1000;
  const rows = await runQuery('SELECT id, last_active FROM sessions WHERE token = ?', [token]);
  if (rows.length > 0) {
    const rawLastActive = rows[0].last_active;
    const numericLastActive = typeof rawLastActive === 'number' ? rawLastActive : Number(rawLastActive) || Date.parse(rawLastActive);
    if (!Number.isFinite(numericLastActive) || numericLastActive < cutoff) {
      return false;
    }
    await execStmt('UPDATE sessions SET last_active = ? WHERE token = ?', [Date.now(), token]);
    return true;
  }
  return false;
}

async function deleteSession(token) {
  await execStmt('DELETE FROM sessions WHERE token = ?', [token]);
}

async function logAttempt(success) {
  await execStmt('INSERT INTO pin_attempts (success) VALUES (?)', [success ? 1 : 0]);
}

module.exports = {
  hashPin,
  isPinSet,
  setPin,
  verifyPin,
  isLockedOut,
  createSession,
  validateSession,
  deleteSession,
  logAttempt
};
