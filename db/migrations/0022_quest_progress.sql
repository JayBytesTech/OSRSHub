-- 0022_quest_progress: IN_PROGRESS quest states from the baseline scan (ADR 0003 D5).
-- RuneLite's Quest.getState() returns a tri-state per quest: NOT_STARTED / IN_PROGRESS / FINISHED.
-- FINISHED already lives in quest_completions (presence = done) and is auto-ticked by /api/ingest;
-- NOT_STARTED is represented by absence. This table captures only the MIDDLE state, so the existing
-- quest_completions "done-set" semantics (used widely via /api/state full-replace) stay untouched.
-- Full-replaced from the dump's quests section when present (ADR 0003 D3).
-- Account-scoped, so deleteAccount()'s table-cascade picks it up automatically.

CREATE TABLE quest_progress (
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  quest      TEXT NOT NULL,
  status     TEXT NOT NULL,               -- 'IN_PROGRESS' (others are derived: FINISHED->quest_completions, NOT_STARTED->absent)
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (account_id, quest)
);
