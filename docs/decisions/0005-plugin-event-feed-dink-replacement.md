# ADR 0005 — Plugin event feed: phase out Dink, make the plugin the sole event source

- **Status:** Accepted
- **Date:** 2026-06-23
- **Deciders:** Project owner (Jay)
- **Relates to:** ADR 0002 (custom plugin), ADR 0003 (baseline scan), ADR 0001 D2 (passive telemetry)
- **Background:** plugin-vision note §1–§8 (the D1 "single-owner-per-event" handoff is from §6 D1).

Architecture Decision Records capture *why* a choice was made so future-you (and any AI assistant)
doesn't silently undo it. Keep them short. Supersede rather than rewrite.

---

## Context

The in-house plugin (`plugin/osrshub-telemetry/`) now works in the user's Jagex/Bolt client and
reports bank value. Today the **event** feed (levels, quests, loot, KC, diaries, collection log,
clues, combat achievements, pets, slayer, deaths) still comes from **Dink** via `POST /api/ingest`
(`normalizeDinkEvent`). The owner wants the **plugin to own the entire event feed** — to control the
ingestion shape and to capture things Dink can't, specifically **session rates (XP/hr, GP/hr)** and
**skilling/gathering gains**, plus "all of Dink and more."

## Decisions

### D1 — Plugin becomes the sole event source; Dink is phased out incrementally
The plugin will emit every event the hub records. Migration is **incremental and category-by-category**
under the **single-owner-per-event** rule (plugin-vision §6 D1): when the plugin starts emitting a
category, that category is toggled **off** in Dink the same moment — never both at once, so nothing
is ever double-recorded. Dink stays installed until the last category is migrated, then removed.

### D2 — Native event contract (`events/1`), not Dink-shaped
The plugin posts a hub-native event payload (versioned `events/1`), **not** Dink's shape — that's the
whole point of owning ingestion. A new server-side handler accepts it; the legacy `normalizeDinkEvent`
path stays for un-migrated categories during the transition. All events still land in the **one**
`account_events` feed (no schema split). Each event carries a stable **idempotency key**
(`account_id | type | game-timestamp | subject`) and `source: "osrshub-plugin"`, so retries/double-fires
dedupe server-side (riding the existing `dedupe_key` unique index).

### D3 — Order: reach Dink parity first, then add the value-adds
- **Phase 0 (foundation):** the `events/1` contract + native ingest handler + idempotency.
- **Phase 1 (parity):** migrate the 11 existing types, lowest-risk first — roughly
  `level → death → quest → diary → ca → clue → pet → slayer → kc → loot → clog`. Each slice = emit
  from plugin + flip off in Dink + verify the feed is unchanged.
- **Phase 2 (beyond Dink):** **session rates** (XP/hr, GP/hr) and **skilling/gathering gains**, then
  any further signals the client exposes.

### D4 — Session rates & skilling gains are session-scoped, not per-tick spam
XP/hr and GP/hr are derived from XP drops + loot value over a **session window** (login→logout, idle
split). To avoid the WikiSync mistake of per-XP-tick flooding (research §7), the plugin aggregates and
posts **periodically / on session boundaries**, not every tick. Exact storage (session-aggregate rows
vs. derived-on-read from existing events + `skill_snapshots`) is decided in that slice.

### D5 — Passive only (reaffirms ADR 0001 D2)
Read game state and POST. Never send input to or automate the game.

## Alternatives rejected

- **Emit Dink-shaped payloads to reuse `normalizeDinkEvent`** — fast parity, but re-inherits Dink's
  shape, defeating the goal of controlling ingestion. Native format (D2) instead.
- **Big-bang switch off Dink** — risks losing event coverage before parity; D1 incremental keeps the
  app working throughout.
- **A separate events table / new feed endpoint** — fragments the timeline; one `account_events`
  feed with a native handler is simpler.
- **Post rates every tick** — floods the server; aggregate per session/interval (D4).

## Consequences

- New `events/1` plugin payload + a native handler alongside `normalizeDinkEvent` (removed once the
  last category is migrated). New plugin subscribers per category (StatChanged, ActorDeath, loot
  events, ChatMessage parsing, varbit watches).
- During transition the user maintains Dink's per-category toggles in lockstep with each slice.
- Verifiable mostly without RuneLite: the server handler + dedupe via synthetic `events/1` POSTs; the
  in-client capture needs the live client.
- Phase 2 finally delivers true XP/hr & GP/hr — the metrics Dink could never provide.
