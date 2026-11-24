// server.js – Main Express Application for DinheirOS (Vercel & Node.js)
require('dotenv').config();
const express = require('express');
const path = require('path');

const routes = require('./routes');
const db = require('./db');
const { getMpesaStatus } = require('./mpesa');

const app = express();
const PORT = process.env.PORT || 3000;

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Root health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Mount API routes
app.use('/api', routes);

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Catch-all to serve index.html for SPA client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Periodic session cleanup (every 10 minutes, when running persistent server)
if (process.env.NODE_ENV !== 'production' || require.main === module) {
  setInterval(async () => {
    try {
      await db.cleanupExpiredSessions();
    } catch (e) {
      // ignore
    }
  }, 10 * 60 * 1000);
}

// Start listening if run directly via node server.js
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`===============================================`);
    console.log(`  DinheirOS Cloud Server listening on port ${PORT}`);
    console.log(`  Supabase: ${process.env.SUPABASE_URL ? 'Configured' : 'NOT SET'}`);
    console.log(`  M-Pesa:   ${getMpesaStatus().mode}`);
    console.log(`===============================================`);
  });
}

// Export for Vercel Serverless
module.exports = app;
