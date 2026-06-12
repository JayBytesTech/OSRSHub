# Roadmap — From v1 to the Vision

Phased path from today's working app to the [PRD](./PRD.md) vision. Sequencing honors
[ARCHITECTURE.md](./ARCHITECTURE.md): **evolve, don't rewrite; every phase ships a working app.**

Phases are ordered by dependency, not calendar. Expect heavy iteration *within* each phase —
this is a discovery process, so treat checklists as hypotheses, not commitments.

Legend: 🟢 done · 🟡 in progress · ⚪ not started

---

## Phase 0 — v1 baseline ✅ (done)
The launchpad that already exists.
- 🟢 Skills / Quests / Progress / Money / AI Journey / Goals / Chat tabs
- 🟢 Live Hiscores + daily history snapshot
- 🟢 Live GE prices → GP/hr
- 🟢 Claude agent with vault tools
- 🟢 Vault-as-source-of-truth (markdown + JSON blocks)

**Exit criteria:** met. The rest of the roadmap builds on this.

---

## Phase 1 — Foundations (data & scoping)  ⚪
*Make the app able to grow. Mostly invisible to the UI, unblocks everything after.*

- ⚪ **F0.1** Introduce SQLite + a migrations setup + a thin repository layer.
- ⚪ Seed SQLite from the current vault JSON (one-time importer).
- ⚪ Move stats history, quest state, and goals to SQLite; keep response shapes stable.
- ⚪ Retire the positional `SKILL_NAMES` coupling by keying snapshots on skill name.
- ⚪ **F0.2** Add `account_id` to every table + a `getCurrentAccount()` seam (one account for now).
- ⚪ Keep the vault for journaling/notes only (optional going forward).

**Exit criteria:** all existing tabs work unchanged, backed by SQLite; `RSN` comes from an
account record; no feature code assumes a single global player.

---

## Phase 2 — The Dashboard (first vision feature)  ⚪
*Deliver the "open it and know where you stand" moment. (ADR D4)*

- ⚪ **F0.3** Account Dashboard / Home: combat, total, QP, diary %, bank value (manual entry
  for now), active goals, recent deltas (from history).
- ⚪ Make it the default landing view.
- ⚪ Wire deltas off the daily snapshot history already being recorded.

**Exit criteria:** opening the app answers "where am I?" at a glance with real data.

---

## Phase 3 — Differentiators (why this hub is unique)  ⚪
*The features that make it an assistant, not a tracker.*

- 🟡 **F1.1** Goal system with auto-prerequisites (goals decompose into live requirement trees).
  Quest goals + the Quest Cape preset already decompose via the F1.2 engine; broad goal types
  (diary tiers, skill targets as trees) still pending.
- 🟡 **F1.2** Quest **dependency graph** (recursive, "can I start now?") — **engine + full dataset live.**
  `buildRequirementTree`/`outstandingFor` expand the whole transitive prerequisite tree (cycle-guarded,
  diamond-deduped) with an ordered to-do list and aggregated skill summary. The prerequisite dataset
  (`public/quest-data.json`) now covers **all 178 quests** in the master list — direct prereqs only
  (the engine recurses), wiki-verified, with skill/QP gates. Deep chains resolve with no unknown holes.
  A master-list integrity pass added 7 real quests that were missing, removed a non-OSRS entry
  (Fairy Tale III), and fixed name/skill-key bugs that were silently breaking gates. Non-quest
  **unlocks** (items, area access, skill unlocks) as graph nodes still pending.
- ⚪ **F1.3** "What should I do next?" engine — ranked, prerequisite-aware suggestions on the dashboard.
  (A `bestReadyQuestName` heuristic already feeds the Quest Cape preset; full dashboard ranker pending.)

**Exit criteria:** adding a high-level goal yields an accurate outstanding-requirements list,
and the dashboard recommends agreeable next actions.

---

## Phase 4 — Depth & analytics  ⚪
*Make progress measurable and motivating.*

- 🟡 **F2.1** Money-maker analytics: historical GP/hr, profit per activity, wealth-over-time charts.
  **Trends view live** — the Progress tab charts XP-over-time (per-skill + Total; the line breaks at
  the XP-tracking start since legacy history is levels-only), Account Value over time, and cumulative
  Wealth-from-drops, with a Level/XP toggle and XP deltas in the Recent-gains grid (`getHistory()` now
  returns an `xp` series), plus a **🏦 Bank value** series fed by the custom plugin (F3.2). Per-activity
  GP/hr history still pending (awaits the GP/hr half of the custom plugin).
