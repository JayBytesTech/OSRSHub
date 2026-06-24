# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Planning docs — read before non-trivial work

This project is evolving from a personal local tool toward a public product. Before making
changes, consult these and respect them:

- **[docs/PRD.md](docs/PRD.md)** — what we're building and why; prioritized requirements (F-numbers).
- **[docs/ROADMAP.md](docs/ROADMAP.md)** — phase ordering; don't build a phase's features before its enabler.
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — current vs. target; vault→SQLite + account-scoping + telemetry.
- **[docs/GUARDRAILS.md](docs/GUARDRAILS.md)** — the rules for AI-assisted changes. These win when in doubt.
- **[docs/decisions/](docs/decisions/)** — ADRs. Significant/hard-to-reverse choices get one before coding.

Key standing rules: account-scope new data (`account_id`); structured/time-series data → SQLite,
human notes → vault (optional); no gameplay automation (telemetry is passive); keep all filesystem
access path-confined; make the smallest viable change and leave the app working.

## Commands

```bash
npm install          # first-time setup
npm start            # start server → http://localhost:5173
```

No build step, no test runner, no linter configured.

To re-port the frontend from a fresh Cowork artifact (destructive):
```bash
node scripts/port-hub.js ~/Downloads/osrs-hub.html --force
```

## Environment (.env)

Copy `.env.example` → `.env`. Key variables:

| Var | Default | Notes |
|-----|---------|-------|
| `ANTHROPIC_API_KEY` | — | Required for Chat tab and AI Journey |
| `VAULT_PATH` | `/home/jaybytestech/Documents/Necronomicon` | Absolute path to Obsidian vault |
| `RSN` | `Nullyn Voyd` | OSRS account name for Hiscores lookups |
| `MODEL` | `claude-opus-4-8` | Claude model for chat |
| `ENABLE_WEB_SEARCH` | `true` | Set `false` if web_search tool isn't on the account |
| `PORT` | `5173` | HTTP port |

`STATE_REL`, `HISTORY_REL`, `MONEY_REL` are vault-relative paths to the three managed markdown files.

## Architecture

```
browser (public/index.html)   ← vanilla JS/HTML/CSS, no framework, no build
        │
        │  fetch /api/state     GET/PUT → quest completions + goals (SQLite)
        │  fetch /api/stats     GET     → OSRS Hiscores + history snapshot (SQLite)
        │  fetch /api/money      GET     → vault money methods data
        │  fetch /api/gephr      GET     → OSRS Wiki real-time GE prices → GP/hr
        │  fetch /api/timeline   GET     → account_events feed (Timeline tab)
        │  fetch /api/sessions   GET     → play-session aggregates (+/current) — XP/hr, GP/hr
        │  fetch /api/scan/...   GET/POST→ baseline-scan pending diff + apply/dismiss
        │  fetch /api/chat      POST     → Claude tool-use loop
        ▲
        │  (RuneLite plugin → hub; passive telemetry, honors INGEST_TOKEN)
        │  POST /api/events    → native events/1 feed (level/quest/loot/… — replaces Dink)
        │  POST /api/ingest    → legacy Dink webhook (transitional; normalizeDinkEvent)
        │  POST /api/bank      → daily bank-value snapshot
        │  POST /api/sessions  → live session upsert (XP/hr + GP/hr + gathered resources)
        │  POST /api/scan      → full skills/quests/diaries dump (first-sight apply or diff)
        ▼
server.js (Express, CommonJS)
        ├─ db/ (SQLite via better-sqlite3) — history, state, events, sessions, scan; scoped by account_id
        ├─ vaultLive.js — one-way SQLite → Obsidian "Live snapshot" note (ADR 0004)
        ├─ filesystem (VAULT_PATH) — money methods + chat vault tools, via safeVaultPath()
        └─ Anthropic SDK — tools: search_vault, read_note, append_note, web_search
```

### Frontend (`public/index.html`)

