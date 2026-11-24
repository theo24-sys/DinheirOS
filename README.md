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

1. **Gate 1 (Daily Limit):** Enforces a daily access cap (e.g., Tokens wallet allows max 1 withdrawal per day).
2. **Gate 2 (Weekly Frequency):** Prevents exceeding weekly count (e.g., Fare wallet allows max 3 accesses per week).
3. **Gate 3 (Balance & Allocation):** Prevents overdrafts beyond the assigned weekly budget.
4. **Rollover:** Unused funds roll over safely to the next week (capped at 2x weekly amount).

---

## Quick Setup Guide

### 1. Set Up the Database (Supabase)
1. Create a free account at [Supabase](https://supabase.com) and create a new project.
2. Go to the **SQL Editor** in the Supabase dashboard.
3. Open [`schema.sql`](schema.sql), copy its contents, paste it into the SQL editor, and click **Run**.
4. Go to **Project Settings** → **API** and copy:
   - `Project URL`
   - `service_role` secret (or `anon` public key)

---

### 2. Deploy to Vercel
1. Push your repository to GitHub (or import the folder directly in Vercel).
2. Connect the repo on [Vercel](https://vercel.com).
3. Under **Environment Variables**, add:
   - `SUPABASE_URL`: Your Supabase Project URL.
   - `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase key.
   - `PIN_SALT`: Any random string (e.g. `my_secret_pin_salt_9281`).
   - *(Optional)* Safaricom Daraja B2C credentials if live payments are enabled. (If left blank, it runs in **MOCK mode** safely for testing).
4. Click **Deploy**. Vercel will deploy the site and activate the automated Monday weekly reset cron (`vercel.json`).

---

### 3. Open the App & Set Up User 1
1. Open your Vercel deployment URL (e.g., `https://your-dinheiros-app.vercel.app`).
2. Because no users exist yet, the app presents the setup screen:
   - **Name:** e.g., Timothy
   - **M-Pesa Phone:** e.g., `0712345678` or `+254712345678`
   - **4-Digit PIN:** Choose your access PIN.
3. Default wallets (`Fare`, `Tokens`, `Data`, `Meat`, `Betting`, `Energy`) are automatically initialized for you!
4. *(Optional)* To add up to 4 more users, go to **Settings** → **+ Add Another User**.

---

### 4. Build the Android APK (Capacitor)
To package into an Android app:
1. Open [`capacitor.config.json`](capacitor.config.json) and set `server.url` to your live Vercel URL:
   ```json
   {
     "appId": "com.morggy.dinheiros",
     "appName": "DinheirOS",
     "webDir": "public",
     "server": {
       "url": "https://your-dinheiros-app.vercel.app",
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
