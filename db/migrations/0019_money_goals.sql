-- 0019_money_goals: GP / money goals (F1.1) — a target GP amount the player is saving toward.
-- Account-scoped; full-replace on write, riding the /api/state path like the other goal tables.
-- label = an optional name ("Twisted bow"); amount = target GP. One goal per label per account.

CREATE TABLE money_goals (
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  label      TEXT NOT NULL,
  amount     INTEGER NOT NULL,
  PRIMARY KEY (account_id, label)
);
