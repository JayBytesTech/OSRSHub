# Guardrails — Building OSRS Hub with AI Assistance

This is the rulebook for how the Hub is built, especially when an AI coding assistant is
doing the typing. Its job is to keep fast, AI-assisted iteration from quietly drifting away
from the [PRD](./PRD.md) and [ARCHITECTURE](./ARCHITECTURE.md). When in doubt, these win.

> **One-line test for any change:** *Does it serve a PRD goal, fit the target architecture,
> and leave the app working?* If not, it goes on the backlog — not into `main`.

---

## 1. Product guardrails

- **Stay a decision-making dashboard, not a wiki clone.** Link the OSRS Wiki; don't reimplement it.
- **Every feature must trace to a PRD requirement** (F-number) or be added to the PRD first.
- **No gameplay automation, ever.** Telemetry is *passive read-only*. No botting, no client control.
- **No RWT / gambling / account-trading features.**
- **Respect scope order.** Don't build Phase N+1 features before Phase N's enabler exists
  (see [ROADMAP.md](./ROADMAP.md)).

## 2. Architecture guardrails

- **Account-scoped from day one (ADR D1).** New tables/records carry `account_id`. No new code
  may assume a single global player. Reads go through `getCurrentAccount()`.
- **Data ownership split (ADR D3):** structured/time-series → **SQLite**; human notes/journal →
  **vault (optional)**. Never make a core feature *require* the vault to exist.
- **Evolve, don't rewrite.** Prefer the smallest change that works. No speculative rewrites
  "for cleanliness." Refactor `server.js` into `routes/services/data/integrations` only when it
  crosses the pain threshold (~600 lines or a 3rd domain), not preemptively.
- **No speculative infrastructure.** No microservices, queues, ORM, Docker/k8s, or client-framework
  migration until a concrete need forces it — and document that need in an ADR.
- **Significant or hard-to-reverse decisions get an ADR** in `docs/decisions/` before coding.

## 3. Security & data guardrails

- **All filesystem access stays path-confined** (the `safeVaultPath()` pattern). Never read/write
  outside the configured roots; reject paths that escape.
- **Secrets only in `.env`** (already git-ignored). Never commit keys. Never log the Anthropic key
  or any token. Don't echo secrets into error responses.
- **Validate and bound all external input** — request bodies, query params, and (later) telemetry
  payloads. Assume the network is hostile once anything is hosted.
- **Be a polite API citizen.** Keep caches (GE prices 60s TTL, mapping once/process), send a
  descriptive `User-Agent`, and respect upstream rate limits and terms (Hiscores, Wiki, Anthropic).
- **No PII beyond what the product needs.** An RSN and progression data is the ceiling for now.

## 4. Code quality guardrails

- **Keep the `SKILL_NAMES` contract intact** until Phase 1 retires it: the array in `server.js`
  and `public/index.html` must stay positionally in sync (Hiscores history columns depend on it).
- **`public/index.html` is hand-edited source of truth** — edit it directly; don't regenerate from
  the retired `scripts/port-hub.js` (it's destructive and one-off).
- **Endpoints keep stable response shapes** across the SQLite migration; change storage, not contracts.
- **Small, reviewable commits.** One concern per commit. A change that touches storage *and* UI
  *and* a new feature should be split.
- **Don't add a dependency to save a few lines.** Justify every new package; prefer the platform.
- **Match existing style** (CommonJS, the current formatting). Don't reformat unrelated code.

## 5. Rules specifically for AI-assisted changes

When prompting an assistant (or acting as one) on this repo:

- **Read `CLAUDE.md`, this file, and the relevant PRD section before writing code.**
- **State which F-requirement and phase a change serves** in the PR/commit description.
- **Make the smallest viable change** and stop — don't opportunistically refactor neighboring code,
  rename things, or "improve" unrelated files unless asked.
- **Surface architecture-affecting choices instead of silently picking one.** If a task implies a
  new dependency, a new data store, an auth approach, or a schema change, propose it (and write an
  ADR) rather than just doing it.
- **Never weaken a guardrail to make a task easier.** If a guardrail blocks the task, that's a
  conversation, not a workaround.
- **Verify the app still runs** (`npm start`) and existing tabs still work before declaring done.
  There's no test suite yet, so manual verification is the safety net — add tests as the value grows.
- **Preserve the security boundaries** (`safeVaultPath`, secret handling) without exception.

## 6. Definition of done (per change)

A change is done when:
1. It serves a stated PRD requirement and fits the target architecture.
2. The app starts and all existing tabs work (no regressions).
3. Secrets, path-confinement, and account-scoping rules are intact.
4. Any significant decision is captured in an ADR.
5. The commit is small, focused, and describes *what* and *why*.

---

*These guardrails are themselves a living document. Loosening one is allowed — but do it
deliberately, in a commit that says why, not by accident in the middle of a feature.*
