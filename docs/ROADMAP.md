# Roadmap — From v1 to the Vision

Phased path from today's working app to the [PRD](./PRD.md) vision. Sequencing honors
[ARCHITECTURE.md](./ARCHITECTURE.md): **evolve, don't rewrite; every phase ships a working app.**

Phases are ordered by dependency, not calendar. Expect heavy iteration *within* each phase —
this is a discovery process, so treat checklists as hypotheses, not commitments.

Legend: 🟢 done · 🟡 in progress · ⚪ not started

---

## Where we are (June 2026)

The **personal decision-dashboard vision (PRD P0–P2) is delivered**: open the app and you get an
at-a-glance dashboard, prerequisite-aware goals that decompose into live requirement trees, a
"what to do next" engine, and depth tabs (XP/diary/CA/gear/money planners, trends, checklist,
Account Value).

The **telemetry layer (PRD P3) is largely built and *overshot* its original scope.** What was
scoped as "a passive plugin for bank value" became:
- an **in-house RuneLite plugin that fully replaces Dink** — all 11 event categories on a native
  `events/1` feed (ADR 0005);
- **live session analytics Dink never could provide** — XP/hr & GP/hr over idle-gated active time,
  per-skill gains, and XP-correlated gathered-resource counts (ADR 0006);
- **one-login account onboarding** via a baseline scan of skills/quests/diaries/stats/CAs (ADR 0003);
- a **one-way SQLite → Obsidian "Live" projection** so chat/AI always reads current data (ADR 0004);
- **multi-account** identity/switch/delete.

What remains is **finishing & hardening** the telemetry/onboarding story (collection log, scan
verification, tests, Dink decommission) and **the public turn** (auth + hosting + self-serve).

---

## Phase 0 — v1 baseline ✅
The launchpad: Skills/Quests/Progress/Money/AI Journey/Goals/Chat tabs, live Hiscores + daily
history, live GE prices → GP/hr, the Claude vault agent, vault-as-source-of-truth.

## Phase 1 — Foundations: SQLite + account scoping ✅
- 🟢 **F0.1** SQLite + migration runner + repository layer; one-time vault→SQLite import; history,
  quest state, and goals moved to SQLite (response shapes unchanged); snapshots keyed by skill name.
- 🟢 **F0.2** `account_id` on every table + a `getCurrentAccount()` seam. Vault is now optional (notes
  + money methods + the generated Live note).

## Phase 2 — The Dashboard ✅
- 🟢 **F0.3** Account dashboard as the default landing view — combat, total, QP, diary %, bank value,
  active goals, recent deltas, plus telemetry tiles (loot, collection log, session).

## Phase 3 — Differentiators ✅
- 🟢 **F1.1** Unified goal system with auto-prerequisites — skill / quest / diary / unlock / CA /
  money goals + one-click templates, each decomposing into live requirement trees.
- 🟢 **F1.2** Quest & unlock dependency graph — recursive, cycle-guarded; full 205-quest wiki-verified
  dataset; optimal-order baseline; QP reconciliation; a 45-unlock catalogue.
- 🟢 **F1.3** "What should I do next?" engine — ranked, prerequisite-aware, actionable inline.

## Phase 4 — Depth & analytics ✅ (one analytics item now unblocked)
- 🟢 **F2.2** XP planning · **F2.3** diary planner (per-task, 492 tasks, all 12 regions) · **F2.4**
  daily/weekly checklist · **F2.5** Account Value score · **F2.6** Gear & upgrade ladders (31/88) ·
  **F2.7** Combat Achievements planner (637 tasks) · **F2.8** GP / money-goal planner.
- 🟡 **F2.1** Money-maker analytics — trends (XP / Account Value / wealth-from-drops / 🏦 bank value)
  are live; **per-activity GP/hr is now unblocked by the session feed (Phase 5)** — close it by
  surfacing session GP/hr per activity. *(moved to Phase 5 remaining work.)*

---

## Phase 5 — Telemetry & living history  🟢 (largely done)
*The living-history layer, via the in-house plugin.*

