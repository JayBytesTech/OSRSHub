-- 0013_diary_goals: Achievement Diary tiers the player is working toward (F1.1).
-- A diary-tier goal decomposes into its missing skills + quests (computed live from
-- diary-data.json + the quest requirement engine); this table just records which tiers
-- are goals. One row per (region, tier). Account-scoped; full-replace on write, riding
-- the same /api/state path as quests/skill goals/diary completions.

CREATE TABLE diary_goals (
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  region     TEXT NOT NULL,
  tier       TEXT NOT NULL,
  added_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (account_id, region, tier)
);
