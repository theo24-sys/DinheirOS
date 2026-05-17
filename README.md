# FinanceOS v1.0.5 - Local PIN-Protected Personal Finance Manager

A strict, rule-governed spending control system for personal use. No cloud, no external authentication—just PIN/biometric protection, local database, and enforced security rules.

## What's Changed (v1.0.5)

- ✅ **Firebase Removed**: No cloud dependencies
- ✅ **PIN Authentication**: 4-6 digit PIN (hashed, server-validated)
- ✅ **Local Database**: sql.js (SQLite) with full data ownership
- ✅ **Server-Side Rules Enforcement**: All security gates validated server-side
- ✅ **Termux Ready**: Runs on Android phone via Termux (Node.js + Express)
- ✅ **Session Management**: 30-minute auto-expiring sessions
- ✅ **Real-time Ledger**: Transaction history with gate evaluation logs

## Quick Start

### Prerequisites
- Node.js 18+
- npm/yarn
- For Android: Termux from F-Droid

### Development (macOS/Linux/Windows)

```bash
# Install dependencies
npm install

# Create .env file
cp .env.example .env
# Edit .env with your settings (optional for local dev)

# Start development server
npm run dev

# Access app
# Open browser to http://127.0.0.1:3000
```

### Termux Setup (Android Phone)

**See [TERMUX_SETUP.md](TERMUX_SETUP.md) for complete instructions**

```bash
# Quick summary:
pkg install nodejs build-essential
cd ~/dinheiros && npm install
npm start
# Access: http://127.0.0.1:3000 on phone browser
```

## Architecture

```
┌─────────────────────┐
│   Mobile Browser    │
│  (React + PIN Auth) │
└──────────┬──────────┘
           │ HTTP/HTTPS
           │
┌──────────▼──────────────────┐
│  Express Server (Port 3000)  │
│  - PIN Validation            │
│  - Session Management        │
│  - Rule Enforcement          │
│  - Payment Processing        │
└──────────┬──────────────────┘
           │
┌──────────▼──────────────────┐
│  Local Database (sql.js)     │
│  - Wallets (config + state)  │
│  - Transactions (immutable)  │
└──────────────────────────────┘
```

## Security Features

### 1. PIN Authentication (Local)
- **4-6 digit PIN** set on first access
- **SHA-256 hashed** and stored securely
- **Server-validated** on each login
- **Session tokens** expire after 30 minutes

### 2. Data Isolation
- **No cloud**: All data remains on device
- **Local SQLite**: via sql.js
- **Immutable ledger**: Transactions cannot be modified
- **Encrypted storage**: In Termux secure directory on Android

### 3. Security Gates (All Server-Enforced)

| Gate | Rule | Example |
|------|------|---------|
| **G1: Daily** | Max 1 withdrawal per day | ✅ Blocked if used today |
| **G2: Weekly** | Max N per week (configurable) | ✅ Blocked if quota exceeded |
| **G3: Funds** | Sufficient allocation | ✅ Blocked if low balance |
| **Rollover** | Unused slots carry over (+1 cap) | ✅ Extra slot next week if unused |

### 4. Rules Cannot Be Bypassed
- All validation **server-side**
- Client cannot modify wallet state
- Transactions create permanent audit trail
- PIN required for every session

## Configuration

### Environment (.env)

```env
# Server
PORT=3000
NODE_ENV=development
VITE_SERVER_URL=http://127.0.0.1:3000

# Database
DB_PATH=./dinheiros.db
PIN_HASH_PATH=./pin.hash

# Payments (Optional)
DARAJA_CONSUMER_KEY=your_key
DARAJA_CONSUMER_SECRET=your_secret
PERSONAL_PHONE_NUMBER=+254712345678
```

### Wallet Configuration

Edit `src/services/gatekeeper.ts`:

```typescript
export const WALLET_CONFIGS = [
  {
    id: "food",
    name: "Food & Transport",
    allocation: 5000,
    maxFrequency: 3,             // Max 3 withdrawals/week
    perWithdrawalAmount: 1250
  },
  // Add more wallets...
];
```

## API Reference

### Auth
```
POST /api/auth/setup-pin      First-time PIN setup
GET  /api/auth/status         Check PIN status
POST /api/auth/pin            Login with PIN → returns token
```

### Protected Routes (Require Bearer Token)
```
GET  /api/wallets             List wallets
GET  /api/transactions?limit  Transaction history
POST /api/withdraw            Request withdrawal
```

### System
```
GET  /api/health              Server status
POST /api/daraja/result       M-Pesa callback
```

## File Structure

```
dinheiros/
├── src/
│   ├── App.tsx              # Main React UI
│   ├── services/
│   │   ├── auth.ts          # PIN + session auth
│   │   ├── gatekeeper.ts    # Security rules
│   │   └── darajaService.ts # Payment integration
│   ├── components/
│   │   └── WalletCard.tsx   # Wallet display
│   └── lib/
│       └── errorHandlers.ts
├── server.ts                # Express + sql.js server
├── vite.config.ts
├── package.json
├── capacitor.config.json    # Android build config
├── TERMUX_SETUP.md          # Termux guide
└── dinheiros.db             # SQLite (auto-created)
```

## Data Models

### Wallet
```json
{
  "id": "food",
  "name": "Food & Transport",
  "allocation": 5000,
  "maxFrequency": 3,
  "usedFrequency": 1,
  "perWithdrawalAmount": 1250,
  "lastWithdrawalDate": "2026-05-17T14:30:00.000Z",
  "locked": false,
  "rolloverBonus": 0,
  "updatedAt": "2026-05-17T14:30:00.000Z"
}
```

### Transaction
```json
{
  "id": "tx_1234567890_abc",
  "walletId": "food",
  "amount": 1250,
  "timestamp": "2026-05-17T14:30:00.000Z",
  "status": "success|denied",
  "reason": "APPROVED|DAILY_LIMIT_EXCEEDED|...",
  "darajaConversationId": "AG_..."
}
```

## Weekly Reset

**Runs**: Monday 00:00 UTC

For each wallet:
1. `usedFrequency` → 0
2. `rolloverBonus` → 1 (if user didn't exhaust limit)
3. `locked` → false
4. `updatedAt` → now

## Troubleshooting

### "PIN not initialized" error
- Expected on first launch
- Choose a 4-6 digit PIN when prompted

### "Invalid PIN" on login
- PIN must match exactly
- Only digits 0-9 allowed

### Port 3000 in use
```bash
lsof -i :3000
kill -9 <PID>
```

### Database corrupted
```bash
cp dinheiros.db dinheiros.db.backup
rm dinheiros.db
npm start  # Recreates with initial config
```

### Can't access from other device (Android)
1. Get phone's IP: `ifconfig | grep "inet "`
2. Update `.env`: `VITE_SERVER_URL=http://PHONE_IP:3000`
3. Restart server
4. Access: `http://PHONE_IP:3000` from other device

## Development

### Build for Production
```bash
npm run build
NODE_ENV=production npm start
```

### Android APK Build
```bash
npm run build
npx cap add android
npx cap build android
```

## Security Best Practices

⚠️ **Personal Use Only**:
- PIN never transmitted or logged
- All data stays on device
- Backup database regularly: `cp dinheiros.db dinheiros.db.$(date +%Y%m%d)`
- Use HTTPS in production
- Keep Termux session secure on phone

## Version History

- **v1.0.5**: PIN auth, local DB, Termux support ← **Current**
- **v1.0.4**: Firebase version (deprecated)

---

**Ready?** Start with [TERMUX_SETUP.md](TERMUX_SETUP.md) for Android or `npm run dev` for local development.
