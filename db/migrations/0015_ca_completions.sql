-- 0015_ca_completions: Combat Achievement tasks the player has completed (CA planner).
-- Presence = completed. One row per CA task id (matches public/ca-data.json task `id`, the
-- wiki's stable data-ca-task-id). Account-scoped; full-replace on write, riding the /api/state
-- path like quest/diary completions. The hub tracks CAs manually (it can't verify combat
-- capability), so there is no ready/locked gating — these rows are the source of truth for
-- per-tier task counts and earned points.

CREATE TABLE ca_completions (
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  task_id    INTEGER NOT NULL,
  done_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (account_id, task_id)
);
