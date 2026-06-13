-- 0017_unlock_ca_goals: unify the goal system — unlocks and CA tiers can now be goals (F1.1).
-- Two account-scoped goal tables mirroring diary_goals: a row = that target is set as a goal.
-- Full-replace on write, riding the /api/state path. unlock_goals.unlock matches
-- unlock-data.json `name`; ca_goals.tier is one of Easy/Medium/Hard/Elite/Master/Grandmaster.

CREATE TABLE unlock_goals (
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  unlock     TEXT NOT NULL,
  PRIMARY KEY (account_id, unlock)
);

CREATE TABLE ca_goals (
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  tier       TEXT NOT NULL,
  PRIMARY KEY (account_id, tier)
);
