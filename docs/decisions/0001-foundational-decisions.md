# ADR 0001 — Foundational Direction

- **Status:** Accepted
- **Date:** 2026-06-09
- **Deciders:** Project owner (Jay)

Architecture Decision Records capture *why* a choice was made so future-you (and any AI
assistant) doesn't silently undo it. Keep them short. Supersede rather than rewrite.

---

## Context

OSRS Hub today is a personal, local web app: a single hand-edited `public/index.html`
talking to a single-file Express `server.js`, with an Obsidian vault as the source of
truth and a hardcoded RuneScape name (`RSN`). The `ideas.md` brainstorm describes a far
larger "personal OSRS assistant" — goals with auto-prerequisites, an account optimizer,
boss/collection-log tracking, and live RuneLite telemetry.

Four direction-setting questions were resolved before writing the PRD.

## Decisions

### D1 — Target audience: public product eventually
Build personal-first, but every new feature must be **account-scoped** from day one. No
new code may assume "there is exactly one player." `RSN` and vault paths become per-account
configuration, not global constants. This is the single most expensive decision to defer,
so we pay the modeling cost now and the infrastructure cost later (see ROADMAP Phase 5).

### D2 — RuneLite telemetry: future phase, design for it now
We will **not** build the Java plugin in the near term, but we **will** define the
telemetry ingest contract (`POST /api/ingest`) early so the web app and data model are
shaped to receive it. The plugin is passive telemetry only — never gameplay automation.

### D3 — Data store: SQLite alongside the vault
The vault stays the home for **human-readable notes and journaling**. New **structured and
time-series data** (snapshots, KC, loot, GP/hr history, goals) moves into **SQLite**.
Markdown JSON blocks do not scale to relational/time-series queries and charts.

### D4 — First focus: Account Dashboard / Home
The first vision feature to build is the at-a-glance **dashboard/home** page. It's the
foundation that every later feature (optimizer, goals, timeline) reads from and renders into.

## Consequences

- A data-model and persistence layer (SQLite) is introduced before most vision features.
- The frontend will outgrow a single `index.html`; a modest build step is anticipated
  (see ARCHITECTURE) but deferred until it actually hurts.
- "Personal and local" remains true for a long time; multi-user *hosting* is the last
  phase, but multi-user *data modeling* starts immediately.
