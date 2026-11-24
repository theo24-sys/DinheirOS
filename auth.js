const crypto = require('crypto');
const db = require('./db');
const config = require('./config');

const LEGACY_PIN_SALT = process.env.PIN_SALT || 'DinheirOS_cloud_salt_2025';

function hashPin(pin, salt = LEGACY_PIN_SALT) {
  return crypto.createHash('sha256').update(String(pin).trim() + salt).digest('hex');
}

function pinMatchesUser(pin, user) {
  const salt = user.pin_salt || LEGACY_PIN_SALT;
  const expectedHash = Buffer.from(hashPin(pin, salt), 'hex');
  const storedHash = Buffer.from(user.pin_hash, 'hex');
  return expectedHash.length === storedHash.length &&
    crypto.timingSafeEqual(expectedHash, storedHash);
}

async function isConfigured() {
  const count = await db.countUsers();
  return count > 0;
}

async function loginWithPin(pin) {
  if (!pin || String(pin).length !== 4) {
    return { success: false, status: 400, error: 'PIN must be exactly 4 digits' };
  }

  // Check lockout
  const lockedOut = await db.isUserLockedOut();
  if (lockedOut) {
    return { success: false, status: 429, error: 'Too many failed attempts. Please wait 5 minutes.' };
  }

  const users = await db.getUsersForPinAuth();
  const user = users.find(candidate => pinMatchesUser(pin, candidate));

  if (!user) {
    await db.logPinAttempt(null, false);
    return { success: false, status: 401, error: 'Invalid PIN' };
  }

  if (!user.pin_salt) {
    const pinSalt = crypto.randomBytes(32).toString('hex');
    await db.updateUserPinCredentials(user.id, hashPin(pin, pinSalt), pinSalt);
  }

  // Success
  await db.logPinAttempt(user.id, true);
  const token = crypto.randomUUID();
  await db.createSession(user.id, token);

  return {
    success: true,
    token,
    user: {
      id: user.id,
      name: user.name,
      phoneNumber: user.phone_number
    }
  };
}

async function setupUser({ name, pin, phoneNumber }) {
  if (!name || name.trim().length === 0) {
    return { success: false, status: 400, error: 'Name is required' };
  }
  if (!pin || String(pin).length !== 4) {
    return { success: false, status: 400, error: 'PIN must be exactly 4 digits' };
  }
  if (!phoneNumber || phoneNumber.trim().length < 9) {
    return { success: false, status: 400, error: 'Valid phone number required (e.g. +254712345678)' };
  }

  const currentCount = await db.countUsers();
  if (currentCount >= (config.maxUsers || 5)) {
    return { success: false, status: 400, error: `Maximum user limit (${config.maxUsers || 5}) reached.` };
  }

  const existingUsers = await db.getUsersForPinAuth();
  const existingWithPin = existingUsers.find(user => pinMatchesUser(pin, user));
  if (existingWithPin) {
    return { success: false, status: 400, error: 'This PIN is already in use. Please pick a unique 4-digit PIN.' };
  }

  const pinSalt = crypto.randomBytes(32).toString('hex');
  const pinHash = hashPin(pin, pinSalt);
  const user = await db.createUser(name.trim(), pinHash, pinSalt, phoneNumber.trim());
  const token = crypto.randomUUID();
  await db.createSession(user.id, token);

  return {
    success: true,
    token,
    user: {
      id: user.id,
      name: user.name,
      phoneNumber: user.phone_number
    }
  };
}

// Express authentication middleware
async function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: Session token missing' });
    }

    const token = authHeader.replace('Bearer ', '').trim();
    const user = await db.validateSession(token);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized: Session expired or invalid' });
    }

    req.user = user;
    req.sessionToken = token;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Internal authentication error' });
  }
}

async function logout(token) {
  if (token) {
    await db.deleteSession(token);
  }
}

module.exports = {
  hashPin,
  isConfigured,
  loginWithPin,
  setupUser,
  authMiddleware,
  logout
};
