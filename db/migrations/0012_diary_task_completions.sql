-- 0012_diary_task_completions: per-task achievement-diary checklist ticks (F2.3 drill-down).
-- Finer-grained than diary_completions (which is whole-tier): one row per individual task the
-- player has ticked, keyed by the task's stable id from public/diary-data.json. Manual only —
-- the game/Dink report whole-tier completion, never individual tasks. Account-scoped, so
-- deleteAccount()'s table-cascade picks it up automatically.

CREATE TABLE diary_task_completions (
  account_id INTEGER NOT NULL,
  task_id    TEXT    NOT NULL,
  PRIMARY KEY (account_id, task_id)
);
