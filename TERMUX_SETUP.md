# Termux Setup Guide for DinheirOS

This guide helps you run FinanceOS on your Android phone using Termux.

## Prerequisites

- **Termux** app installed from [F-Droid](https://f-droid.org/packages/com.termux/) (NOT Google Play)
- **Storage permission** granted to Termux
- **Node.js 18+** installed via pkg

## Step-by-Step Installation

### 1. Install Termux Dependencies

```bash
# Update packages
pkg update && pkg upgrade

# Install Node.js
pkg install nodejs

# Install build tools (for native modules)
pkg install build-essential python

# Verify installation
node --version
npm --version
```

### 2. Set Up Project Directory

```bash
# Create project folder in home directory
mkdir -p ~/dinheiros
cd ~/dinheiros

# Clone or copy your project files here
# If copying: transfer files via USB or ADB
```

### 3. Install Project Dependencies

```bash
cd ~/dinheiros
npm install
```

This installs:
- Express (server framework)
- sql.js (local SQLite database)
- node-cron (scheduled tasks)
- dotenv (environment variables)
- Vite + React (frontend)

### 4. Create Environment Configuration

```bash
# Create .env file for your phone's IP
nano .env
```

**Add this content:**
```
PORT=3000
NODE_ENV=development
DB_PATH=/data/data/com.termux/files/home/dinheiros/dinheiros.db
PIN_HASH_PATH=/data/data/com.termux/files/home/dinheiros/pin.hash
VITE_SERVER_URL=http://127.0.0.1:3000
DARAJA_CONSUMER_KEY=your_key_here
DARAJA_CONSUMER_SECRET=your_secret_here
PERSONAL_PHONE_NUMBER=+254712345678
```

**Important:** If accessing from another device on your network, use your phone's IP instead:
```
VITE_SERVER_URL=http://192.168.1.100:3000
```

Press `Ctrl+X` → `Y` → `Enter` to save.

### 5. Start the Server

```bash
# In development (with hot reload)
npm run dev

# Or in production
npm start
```

You should see:
```
╔════════════════════════════════════════╗
║     FinanceOS - Local Server Ready     ║
╠════════════════════════════════════════╣
║ URL: http://127.0.0.1:3000
║ Database: ./dinheiros.db
║ Mode: Local PIN Authentication
║ Rules: ENFORCED SERVER-SIDE
╚════════════════════════════════════════╝
```

### 6. Access the App

**On the same phone (in browser):**
```
http://127.0.0.1:3000
```

**From another device on the network:**
1. Get your phone's IP: `ifconfig | grep "inet " | grep -v 127.0.0.1`
2. Use: `http://YOUR_PHONE_IP:3000`

## Important Notes

### Keeping Termux Running

- **Disable battery optimization** for Termux:
  - Settings → Battery → Battery Optimization → Don't optimize → Termux

- **Keep device awake** while running:
  - Enable Developer Options → Stay Awake (USB Debugging mode)
  - Or configure a screen lock timeout

- **Run as background service** (optional):
  ```bash
  # Use tmux or screen to keep session alive
  pkg install tmux
  tmux new-session -d -s dinheiros "cd ~/dinheiros && npm start"
  tmux attach-session -t dinheiros  # to view logs
  ```

### First-Time Setup

On first launch, you'll be prompted to set a 4-6 digit PIN. This PIN will be:
- **Hashed locally** on your phone
- **Required** to access the app each session
- **Stored in**: `pin.hash` file

### Database Management

Your financial data is stored in `dinheiros.db`:
- **Wallets**: Configuration, frequency counters, lock status
- **Transactions**: All withdrawal attempts (successful/denied)

**Backup your database:**
```bash
cp ~/dinheiros/dinheiros.db ~/dinheiros/dinheiros.db.backup
```

### Troubleshooting

**Port already in use:**
```bash
# Kill existing process
lsof -i :3000
kill -9 <PID>
```

**Database locked error:**
```bash
rm ~/dinheiros/dinheiros.db
# Server will recreate it on restart
```

**Network access issues:**
- Ensure Termux has storage permission
- Check firewall settings on phone
- Verify both devices on same WiFi network

**npm install fails:**
```bash
# Clear npm cache
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
```

## Running Multiple Commands (Screen Setup)

For long-term background operation:

```bash
# Install screen
pkg install screen

# Create new screen session
screen -S dinheiros

# Inside screen session - start server
cd ~/dinheiros
npm start

# Detach from screen (keep running): Ctrl+A → D
# Re-attach later: screen -r dinheiros
```

## Architecture Notes

```
Client (Browser)
    ↓↓ HTTPS/HTTP
Server (Express on Port 3000)
    ↓↓ SQL queries
Database (sql.js, local file)

PIN Authentication:
- Frontend: Hashed client-side for UI
- Backend: Full validation + session tokens
- Storage: Encrypted file on phone
```

## Security Rules Enforced

All withdrawal requests are validated server-side:

1. **Daily Limit**: Max 1 withdrawal per calendar day
2. **Weekly Limit**: Max N withdrawals per week (configurable)
3. **Rollover Bonus**: Extra slot if previous week unused (capped at 1)
4. **Liquidity Check**: Sufficient allocation available
5. **Lock State**: Wallet cannot be locked for manual blocks

## Next Steps

1. ✅ Run the server: `npm start`
2. ✅ Set your PIN on first access
3. ✅ Configure wallets in app
4. ✅ Test withdrawal flow
5. ✅ Backup your database regularly

---

**Questions?** Check logs in terminal for detailed error messages.
