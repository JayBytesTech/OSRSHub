# ADR 0004 — Vault live snapshot (SQLite → Obsidian reverse sync)

- **Status:** Accepted
- **Date:** 2026-06-15
- **Deciders:** Project owner (Jay)
- **Relates to / partially revisits:** ADR 0001 D3 (SQLite is the store; vault writes were removed)

Architecture Decision Records capture *why* a choice was made so future-you (and any AI assistant)
doesn't silently undo it. Keep them short. Supersede rather than rewrite.

---

## Context

ADR 0001 D3 moved structured/time-series data into SQLite and **stopped rewriting** the vault state
/ history notes (they're now read once, on first boot, for the legacy import). Since then the hub
became increasingly **auto-updating** (Dink ingest, the baseline scan in ADR 0003, daily Hiscores
snapshots) — so SQLite is current but the **vault has gone stale**.

The chat (`/api/chat`) and any Obsidian-side AI read the vault **live** (`search_vault`, `read_note`).
So when the user chats about their account, Claude sees frozen, pre-automation data. The vault needs
to reflect current state again — but *without* re-coupling the app's source of truth to markdown.

## Decision

### D1 — One-way reverse sync: SQLite → a hub-owned "Live" note
SQLite remains the **single source of truth**. The hub additionally **regenerates a dedicated,
hub-owned vault note** (`LIVE_REL`, default `Gaming/OSRS/OSRS Hub — Live.md`) from SQLite. This is a
*projection*, not a store — nothing is ever read back from it. ADR 0001 D3 stands; this only adds a
human-readable mirror for AI/chat consumption.

### D2 — New note, never the user's hand-written notes
Write a new dedicated note with a "generated — do not edit" banner. It is fully **overwritten** on
each sync (it's a projection). We do **not** touch the legacy `STATE_REL` / `HISTORY_REL` notes or
any hand-authored note. (Chosen over rewriting the legacy machine notes: avoids clobbering anything
the user maintains, and prose reads better for chat than the old JSON blocks.)

### D3 — Regenerate on change, debounced
`scheduleSync()` is called after every state-changing operation (Hiscores snapshot, `/api/ingest`,
scan apply, `/api/state` PUT, `/api/bank`) and coalesces rapid changes into a single write a few
seconds later. A manual `POST /api/vault/sync` is also exposed. Sync failures are logged and never
break the triggering request (the vault may be absent/closed).

### D4 — Content: snapshot + recent feed + weekly rollup
The note contains: identity (RSN, combat, total level, bank), a skills table, progress summaries
(quests X/205, diaries, combat achievements X/637 + points, slayer/collection-log scalars where
present), active goals, a **weekly rollup**, and the **last ~25 activity events**.

### D5 — Path-confined, passive
All writes go through `safeVaultPath()` (confined to `VAULT_PATH`). This is output-only projection;
no game interaction.

## Alternatives rejected

- **Rewrite the legacy state/history notes in place** — risks clobbering anything the user has added;
  JSON-block format reads poorly for chat. (D2.)
- **Give the chat direct SQLite access instead of writing the vault** — wouldn't help Obsidian-side
  AI, and the user explicitly wants the vault current. A vault projection serves both.
- **Periodic / on-demand only** — can lag behind recent changes right when the user goes to chat. (D3.)
- **Two-way sync** — re-couples the source of truth to markdown; exactly what ADR 0001 D3 removed.

## Consequences

- A new `vaultLive.js` projector reads the repos and writes one markdown note; `server.js` calls
  `scheduleSync()` from the mutating routes and adds `POST /api/vault/sync`.
- New env var `LIVE_REL`. The note is regenerated, so it's safe to delete; it reappears on next sync.
- Verifiable without the real vault (point `VAULT_PATH` at a temp dir and assert the rendered file).
