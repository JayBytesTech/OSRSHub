-- 0021_collection_log_items: per-item collection-log capture (ADR 0003 D5).
-- The one genuinely large/relational part of the baseline scan (~1500 items). Collection log is
-- interface-gated: a full capture needs the player to open the log once; after that new items
-- auto-sync on obtain (research §7). So a scan dump may be PARTIAL — apply upserts the provided
-- items and NEVER deletes (a partial dump must not wipe known items). quantity 0 = not obtained.
-- Aggregate counts (unique obtained/total, completeness) live in profile_stats (clog.* keys).
-- Account-scoped, so deleteAccount()'s table-cascade picks it up automatically.

CREATE TABLE collection_log_items (
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  item_id    INTEGER NOT NULL,
  item_name  TEXT,
  quantity   INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (account_id, item_id)
);
