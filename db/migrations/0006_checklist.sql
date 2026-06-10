-- 0006_checklist: Daily/weekly recurring task list.
-- Account-scoped. Full-replace on write. last_completed stores the period key
-- (YYYY-MM-DD for daily; YYYY-MM-DD of that week's Wednesday for weekly) so
-- "is done today?" is a simple string equality check on the client.

CREATE TABLE checklist_tasks (
  account_id     INTEGER NOT NULL REFERENCES accounts(id),
  task_id        TEXT    NOT NULL,
  title          TEXT    NOT NULL,
  frequency      TEXT    NOT NULL CHECK(frequency IN ('daily','weekly')),
  enabled        INTEGER NOT NULL DEFAULT 1,
  is_preset      INTEGER NOT NULL DEFAULT 0,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  last_completed TEXT,
  PRIMARY KEY (account_id, task_id)
);
