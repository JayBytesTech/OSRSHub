-- 0009_account_profile: a friendly display name for the account (going-public, slice 1).
-- The `rsn` stays the Hiscores lookup key (UNIQUE); `display_name` is an optional label
-- shown in the UI. Account identity becomes editable in-app and DB-owned from here on —
-- the RSN env var only seeds the FIRST account (see getCurrentAccount in db/index.js).

ALTER TABLE accounts ADD COLUMN display_name TEXT;
