# ADR 0003 — Baseline character scan + full-state ingest contract

- **Status:** Accepted
- **Date:** 2026-06-15
- **Deciders:** Project owner (Jay)
- **Relates to:** ADR 0001 D2 (passive telemetry), ADR 0002 (custom RuneLite plugin), ROADMAP F2.x / F3.x
- **Background:** the full brainstorm, decisions (D1–D3), research, and design draft live in the
  Obsidian note *"OSRS Hub — Plugin Vision (Self-Contained, Baseline Scan)"* §6–§8.

Architecture Decision Records capture *why* a choice was made so future-you (and any AI assistant)
doesn't silently undo it. Keep them short. Supersede rather than rewrite.

---

## Context

ADR 0002 built the in-house plugin's first slice (passive **bank value** → `POST /api/bank`). The
next slice is the **baseline scan**: a one-time/occasional **full dump** of account state (skills,
quests, achievement diaries, combat achievements, unlocks, collection log, scalar stats) so the hub
stops being a manual tracker and becomes a live mirror.

`POST /api/ingest` (Dink today) already auto-ticks *individual* quest/diary/CA events into
`quest_completions` / `diary_completions` / `ca_completions`. The scan is the **bulk** counterpart of
that incremental path — it does not replace it. Research confirmed the approach against
[WikiSync](https://github.com/weirdgloop/WikiSync) (a wiki-maintained, Jagex-tolerated plugin that
does exactly this): read varbits/varps on login, full-dump-then-delta, server-driven manifest.

## Decisions

### D1 — A dedicated scan ingest path, separate from `/api/ingest`
The plugin POSTs a full-state document to **`POST /api/scan`** (a new path), not the Dink-shaped
`/api/ingest`. Reconciliation differs from event ingest enough (full sets, diffing) to warrant its
own endpoint. The companion read/confirm endpoints are `GET /api/scan/pending`,
`POST /api/scan/apply`, `POST /api/scan/dismiss`. All honor the existing `INGEST_TOKEN` guard.

### D2 — First-sight applies wholesale; a known character confirms a diff
- **First-sight** (the account has *zero* rows across all scan-managed tables) → apply the dump
  immediately; the scan is the source of truth, nothing to diff against.
- **Known character** (any existing tracked state, manual or scanned) → do **not** apply. Store the
  dump in `scan_pending` (one row per account, latest wins) and surface a diff (set adds/removes +
  skill level changes) in the hub UI. The user accepts (`/apply`) or discards (`/dismiss`).

### D3 — Section-conditional, mostly full-replace; unlocks additive
Only sections **present** in the payload are written (partial dumps are valid — e.g. bank-only or
collection-log-only). Game-authoritative sets (**quests FINISHED, diary tiers, CA completed**) are
**full-replaced** from the dump. **Unlocks are additive** (insert-or-ignore) — the plugin only knows
a *derivable* subset, so it must never wipe manually-set unlocks. Skills upsert today's
`skill_snapshots`; scalars upsert `profile_stats`; collection log upserts items (never deletes on a
partial dump); bank rides the existing `bank_snapshots` path.

### D4 — Server-owned manifest of what to read
A versioned `scan-manifest.json` (repo root; `data/` is gitignored) served at
**`GET /api/scan/manifest`** tells the plugin which varbits/varps/keys to read, with a per-key
update period. Game updates that shift varbit IDs are fixed by editing the manifest **server-side** —
no plugin redeploy. (WikiSync's pattern; neutralizes the "varbit IDs drift" risk.)

### D5 — Storage: reuse existing tables; four new migrations
Reuse `skill_snapshots`, `quest_completions`, `diary_completions`, `ca_completions`, `unlock_done`,
`bank_snapshots`, `account_events`. Add:
- `0020_profile_stats` — generic account-scoped key/value for scalar metrics (slayer, music, QP, CL
  counts, KCs). Avoids a migration per new counter; mirrors the manifest's "server defines keys".
- `0021_collection_log_items` — per-item collection-log rows (the one large/relational dataset).
- `0022_quest_progress` — IN_PROGRESS quest states (`Quest.getState()` tri-state); FINISHED stays in
  `quest_completions`, NOT_STARTED is absence.
- `0023_scan_pending` — the dump awaiting confirm-diff.

Last-applied scan metadata is stored as a `profile_stats` key (`scan.lastAppliedAt`), not a new table.

### D6 — Passive only (reaffirms ADR 0001 D2 / ADR 0002 D4)
The scan **reads** game state and POSTs. It never sends input to or automates the game.

## Alternatives rejected

- **Force the scan through `/api/ingest`** — full-set reconciliation mismodels the append-only,
  per-event feed; diffing belongs on its own path.
- **Typed column per scalar** instead of `profile_stats` k/v — a migration per new counter; rejected
  for the manifest-driven extensibility.
- **Apply on known characters without confirmation** — risks a bad varbit read silently wiping
  hand-entered state; the one-time confirm-diff is cheap insurance (D2).
- **Hardcode varbit IDs in the plugin** — every game update would need a plugin redeploy; the
  server-side manifest (D4) avoids it.

## Consequences

- The scan is verifiable **without RuneLite**: migrations + `/api/scan*` are exercised by synthetic
  POSTs; only the in-client dump builder needs the live client.
- Build order (per ADR 0002's logic): migrations → repo → `/api/scan*` endpoints → manifest file
  (this ADR's slice), **then** add scan-on-login to the existing `plugin/osrshub-telemetry/` and a
  confirm-diff UI in the hub (later slices).
- The existing bank reporter and Dink event flow are untouched; the scan is purely additive.
