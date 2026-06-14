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

## Phase 3 — Differentiators (why this hub is unique)  🟢
*The features that make it an assistant, not a tracker.*

- 🟢 **F1.1** Goal system with auto-prerequisites (goals decompose into live requirement trees).
  Every goal type now decomposes: **quest goals** + the **Quest Cape** preset via the F1.2 engine
  (full transitive requirement tree); **skill goals** into XP-remaining + time-to-go per method
  (the XP planner); and **diary-tier goals** (new) into their missing skills (with ETA) + missing
  quests (each startable-now or blocked), via `diaryTierStatus` + the quest engine. Set a diary
  goal with the 🎯 toggle on any Diaries tier; it shows a decomposition card in Goals, a row in the
  dashboard Active-Goals peek, and drives the "what to do next" ranker (best startable quest in the
  tier, else the nearest missing skill). Persisted via a new `diary_goals` table on the `/api/state`
  path. **Goal templates** (a Templates row in the Goals tab) one-click-expand curated bundles into
  these goal types — Barrows gloves, Fire cape, Base 70/90 combat, All Hard diaries, Song of the
  Elves — skipping anything already met/tracked. **Goal system unified** — **unlock goals** and
  **Combat-Achievement tier goals** are now first-class alongside skill/quest/diary/preset goals:
  ★ any unlock or CA tier to set it as a goal, each decomposes in the Goals tab (unlock goals via the
  unlock engine — missing skills/quests/diaries/sub-unlocks with quest chains; CA tier goals into
  points-to-threshold), shows in the dashboard Active-Goals peek, and drives the "what to do next"
  ranker with goal-specific next steps. Persisted via new `unlock_goals` + `ca_goals` tables on the
  `/api/state` path. Exit criteria met: adding any high-level goal yields an accurate
  outstanding-requirements list.
- 🟢 **F1.2** Quest **dependency graph** (recursive, "can I start now?") — **engine + full dataset + non-quest unlocks live.**
  `buildRequirementTree`/`outstandingFor` expand the whole transitive prerequisite tree (cycle-guarded,
  diamond-deduped) with an ordered to-do list and aggregated skill summary. The prerequisite dataset
  (`public/quest-data.json`) now covers **every quest in the master list (205)** — direct prereqs only
  (the engine recurses), wiki-verified, with skill/QP gates. Deep chains resolve with no unknown holes.
  The master list was **audited against the OSRS Wiki's full quest categories** (MediaWiki API): it
  added the real quests it was missing (incl. grandmasters — Song of the Elves, While Guthix Sleeps,
  The Path of Glouphrie) and the untracked miniquests, removed a non-OSRS entry (Fairy Tale III),
  **excluded unreleased/future quests** (The Blood Moon Rises, The Graveyard, Fallen From Grace), and
  fixed name/skill-key bugs (Vampyre Slayer, The Hand in the Sand, Runecraft→Runecrafting) that were
  silently breaking gates. **Non-quest unlocks now live** — an **Unlocks** tab (`public/unlock-data.json`,
  45 curated high-value unlocks across 6 categories: teleport networks, spellbooks, item/area access, QoL
  diary rewards) where each unlock is a generic requirement node gated ready/locked against the player's
  state — skills, **quest prereqs (delegated to the quest engine, so the full transitive quest tree
  expands inline)**, diary-tier prereqs (`diaryTierStatus`), sub-unlock prereqs (recursive, cycle-guarded),
  and a QP gate. "Have it" is tracked per name via a new `unlock_done` table on the `/api/state` path; a
  dashboard tile and a ranker tier ("Unlock X") surface what you can get now. So "what's the full path to
  this unlock?" is answered for non-quest goals too. Item *upgrade* unlocks remain covered by the Gear tab.
  **Optimal quest order (baseline) live** — a 🧭 "Optimal order" toggle on the Quests tab re-sorts the
  log into the **OSRS Wiki Optimal quest guide** sequence (`public/quest-order.json`, scraped from the
  guide's `data-rowid` order via the MediaWiki API: 193 of the 205 master-list quests sequenced; RFD
  subquests collapsed to one entry at its final step; 12 miniquests the guide doesn't sequence sink to
  the bottom). Each row gets a `#n` position badge, and a **"Next in your optimal path"** banner surfaces
  the first incomplete quest in guide order with its live ready/locked gating and a one-click ✓ Mark done.
  **QP reconciliation** — since no public API exposes which quests a player has done, the Quests tab shows
  a banner comparing the hub's ticked QP against a reference (the true total Dink reports on its last quest
  event — now surfaced via `milestonesSummary().quest` — or a manually-entered in-game QP), counting the
  gap down to zero so you can find quests completed before tracking and confirm when you're back in sync.
