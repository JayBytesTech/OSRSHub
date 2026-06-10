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

- ⚪ **F1.1** Goal system with auto-prerequisites (goals decompose into live requirement trees).
- ⚪ **F1.2** Quest & unlock dependency graph (recursive, "can I start now?").
- ⚪ Build/curate the prerequisite dataset (quests, skill reqs, unlocks) as structured data.
- ⚪ **F1.3** "What should I do next?" engine — ranked, prerequisite-aware suggestions on the dashboard.

**Exit criteria:** adding a high-level goal yields an accurate outstanding-requirements list,
and the dashboard recommends agreeable next actions.

---

## Phase 4 — Depth & analytics  ⚪
*Make progress measurable and motivating.*

- ⚪ **F2.1** Money-maker analytics: historical GP/hr, profit per activity, wealth-over-time charts.
- 🟢 **F2.2** XP planning: per-skill XP-remaining + time-to-goal per method (curated XP/hr dataset + ad-hoc planner).
- ⚪ **F2.3** Achievement-diary planner (per region).
- 🟢 **F2.4** Daily/weekly checklist with reset timers.
- 🟢 **F2.5** Account Value score, trended over time.
- ⚪ Frontend modularization if/when `index.html` interactivity outgrows hand-editing (ADR first).

**Exit criteria:** the hub shows trends over time, not just current state.

---

## Phase 5 — Telemetry & going public  ⚪
*The living-history layer and the multi-user turn. Largest scope; do last.*

- 🟡 **F3.1** `POST /api/ingest` telemetry contract (ADR D2) — **live via the Dink plugin** (levels,
  quests, loot → `account_events`; quests auto-tick). Custom-plugin payloads (bank, GP/hr) still pending.
- ⚪ **F3.2** RuneLite plugin (passive telemetry: XP, loot, bank, KC, clues, sessions). *Dink covers the
  common events today; a custom plugin is only needed for bank value + true GP/hr.*
- ⚪ **F3.3** Boss & collection-log dashboards (KC, PB, profit, deaths, log completion, missing items).
- 🟡 **F3.4** Account timeline (living feed of level-ups, drops, completions, net-worth changes) —
  timeline tab + dashboard peek live; net-worth changes await the custom plugin.
- ⚪ Real auth + sessions: turn `getCurrentAccount()` into actual accounts.
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
