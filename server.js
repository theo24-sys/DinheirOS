// server.js – entry point for FinanceOS
// ------------------------------------------------
// Loads environment, initializes DB, registers middleware, routes, and starts the server.
// No TypeScript, plain JavaScript, async/await style.

require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');

const { initDatabase, execStmt } = require('./db');
const routes = require('./routes');
const { resetDaily, resetWeekly } = require('./cron'); // ensures cron job is scheduled

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Serve static frontend files
app.use('/public', express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api', routes);

// Simple health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Initialise DB (creates tables if missing)
initDatabase();

// Create sessions table for session token management and ensure it's present
(async () => {
  try {
    await execStmt(`CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      last_active INTEGER NOT NULL
    )`);
    console.log('Sessions table ensured');
  } catch (err) {
    console.error('Failed to ensure sessions table:', err.message);
  }
})();

// Session expiry: remove sessions inactive for more than 5 minutes
const SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
setInterval(async () => {
  const cutoff = Date.now() - SESSION_TIMEOUT_MS;
  try {
    await execStmt('DELETE FROM sessions WHERE last_active < ?', [cutoff]);
  } catch (err) {
    console.error('Session cleanup error:', err.message);
  }
}, 60 * 1000); // run every minute

app.listen(PORT, () => {
  console.log(`FinanceOS server listening on port ${PORT}`);
});
