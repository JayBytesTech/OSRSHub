# OSRS Hub — Product Requirements Document

- **Owner:** Jay
- **Status:** Living document (v0.1)
- **Last updated:** 2026-06-09
- **Related:** [ROADMAP.md](./ROADMAP.md) · [ARCHITECTURE.md](./ARCHITECTURE.md) · [GUARDRAILS.md](./GUARDRAILS.md) · [decisions/](./decisions/)

> A PRD is a contract with yourself. It exists to keep AI-assisted development pointed at
> the right thing and to make "no" easy. When a feature idea arrives, it should fit a goal
> below or it goes on the backlog — not into `main`.

---

## 1. Vision

> **OSRS Hub is a decision-making dashboard, not a wiki clone.**
> It answers one question better than anything else: **"What should I do next on my account?"**

Most OSRS sites tell you *what exists*. The Hub tells you *what to do*, grounded in **your**
real stats, quests, gear, and goals. The endgame is a personal OSRS assistant that turns a
sprawling account into a clear, motivating roadmap — and eventually does the same for others.

## 2. Problem statement

Account progression in OSRS is a giant dependency graph (quests gate quests, levels gate
quests, quests/levels gate diaries and unlocks). Players juggle this across the wiki,
spreadsheets, and memory. There is no single place that takes *your current state* and tells
you the optimal, prerequisite-aware next steps — or shows your progress climbing over time.

## 3. Personas

| Persona | Description | Needs |
|---------|-------------|-------|
| **Primary — "The Owner" (Jay / Nullyn Voyd)** | Active player optimizing one main account. | At-a-glance status, prerequisite-aware goals, "what next", money analytics, journaling. |
| **Secondary — "The Optimizer"** (future public user) | Efficiency-minded player who'd adopt a hosted version. | Same, but self-serve: enter an RSN, get value with no local setup or vault. |
| **Tertiary — "The Telemetry Power User"** (future) | Runs RuneLite, wants a living account history. | Automatic XP/loot/KC/bank tracking and timelines via the plugin. |

Build for the Owner first; never make a choice that *blocks* the Optimizer (ADR D1).

## 4. Goals & success metrics

**Product goals**
1. **Clarity** — open the app and know your account status in <5 seconds.
2. **Direction** — always have a credible, prerequisite-aware "do this next" answer.
3. **Momentum** — make long-term progress visible and satisfying over weeks/months.
4. **Grounded** — recommendations use *real* account data + verified wiki facts, not guesses.

**Success signals (personal phase)**
- The Owner opens the Hub before deciding what to play ≥ most sessions.
- Goals on the board reflect what's actually being worked on.
- "What next" suggestions are ones the Owner agrees with and acts on.

**Success signals (public phase, later)**
- A new user enters an RSN and reaches a useful dashboard with zero local setup.
- Returning users come back to watch their Account Value score climb.

## 5. Current state (v1 baseline — what already exists)

Tabs: **Skills, Quests, Progress, Money, AI Journey, Goals, Chat.**
- Live OSRS Hiscores with a daily history snapshot.
- Quest tracking with filters (ready / to-do / done / F2P / P2P / mini) and completion state.
- Money methods + **live GE-price-driven GP/hr** computation.
- A Claude chat agent with vault tools (search/read/append) + optional web search.
- Obsidian vault as the durable store (markdown + JSON blocks).

This baseline is the launchpad. The roadmap *extends* it; it does not throw it away.

## 6. Feature requirements (prioritized)

Priority = **P0** (foundation, do first) → **P3** (later/vision). Each feature lists intent
and acceptance criteria. Detailed sequencing lives in [ROADMAP.md](./ROADMAP.md).

### P0 — Foundations
**F0.1 Persistence layer (SQLite alongside vault)** *(enabler, ADR D3)*
- Structured/time-series data in SQLite; vault retained for human notes. Migrations + a thin
  repository layer. Existing endpoints keep their response shapes.
- *Done when:* stats history, goals, and quest state read/write through SQLite; vault still
  holds journaling; no regression in existing tabs.

