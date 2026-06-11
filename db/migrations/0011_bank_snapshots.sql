-- 0011_bank_snapshots: daily bank-value trend (F3.2 — custom RuneLite plugin).
-- Bank value is a snapshot of a running quantity (like skill_snapshots / account_value_snapshots),
-- NOT a discrete timeline event — so it gets its own per-day table rather than the account_events
-- feed. One row per (account, day); the latest reading of the day wins (upsert). Account-scoped, so
-- deleteAccount()'s table-cascade picks it up automatically.

CREATE TABLE bank_snapshots (
  account_id INTEGER NOT NULL,
  date       TEXT    NOT NULL,
  value      INTEGER NOT NULL,
  updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (account_id, date)
);
