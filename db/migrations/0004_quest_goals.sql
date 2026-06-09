-- 0004_quest_goals: high-level goals that target a specific quest (F1.1).
-- Decomposed live by the frontend's recursive requirement engine; here we just store
-- which quests the player has set as goals. Account-scoped; full-replace on write,
-- matching the skill `goals` table.

CREATE TABLE quest_goals (
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  quest      TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (account_id, quest)
);
