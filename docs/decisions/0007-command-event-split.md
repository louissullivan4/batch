# 0007 — Command/event split: `decide` validates, `reduce` folds

Date: 2026-08-04
Status: accepted

## Context

The order aggregate needs two operations with different obligations:

- Turning an operator intent ("add a flat white", "tender €5") into the event(s) to record. This
  step **validates** and can fail — a line with quantity 0, a refund on an open order, a close with
  money still owed.
- Replaying a stored stream to rebuild state. This step runs every time an order is opened on the
  till and every time the server re-derives a total. It must be **deterministic**.

If validation lives only inside the fold, then a rule tightened tomorrow (say, "discounts may not
exceed 50%") re-runs against *yesterday's* already-accepted events during replay, and a historic
order becomes unopenable. Validation and replay have to be separable.

## Decision

Split the aggregate into two pure functions in `packages/domain/order`:

```ts
decide(state: OrderState | null, command: OrderCommand, ctx: DecideContext): Result<OrderEvent[], DomainError>
reduce(state: OrderState | null, event: OrderEvent): OrderState
```

- `decide` is the **only** place an event is minted from an intent. It validates the command against
  current state and returns either the event(s) to append or a `DomainError` (a `{ code, message }`,
  never a throw). Time and ids are supplied through `ctx` (`eventId`, `aggregateId`, `occurredAt`) —
  `decide` reads no clock and generates no id, so it stays pure and testable (non-negotiable: no
  `Date.now()` / randomness in `packages/domain`).
- `decide` guarantees, by construction, that every event it emits folds cleanly: it builds the
  candidate event and runs it through `reduce`; if `reduce` rejects, `decide` returns that error
  instead of the event. This is asserted by a property test ("`decide` never emits an event that
  `reduce` throws on"). The two can therefore never disagree about what is valid.

### Why `reduce` still throws

In an ideal command-sourced system `reduce` is total and never fails. Batch has an extra
constraint: **the server ingests events generated offline on an untrusted client**, so it cannot
assume a trusted log at append time. `reduce` is that re-validation gate — the API folds each
incoming client event and rejects the batch item on an `OrderReductionError` (see
`apps/api/sync/service.ts`). So `reduce` is *total over the events `decide` can emit and over
already-accepted events*, but retains its throwing behaviour as the ingest guard against a
malicious or buggy client. Replaying a **stored** stream never throws, because every stored event
passed this gate when it was appended — which is what protects historic orders from a future rule
change. New validations belong in `decide`, and in the server's ingest check for genuinely new
event kinds — never as a tightening applied blindly during replay of accepted history.

## Consequences

Makes easy: one validation source (`decide`, backed by `reduce`); a till write path that fails fast
with a friendly `DomainError` before an event id is even minted; a server that re-derives with the
identical code.

Makes hard: two entry points to keep in step. The property test is the guard — if `decide` ever
emits an event `reduce` would reject, the suite fails.

## Alternatives rejected

- **Validate only in `reduce`.** Couples rule changes to replay; a tightened rule breaks historic
  orders. This is the failure mode the split exists to prevent.
- **Make `reduce` total and validate only in `decide`.** Clean in theory, but then the server has no
  domain gate for untrusted client events and would need a third `validate(state, event)` function
  duplicating every rule. Folding-as-validation keeps one rule set.
