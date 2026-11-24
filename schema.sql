-- DinheirOS Cloud Schema for Supabase (PostgreSQL)
-- Supports 1 to 5 users with isolated wallets and ledgers.

-- 1. Users Table (Max 5 users)
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    pin_hash VARCHAR(64) NOT NULL UNIQUE,
    phone_number VARCHAR(20) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Wallets Table (Scoped to user_id)
CREATE TABLE IF NOT EXISTS wallets (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    weekly_amount INT NOT NULL,
    daily_limit INT NOT NULL DEFAULT 0, -- 0 = no daily limit, 1 = max 1 access/day
    weekly_max_count INT NOT NULL,
    per_access_amount INT NOT NULL,
    rollover BOOLEAN NOT NULL DEFAULT TRUE,
    used_today INT NOT NULL DEFAULT 0,
    used_this_week INT NOT NULL DEFAULT 0,
    balance INT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_user_wallet UNIQUE (user_id, name)
);

-- 3. Transactions Table (Immutable audit trail)
CREATE TABLE IF NOT EXISTS transactions (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wallet_id INT REFERENCES wallets(id) ON DELETE SET NULL,
    type VARCHAR(30) NOT NULL, -- 'withdraw', 'reset', 'rollover'
    amount INT NOT NULL,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    note TEXT
);

-- 4. Sessions Table (Auto-expiring token store)
CREATE TABLE IF NOT EXISTS sessions (
    token VARCHAR(64) PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at BIGINT NOT NULL,
    last_active BIGINT NOT NULL
);

-- 5. PIN Attempts (Rate limiting / lockout)
CREATE TABLE IF NOT EXISTS pin_attempts (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    success INT NOT NULL DEFAULT 0
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_wallets_user ON wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_pin_attempts_time ON pin_attempts(timestamp);
