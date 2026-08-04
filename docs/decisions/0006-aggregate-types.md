# 0006 — Event-source three aggregates: order, shift, ledger

Date: 2026-08-04
Status: accepted
Amends: non-negotiable #7 in `CLAUDE.md` (was "exactly two aggregates: order and ledger").

## Context

Non-negotiable #7 fixed the event-sourced aggregates at **order** and **ledger**, with everything
else (products, staff, settings, suppliers) as ordinary CRUD. Cash-drawer / shift activity was
provisionally going to be modelled as `ledger` events (see the comment in the original `event_log`
migration). Working through Sprint 4 (cash & shift), that folds two genuinely different things into
one stream.

A **shift** (a till session: opened, paid in/out, counted, Z-read, closed) has a **real lifecycle and
real invariants** that only make sense as a replayed aggregate:

- a shift cannot be closed twice;
- a Z-read cannot be run twice;
- pay-in/pay-out and the counted float only have meaning *within* one open shift;
- the expected-vs-counted variance is a fold over the shift's own events.

Those are exactly the properties event sourcing exists to enforce by replay. Modelling them as loose
`ledger` entries would push shift invariants into projection code and lose the "can't close twice"
guarantee the reducer gives for free. The `ledger` aggregate, by contrast, is the future
double-entry financial record — a different thing with a different reducer, and one we are **not**
writing yet.

## Decision

- Event-source **three** aggregates: **`order`**, **`shift`**, **`ledger`**.
- **`shift`** earns aggregate status now: it is written starting in Sprint 4, with its own reducer and
  invariants (single open shift per till, no double close, no double Z-read).
- **`ledger`** stays **declared but unwritten** until the finance module. It is allowed in the
  `event_log` CHECK so no migration is needed the day it lands, but no code emits or reduces it yet.
- The `event_log` `aggregate_type` CHECK is widened to `('order','shift','ledger')` **now, while the
  table is empty**. Widening an unenforced, empty constraint is free; doing it later means Postgres
  revalidates every historic row and we coordinate around a live table.
- Non-negotiable #7 in `CLAUDE.md` is updated in the same commit so the rule matches the code instead
  of being quietly violated.

## Consequences

Makes easy: shift logic gets the same replay-correctness and idempotency guarantees as orders; the
`event_log` spine already carries it (nothing new in the sync path); the finance ledger has a home
reserved without being half-built.

Makes hard: "exactly two aggregates" was a useful forcing function against scope creep, and we are
spending one of its teeth. The bar for a *fourth* aggregate stays high — a new aggregate must, like
`shift`, have lifecycle invariants that only replay can enforce. CRUD stays CRUD.

To reverse: aggregate identity is baked into `event_log` rows and the CHECK. Removing `shift` later
means those events must be reinterpreted, not deleted (append-only, #3). Adding it now, while no
`shift` row exists, is the cheap moment — hence doing it in this commit.

## Alternatives rejected

- **Keep two aggregates; model shift as `ledger` events:** loses the shift lifecycle invariants,
  scatters "can't close twice" / "can't Z twice" into projections, and conflates till-session
  bookkeeping with the future double-entry ledger.
- **Make `shift` a CRUD table with a status column:** a mutable `status` throws away the append-only
  audit of exactly when and by whom a shift was paid in/out and closed — the one record a cash
  variance dispute needs. Shifts are an event stream, not a row you overwrite.
- **Widen the CHECK later, when shift ships:** revalidates every existing `event_log` row against the
  new constraint on a live, non-empty table. Free now, a coordinated operation later.
