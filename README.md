# DinheirOS Cloud (v2.0)

A strict, rule-governed personal spending control system & wallet manager for personal/family use (**1 to 5 users**).

Runs anywhere via **Vercel** (Cloud Web App) and **Capacitor** (Android APK), powered by **Supabase** (PostgreSQL) and automated weekly resets.

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────┐
│                   Clients                              │
│   • Web App (Browser on any device)                    │
│   • Android APK (via Capacitor)                        │
└───────────────────────────┬────────────────────────────┘
                            │ HTTPS
┌───────────────────────────▼────────────────────────────┐
│              Vercel Serverless API                     │
│   • Node.js / Express backend (/api/*)                 │
│   • Multi-user PIN authentication (1-5 users)          │
│   • 3-Gate spending evaluation (gates.js)              │
│   • Safaricom Daraja M-Pesa B2C disbursements          │
│   • Vercel Cron: automated Monday midnight resets      │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│              Supabase Database (Cloud Postgres)        │
│   • Users, Wallets, Transactions, Sessions             │
│   • Visual Web Dashboard for the owner                 │
└────────────────────────────────────────────────────────┘
```

---

## 1 to 5 Users Architecture

- **No username typing needed on mobile:** Each user has their own unique 4-digit PIN.
- When User 1 enters their PIN, the app identifies them, loads their personal wallets, and greets them ("Hey Timothy 👋").
- When User 2 enters their PIN, they see their own independent wallet quotas and balances.
- Each user's withdrawals disburse directly to their own configured M-Pesa phone number.
- Up to 5 users can be added directly from the Settings screen or via the Supabase table editor.

---

## The 3 Security Gates

Every withdrawal must pass through 3 server-enforced security gates before any money can be released:

1. **Gate 1 (Daily Limit):** Enforces a daily access cap when configured; the current wallets have no daily cap.
2. **Gate 2 (Weekly Frequency):** Prevents exceeding the wallet's weekly count.
3. **Gate 3 (Balance & Allocation):** Prevents overdrafts beyond the assigned weekly budget.
4. **Rollover:** Unused funds roll over safely to the next week (capped at 2x weekly amount).

---

## Quick Setup Guide

### 1. Set Up the Database (Supabase)
1. Create a free account at [Supabase](https://supabase.com) and create a new project.
2. Go to the **SQL Editor** in the Supabase dashboard.
3. Open [`schema.sql`](schema.sql), copy its contents, paste it into the SQL editor, and click **Run**.
   Re-run this file after pulling updates that add database columns or payout functions.
4. To apply the current five-wallet budgets to existing users, run [`scripts/update-wallet-budgets.sql`](scripts/update-wallet-budgets.sql) once after `schema.sql`. It preserves the mapped wallets' spending and transaction links, creates any missing target wallets, and deletes wallets outside the requested set. Deleted wallet rows lose their balance; associated transactions remain but are no longer linked to that wallet. The migration stops if an obsolete wallet has a pending payout or if a legacy/new wallet name conflicts.
5. Go to **Project Settings** → **API** and copy:
   - `Project URL`
   - `service_role` secret or secret API key. Do not use the `anon` / publishable key for the server.
6. Run `npm install` after pulling changes so `package-lock.json` includes the server-side passkey verifier.

---

### 2. Deploy to Vercel
1. Push your repository to GitHub (or import the folder directly in Vercel).
2. Connect the repo on [Vercel](https://vercel.com).
3. Under **Environment Variables**, add:
   - `SUPABASE_URL`: Your Supabase Project URL.
   - `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase key.
   - `WEBAUTHN_RP_ID=dinheir-os.vercel.app` and `WEBAUTHN_ORIGIN=https://dinheir-os.vercel.app` (change these together for a custom app domain).
   - For live M-Pesa B2C payouts: `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`, `DARAJA_INITIATOR_NAME`, `DARAJA_SECURITY_CREDENTIAL`, and `MPESA_ENVIRONMENT=production`.
   - `CALLBACK_URL`: Your public HTTPS app URL ending in `/api/daraja/callback` (optional; this is the default).
4. Click **Deploy**. Vercel will deploy the site and activate the automated Monday weekly reset cron (`vercel.json`).

New users choose their 4-digit PIN during account setup and use it to sign in; no `PIN_SALT` environment variable is needed. PINs are salted per user and stored as hashes. If an existing deployment already has a `PIN_SALT` value, keep that same value until each existing user signs in once; successful sign-in migrates their PIN, after which the variable can be removed. Re-run `schema.sql` before deploying this change.

After signing in with a PIN, open **Settings** to register a device passkey. The server verifies passkey signatures before creating a session; a device biometric prompt alone does not grant access. The fingerprint/passkey button appears on the sign-in screen after a passkey has been registered. Set `WEBAUTHN_RP_ID` and `WEBAUTHN_ORIGIN` to your app’s hostname and HTTPS origin if you use a custom domain. Passkey verification requires Node.js 22 or later.

Each wallet has an **Adjust weekly budget** action. A change applies immediately: the current balance changes by the same amount as the budget, preserving the amount already spent. The wallet’s per-access amount and withdrawal count limits remain unchanged.

---

### M-Pesa B2C payout notes

- The shortcode must be enabled for Safaricom B2C payouts; a consumer Till and the Lipa na M-Pesa passkey are not substitutes.
- `DARAJA_INITIATOR_NAME` and `DARAJA_SECURITY_CREDENTIAL` are the B2C initiator name and its encrypted credential from Daraja. `MPESA_PASSKEY` is for STK Push and is not used for B2C.
- The app accepts whole-number payouts from Ksh 10 to Ksh 250,000, matching the documented B2C per-transaction limits. The recipient is the phone number saved on the user profile, so it can be the same registered M-Pesa number each time.
- Payouts use Daraja B2C v3. A request appears as **pending** until Safaricom sends its result callback. Funds are reserved on request, released from the reservation on success, and returned on a confirmed failure. If the provider response is uncertain, funds remain reserved until the callback resolves it.
- The app blocks another withdrawal from the same wallet while a payout is pending or uncertain, so retrying cannot accidentally create a second payout.
- Before deploying this version, run the updated `schema.sql` in Supabase so the transaction status fields and atomic reservation/settlement functions exist.

---

### 3. Open the App & Set Up User 1
1. Open your Vercel deployment URL (default: `https://dinheir-os.vercel.app`).
2. Because no users exist yet, the app presents the setup screen:
   - **Name:** e.g., Timothy
   - **M-Pesa Phone:** e.g., `0712345678` or `+254712345678`
   - **4-Digit PIN:** Choose your access PIN.
3. Default wallets (`Food`, `Kplc`, `Stake`, `Fare`, `Data`) are automatically initialized for you. Kplc is Ksh 250 per week with three Ksh 83 taps; the remaining Ksh 1 stays in the wallet.
4. *(Optional)* To add up to 4 more users, go to **Settings** → **+ Add Another User**.

---

### 4. Build the Android APK (Capacitor)
To package into an Android app:
1. [`capacitor.config.json`](capacitor.config.json) points to `https://dinheir-os.vercel.app` by default. If you deploy to a different URL, update `server.url` before building:
   ```json
   {
     "appId": "com.morggy.dinheiros",
     "appName": "DinheirOS",
     "webDir": "public",
     "server": {
       "url": "https://dinheir-os.vercel.app",
       "cleartext": false
     }
   }
   ```
2. Build and sync Capacitor:
   ```bash
   npx cap sync android
   npx cap open android
   ```
3. In Android Studio, click **Build** → **Build APK(s)** to generate your release or debug APK.

Android shows its native launch screen while the WebView starts; the in-app loading screen appears as soon as the page can run and remains visible through PIN initialization.

---

## File Reference

- `schema.sql`: PostgreSQL schema for Supabase (users, wallets, transactions, sessions).
- `server.js`: Express server (serves static UI, handles API, exports for Vercel).
- `routes.js`: Clean REST API endpoints (`/api/auth/*`, `/api/status`, `/api/withdraw`, `/api/history`, `/api/cron/reset`).
- `db.js`: Supabase database client and query helpers.
- `auth.js`: PIN hashing, session management, and lockout protection.
- `gates.js`: 3-Gate spending validation logic.
- `mpesa.js`: Safaricom Daraja B2C integration (with automated Mock mode fallback).
- `cron.js`: Monday midnight budget reset and daily counter reset logic.
- `vercel.json`: Vercel serverless routing and weekly reset cron trigger.
- `public/index.html`: Glassmorphic single-page frontend with WebAuthn / Passkey support.
- `public/brand-logo.jpg`: Master DinheirOS logo used to generate the web, PWA, and Android brand assets.
- On Windows, regenerate those assets with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/make-icons.ps1`.
