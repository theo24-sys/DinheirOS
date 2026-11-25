BEGIN;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.wallets legacy
        JOIN public.wallets target
          ON target.user_id = legacy.user_id
        WHERE (legacy.name = 'Tokens' AND target.name = 'Kplc')
           OR (legacy.name = 'Meat' AND target.name = 'Food')
           OR (legacy.name = 'Betting' AND target.name = 'Stake')
    ) THEN
        RAISE EXCEPTION 'Wallet migration stopped: a user has both a legacy wallet and its new name.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.wallets w
        JOIN public.transactions t ON t.wallet_id = w.id
        WHERE w.name = 'Energy'
          AND t.status IN ('pending', 'unknown')
    ) THEN
        RAISE EXCEPTION 'Wallet migration stopped: settle all pending Energy payouts before deleting that wallet.';
    END IF;
END;
$$;

UPDATE public.wallets
SET name = CASE name
    WHEN 'Tokens' THEN 'Kplc'
    WHEN 'Meat' THEN 'Food'
    WHEN 'Betting' THEN 'Stake'
END
WHERE name IN ('Tokens', 'Meat', 'Betting');

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.wallets w
        JOIN public.transactions t ON t.wallet_id = w.id
        WHERE w.name NOT IN ('Food', 'Kplc', 'Stake', 'Fare', 'Data')
          AND t.status IN ('pending', 'unknown')
    ) THEN
        RAISE EXCEPTION 'Wallet migration stopped: settle payouts for wallets being removed before continuing.';
    END IF;
END;
$$;

UPDATE public.wallets AS w
SET weekly_amount = target.weekly_amount,
    daily_limit = 0,
    weekly_max_count = target.weekly_max_count,
    per_access_amount = target.per_access_amount,
    balance = GREATEST(
        target.weekly_amount - (w.weekly_amount - w.balance),
        0
    ),
    updated_at = NOW()
FROM (VALUES
    ('Food', 780, 4, 195),
    ('Kplc', 250, 3, 83),
    ('Stake', 150, 3, 50),
    ('Fare', 150, 3, 50),
    ('Data', 100, 5, 20)
) AS target(name, weekly_amount, weekly_max_count, per_access_amount)
WHERE w.name = target.name;

INSERT INTO public.wallets (
    user_id,
    name,
    weekly_amount,
    daily_limit,
    weekly_max_count,
    per_access_amount,
    rollover,
    used_today,
    used_this_week,
    balance,
    updated_at
)
SELECT u.id,
       target.name,
       target.weekly_amount,
       0,
       target.weekly_max_count,
       target.per_access_amount,
       TRUE,
       0,
       0,
       target.weekly_amount,
       NOW()
FROM public.users AS u
CROSS JOIN (VALUES
    ('Food', 780, 4, 195),
    ('Kplc', 250, 3, 83),
    ('Stake', 150, 3, 50),
    ('Fare', 150, 3, 50),
    ('Data', 100, 5, 20)
) AS target(name, weekly_amount, weekly_max_count, per_access_amount)
WHERE NOT EXISTS (
    SELECT 1
    FROM public.wallets w
    WHERE w.user_id = u.id
      AND w.name = target.name
);

DELETE FROM public.wallets
WHERE name NOT IN ('Food', 'Kplc', 'Stake', 'Fare', 'Data');

COMMIT;

SELECT user_id, name, weekly_amount, per_access_amount, weekly_max_count, balance
FROM public.wallets
WHERE name IN ('Food', 'Kplc', 'Stake', 'Fare', 'Data')
ORDER BY user_id, name;

SELECT user_id, COUNT(*) AS wallet_count, SUM(weekly_amount) AS weekly_total
FROM public.wallets
GROUP BY user_id
ORDER BY user_id;