This is the **hand-edited source of truth** — edit directly and refresh the browser; no restart or build needed. It is a single self-contained HTML file with inline CSS and JS.

Key frontend globals: `STATS` (fallback skill levels), `SKILL_NAMES` (ordered array of 25 skills including Sailing), `QUESTS`, `COMPLETED`, `GOALS`. The `switchTab()` function drives the tab UI (Dashboard / Skills / Quests / Progress / Money / AI Journey / Goals / Chat); Dashboard is the default landing tab and `renderDashboard()` composes existing globals/helpers into the at-a-glance view.

### Backend (`server.js`)

Single-file Express server. All routes are in this file.

**Data stores**: structured/account data — quest completions, goals, and daily Hiscores history — lives in **SQLite** (`db/`, file at `DB_PATH`, default `data/osrs-hub.db`), behind `/api/state` and `/api/stats`. The **vault** is still read for **money methods** (`/api/money`, `/api/gephr` parse a fenced ` ```json ` block from `MONEY_REL`) and by the **chat** vault tools. On first boot the server one-time-imports the legacy vault history + state notes into SQLite; those notes are no longer rewritten.

**SQLite layer** (`db/`): `index.js` opens the DB, runs a forward-only migration runner over `db/migrations/*.sql`, and exposes `getCurrentAccount()` (the account-scoping seam). Repositories are factories `(db) => ({...})`: `snapshots.js` (history), `state.js` (quests/goals/diaries/CAs), `events.js` (timeline feed), `bank.js` (daily bank value), `sessions.js` (play-session aggregates), `scan.js` (baseline scan), `accountValue.js`, `checklist.js`. Add schema changes as a new numbered migration file — never edit an applied one. All account-scoped tables are picked up automatically by `deleteAccount`'s cascade.

**Plugin telemetry** (the in-house RuneLite plugin in `plugin/osrshub-telemetry/`, replacing Dink — ADR 0005): passively reads game state and POSTs. `POST /api/events` is the native `events/1` feed (all 11 categories: level/death/quest/diary/ca/clue/pet/slayer/kc/loot/clog) landing in the one `account_events` table, deduped by idempotency key, with quest/diary/CA auto-ticking; `normalizeDinkEvent` + `POST /api/ingest` remain for the Dink transition. `POST /api/sessions` upserts live play-session aggregates by `session_id` (XP/hr over idle-gated active time, GP/hr from loot + gathered resources, per-skill XP, resource counts — ADR 0006); rates are derived on read in `db/sessions.js`. `POST /api/scan` ingests a full skills/quests/diaries dump and either applies it (first sight) or stores a confirm-diff (known account — ADR 0003). All telemetry routes honor the optional `INGEST_TOKEN` and are passive only (ADR 0001 D2).

**Vault Live snapshot** (`vaultLive.js`, ADR 0004): a one-way, debounced projection of the SQLite source of truth into a hub-owned Obsidian note (`LIVE_REL`) so chat / Obsidian-side AI always reads current data. Nothing is read back; regenerated wholesale on change via the path-confined `writeNote`.

**Skill-name coupling**: the old positional `SKILL_NAMES` coupling is retired — history is keyed by skill **name** in SQLite, so `server.js` no longer defines `SKILL_NAMES` (only `public/index.html` does, for render order). Both `/api/stats` and `/api/state` keep their original response shapes; only the backing store changed, so the frontend is unaffected.

**Chat loop** (`runChat`): up to 8 tool-use turns. If the `web_search` tool fails (account doesn't have it), `/api/chat` automatically retries without it.

**GE prices**: `mappingCache` (item name→id) is fetched once per process lifetime. `pricesCache` has a 60-second TTL. Both reset on server restart.

**`safeVaultPath()`**: all filesystem access is confined to `VAULT_PATH` — it throws if a path would escape.

### `scripts/port-hub.js`

One-off scaffolder (now retired) that ported the original Cowork artifact HTML into this local server setup by applying string replacements to wire up `/api/state` and `/api/chat`. It refuses to overwrite `public/index.html` without `--force`.
