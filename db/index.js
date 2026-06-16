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

// App-level key/value settings (process-wide, not account-scoped). First use: the active
// account pointer for multi-account switching.
function getSetting(key) {
  const r = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  return r ? r.value : null;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value == null ? null : String(value));
}

const selAccount = db.prepare('SELECT id, rsn, display_name AS displayName FROM accounts WHERE id = ?');
const selFirstAccount = db.prepare('SELECT id, rsn, display_name AS displayName FROM accounts ORDER BY id LIMIT 1');

// Return the active account. Identity is DB-owned; a `current_account_id` pointer in
// app_settings selects which account is current. Falls back to the first account (seeding
// one from the RSN env var only when none exist), and self-heals a stale pointer.
function getCurrentAccount() {
  const ptr = getSetting('current_account_id');
  if (ptr) {
    const acct = selAccount.get(Number(ptr));
    if (acct) return acct;                          // pointer valid
  }
  let acct = selFirstAccount.get();
  if (!acct) {
    const rsn = process.env.RSN || 'Nullyn Voyd';
    db.prepare('INSERT INTO accounts (rsn) VALUES (?)').run(rsn);
    acct = selFirstAccount.get();
  }
  setSetting('current_account_id', acct.id);        // seed / heal the pointer
  return acct;
}

function listAccounts() {
  return db.prepare('SELECT id, rsn, display_name AS displayName FROM accounts ORDER BY id').all();
}

// Create a new account. Returns { account } or { error } (bad RSN / duplicate).
function createAccount({ rsn, displayName } = {}) {
  const norm = normalizeRsn(rsn);
  if (norm.error) return { error: norm.error };
  const dn = displayName == null ? null : String(displayName).trim().slice(0, 40) || null;
  let info;
  try {
    info = db.prepare('INSERT INTO accounts (rsn, display_name) VALUES (?, ?)').run(norm.rsn, dn);
  } catch (e) {
    if (String(e).includes('UNIQUE')) return { error: 'An account with that RSN already exists.' };
    throw e;
  }
  return { account: selAccount.get(info.lastInsertRowid) };
}

// Switch the active account. Returns { account } or { error } if the id is unknown.
function setCurrentAccount(id) {
  const acct = selAccount.get(Number(id));
  if (!acct) return { error: 'Unknown account.' };
  setSetting('current_account_id', acct.id);
  return { account: acct };
}

// Tables that scope rows by account_id — computed once so deleteAccount cascades robustly
// even as new account-scoped tables are added.
const accountScopedTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
  .map(t => t.name)
  .filter(name => db.prepare('PRAGMA table_info(' + name + ')').all().some(c => c.name === 'account_id'));

// Permanently delete an account and all its scoped data. Guarded: can't delete the only
// account, and can't delete the active one (switch away first). Returns { ok } or { error }.
function deleteAccount(id) {
  const acct = selAccount.get(Number(id));
  if (!acct) return { error: 'Unknown account.' };
  const total = db.prepare('SELECT COUNT(*) AS c FROM accounts').get().c;
  if (total <= 1) return { error: 'Cannot delete the only account.' };
  const current = getSetting('current_account_id');
  if (current && Number(current) === acct.id) return { error: 'Switch to another account before deleting this one.' };

  db.transaction(() => {
    for (const t of accountScopedTables) db.prepare('DELETE FROM ' + t + ' WHERE account_id = ?').run(acct.id);
    db.prepare('DELETE FROM accounts WHERE id = ?').run(acct.id);
  })();
  return { ok: true, deletedId: acct.id };
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
const bank         = require('./bank')(db);
const scan         = require('./scan')(db);

module.exports = { db, getCurrentAccount, updateAccount, listAccounts, createAccount, setCurrentAccount, deleteAccount, snapshots, state, accountValue, checklist, events, bank, scan };