**Done:**
- 🟢 **F3.1** Ingest contract — native `events/1` handler (`POST /api/events`) + the legacy
  `normalizeDinkEvent` path (`/api/ingest`) retained for transition.
- 🟢 **F3.2** In-house RuneLite plugin (passive; ADRs 0002/0005/0006/0003): **replaces Dink** across
  all 11 categories; **bank value**; **session rates** (XP/hr, GP/hr, per-skill XP, gathered-resource
  counts + values); **baseline scan** (skills/quests/diaries/scalar-stats/CA on login → first-sight
  apply or confirm-diff); **vault Live projection** (ADR 0004).
- 🟢 **F3.3 (partial)** Loot & Wealth, Bosses/kill-tracker, and progression-milestones dashboards;
  Sessions history tab.
- 🟢 **F3.4** Account timeline (living feed) + dashboard peek + session-end recap event.
- 🟢 Multi-account identity / create / switch / delete (Settings).

**Remaining:**
- ⚪ **Collection log** — the deferred baseline-scan section (interface-gated capture on log open) +
  a full item-grid UI (completes F3.3).
- ⚪ **Per-tier dashboards** — clue / CA / death breakdowns; boss personal-best tracking (F3.3).
- ⚪ **Baseline-scan completeness** — live-verify the CA varp decode (needs ≥1 completed CA);
  slayer-task name resolution (creature index → name).
- ⚪ **Close F2.1** — per-activity GP/hr history off the session feed.
- ⚪ **Decommission Dink** — once every category is verified single-owner, remove
  `normalizeDinkEvent` + `/api/ingest`.

**Exit criteria:** telemetry powers a complete living history with no Dink dependency.

---

## Phase 6 — Hardening for the public turn  ⚪ (new)
*Make it robust before strangers depend on it. Mostly invisible; de-risks Phase 7.*

- ⚪ **Automated tests** — start with the data layer (scan reconciliation, session rates/staleness,
  event idempotency, GE/price math). The un-tested quest-scan name bug that corrupted live data
  (June 2026) is the cautionary tale; the throwaway temp-DB verification scripts should become tests.
- ⚪ **Frontend modularization** — `public/index.html` is now very large; split it when hand-editing
  starts to hurt (ADR first, per the long-standing note).
- ⚪ **Resilience & states** — robust empty / loading / error states across tabs; graceful behaviour
  when the plugin or hub is offline.
- ⚪ **Data-integrity guards on destructive paths** — e.g. a scan-apply preview/undo (the
  `repair-quest-names.js` incident lesson); backups before bulk mutations.

**Exit criteria:** a regression in a core data flow is caught by a test, not by a user.

---

## Phase 7 — Going public  ⚪ (new)
*The multi-user turn. Largest scope; gated on Phase 6.*

- ⚪ **Hosting decision + deployment** (its own ADR) — self-host vs managed; what the ingest endpoint
  looks like on the public internet.
- ⚪ **Real auth/login + sessions** — turn `getCurrentAccount()` into authenticated accounts.
- ⚪ **Self-serve onboarding** — enter an RSN, reach a useful dashboard with no vault and no local setup.
- ⚪ **Privacy, rate-limiting, abuse/ToS posture** for a public telemetry endpoint.

**Exit criteria:** a second person uses a hosted instance with their own account; telemetry powers a
living account history for them too.

---

## Open questions (updated)

- **Bank value source** — ✅ solved (plugin `POST /api/bank`).
- **Collection-log read path** — partially solved (incremental clog events); the baseline grid needs
  interface-open capture (Phase 5 remaining).
- **Frontend modularization trigger/tool** — now pressing given `index.html` size; needs its own ADR (Phase 6).
- **Hosting model + auth approach** — still open; the first Phase 7 ADR.

---

## Working agreement (how we move between phases)

- **Vertical slices over big bangs.** Ship the thinnest end-to-end version, then iterate.
- **Don't start a phase's features before its enabler lands.**
- **Re-evaluate priorities at each phase boundary** — `ideas.md` is a menu, not a queue.
- **Record significant/hard-to-reverse choices as ADRs** (see `docs/decisions/`).
- **Each change leaves a working app**; verify before claiming done; no synthetic data on the real account.
</content>
