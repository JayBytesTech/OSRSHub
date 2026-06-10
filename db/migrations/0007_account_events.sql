-- 0007_account_events: passive telemetry feed (F3.1/F3.4).
-- Append-only account-scoped event log, populated by POST /api/ingest (Dink webhooks
-- today; a custom RuneLite plugin later). `data` holds the raw structured extras as JSON.
-- dedupe_key (type|summary|minute) + the unique index make re-posted webhooks idempotent.

CREATE TABLE account_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id  INTEGER NOT NULL REFERENCES accounts(id),
  type        TEXT NOT NULL,                 -- 'level' | 'quest' | 'loot' | 'other'
  occurred_at TEXT NOT NULL,                 -- ISO timestamp (server receipt time)
  summary     TEXT NOT NULL,                 -- human one-liner for the feed
  data        TEXT,                          -- JSON of the structured extras (nullable)
  source      TEXT NOT NULL DEFAULT 'dink',
  dedupe_key  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_events_acct_time ON account_events(account_id, occurred_at DESC);
CREATE UNIQUE INDEX idx_events_dedupe ON account_events(account_id, dedupe_key);
