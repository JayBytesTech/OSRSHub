-- 0024_xp_sessions: play-session aggregates for XP/hr & GP/hr (ADR 0006, plugin Phase 2).
-- The plugin's SessionTracker posts a running aggregate per session (login→logout) to
-- POST /api/sessions, upserted by session_id so periodic in-session updates overwrite one row
-- (ADR 0006 D1; NOT the account_events feed, which is for discrete moments). Rates are derived on
-- read from total_xp / active_seconds and (loot_value+gathered_value) / active_seconds (D2 idle-gated
-- active time is the denominator). per_skill_json / resources_json hold the breakdowns for later
-- slices (2B). Columns for all of Phase 2 are present now so no re-migration is needed mid-phase.
-- Account-scoped, so deleteAccount()'s table-cascade picks it up automatically.

CREATE TABLE xp_sessions (
  account_id      INTEGER NOT NULL REFERENCES accounts(id),
  session_id      TEXT    NOT NULL,            -- plugin-assigned, stable for the session (start ISO)
  started_at      TEXT    NOT NULL,
  ended_at        TEXT,                         -- set when the session's final post arrives
  active_seconds  INTEGER NOT NULL DEFAULT 0,   -- idle-gated active time (rate denominator)
  total_xp        INTEGER NOT NULL DEFAULT 0,   -- total XP gained this session
  loot_value      INTEGER NOT NULL DEFAULT 0,   -- GE value of loot received (2C)
  gathered_value  INTEGER NOT NULL DEFAULT 0,   -- GE value of gathered resources (2C)
  per_skill_json  TEXT,                          -- {"Slayer":120000,...} XP gained per skill (2B)
  resources_json  TEXT,                          -- {"Yew logs":287,...} resources gathered (2B)
  final           INTEGER NOT NULL DEFAULT 0,   -- 1 once the session ended (logout/hop)
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (account_id, session_id)
);

CREATE INDEX idx_xp_sessions_started ON xp_sessions (account_id, started_at DESC);
