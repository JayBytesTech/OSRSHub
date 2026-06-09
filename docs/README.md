# OSRS Hub — Project Docs

Planning and guardrail documents that steer development (especially AI-assisted). Start here.

| Doc | Purpose | Read it when… |
|-----|---------|---------------|
| [PRD.md](./PRD.md) | Vision, personas, prioritized requirements, non-goals, metrics. | Deciding *what* to build or whether an idea is in scope. |
| [ROADMAP.md](./ROADMAP.md) | Phased path from today's v1 to the vision. | Deciding *what's next* and in what order. |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Current vs. target architecture and the migration path. | Deciding *how* to build it / where data lives. |
| [GUARDRAILS.md](./GUARDRAILS.md) | Rules for building (and prompting AI to build) safely. | Before *every* non-trivial change. |
| [decisions/](./decisions/) | Architecture Decision Records (ADRs). | Making or reversing a significant choice. |

## The four foundational decisions (see [ADR 0001](./decisions/0001-foundational-decisions.md))
1. **Audience:** public product eventually → account-scope data from day one.
2. **RuneLite telemetry:** future phase, but design the ingest API for it now.
3. **Data store:** SQLite for structured/time-series data; vault for human notes (optional).
4. **First vision feature:** the Account Dashboard / Home page.

These docs are living. Keep them honest: when reality diverges from the plan, update the doc
(or write an ADR) — don't let them rot into fiction.

## Canonical source & vault mirror

**This `docs/` folder is canonical.** Edit these files. A read-only mirror is published into
the Obsidian vault (`Gaming/OSRS/Hub Docs/`) for comfortable reading — those copies are
**generated** and any manual edit there is overwritten.

After changing a doc, push the mirror:

```bash
npm run sync-docs
```

`scripts/sync-docs.js` reads `VAULT_PATH` from `.env`, transforms each file (adds Obsidian
frontmatter, rewrites relative links into `[[wiki-links]]`), and writes it into the vault.
Add a new doc by appending one entry to the `DOCS` map in that script.

### Automatic sync on commit (optional)

A committed pre-commit hook (`scripts/hooks/pre-commit`) runs `sync-docs` automatically
whenever a commit touches `docs/`. It's **non-blocking** — if the vault is unavailable the
commit still succeeds. Enable it once per clone (Git doesn't track `core.hooksPath`):

```bash
git config core.hooksPath scripts/hooks
```
