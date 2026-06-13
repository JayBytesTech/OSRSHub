-- 0014_gear_owned: gear items the player owns/uses (Gear & upgrade path v2).
-- Presence = owned. Lets the Gear tab compute "next upgrade" from your actual current piece
-- (not just stat-gating, which saturates at high levels) and lets the dashboard ranker suggest
-- the next equippable upgrade you don't have yet. One row per owned item name (matches the
-- gear-data.json `name`). Account-scoped; full-replace on write, riding the /api/state path.

CREATE TABLE gear_owned (
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  item       TEXT NOT NULL,
  owned_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (account_id, item)
);
