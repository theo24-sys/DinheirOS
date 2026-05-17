// server.js – entry point for FinanceOS
// ------------------------------------------------
// Loads environment, initializes DB, registers middleware, routes, and starts the server.
// No TypeScript, plain JavaScript, async/await style.

require('dotenv').config();
const express = require('express');
const path = require('path');

const { initDatabase } = require('./db');
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

app.listen(PORT, () => {
  console.log(`FinanceOS server listening on port ${PORT}`);
});
