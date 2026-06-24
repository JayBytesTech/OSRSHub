-- 0023_scan_pending: a baseline-scan dump awaiting confirm-diff (ADR 0003 D2).
-- For a KNOWN character, POST /api/scan does not apply immediately — it stores the full dump here
-- and surfaces a diff in the hub UI. The user then accepts (POST /api/scan/apply) or discards
-- (POST /api/scan/dismiss). The dump originates in the plugin but the human confirms in the hub, so
-- the server must bridge them: one pending dump per account, latest POST wins.
-- Account-scoped, so deleteAccount()'s table-cascade picks it up automatically.

CREATE TABLE scan_pending (
  account_id       INTEGER NOT NULL REFERENCES accounts(id),
  payload          TEXT    NOT NULL,      -- the full dump JSON, as received
  manifest_version INTEGER,
  received_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (account_id)
);
