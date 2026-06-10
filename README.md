# OSRS Hub (local)

Nullyn Voyd's OSRS hub, running locally on Linux with your Obsidian vault as the
source-of-truth backend. Ported from the Cowork artifact so it no longer depends
on the Cowork runtime.

## What it does

- **Hub** (Skills / Quests / Progress / AI Journey / Goals) — same UI as the artifact.
- **Vault sync** — quest ticks and goals read/write `Gaming/OSRS/OSRS Hub State.md`
  directly on disk. Survives cache wipes; vault stays the source of truth.
- **Chat tab** — talk to Claude with live tools: search your vault, read notes,
  append to notes (e.g. "log today's session to my Daily Log"), and search the
  OSRS wiki.

## One-time setup

```bash
cd ~/Documents/osrs-hub-app
npm install
cp .env.example .env
# edit .env → paste your ANTHROPIC_API_KEY (only needed for Chat / AI Journey)
```

## Run

```bash
npm start
# → http://localhost:5173
```

Vault sync works without an API key. Chat/AI Journey need `ANTHROPIC_API_KEY`.

## Developing the hub

`public/index.html` is the source of truth — edit it directly, then refresh the
browser. (`npm start` serves it statically; no build/restart needed for HTML/JS edits.)

The `scripts/port-hub.js` scaffolder is now retired to a one-off: it refuses to
overwrite `public/index.html` to protect your edits. If you ever truly want to
re-port from a fresh artifact and discard local changes, run:

```bash
node scripts/port-hub.js ~/Downloads/osrs-hub.html --force
```

## How hub data updates

| Data | Source | Update mechanism |
|------|--------|------------------|
| Quest completion + Goals | `Gaming/OSRS/OSRS Hub State.md` | You tick/edit in the hub → `PUT /api/state` |
| Skill levels / XP | OSRS Hiscores (live) | `GET /api/stats` on every hub load → overwrites the embedded `STATS` fallback |
| Progress chart | `Gaming/OSRS/OSRS Hiscores History.md` | One snapshot per day, appended automatically on first load; same-day loads refresh today's column in place |
| Money methods | `Gaming/OSRS/OSRS Money Methods Data.md` | Read via `GET /api/money`; the hub auto-buckets each method (Available / Next / Endgame) live against your current stats + completed quests |
| Live GP/hr | OSRS Wiki real-time prices API | `GET /api/gephr` computes net GP/hr (live GE price × modeled throughput − input costs) for methods that have an `output`/`cost` model. Shown with a 🟢 LIVE tag; methods without a model keep their static estimate. Tune `qtyPerHr` in the data file to adjust throughput. |
| Account Timeline | RuneLite (Dink plugin) | `POST /api/ingest` receives webhooks → stored in `account_events` → shown on the **Timeline** tab + dashboard peek. Quest completions also auto-tick the Quests tab. |

The Hiscores fetch uses `RSN` (default "Nullyn Voyd"), no API key. If the Hiscores
are unreachable, the hub falls back to the values embedded in `public/index.html`.

## Connect RuneLite (auto-updating timeline)

Make the hub update itself while you play — no manual refresh:

1. In RuneLite, install the **Dink** plugin (Plugin Hub) and enable it.
2. Set Dink's **webhook URL** to `http://localhost:5173/api/ingest`
   (append `?token=YOUR_TOKEN` if you set `INGEST_TOKEN` in `.env`).
3. Turn on the notifications you want — at minimum **Level**, **Quest**, and **Loot**.

Now level-ups, quest completions, and drops flow into the **Timeline** tab automatically, and
completed quests tick themselves off in the Quests tab. *Passive only — the hub never controls the
game.* Bank value and true GP/hr need a future custom plugin (Dink can't read those).

## Config (.env)

| Var | Purpose |
|-----|---------|
| `ANTHROPIC_API_KEY` | Required for Chat / AI Journey |
| `VAULT_PATH` | Absolute path to the Obsidian vault |
| `STATE_REL` | Vault-relative path to the hub state file |
| `MODEL` | `claude-opus-4-8` (best) or `claude-sonnet-4-6` (cheaper/faster chat) |
| `ENABLE_WEB_SEARCH` | `false` if web search tool isn't enabled on your account |
| `PORT` | Server port (default 5173) |

## How it's wired

```
browser (public/index.html)
   │  fetch /api/state  (GET/PUT)        →  reads/writes vault .md on disk
   │  fetch /api/chat   (POST)           →  Claude tool-use loop
   ▼
server.js (Express)
   ├─ filesystem  ── VAULT_PATH/Gaming/OSRS/OSRS Hub State.md
   └─ Anthropic SDK ── tools: search_vault, read_note, append_note, web_search
```

## Later: multi-device (phone)

This is the local-first version. To reach it from your phone, the contained next
step is to mirror `Gaming/OSRS/` to a private Git repo and move these two endpoints
to Vercel serverless functions — the frontend doesn't change.
