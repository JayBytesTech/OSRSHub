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

// Return the single current account. Identity is DB-owned and editable in-app; the RSN
// env var only SEEDS the first account (so a UI rename isn't clobbered on the next request).
function getCurrentAccount() {
  let acct = db.prepare('SELECT id, rsn, display_name AS displayName FROM accounts ORDER BY id LIMIT 1').get();
  if (!acct) {
    const rsn = process.env.RSN || 'Nullyn Voyd';
    db.prepare('INSERT INTO accounts (rsn) VALUES (?)').run(rsn);
    acct = db.prepare('SELECT id, rsn, display_name AS displayName FROM accounts ORDER BY id LIMIT 1').get();
  }
  return acct;
}

// OSRS RSNs are 1–12 chars: letters, digits, spaces, hyphens, underscores.
function normalizeRsn(raw) {
  const rsn = String(raw == null ? '' : raw).trim();
  if (rsn.length < 1 || rsn.length > 12) return { error: 'RSN must be 1–12 characters.' };
  if (!/^[A-Za-z0-9 _-]+$/.test(rsn)) return { error: 'RSN may only contain letters, digits, spaces, hyphens, and underscores.' };
  return { rsn };
}

// Edit the current account's identity. Validates the RSN; display name is optional.
// Returns { account } on success or { error } on bad input / RSN collision.
function updateAccount(id, { rsn, displayName } = {}) {
  const norm = normalizeRsn(rsn);
  if (norm.error) return { error: norm.error };
  const dn = displayName == null ? null : String(displayName).trim().slice(0, 40) || null;
  try {
    db.prepare('UPDATE accounts SET rsn = ?, display_name = ? WHERE id = ?').run(norm.rsn, dn, id);
  } catch (e) {
    if (String(e).includes('UNIQUE')) return { error: 'That RSN is already used by another account.' };
    throw e;
  }
  return { account: db.prepare('SELECT id, rsn, display_name AS displayName FROM accounts WHERE id = ?').get(id) };
}

const snapshots    = require('./snapshots')(db);
const state        = require('./state')(db);
const accountValue = require('./accountValue')(db);
const checklist    = require('./checklist')(db);
const events       = require('./events')(db);

module.exports = { db, getCurrentAccount, updateAccount, snapshots, state, accountValue, checklist, events };
