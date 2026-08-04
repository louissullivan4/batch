# 0010 — Shift aggregate: drawer session, blind-count integrity, Z-seal

Date: 2026-08-04
Status: accepted
Builds on: ADR 0006 (shift is an event-sourced aggregate), ADR 0007 (command/event split).
Scope: Sprint 4.

## Context

ADR 0006 granted `shift` aggregate status but did not fix its event set or its invariants. Sprint 4
implements it. Three modelling questions are irreversible once shift rows exist in the append-only
`event_log`, so they are settled here before code.

1. **What is a shift event vs. what is computed?**
2. **How is the blind count kept blind** — structurally, not by UI discipline?
3. **How is expected cash reconciled**, given cash *sales* live in the `order` aggregate, not `shift`?

## Decision

### Event set

The shift aggregate is a **drawer session**. Its events:

- `ShiftOpened` — `{ shiftId, deviceId, openedByStaffId, currency }`. First event; a device has at
  most one open shift (enforced by the reducer).
- `CashDeclared` — `{ purpose: 'OPENING_FLOAT' | 'COUNT', countSeq, denominations, countedMinor }`.
  Reused for the opening float *and* every drawer count. `countSeq` is 0 for the float, then 1, 2, …
  for successive counts (recounts are new events, both kept — SPEC screen 3). It carries **counted**
  cash only. It never carries *expected* — see integrity below.
- `PaidIn` / `PaidOut` / `Skim` / `SafeDrop` — `{ movementId, amountMinor, reason, authStaffId }`.
  `amountMinor > 0`; `reason` **required** (a movement without a reason is unreconcilable). PaidIn
  adds to the drawer; the other three remove from it. A correction is a reversing movement, never an
  edit (append-only).
- `ShiftHandover` — `{ fromStaffId, toStaffId }`. Drawer stays open, no count (SPEC).
- `ShiftClosed` — `{ zNumber, closedByStaffId, finalCountSeq, varianceMinor, reasonCodes,
  authorised }`. The Z-read. Terminal: seals the aggregate.

**No `XReported` event.** The X report is a **pure fold over current shift state** and appends
nothing — this is exactly why exit criterion "X does not mutate any state" holds by construction.
The "#N this shift" X counter is session-local (resets on reload); persisting it is not worth an
event, and an appended audit row would violate the criterion's letter. Z is the only report that
writes.

### Blind-count integrity (structural, not procedural)

- The **expected** figure is never a property, field, cache, or hidden element on the client during a
  count. The count screen renders from denomination-grid state only. Expected is computed **after**
  `CashDeclared(COUNT)` commits, by folding the shift's events. There is nothing to inspect via dev
  tools, a screen reader, or a shoulder-peek.
- `CashDeclared` payloads contain `countedMinor`, never `expectedMinor`. The variance screen is the
  first place expected appears, derived at render from the committed log.
- A recount is a new `CashDeclared(COUNT, countSeq+1)`. Both counts persist; the back office sees
  "count 2 after count 1" — the honest deterrent against typing the number you just saw, since a
  recount is visible, not because the UI prevents it.

### Expected cash — the cross-aggregate seam

Cash *sales* are `order`-aggregate `OrderTendered{method:'CASH'}` events, not shift events. The shift
reducer stays **pure over its own events**. Expected drawer cash is a separate pure function:

```
expectedDrawerMinor(shift, cashSalesMinor) =
    openingFloatMinor
  + cashSalesMinor            // supplied by the caller
  + Σ PaidIn − Σ PaidOut − Σ Skim − Σ SafeDrop
```

`cashSalesMinor` is supplied by the caller: the till sums CASH tenders since `ShiftOpened` from its
local order store (a device has exactly one open shift, so every cash tender while open belongs to
it — no `shiftId` stamp on orders is needed this sprint). Variance = `countedMinor − expected`;
positive is **over** (▲), negative is **short** (▼). This keeps the shift reducer replay-pure while
the reconciliation, which genuinely spans two aggregates, is an explicit function of both inputs.

We do **not** stamp `shiftId` onto order events this sprint (avoids churning the order schema and the
order sync path). Attributing historic sales to shifts in the back office is a future concern; logged
as an assumption.

### Z-seal and numbering

- `ShiftClosed` is terminal: the reducer rejects **every** event (including a second `ShiftClosed`)
  after it. "Z runs once" is a replay invariant, not a UI guard — the SPEC's hold-to-confirm is
  ergonomics on top of a structural seal.
- `zNumber` is **per-device sequential** (`{deviceId}-{n}`), assigned by counting prior `ShiftClosed`
  events for the device. Per-device (not server-global) so numbering integrity survives offline —
  a Z runs fully offline and its number is stable before it ever syncs.
- Closing requires a committed final count (`CashDeclared(COUNT)` exists) — the reducer rejects a
  close with no count. `authorised` records whether a manager PIN cleared an over-threshold variance
  (SPEC screen 4); an unauthorised over-threshold close is still allowed (never block a close at 6pm)
  and simply flagged.

## Consequences

Makes easy: "can't close twice", "can't Z twice", "can't move cash after Z" are free from replay;
blind count has no client-side expected to leak; offline Z numbering is stable.

Makes hard: expected-cash reconciliation is not a single-aggregate fold — a caller must supply
`cashSalesMinor`. That coupling is explicit and tested rather than hidden. Cross-shift sales
attribution is deferred.

To reverse: shift event shapes are baked into append-only rows. The cheap moment to fix the model is
now, before any shift row exists. Adding fields later is additive; renaming/removing is a
reinterpretation, never a delete (#3).

## Alternatives rejected

- **`XReported` audit event:** would let the X counter survive reloads, but appends state on a
  "read", brushing against the exit criterion and adding no reconciliation value. Rejected — X stays
  a pure fold.
- **Snapshot `expectedMinor` into `CashDeclared`:** puts the expected figure on the client before the
  variance screen — the exact leak blindness must prevent. Rejected outright.
- **Fold cash sales inside the shift reducer** (subscribe shift to order events): breaks aggregate
  purity and single-stream replay. The scalar-parameter seam keeps each reducer over its own stream.
- **Server-global Z numbering:** needs the network at close time; a café closing offline could not
  get a number. Per-device sequence is offline-stable and still unique with the device id.
