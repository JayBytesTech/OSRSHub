-- 0005_preset_goals: high-level "preset" goals that aren't a single skill or quest.
-- First kind: 'quest_cape' (complete every quest). Decomposed live by the frontend.
-- Account-scoped; full-replace on write, matching goals / quest_goals. The `kind` column
-- is intentionally open-ended so later presets (base_70, total_2000, …) cost only a row.

CREATE TABLE preset_goals (
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  kind       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (account_id, kind)
);
