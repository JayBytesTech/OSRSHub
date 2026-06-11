-- 0010_app_settings: app-level key/value store (going-public, slice 2).
-- First use: 'current_account_id' — the active account pointer for multi-account switching.
-- App-level (not account-scoped) on purpose: it records WHICH account is current. Reusable
-- later for other process-wide prefs that aren't tied to a single account.

CREATE TABLE app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
