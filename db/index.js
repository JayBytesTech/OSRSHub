'use strict';

// SQLite foundation: connection, a minimal forward-only migration runner, and the
// getCurrentAccount() seam. Structured/time-series data lives here (per ADR 0001 D3);
// the vault remains for human notes. getCurrentAccount() is the single point that will
// become real auth later — all repositories scope by account_id.

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'osrs-hub.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

migrate();

function migrate() {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  const applied = new Set(db.prepare('SELECT name FROM schema_migrations').all().map(r => r.name));
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(file);
    })();
    console.log('DB migration applied:', file);
  }
}

// Upsert + return the single current account (seeded from the RSN env var for now).
function getCurrentAccount() {
  const rsn = process.env.RSN || 'Nullyn Voyd';
  db.prepare('INSERT INTO accounts (rsn) VALUES (?) ON CONFLICT(rsn) DO NOTHING').run(rsn);
  return db.prepare('SELECT id, rsn FROM accounts WHERE rsn = ?').get(rsn);
}

const snapshots = require('./snapshots')(db);

module.exports = { db, getCurrentAccount, snapshots };
