---
sprint: 2
name: domain
title: Domain model
requires_design: false
design_assets: []
design_prompt: null
estimate_hours: 20-25
---

# Sprint 2 — Domain model

**Goal:** every rule about money, tax and order state exists once, in `packages/domain`, imported
by both the till and the API.

**Prerequisite:** Sprint 1 exit criteria pass — all four sync tests green on real hardware.

## Design gate

None. This sprint is pure logic.

**But start DP-01 (design system) in Claude Design now, in parallel.** It has no code dependency,
and Sprint 3 is gated on it. Doing it during this sprint is free; doing it after Sprint 2 costs you
a stall.

## Decisions — ADRs before code

Run `/adr` on each. Both are expensive to reverse once events exist.

**ADR: command/event split**
```ts
decide(state, command): Result<Event[], DomainError>   // validates, can fail
reduce(state, event): State                            // replays, cannot fail
```
Validation lives in `decide`. `reduce` assumes a trusted log. Without the split, validation runs
during replay — and when a rule changes, a merchant's historic order becomes unopenable.

**ADR: quantity and void semantics**
Is "2× flat white" one line with `qty: 2` or two lines? Recommended: one line with quantity, and
`LineVoided` carries a quantity so you can void one of two. Lines get stable client-generated IDs —
never array position, because voids reference them.

## Tasks

**1. `packages/domain/money.ts`**
- `Money = { amountMinor: bigint; currency: 'EUR' }`
- Constructors `euro(major, minor)`, `minor(bigint)`, `zero()` — nothing else builds a `Money`
- `add`, `sub`, `mulByQty`, `negate`, `compare`, `isZero`
- `format(money)` directly from `bigint` — no float round-trip
- `parseKeypadInput(string)` → `Result<Money>`, rejecting ambiguous input
- `splitEvenly(money, n)` and `allocate(money, ratios)` — each with its rounding policy in a
  comment above it and asserted in a test

**2. `packages/domain/vat.ts`**
- Rates as basis points. 13.5% is `1350`.
- `extractVatFromGross(grossMinor, rateBp)` — Irish menu prices are VAT-inclusive, so tax comes
  out of a gross figure. The net-to-gross formula gives a small, plausible, wrong number.
- `resolveVatRateBp(product, fulfilmentMode)` — build the fulfilment dependency now even though
  M1 is counter-service only. Retrofitting it means rewriting every historic projection.
- Per-line VAT, then reconcile the sum against order-level and push any single-cent difference
  onto the largest line

**3. `packages/schemas/events/order.ts`**

M1 event set, Zod schemas, discriminated on `eventType`:
`OrderOpened` · `LineAdded` · `LineVoided` · `DiscountApplied` · `OrderTendered` · `OrderClosed` ·
`OrderRefunded`

Embed modifiers inside `LineAdded`. Add `ModifierApplied` only when the UI needs to change an
existing line — not before.

Every payload snapshots its values: `unitPriceMinor`, `vatRateBp`, product name, modifier names.
No references to mutable rows.

**4. `packages/domain/order/reduce.ts` and `decide.ts`**
- Exhaustive over event types with a `never` assertion in the default branch
- Pure — time and IDs are passed in, never read from ambient
- `OrderState` tracks applied event IDs for the order's lifetime (orders are short; this is cheap
  defence in depth on top of the database constraint)

**5. `packages/domain/order/reduce.test.ts`**

Property tests with `fast-check`:
- replay-equals-projection over random valid sequences
- totals never negative
- voiding every line returns the order to zero
- a duplicate `eventId` is rejected, not silently absorbed
- `decide` never emits an event that `reduce` throws on

**6. Wire server-side verification in `apps/api/sync/`**

The server replays the same reducer and rejects a client total mismatch.

## Exit criteria

- [ ] The identical reducer module is imported by both `apps/till` and `apps/api` — verified by
      grep, not assumed
- [ ] Property tests pass on 1000+ generated sequences
- [ ] Every money-dividing function has a documented rounding policy and a test asserting it
- [ ] `apps/api` rejects a deliberately wrong client total in an integration test
- [ ] `pnpm --filter @batch/domain test` runs in under 5 seconds
- [ ] Both ADRs written

## Do not

- Add `ModifierApplied`, order-level discounts beyond a flat amount, split-bill logic, or refund
  partial-quantity handling. Those arrive with the screens that need them.
- Put any I/O, `Date.now()`, or randomness inside `packages/domain`.
