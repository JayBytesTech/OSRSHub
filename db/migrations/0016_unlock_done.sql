-- 0016_unlock_done: non-quest unlocks the player has obtained (Unlocks catalogue, F1.2).
-- Presence = unlocked/owned. One row per unlock name (matches public/unlock-data.json `name`).
-- Account-scoped; full-replace on write, riding the /api/state path like quest/diary/gear/CA
-- state. Lets the catalogue mark what you already have, the "next upgrade"-style ranker skip
-- owned unlocks, and the dashboard count only what's still to get.

CREATE TABLE unlock_done (
  account_id  INTEGER NOT NULL REFERENCES accounts(id),
  unlock      TEXT NOT NULL,
  done_at     TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (account_id, unlock)
);
