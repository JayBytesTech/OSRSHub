-- 0001_init: accounts + per-skill daily snapshots (history).
-- Snapshots are keyed by skill NAME (no positional SKILL_NAMES coupling).
-- "Total" is not stored — it is computed on read as the sum of skill levels per date.

CREATE TABLE accounts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  rsn        TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE skill_snapshots (
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  date       TEXT NOT NULL,          -- YYYY-MM-DD
  skill      TEXT NOT NULL,          -- hub skill name
  level      INTEGER NOT NULL,
  xp         INTEGER,                -- captured live going forward; NULL for imported rows
  rank       INTEGER,
  PRIMARY KEY (account_id, date, skill)
);

CREATE INDEX idx_snap_acct_date ON skill_snapshots(account_id, date);
