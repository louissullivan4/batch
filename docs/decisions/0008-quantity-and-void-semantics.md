# 0008 — Line quantity, void semantics, and where modifiers live

Date: 2026-08-04
Status: accepted

## Context

Three coupled modelling questions that are cheap to decide now and an event-schema migration to
change once real orders exist:

1. Is "2× flat white" **one line with quantity 2**, or two lines?
2. When a barista voids one of those two, what event carries that?
3. A modifier (extra shot, oat milk) — is it part of the line, or its own event?

## Decision

**One line, quantity N, stable id.** `LineAdded` carries `quantity: bigint`. The line's id is the
`LineAdded` event id — never an array index, because voids and (later) modifiers reference it and
array position is not stable across a rebuild.

**Void is quantity-carrying.** `LineVoided { lineId, quantity?, reason? }`. `quantity` omitted means
"void all remaining"; a value voids that many of the line's units. State tracks `voidedQuantity` per
line; the active quantity a line contributes to totals is `quantity − voidedQuantity`. Voiding every
unit of every line returns the order to zero (property-tested). Rules: the target line must exist,
`quantity` must be ≥ 1, and it may not exceed the units still active — an over-void or a void of an
already-fully-voided line is rejected. `event_log` is append-only, so a void is a new compensating
event, never a mutation of the `LineAdded`.

**Modifiers are embedded in `LineAdded`.** `LineAdded.modifiers` is an array of
`{ modifierId, name, unitPriceMinor, vatRateBp }`, each snapshotting its price and rate at the
moment of sale (non-negotiable #2). A modifier scales with the line quantity and shares the line's
void: voiding units of the line voids their modifiers with them. There is **no `ModifierApplied`
event** in the M1 set — the M1 order events are exactly `OrderOpened`, `LineAdded`, `LineVoided`,
`DiscountApplied`, `OrderTendered`, `OrderClosed`, `OrderRefunded` (seven).

## Consequences

Makes easy: the receipt line "2× Flat White + oat milk … €7.00" is one event; partial void ("make
that one") is one event that references a stable id; VAT bands still work because each modifier
carries its own rate.

Makes hard: changing an existing line's modifiers after it was added. That needs a `ModifierApplied`
event, which we add **only when a screen requires editing a committed line** — not before (it would
be unused scope now, and the eighth event to reason about in every reducer and property test).
Partial-quantity **refund** is likewise deferred; a refund is still whole-amount in M1.

## Alternatives rejected

- **Two lines for "2× flat white".** Doubles the events, and a per-unit void is just deleting a
  line — but then "1× with oat milk, 1× without" and "void one" get fiddly. Quantity + stable id is
  the compact form.
- **`ModifierApplied` as a first-class event now.** Only justified by an edit-an-existing-line UI
  that does not exist in M1. Deferred per the sprint's "do not add scope from later sprints".
- **Whole-line-only void.** Forces "void the line, re-add one" to drop one of two — more events, and
  it loses the intent ("voided one") that a refund audit later wants to see.
