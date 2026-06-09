-- 0002_state: quest completions + skill goals (moved out of the vault state note).
-- Presence in quest_completions = completed. Goals are keyed by skill name.

CREATE TABLE quest_completions (
  account_id   INTEGER NOT NULL REFERENCES accounts(id),
  quest        TEXT NOT NULL,
  completed_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (account_id, quest)
);

CREATE TABLE goals (
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  skill      TEXT NOT NULL,
  target     INTEGER NOT NULL,
  PRIMARY KEY (account_id, skill)
);
