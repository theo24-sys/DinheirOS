// db.js – SQLite setup and table creation (Refactored for sqlite/sqlite3)
// -------------------------------------------------
// Uses the sqlite async wrapper around sqlite3 to avoid Python build issues on Windows.

const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');

// Resolve database file path (placed in project root)
const dbPath = path.resolve(__dirname, '..', 'financeos.db');

let dbPromise;

// Initialize tables – returns a promise of the DB instance
async function initDatabase() {
  if (!dbPromise) {
    dbPromise = open({
      filename: dbPath,
      driver: sqlite3.Database
    }).then(async (db) => {
      // wallets table stores per-wallet configuration and usage counters
      await db.exec(`
        CREATE TABLE IF NOT EXISTS wallets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          weekly_amount INTEGER NOT NULL,
          daily_limit INTEGER NOT NULL,
          weekly_max_count INTEGER NOT NULL,
          rollover BOOLEAN NOT NULL,
          used_today INTEGER DEFAULT 0,
          used_this_week INTEGER DEFAULT 0,
          balance INTEGER DEFAULT 0
        );
      `);

      // withdrawals records every approved access
      await db.exec(`
        CREATE TABLE IF NOT EXISTS withdrawals (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          wallet_id INTEGER NOT NULL,
          amount INTEGER NOT NULL,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(wallet_id) REFERENCES wallets(id)
        );
      `);

      // transactions for audit (includes deposits, rolls, resets)
      await db.exec(`
        CREATE TABLE IF NOT EXISTS transactions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          wallet_id INTEGER NOT NULL,
          type TEXT NOT NULL,
          amount INTEGER NOT NULL,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          note TEXT,
          FOREIGN KEY(wallet_id) REFERENCES wallets(id)
        );
      `);

      return db;
    });
  }
  return dbPromise;
}

// Expose the db promise and init function
module.exports = {
  getDb: () => initDatabase(),
  initDatabase,
  /**
   * Helper to run a query and return rows as plain objects.
   */
  runQuery: async (sql, params = []) => {
    const db = await initDatabase();
    return db.all(sql, params);
  },
  /**
   * Helper to execute a statement (INSERT/UPDATE/DELETE) and get info.
   */
  execStmt: async (sql, params = []) => {
    const db = await initDatabase();
    const result = await db.run(sql, params);
    return result; // result contains .lastID and .changes
  }
};
