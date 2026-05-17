const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'fedhaos.db');

let db;

async function getDb() {
  if (db) return db;
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // Initialize tables if they don't exist
  db.run(`
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

  db.run(`
    CREATE TABLE IF NOT EXISTS withdrawals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet_id INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(wallet_id) REFERENCES wallets(id)
    );
  `);

  db.run(`
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

  // Auth-related tables
  db.run(`CREATE TABLE IF NOT EXISTS pin (
    id INTEGER PRIMARY KEY,
    hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY,
    token TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_active DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS pin_attempts (
    id INTEGER PRIMARY KEY,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    success INTEGER DEFAULT 0
  )`);

  saveDb();

  return db;
}

function saveDb() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

module.exports = {
  getDb,
  initDatabase: getDb,
  /**
   * Helper to run a query and return rows as plain objects.
   */
  runQuery: async (sql, params = []) => {
    const database = await getDb();
    const stmt = database.prepare(sql);
    if (params && params.length > 0) {
      stmt.bind(params);
    } else if (params && typeof params === 'object') {
      stmt.bind(params);
    }
    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  },
  /**
   * Helper to execute a statement (INSERT/UPDATE/DELETE) and get info.
   */
  execStmt: async (sql, params = []) => {
    const database = await getDb();
    const stmt = database.prepare(sql);
    if (params && params.length > 0) {
      stmt.bind(params);
    } else if (params && typeof params === 'object') {
      stmt.bind(params);
    }
    stmt.step();
    stmt.free();
    
    saveDb();
    
    let lastID = 0;
    if (sql.trim().toUpperCase().startsWith('INSERT')) {
        const res = database.exec("SELECT last_insert_rowid() as id");
        if (res.length > 0 && res[0].values.length > 0) {
            lastID = res[0].values[0][0];
        }
    }
    
    const changes = database.getRowsModified();
    return { lastID, changes };
  }
};
