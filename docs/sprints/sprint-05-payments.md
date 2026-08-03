---
sprint: 5
name: payments
title: Card payments — semi-integrated
requires_design: true
design_assets:
  - design/system/tokens.json
  - design/sprint-05-payments/SPEC.md
design_prompt: docs/design-prompts/DP-04-payment-states.md
estimate_hours: 25-35
---

# Sprint 5 — Card payments, semi-integrated

**Goal:** take a real card payment on a real terminal, and be able to swap the provider without
touching anything outside `adapters/`.

**Prerequisite:** Sprint 4 exit criteria pass.

## Design gate — BLOCKING

Requires `design/sprint-05-payments/SPEC.md`. Payment states are where a POS most visibly fails —
declines, timeouts, partial approvals, a customer walking away mid-transaction. These need
designing, not improvising. Run `/design-brief 5`.

## Tasks

**1. `PaymentProvider` interface** in `packages/domain/payments/`
```ts
interface PaymentProvider {
  authorize(amountMinor: bigint, currency: string, ref: string): Promise<Result>
  capture(txId: string): Promise<Result>
  refund(txId: string, amountMinor: bigint): Promise<Result>
  void(txId: string): Promise<Result>
  adjustTip(txId: string, tipMinor: bigint): Promise<Result>
  fetchSettlements(from: Date, to: Date): Promise<Settlement[]>
}
```

**2. `StubProvider` first.** Build the entire tender flow against it, including every failure path.
The real integration then becomes a swap rather than a rewrite.

**3. `StripeTerminalProvider`.** Sandbox reader, then live.

**4. Tender events** — `OrderTendered` extended for card, with `tipMinor` and provider reference.
Split tender: part cash, part card.

**5. Failure paths** — decline, timeout, terminal unreachable, customer cancel, partial approval.
Each needs a defined recovery that leaves the order in a valid state. A terminal timeout must never
strand an order between tendered and closed.

**6. Refunds** — linked to the original tender, role-gated, reason-coded.

**7. Settlement fetch** — pull settlements and store gross, fees and net as separate values. The
finance module later depends on these being distinct from day one.

## Exit criteria

- [ ] Swapping `StubProvider` → `StripeTerminalProvider` requires zero changes outside `adapters/`
- [ ] Every failure path in `SPEC.md` has a test and leaves the order recoverable
- [ ] Card data never appears in logs, SQLite, Postgres, or crash reports — verified by the
      `security-reviewer` agent
- [ ] A real card payment completes on real hardware
- [ ] Settlement records store gross, fees and net separately

## Do not

- Build your own terminal, pursue SoftPOS, or explore PayFac. Years away, and correctly so.
- Store any PAN, CVV, or track data. If you appear to need to, stop and ask.