- 🟢 **F2.2** XP planning: per-skill XP-remaining + time-to-goal per method (curated XP/hr dataset + ad-hoc planner).
- 🟢 **F2.3** Achievement-diary planner: tier-level requirements for all 12 regions (skill/quest/combat
  gates, "can I do this now?"), completion tracking, dashboard tile. **Per-task drill-down live** —
  expand a tier to a checklist of its individual tasks, each with its own requirement gating (ready/
  locked) and a tickable checkbox (synced via `diaryTasks` in `/api/state`, stored in
  `diary_task_completions`); tier head shows `n/m tasks`. **All 12 regions curated** (492 tasks);
  per-task gates validated against the frontend `QUESTS` master list so quest requirements the hub
  can't verify are surfaced as notes rather than false-locking gates.
- 🟢 **F2.4** Daily/weekly checklist with reset timers.
- 🟢 **F2.5** Account Value score, trended over time.
- ⚪ Frontend modularization if/when `index.html` interactivity outgrows hand-editing (ADR first).

**Exit criteria:** the hub shows trends over time, not just current state.

---

## Phase 5 — Telemetry & going public  ⚪
*The living-history layer and the multi-user turn. Largest scope; do last.*

- 🟡 **F3.1** `POST /api/ingest` telemetry contract (ADR D2) — **live via the Dink plugin** (levels,
  quests, loot, KC, achievement diaries → `account_events`; quests **and diary tiers** auto-tick).
  Custom-plugin **bank value** now flows via `POST /api/bank` (F3.2); GP/hr still pending.
- 🟡 **F3.2** RuneLite plugin (passive telemetry: XP, loot, bank, KC, clues, sessions). *Dink covers the
  common events today; a custom plugin is only needed for bank value + true GP/hr.* **Custom plugin base
  live** — `plugin/osrshub-telemetry/` (side-loaded, passive; ADR 0002) reads **bank value** on
  bank-change and POSTs to a dedicated `POST /api/bank`, stored as a daily `bank_snapshots` snapshot and
  charted as the **🏦 Bank value** trend. True **GP/hr** (session XP/gp rates) is the next plugin slice.
- 🟡 **F3.3** Boss & collection-log dashboards (KC, PB, profit, deaths, log completion, missing items) —
  **Loot & Wealth view live** (GP from drops, per-source breakdown, biggest drops, true KC from Dink
  `KILL_COUNT`); **progression milestones live** (typed collection-log / clue / combat-achievement / pet /
  slayer / death events → `/api/milestones` → dashboard Collection Log tile + Milestones panel);
  **Bosses / kill-tracker view live** (per-boss KC + logged loot + avg/drop + expandable drop drilldown,
  `/api/bosses`). Full collection-log item grid, PB tracking, and per-tier clue/CA/death dashboards still pending.
- 🟡 **F3.4** Account timeline (living feed of level-ups, drops, completions, net-worth changes) —
  timeline tab + dashboard peek live; net-worth changes await the custom plugin.
- 🟡 Real auth + sessions: turn `getCurrentAccount()` into actual accounts. **Slices 1–3 done** —
  account identity (RSN + display name) is DB-owned and editable in-app (`GET`/`PUT /api/account`),
  **multiple accounts** can be created / listed / switched from the Settings tab
  (`GET`/`POST /api/accounts`, `PUT /api/account/current`; active account in an `app_settings`
  pointer), and accounts can be **deleted** (`DELETE /api/accounts/:id`, transactional cascade;
  guarded against deleting the only or the active account). The `RSN` env var only seeds the first
  account. Real **auth/login** + hosting still pending.
- ⚪ Hosting decision + deployment (its own ADR).
- ⚪ Self-serve onboarding: enter an RSN, get value with no vault and no local setup.

**Exit criteria:** a second person can use a hosted instance with their own account; telemetry
powers a living account history.

---

## Working agreement (how we move between phases)

- **Vertical slices over big bangs.** Ship the thinnest end-to-end version, then iterate.
- **Don't start a phase's features before its enabler lands** (e.g. analytics charts wait for
  SQLite history; the optimizer waits for the prerequisite dataset).
- **Re-evaluate priorities at each phase boundary** — `ideas.md` is a menu, not a queue.
- **Record reversals as ADRs.** If we abandon SQLite or change the data split, write it down.
