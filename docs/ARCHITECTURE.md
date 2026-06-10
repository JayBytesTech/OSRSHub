# Architecture — Current & Target

This document describes where the system is today and the shape we're evolving toward.
It is the technical companion to [PRD.md](./PRD.md) and is bound by the choices in
[decisions/0001-foundational-decisions.md](./decisions/0001-foundational-decisions.md).

> Guiding rule: **evolve, don't rewrite.** Each phase should leave a working app.

---

## 1. Current architecture (v1)

```
browser (public/index.html)         vanilla JS/HTML/CSS, single file, no build
        │
        │  /api/state   GET/PUT   quests + goals  → vault markdown (JSON block)
        │  /api/stats   GET        Hiscores + appends daily history → vault markdown
        │  /api/money   GET        money methods   ← vault markdown (JSON block)
        │  /api/gephr   GET        live GE prices → GP/hr (computed)
        │  /api/chat    POST       Claude tool-use loop
        ▼
server.js (Express, CommonJS, single file)
        ├─ filesystem (VAULT_PATH), all access via safeVaultPath()
        ├─ OSRS Hiscores  (secure.runescape.com)
        ├─ OSRS Wiki prices (prices.runescape.wiki, 60s cache)
        └─ Anthropic SDK — tools: search_vault, read_note, append_note, web_search
```

**Properties today**
- Single account, seeded from `RSN`, behind a `getCurrentAccount()` seam (no real auth yet).
- Structured data (history, quest completions, goals) lives in **SQLite** (`db/`, better-sqlite3,
  with migrations), scoped by `account_id`. The **vault** is now read-only reference: money
  methods (`MONEY_REL`) + the chat tools. Legacy history/state notes were one-time-imported.
- No build step, no tests yet.
- **Static reference data** (the quest prerequisite dataset, F1.2) lives in `public/quest-data.json`,
  served statically and fetched by the frontend at startup. It is *not* in SQLite by design: it is
  non-account-scoped, read-only reference data that the client walks directly (and the future
  server-side "what next?" ranker can read the same file). SQLite stays for account/time-series data.
- `SKILL_NAMES` used to be duplicated in `server.js` and `index.html` with a positional coupling.
  As of Foundations Slice 1 that's retired: history is in SQLite keyed by skill name, and
  `server.js` no longer defines `SKILL_NAMES` (only `index.html` does, for render order).

**What's good and worth preserving**
- Zero-build frontend is fast to iterate.
- `safeVaultPath()` path-confinement is a real security boundary — keep this discipline.
- The vault-as-journal idea is genuinely nice for human notes. Keep it for prose.

---

## 2. Target architecture (north star)

```
   ┌─────────────────────────────────────────────────────────────┐
   │ Clients                                                       │
   │   • Web app (dashboard, goals, optimizer, timeline)          │
   │   • RuneLite plugin (passive telemetry) ── POST /api/ingest  │
   └─────────────────────────────────────────────────────────────┘
                              │  HTTP (account-scoped)
                              ▼
   ┌─────────────────────────────────────────────────────────────┐
   │ API server (Node/Express)                                    │
   │   routes/  ── thin HTTP handlers                             │
   │   services/ ── domain logic (goals, optimizer, money, …)     │
   │   data/   ── repositories over SQLite                        │
   │   integrations/ ── hiscores, wiki-prices, anthropic, vault   │
   └─────────────────────────────────────────────────────────────┘
        │                         │                      │
        ▼                         ▼                      ▼
   SQLite (structured,       Obsidian vault         External APIs
   time-series, per          (human notes &         (Hiscores, Wiki
   account)                  journal, optional)      prices, Anthropic)
```

### 2.1 Data ownership split (per ADR D3)
| Data | Home | Why |
|------|------|-----|
| Skill snapshots, history, KC, loot, GP/hr history | **SQLite** | time-series, charts, queries |
| Goals, prerequisites, unlock/diary/clog state | **SQLite** | relational, derived |
| Account/config (RSN, prefs) | **SQLite** | per-account |
| Journal entries, freeform notes, roadmap prose | **Vault** (optional) | human-readable, Obsidian-native |

The vault becomes **optional and personal**: a hosted public user has no vault, a local
power user can opt in. Never make a core feature *depend* on the vault existing.

### 2.2 Account scoping (per ADR D1)
Every domain table has an `account_id`. Today there is exactly one account (yours, seeded
from `RSN`). The single-account assumption lives behind a `getCurrentAccount()` seam so it
can become real auth later **without touching feature code**.

### 2.3 Telemetry ingest contract (per ADR D2)
Define early, implement later. Sketch:
```
POST /api/ingest        (auth: per-account ingest token)
{
  account_id, session_id, timestamp,
  skill_xp: {...}, bank_value, inventory_snapshot, equipment_snapshot,
  quest_varbits: {...}, ge_offers: [...], boss_kc: {...}, loot_events: [...]
}
```
The web app derives XP graphs, net-worth graphs, timelines, and "what changed since last
login" from ingested rows. **Passive only** — the plugin reads game state, never acts.

**Status: partially implemented.** A first slice is live (`POST /api/ingest` + `GET /api/timeline`,
backed by the `account_events` table and `db/events.js`). It receives webhooks from the existing
**Dink** RuneLite plugin (no custom Java yet): level-ups, quest completions, and loot drops feed an
**Account Timeline** (F3.4), and quest completions additionally auto-tick the Quests tab via
`state.addQuestCompletion()`. Ingest auth is an optional shared `INGEST_TOKEN` (`?token=`), checked
only if set. Still deferred to a **custom plugin**: bank value (only readable while the bank is open),
true GP/hr (derived/session-based), and any live override of displayed levels.

---

## 3. Migration path (no big-bang rewrites)

1. **Introduce SQLite behind repositories**, seeded from current vault JSON. Endpoints keep
   their shapes; only their backing store changes.
2. **Add `account_id` everywhere** with a single hardcoded current account.
3. **Split `server.js`** into `routes/ services/ data/ integrations/` once it crosses a pain
   threshold (~600 lines or 3rd domain added), not before.
4. **Frontend modularizes** when `index.html` interactivity outgrows hand-editing. Prefer the
   lightest tool that works (e.g. Vite + vanilla or a small framework) — decide via an ADR.
5. **Auth + hosting** last (Phase 5), turning `getCurrentAccount()` into real sessions.

## 4. Things we explicitly are NOT doing (yet)
- No microservices, no message queues, no Docker/k8s until hosting demands it.
- No ORM unless raw SQL becomes unmanageable; start with a thin query layer + migrations.
- No client framework rewrite "for cleanliness" — only when interactivity demands it.
- No scraping or automating the game client. Ever.

## 5. Cross-cutting constraints
- `safeVaultPath()`-style confinement for **all** filesystem access.
- ~~`SKILL_NAMES` ordering contract~~ — **retired** (Foundations Slice 1): snapshots are keyed
  by skill name in SQLite, so there is no positional coupling between server and frontend.
- External API politeness: keep caches (prices 60s TTL, mapping once/process) and User-Agents.
- Secrets only in `.env`; never commit keys; never log the Anthropic key.
