# Batch — Build Loop

The operating manual for building Batch with Claude Code and Claude Design. Read this before
starting any sprint.

## How a sprint runs

```
  /sprint N
      │
      ├── gate check: node scripts/check-design-gate.mjs N
      │       │
      │       ├── PASS ──► Claude Code reads design/, executes tasks, writes code
      │       │
      │       └── FAIL ──► STOPS. Prints which assets are missing and which
      │                    design prompt to run. Writes no code.
      │
      └── on stop:  /design-brief N  ──►  prints prompt  ──►  paste into Claude Design
                          │
                          └── drop output into design/sprint-NN-*/  ──►  /sprint N again
```

Claude Code will not start a gated sprint without designs, and it will not invent them. That
refusal is the point — a till screen improvised by a coding agent is worse than no screen, because
it looks finished.

## Sprint index

| # | Sprint | Design gate | Prompt | Est. |
|---|---|---|---|---|
| 0 | Foundations | — | — | 12–16h |
| 1 | Sync spine | — | — | 20–30h |
| 2 | Domain model | — | — | 20–25h |
| 3 | Till UI | **YES** | DP-01, DP-02 | 40–50h |
| 4 | Cash & shift | **YES** | DP-03 | 20h |
| 5 | Card payments | **YES** | DP-04 | 25–35h |
| 6 | Back office | **YES** | DP-05 | 25h |

Sprints 0–2 are pure logic and infrastructure — no screens, no gate. **Run DP-01 during Sprint 2.**
It has no code dependency, and having the design system finished when Sprint 3 opens is the
difference between a smooth sprint and a stalled one.

## Sprint status

Update this as you go. Claude Code reads it to know where you are.

| # | Status |
|---|---|
| 0 | ◑ in progress — pnpm/Turbo/strict-TS/ESLint, GitHub Actions CI, Dockerfile.api, event_log migration all done. Outstanding (need the cloud env): Railway + Postgres (EU), nightly pg_dump→R2, the restore drill, wal_level check. |
| 1 | ◑ in progress — event_log schema + `POST /v1/sync/events` + exactly-once done; idempotency, RLS isolation, WITH CHECK and append-only **verified against real Postgres**. The 4 device tests (airplane mode / force-quit / two devices) need the till app (S3) on real hardware. |
| 2 | ◑ in progress — Money, Irish VAT, and the order reducer done and property-tested (replay-equals-projection, totals never negative, void-all-to-zero, duplicate rejected). "The same reducer imported by both apps" completes when the till lands (S3); the API side imports it now. |
| 3 | ☐ not started |
| 4 | ☐ not started |
| 5 | ☐ not started |
| 6 | ☐ not started |

## Rules that hold across every sprint

1. **A sprint is not done until its exit criteria pass.** Not "the code is written" — the criteria
   in the sprint file, verified. Claude Code should report which passed and which didn't rather
   than declaring success.
2. **ADRs before code** for anything listed under `## Decisions` in a sprint file.
3. **No scope from later sprints.** If a task seems to need something from Sprint 5, stub it.
4. **Assumptions get logged.** Any domain call made from general retail knowledge rather than
   something in this repo goes in `docs/assumptions.md` with a falsifier.
5. **The non-negotiables in `CLAUDE.md` outrank anything in a sprint file.** If a sprint task
   appears to require breaking one, stop and ask.