-- 0020_profile_stats: generic account-scoped key/value for SCALAR baseline metrics (ADR 0003 D5).
-- The baseline scan (POST /api/scan) reports many small running quantities — slayer points/streak/
-- task, music unlocked/total, quest points, collection-log unique counts, boss KCs, etc. Rather than
-- a typed column (and a migration) per counter, they share one k/v table whose keys are defined by
-- the server-side scan manifest (ADR 0003 D4). value_num for numbers, value_str for text (e.g. the
-- current slayer task). Latest reading wins (upsert). Also holds scan metadata (scan.lastAppliedAt).
-- Account-scoped, so deleteAccount()'s table-cascade picks it up automatically.

CREATE TABLE profile_stats (
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  key        TEXT    NOT NULL,            -- 'slayer.points', 'music.unlocked', 'scan.lastAppliedAt', ...
  value_num  INTEGER,                     -- numeric value (nullable)
  value_str  TEXT,                        -- text value (nullable)
  updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (account_id, key)
);
