-- 0008_diary_completions: Achievement Diary tier completions (F2.3).
-- One row per completed (region, tier) the player has claimed in-game. Diary tiers are
-- all-or-nothing, so a single flag per tier is the right granularity (mirrors quest_completions).
-- Account-scoped; full-replace on write, riding the same /api/state path as quests/goals.
-- The frontend computes ready/locked live from diary-data.json; this table only stores "claimed".

CREATE TABLE diary_completions (
  account_id   INTEGER NOT NULL REFERENCES accounts(id),
  region       TEXT NOT NULL,
  tier         TEXT NOT NULL,
  completed_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (account_id, region, tier)
);