- 🟢 **F1.3** "What should I do next?" engine — ranked, prerequisite-aware suggestions on the dashboard.
  **Live** as the "🧭 What to do next" panel: `nextActions()` ranks across tiers — quest-goal next
  steps, Quest Cape, skill goals, **goal-independent opportunity quests**, a **high-leverage
  skill-to-train nudge** (`skillUnlockLeverage` — the skill that solely-blocks the most startable
  quests, with the nearest unlock level + ETA), top money method, and the best diary opportunity.
  Works even with no goals set. The **goal-independent** quest pick now follows the **OSRS Wiki
  optimal-order baseline** (`optimalReadyQuestName` — the earliest *startable* quest in the guide
  sequence, labelled "Next on your optimal quest path #n of 193"), falling back to **reward XP
  magnitude** when the optimal dataset isn't available or only unsequenced miniquests are startable.
  Goal-driven and Quest-Cape picks still rank by reward magnitude (`questRewardXp` parses the
  free-text reward field; `compareQuestValue` is the shared comparator) — so e.g. Monkey Madness I
  (~35k combat XP) is suggested over a trivial quest. Suggestions are **actionable inline** — quest picks carry a
  ✓ (mark complete → panel re-ranks live) and ★ (track as a goal); the skill-leverage nudge carries a
  ★ (add the skill goal) — so the user acts from the dashboard without tab-hopping.

**Exit criteria:** adding a high-level goal yields an accurate outstanding-requirements list,
and the dashboard recommends agreeable next actions.

---

## Phase 4 — Depth & analytics  ⚪
*Make progress measurable and motivating.*

- 🟢 **F2.8** GP / money-goal planner. A **money goal** type in the unified goal system
  (`money_goals` table on the `/api/state` path): set a GP target (with k/m/b shorthand and an
  optional label like "Twisted bow"), and it decomposes into the **fastest money methods available
  now** + **time-to-earn** each, ranked by live GE GP/hr (`bestMoneyMethods`/`methodGphr` reuse the
  Money tab's live-or-estimated rates). Shows a plan card in Goals, a row in the dashboard
  Active-Goals peek, and a ranker tier ("Earn N for X — best method ~rate → ~time"). `fmt()` gained a
  billions tier. No progress bar (the hub can't read liquid GP), so it's an honest "how to earn it" planner.
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
- 🟢 **F2.6** Gear & upgrade path. A Gear tab with curated progression ladders
  (`public/gear-data.json`) where each item is gated ready/locked against live stats + completed
  quests (`gearStatus` reuses the quest/diary engine) and priced via `GET /api/prices` (reuses the GE
  machinery). **Ownership tracking** (a per-item owned checkbox → `gear_owned` table on the
  `/api/state` path) makes "next upgrade" the first un-owned rung above your current best (tagged 🎯
  next, "current" on your best owned), and a ranker tier suggests the cheapest next-rung item you can
  equip now but don't own — dropping out once owned. **Covers every equipment slot** — weapon, helm,
  body, legs, boots, amulet, ring, gloves, shield, and cape per style, plus ranged ammo (**31 ladders
  / 88 items**, grouped by ⚔️/🏹/🔮). Endgame reqs wiki-verified. Optional future: **style-aware
  prioritisation** (lead with your main style) and "next *affordable* upgrade" once bank value lands
  from the custom plugin.
- 🟢 **F2.7** Combat Achievements planner. A "Combat Tasks" tab tracking all **637 CA tasks**
  (`public/ca-data.json`, scraped from the Wiki's `Combat_Achievements/All_tasks` rendered table —
  stable `data-ca-task-id`, monster, name, desc, type, tier) **grouped by boss** (89 groups), with a
  tier filter (Easy→GM), a To-do filter, and task/boss search. Six **tier summary cards** show
  tasks-done and points-earned per tier with a progress bar and the cumulative **reward-unlock point
  threshold** (Easy 41 → Medium 161 → Hard 416 → Elite 1064 → Master 1904 → Grandmaster 2630).
  Completion is tracked **per task id** (manual ticks; the hub can't verify combat capability so there's
  no ready/locked gating), persisted via a new `ca_completions` table on the `/api/state` path. A
  **dashboard tile** (points + pts-to-next-tier) and a **ranker tier** ("N pts to <tier> CA rewards",
  shown once the player is engaged) round it out. **CA tier goals** decompose like diary goals (F1.1),
  CAs **auto-tick from Dink** `COMBAT_ACHIEVEMENT` telemetry (name→id match, unknown names stored but not
  ticked), and a **CA-points reconciliation banner** (mirroring the quest-point one) compares hub-tracked
  points against the plugin-reported total (or a manual entry) so achievements earned before tracking are
  visible — new ones auto-tick going forward.
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
