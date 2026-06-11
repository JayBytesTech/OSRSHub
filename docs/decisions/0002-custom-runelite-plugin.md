# ADR 0002 — Custom RuneLite plugin (passive bank-value telemetry)

- **Status:** Accepted
- **Date:** 2026-06-11
- **Deciders:** Project owner (Jay)
- **Relates to:** ADR 0001 D2 (telemetry is passive, design-for-it-now), ROADMAP F3.2 / F2.1 / F3.4

Architecture Decision Records capture *why* a choice was made so future-you (and any AI
assistant) doesn't silently undo it. Keep them short. Supersede rather than rewrite.

---

## Context

The hub ingests RuneLite telemetry via `POST /api/ingest`, today fed by the **Dink** plugin —
which already covers every discrete event we want (levels, quests, loot, KC, diaries, collection
log, clues, combat achievements, pets, deaths). Two metrics Dink **cannot** send keep blocking
roadmap items (F3.2, the F2.1 analytics tail, F3.4's net-worth line): **bank value** and **true
GP/hr**. Both are running quantities a passive in-client plugin must read directly.

ADR 0001 D2 said we'd build the Java plugin "in a future phase" but shape the data model for it
now. That phase has arrived: the ingest contract is proven, the app is still solo/local, and bank
value is the single highest-value missing signal. This ADR records *how* we build the plugin —
before writing it — because a new language + build + deployable is hard to reverse cheaply.

## Decisions

### D1 — Build an in-house plugin for the Dink gap, bank value first
A small RuneLite plugin (`plugin/osrshub-telemetry/`) reports the signals Dink can't. The first
slice is **bank value only**; **true GP/hr** is a deliberate follow-up. Rationale: bank value is the
bigger unlock (true net worth over time) and far simpler — one passive read on bank-change → one
POST — versus GP/hr's continuous session-rate tracking.

### D2 — Distribution: side-load, NOT the RuneLite Plugin Hub
The plugin is run locally as a **side-loaded / dev-client plugin** (gradle `run` task or IntelliJ
run-config, the canonical `runelite/example-plugin` pattern). We do **not** publish to the Plugin
Hub. The Hub forbids arbitrary outbound HTTP to a user's localhost and requires public review and
publishing — wrong for a private tool posting to your own machine. Side-loading keeps it private,
unreviewed, and trivially reversible. (Revisit only if the hub is ever hosted for others.)

### D3 — Bank value is a snapshot, stored outside the events feed
Bank value is a **snapshot of a running quantity**, not a discrete timeline event. It lives in its
own per-day table (`bank_snapshots`, one row per account/day, latest reading wins) — mirroring
`skill_snapshots` / `account_value_snapshots` — **not** the append-only `account_events` feed where
drops/KC live. The plugin posts to a **dedicated `POST /api/bank`**, keeping `/api/ingest` purely
Dink-shaped. Account-scoped, so the existing `deleteAccount()` cascade covers it automatically.

### D4 — Passive only (reaffirms ADR 0001 D2)
The plugin **observes** game state (the bank item container) and sends HTTP. It never sends input
to, scripts, or automates the game. Any future signal (GP/hr, equipment value) inherits this rule.

## Alternatives rejected

- **Publish to the RuneLite Plugin Hub** — localhost-POST restriction + mandatory public review;
  pointless for a personal tool.
- **Screen/OCR scraping of the bank value widget** — fragile, breaks on UI changes; the item
  container + `ItemManager` GE prices are the supported, exact path.
- **Manual bank-value entry in the hub** — the current stopgap; not durable and easy to forget.
- **Force bank value through `/api/ingest` as a fake event** — pollutes the append-only feed with a
  non-event and mismodels a running quantity.

## Consequences

- New top-level Gradle/Java project under `plugin/` (separate toolchain from the Node app; build
  output gitignored). The in-client half can only be verified by running RuneLite — the server/DB/
  chart half is verified in-repo via synthetic POSTs.
- Net worth in the hub initially means **banked items only** (excludes worn gear + inventory); a
  truer figure and GP/hr are follow-up slices on this same plugin.
