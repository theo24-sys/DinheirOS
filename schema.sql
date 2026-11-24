-- DinheirOS Cloud Schema for Supabase (PostgreSQL)
-- Supports 1 to 5 users with isolated wallets and ledgers.

-- 1. Users Table (Max 5 users)
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    pin_hash VARCHAR(64) NOT NULL UNIQUE,
    pin_salt VARCHAR(64),
    phone_number VARCHAR(20) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS pin_salt VARCHAR(64);

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

-- 3. Transactions Table (ledger and asynchronous payout lifecycle)
CREATE TABLE IF NOT EXISTS transactions (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wallet_id INT REFERENCES wallets(id) ON DELETE SET NULL,
    type VARCHAR(30) NOT NULL, -- 'withdraw', 'reset', 'rollover'
    amount INT NOT NULL,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    note TEXT
);

ALTER TABLE public.transactions
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed',
    ADD COLUMN IF NOT EXISTS originator_conversation_id TEXT,
    ADD COLUMN IF NOT EXISTS conversation_id TEXT,
    ADD COLUMN IF NOT EXISTS transaction_receipt TEXT,
    ADD COLUMN IF NOT EXISTS status_note TEXT;

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
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_originator_conversation_id
    ON public.transactions(originator_conversation_id)
    WHERE originator_conversation_id IS NOT NULL;

-- The server uses a service_role key and accesses tables through the Supabase API.
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL PRIVILEGES ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL PRIVILEGES ON SEQUENCES TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_wallet_withdrawal(
    p_user_id INTEGER,
    p_wallet_id INTEGER,
    p_amount INTEGER,
    p_originator_conversation_id TEXT,
    p_note TEXT
)
RETURNS TABLE (
    transaction_id INTEGER,
    wallet_balance INTEGER,
    used_today INTEGER,
    used_this_week INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_wallet public.wallets%ROWTYPE;
BEGIN
    IF p_amount IS NULL OR p_amount < 10 OR p_amount > 250000 THEN
        RAISE EXCEPTION 'Withdrawal amount must be between Ksh 10 and Ksh 250000';
    END IF;

    IF p_originator_conversation_id IS NULL OR p_originator_conversation_id = '' THEN
        RAISE EXCEPTION 'OriginatorConversationID is required';
    END IF;

    SELECT *
    INTO v_wallet
    FROM public.wallets
    WHERE id = p_wallet_id AND user_id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Wallet not found';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.transactions
        WHERE wallet_id = p_wallet_id
          AND status IN ('pending', 'unknown')
    ) THEN
        RAISE EXCEPTION 'A previous payout is still awaiting confirmation for %', v_wallet.name;
    END IF;

    IF v_wallet.daily_limit > 0 AND v_wallet.used_today >= v_wallet.daily_limit THEN
        RAISE EXCEPTION 'Daily limit reached for %', v_wallet.name;
    END IF;

    IF v_wallet.used_this_week >= v_wallet.weekly_max_count THEN
        RAISE EXCEPTION 'Weekly access quota exhausted for %', v_wallet.name;
    END IF;

    IF p_amount > v_wallet.balance THEN
        RAISE EXCEPTION 'Insufficient allocation in %. Remaining: Ksh %', v_wallet.name, v_wallet.balance;
    END IF;

    UPDATE public.wallets AS w
    SET balance = w.balance - p_amount,
        used_today = w.used_today + 1,
        used_this_week = w.used_this_week + 1,
        updated_at = NOW()
    WHERE w.id = p_wallet_id
    RETURNING w.balance, w.used_today, w.used_this_week
    INTO wallet_balance, used_today, used_this_week;

    INSERT INTO public.transactions (
        user_id,
        wallet_id,
        type,
        amount,
        note,
        status,
        originator_conversation_id
    )
    VALUES (
        p_user_id,
        p_wallet_id,
        'withdraw',
        p_amount,
        p_note,
        'pending',
        p_originator_conversation_id
    )
    RETURNING id INTO transaction_id;

    RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_wallet_withdrawal(
    p_originator_conversation_id TEXT,
    p_success BOOLEAN,
    p_conversation_id TEXT DEFAULT NULL,
    p_transaction_receipt TEXT DEFAULT NULL,
    p_status_note TEXT DEFAULT NULL
)
RETURNS TABLE (
    final_status TEXT,
    wallet_refunded BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_transaction public.transactions%ROWTYPE;
BEGIN
    SELECT *
    INTO v_transaction
    FROM public.transactions
    WHERE originator_conversation_id = p_originator_conversation_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payout transaction not found';
    END IF;

    IF v_transaction.status IN ('completed', 'failed') THEN
        final_status := v_transaction.status;
        wallet_refunded := FALSE;
        RETURN NEXT;
        RETURN;
    END IF;

    IF p_success THEN
        UPDATE public.transactions
        SET status = 'completed',
            conversation_id = COALESCE(p_conversation_id, conversation_id),
            transaction_receipt = COALESCE(p_transaction_receipt, transaction_receipt),
            status_note = NULL
        WHERE id = v_transaction.id;

        final_status := 'completed';
        wallet_refunded := FALSE;
    ELSE
        IF v_transaction.wallet_id IS NOT NULL THEN
            UPDATE public.wallets
            SET balance = balance + v_transaction.amount,
                used_today = CASE
                    WHEN DATE_TRUNC('day', v_transaction.timestamp) = DATE_TRUNC('day', NOW())
                    THEN GREATEST(used_today - 1, 0)
                    ELSE used_today
                END,
                used_this_week = CASE
                    WHEN DATE_TRUNC('week', v_transaction.timestamp) = DATE_TRUNC('week', NOW())
                    THEN GREATEST(used_this_week - 1, 0)
                    ELSE used_this_week
                END,
                updated_at = NOW()
            WHERE id = v_transaction.wallet_id;
        END IF;

        UPDATE public.transactions
        SET status = 'failed',
            conversation_id = COALESCE(p_conversation_id, conversation_id),
            status_note = p_status_note
        WHERE id = v_transaction.id;

        final_status := 'failed';
        wallet_refunded := v_transaction.wallet_id IS NOT NULL;
    END IF;

    RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_wallet_withdrawal(INTEGER, INTEGER, INTEGER, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_wallet_withdrawal(TEXT, BOOLEAN, TEXT, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_wallet_withdrawal(INTEGER, INTEGER, INTEGER, TEXT, TEXT)
    TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_wallet_withdrawal(TEXT, BOOLEAN, TEXT, TEXT, TEXT)
    TO service_role;
