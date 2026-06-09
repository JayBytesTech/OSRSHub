-- 0003_account_value: one composite "account progress" score per day (the trend series).
-- The score is computed client-side (it needs quest-point metadata that lives in the frontend)
-- and POSTed; the server just persists daily points. Upsert refreshes today's score in place.

CREATE TABLE account_value_snapshots (
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  date       TEXT NOT NULL,         -- YYYY-MM-DD
  score      REAL NOT NULL,         -- composite 0-100
  skills_pct REAL,
  quests_pct REAL,
  PRIMARY KEY (account_id, date)
);
