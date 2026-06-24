# ADR 0006 — Session rates & skilling gains (plugin Phase 2, beyond Dink)

- **Status:** Accepted
- **Date:** 2026-06-24
- **Deciders:** Project owner (Jay)
- **Relates to:** ADR 0005 (plugin event feed; this is its Phase 2), ADR 0001 D2 (passive telemetry),
  ADR 0001 D3 (SQLite is source of truth)
- **Background:** Phase 2 plan note (`Gaming/OSRS/OSRS Hub — Phase 2 Plan (Session Rates).md`), where
  the four headline decisions below were chosen by the owner.

Architecture Decision Records capture *why* a choice was made so future-you (and any AI assistant)
doesn't silently undo it. Keep them short. Supersede rather than rewrite.

---

## Context

Phase 1 (ADR 0005) made the plugin emit all 11 categories Dink did. Phase 2 delivers what Dink never
could: **XP/hr, GP/hr, per-skill XP gains, and gathered-resource counts**, scoped to a play **session**.
These are running aggregates, not discrete timeline moments, and ADR 0005 D4 forbids per-XP-tick
flooding — so they need their own shape, storage, and cadence rather than riding `account_events`.

## Decisions

### D1 — Dedicated session path, not the events feed
Sessions are stored via a new `POST /api/sessions` endpoint into a new `xp_sessions` table, **upserted
by `session_id`** (so periodic in-session updates overwrite the same row). This is separate from the
`account_events` feed. Account-scoped like all data; honors `INGEST_TOKEN`; triggers `vaultLive` sync.

### D2 — Idle-gated active time is the rate denominator
XP/hr and GP/hr are computed over **active time**, not wall-clock online time. On each XP gain the
plugin adds `min(now − lastGainAt, idleThreshold)` to an `activeSeconds` accumulator, so genuine AFK
(gaps longer than the threshold) doesn't dilute rates. **Idle threshold = 5 minutes, configurable.**
(Same model as RuneLite's XP tracker / Wise Old Man.)

### D3 — Live aggregation in the plugin, posted periodically + on session end
The plugin holds an in-memory `SessionTracker` (per-skill start/current XP via `StatChanged.getXp()`,
`client.getOverallExperience()`, accumulated loot + gathered value, active-time). It posts a
`sessions/1` payload **every ~60s while active** (so the hub renders a *live* current session) and a
final authoritative post (`final:true`) on logout/hop. Server upsert is idempotent by `session_id`.

### D4 — GP/hr = loot value + gathered-resource value
GP/hr counts both PvM/drop loot (the Phase 1 `handleLoot` valuation) **and** the GE value of resources
gathered while skilling — so money-making skills register. (Not net-worth delta, which buying/selling
/teleports make noisy and misleading.)

### D5 — Resource counts are core (not deferred), via XP-correlated attribution
Because gathered output must show as counts AND feed GP/hr (D4), resource counting ships in v1. To
avoid the naïve inventory-diff trap (which miscounts bank withdrawals, buys, and drops), a positive
inventory delta is attributed to gathering **only when a gathering-skill `StatChanged` fired on the
same tick**. Gathered items are valued with `ItemManager.getItemPrice`. Processing skills (Cooking,
Fletching, …) net ~zero inventory delta → counted as XP-only, never "gathered"; full-inventory
drops-to-floor count for XP/hr but may undercount resources (accepted limitation).

### D6 — Session-end Timeline recap event
In addition to the `xp_sessions` row, the plugin drops **one** `session` event into `account_events` at
session end (e.g. "🧭 Session: 1h20m · 350k XP · 1.2M gp") as a human-readable recap. One per session
(keyed by `session_id`), so it doesn't reintroduce per-tick spam.

### D7 — Passive only (reaffirms ADR 0001 D2)
Read game state and POST. Never send input to or automate the game.

## Alternatives rejected

- **Put sessions in `account_events`** — fragments a discrete-event feed with mutable aggregates;
  upserting a session row is cleaner (D1).
- **Per-tick / per-XP-drop posts** — the WikiSync flooding mistake (ADR 0005 D4); aggregate client-side
  and post on an interval/boundary (D3).
- **Wall-clock online time as the denominator** — AFK/banking dilutes rates; idle-gating is the
  meaningful measure (D2).
- **Net-worth-delta GP/hr** — broad but noisy (buying, selling, teleport costs); loot + gathered value
  is attributable and honest (D4).
- **Naïve inventory diffing for resources** — miscounts non-gathering inventory changes; XP-correlation
  scopes it correctly (D5).
- **Deferring resource counts to a later phase** — but they're required by the GP/hr decision (D4), so
  they're in v1 (D5).

## Consequences

- New `xp_sessions` table (migration `0024`), `db/sessions.js` repo, `POST/GET /api/sessions` (+
  `/current`); the existing daily `skill_snapshots` is unchanged (sessions add intra-day granularity).
- New plugin `SessionTracker` + an inventory-diff resource counter; reuses the Phase 1 loot valuation.
- Hub UI: a live "🧭 Session" Dashboard card (polls `/current`) + a Sessions history view.
- Built in slices (2A foundation/XP-hr → 2B per-skill + resource counts → 2C GP/hr + recap event → 2D
  history UI + vault block + config + edge-case hardening), each left working — same cadence as Phase 1.
- Delivers true XP/hr & GP/hr — the headline metrics Dink could never provide.
