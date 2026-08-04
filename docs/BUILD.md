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
| 1 | ◑ **software-complete; on-device runs pending.** Server: event_log + `POST /v1/sync/events` + high-water/down-pull GETs + exactly-once, RLS, WITH CHECK, append-only — **verified against real Postgres 18**. Till: `@batch/storage` LocalStore (OPFS SQLite-wasm adapter) + outbox (one-txn, UUIDv7, money-as-TEXT, never deleted) + per-event sync client + eviction detect/resync + Vite/React PWA shell (Workbox precaches the shell incl. the wasm + the store worker → cold-loads offline). The OPFS store runs in a **Web Worker** (`@batch/storage/opfs-worker`) — OPFS sync access handles are worker-only in every browser, so the original main-thread adapter opened nowhere (ADR 0005 impl note); the fix was behind the `LocalStore` seam, zero caller changes. Exit criteria 1–5 pass at the **software** level (15 Node device-test proxies + 6 real-PG integration + full HTTP e2e: drain, replay-dedupe, eviction-recover). ⚠️ Not done until the **on-device** runs pass: real iPad airplane-mode / force-quit / two physical devices / cold-load, and the 7-day storage-durability run. |
| 2 | ✅ **done — all 6 exit criteria pass.** Command/event split (`decide` validates → events, `reduce` folds; ADR 0007), quantity-carrying `LineVoided` + modifiers embedded in `LineAdded`, `ModifierApplied` dropped (ADR 0008), plus `Result` + `parseKeypadInput`. Shared reducer imported by both apps — `apps/till/src/order.ts` and `apps/api/src/sync/service.ts` both pull `reduce`/`computeTotals` from the one `@batch/domain` (grep-verified). Property tests at **1000 runs each**: replay=projection, totals non-negative/internally consistent, void-all-to-zero, and the ADR-0007 guarantee (`decide` never emits an event `reduce` throws on); duplicate-eventId rejected. Domain suite **57 tests in ~0.6s** (budget <5s). Server total-check verified against **real Postgres 18** — 7/7 integration incl. a **deliberately-wrong client total rejected and not persisted**. Note: Task 2's "per-line VAT reconcile onto the largest line" is the method **ADR 0004 explicitly rejected** — VAT stays per-band; honoured the ADR over the sprint wording. ⚠️ Reminder: run **DP-01 (design system)** in Claude Design now — Sprint 3 is gated on it. |
| 3 | ◑ **software-complete; on-device runs pending.** Design gate passes 5/5 (DP-01 tokens + DP-02 SPEC/screens; the frontmatter now points at the real `reference/` asset paths). Built on a tested foundation: `gen-tokens.mjs` turns `design/system/tokens.json` into the single-source `tokens.css` (+ `effects.css`, all `color-mix()` over tokens — **zero hex outside the token file**, ESLint-enforced in components); self-hosted Spline Sans (woff2 precached, offline-safe); a seed **menu fixture** (Sprint-6 stub, A-017) mirroring the design grid; pure `order-ops` + `useOrder` routing every mutation through the shared `@batch/domain` reducer (repeat-tap merges to `N×` via void+re-add, append-only). Four designed screens per `SPEC.md`: order entry (no-scroll 4×5 grid, void→confirm strip, long-press defaults, 86'd toast), modifier sheet (shape-encoded groups, zero-tap defaults, edit/remove), cash tender (`parseKeypadInput`, quick-tenders set-not-add, Complete gated on tendered≥total, **fully offline**), on-screen receipt (per-band VAT). Diagnostics drawer preserves the Sprint-1 sync visibility; per-event outbox drain runs **after paint**, never on the order/tender path. Gates: workspace typecheck + lint green, **38 till tests** (incl. the design's €4.10/€4.80/€9.60 lines + a full build→void→tender→close replay), vite PWA build precaches 15 entries (shell+wasm+worker+fonts). **Exit criteria: 5 (no hex) and 6 (touch targets — 64pt primaries, 72pt keypad, 48pt void, grep-verified) PASS here; 1–4 and 7 are on-device/visual — software-complete + instrumented (`perf.ts` budgets) but need a real iPad. Checklist: `docs/sprints/sprint-03-device-checklist.md`.** ⚠️ Not done until the on-device shift + latency + screenshot runs pass. |
| 4 | ◑ **software-complete; all 5 exit criteria PASS at the software level; on-device runs pending.** New `shift` aggregate end to end (ADR 0010): domain reducer + `decide` + variance + X/Z folds (`packages/domain/shift`, **93 domain tests**, 1000-run property), Zod wire schemas widened to an order\|shift union, and the sync spine (`processSyncBatch` + pg store) branching by aggregate so shifts replay through `shift.reduce` — lifecycle invariants (single-open, no-double-close, no-fold-after-Z) enforced **server-side**, no total-check, ledger still rejected. **Verified against real Postgres 18**: full shift lifecycle append, exactly-once replay, a second `ShiftClosed`/a movement-after-Z rejected `SHIFT_CLOSED`, money round-tripping through jsonb as bigint (scratch run + a case in the gated integration suite). Till: five designed screens per `SPEC.md` (shift open · cash movements sheet · blind count · variance · X/Z reports), shared `DenominationCounter`/`PinPad`, `shift-ops.ts` + `useShift.ts` routing every mutation through the shared `shift.decide`/outbox. **PIN auth** is real Argon2id via bundled `hash-wasm` (ADR 0009: m=19456,t=2,p=1, PHC, constant-work verify, no network on the path), seeded from a **dev-only** staff fixture (`STAFF_ROSTER` folds to `[]` in prod — Vite tree-shakes every PHC hash out of the bundle, verified by grep; assumption A-018). **Two reviewers ran and their findings were fixed:** security-reviewer (PIN mechanism CLEAR; Finding 1 — fixture must not ship — closed by the dev-gate) and sync-auditor (**SAFE TO MERGE**; Finding 2 — failed drawer commits now roll back the optimistic UI + rethrow so a failed count never reaches variance; Finding 1 — added atomic-rollback + never-deleted outbox tests). Interpretation beyond the letter of the SPEC: the variance-screen close decision is *carried* to the Reports screen and committed by the 1.5s Z-hold (one deliberate seal); "X locked during count" is enforced by navigation (BlindCount is a full-screen takeover, never mounted alongside Reports). **Printable Z report** (task 8, added mid-sprint on request): the sealed Z state offers **Print / Save as PDF** — `window.print()` over a print stylesheet (zero deps, offline; iPad gets AirPrint + "Save to Files → PDF" from one button), rendering a portal'd document (`ZReceipt`) built by the pure `buildZReceipt` snapshot so the paper copy can never disagree with the event log. Gates: workspace typecheck + lint green, **62 till tests** (11 files), PWA build precaches **17 entries** (hash-wasm embeds its Argon2id WASM as base64 in the shell JS — no Workbox glob change). **Exit criteria: #1 (50-order + 3 paid-outs + planted €20 → SHORT €20.00 to the cent, correct count → EXACT — `shift/reconcile.test.ts`), #2 (blind count can't be bypassed — no `expected*` on command/event/state, structural — `blind-count.test.ts` + `BlindCount.tsx`), #3 (Z can't run twice — reducer seal, real-PG + UI hold-gate), #4 (PIN in airplane mode — zero network in `pin.ts`, WASM bundled), #5 (X mutates nothing — pure fold, appends no event) all PASS.** ⚠️ Not done until the on-device runs pass on a real iPad: PIN entry + hold-gesture + a full shift-day (open → sales → movements → count → variance → Z) in airplane mode, per the Sprint-3 device checklist. |
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