**F0.2 Account scoping** *(enabler, ADR D1)*
- Every record carries `account_id`; a `getCurrentAccount()` seam returns the single current
  account. No feature code assumes a global player.
- *Done when:* `RSN` is read from the account record, not a global constant.

**F0.3 Account Dashboard / Home** *(first vision feature, ADR D4)*
- A single landing page summarizing: combat level, total level, quest points, diary %,
  collection-log % (when available), bank value (manual or telemetry), active goals, and
  recent progress deltas.
- *Done when:* opening the app shows an at-a-glance status card without clicking into tabs.

### P1 — The differentiators
**F1.1 Goal system with auto-prerequisites**
- Goals (e.g. Quest Cape, Fire Cape, Base 70s, 100M bank) that **decompose into requirements**
  and show live completion against real stats/quests. Clicking a goal expands prerequisites.
- *Done when:* adding "Quest Cape" lists outstanding quests/levels derived from data, not typed by hand.

**F1.2 Quest & unlock dependency graph**
- Recursive prerequisite expansion for quests and major unlocks; "can I start this now?" answers.
- *Done when:* a quest shows its full transitive requirement tree with met/unmet state.

**F1.3 "What should I do next?" engine**
- Ranked, prerequisite-aware suggestions based on current stats, quest progress, GP, and goals.
- *Done when:* the dashboard surfaces a short ordered list the Owner finds reasonable and actionable.

### P2 — Depth & analytics
- **F2.1 Money-maker analytics** — historical GP/hr, profit per activity, wealth-over-time charts.
- **F2.2 XP planning** — per-skill current→goal XP remaining and time estimates per method.
- **F2.3 Achievement-diary planner** — per-region remaining requirements.
- **F2.4 Daily/weekly checklist** — battlestaves, herb runs, birdhouses, kingdom, ToG, etc., with resets.
- **F2.5 Account Value score** — a composite progress metric trended over time.

### P3 — Telemetry & living history (RuneLite)
- **F3.1 Telemetry ingest API** — `POST /api/ingest` contract defined early (ADR D2), implemented here.
- **F3.2 RuneLite plugin (passive)** — XP/loot/bank/KC/clue/session capture.
- **F3.3 Boss & collection-log dashboards** — KC, PB, profit, deaths, log completion, missing items.
- **F3.4 Account timeline** — a living feed of level-ups, drops, completions, net-worth changes.

## 7. Non-goals (explicit)

- ❌ A general OSRS wiki / mechanics encyclopedia. We *link* the wiki; we don't reimplement it.
- ❌ Any gameplay automation, botting, or client interaction beyond **passive** telemetry.
- ❌ Real-money trading, gambling, or account-buying features.
- ❌ Social network / feed-for-others features in the personal phase.
- ❌ Speculative scale infrastructure (microservices, queues) before hosting needs it.

## 8. Constraints & guardrails (summary)

Full rules in [GUARDRAILS.md](./GUARDRAILS.md). Headlines:
- Account-scoped data from day one; vault optional; SQLite for structured data.
- Politeness toward external APIs (caching, User-Agent, respect rate limits/ToS).
- Filesystem access stays path-confined; secrets only in `.env`.
- Each change leaves a working app; prefer the smallest viable increment.

## 9. Open questions

- Bank value source before telemetry exists — manual entry, or scrape from a user-provided
  export? (Hiscores does not expose bank value.)
- Frontend modularization trigger and tool choice (needs its own ADR when the time comes).
- Collection-log data source pre-telemetry — is there a reliable read path, or manual only?
- Hosting model for the public phase (self-host vs managed) and its auth approach.

## 10. Glossary

- **Vault** — the user's Obsidian markdown directory (`VAULT_PATH`).
- **RSN** — RuneScape name used for Hiscores lookups.
- **GP/hr** — gold pieces earned per hour for a money-making method.
- **Telemetry** — passive game-state data sent from the future RuneLite plugin.
- **ADR** — Architecture Decision Record (see `docs/decisions/`).
