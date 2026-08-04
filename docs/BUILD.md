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
| 0 | ✅ done (code/tooling) — pnpm/Turbo/strict-TS/ESLint, GitHub Actions CI, Dockerfile.api, event_log migration. ⚠️ Not yet done, needs the cloud account: Railway + Postgres (EU), nightly pg_dump→R2, the restore drill, wal_level check. |
| 1 | ◑ **software-complete; on-device runs pending.** Server: event_log + `POST /v1/sync/events` + high-water/down-pull GETs + exactly-once, RLS, WITH CHECK, append-only — **verified against real Postgres 18**. Till: `@batch/storage` LocalStore (OPFS SQLite-wasm adapter) + outbox (one-txn, UUIDv7, money-as-TEXT, never deleted) + per-event sync client + eviction detect/resync + Vite/React PWA shell (Workbox precaches the shell incl. the wasm → cold-loads offline). Exit criteria 1–5 pass at the **software** level (15 Node device-test proxies + 6 real-PG integration + full HTTP e2e: drain, replay-dedupe, eviction-recover). ⚠️ Not done until the **on-device** runs pass: real iPad airplane-mode / force-quit / two physical devices / cold-load, and the 7-day storage-durability run. |
| 2 | ✅ **done — all 6 exit criteria pass.** Command/event split (`decide` validates → events, `reduce` folds; ADR 0007), quantity-carrying `LineVoided` + modifiers embedded in `LineAdded`, `ModifierApplied` dropped (ADR 0008), plus `Result` + `parseKeypadInput`. Shared reducer imported by both apps — `apps/till/src/order.ts` and `apps/api/src/sync/service.ts` both pull `reduce`/`computeTotals` from the one `@batch/domain` (grep-verified). Property tests at **1000 runs each**: replay=projection, totals non-negative/internally consistent, void-all-to-zero, and the ADR-0007 guarantee (`decide` never emits an event `reduce` throws on); duplicate-eventId rejected. Domain suite **57 tests in ~0.6s** (budget <5s). Server total-check verified against **real Postgres 18** — 7/7 integration incl. a **deliberately-wrong client total rejected and not persisted**. Note: Task 2's "per-line VAT reconcile onto the largest line" is the method **ADR 0004 explicitly rejected** — VAT stays per-band; honoured the ADR over the sprint wording. ⚠️ Reminder: run **DP-01 (design system)** in Claude Design now — Sprint 3 is gated on it. |
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