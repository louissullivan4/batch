import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { extractVatMinor, VAT_REDUCED_BP, VAT_STANDARD_BP, VAT_ZERO_BP } from '../vat'
import type { LineAddedPayload, OrderEvent, OrderOpenedPayload, OrderTenderedPayload } from './events'
import { reduce, reduceOrder } from './reduce'
import { decide, type DecideContext, type OrderCommand } from './decide'
import { computeTotals } from './totals'
import type { OrderState } from './state'

const OID = 'order-1'
const OCC = '2026-08-03T10:00:00.000Z'

// --- Typed event builders ---------------------------------------------------------------------

function opened(eventId = 'e-open', p: Partial<OrderOpenedPayload> = {}): OrderEvent {
  return {
    eventId,
    aggregateId: OID,
    occurredAt: OCC,
    eventType: 'OrderOpened',
    payload: { currency: 'EUR', fulfilment: 'EAT_IN', ...p },
  }
}

function lineAdded(eventId: string, p: Partial<LineAddedPayload> = {}): OrderEvent {
  return {
    eventId,
    aggregateId: OID,
    occurredAt: OCC,
    eventType: 'LineAdded',
    payload: {
      productId: 'prod',
      name: 'Item',
      quantity: 1n,
      unitPriceMinor: 100n,
      vatRateBp: VAT_REDUCED_BP,
      fulfilment: 'EAT_IN',
      modifiers: [],
      ...p,
    },
  }
}

function lineVoided(eventId: string, lineId: string, quantity?: bigint): OrderEvent {
  return {
    eventId,
    aggregateId: OID,
    occurredAt: OCC,
    eventType: 'LineVoided',
    payload: { lineId, ...(quantity !== undefined ? { quantity } : {}) },
  }
}

function tendered(eventId: string, p: Partial<OrderTenderedPayload> = {}): OrderEvent {
  return {
    eventId,
    aggregateId: OID,
    occurredAt: OCC,
    eventType: 'OrderTendered',
    payload: { tenderId: 'tndr', method: 'CASH', amountMinor: 100n, ...p },
  }
}

function closed(eventId: string): OrderEvent {
  return { eventId, aggregateId: OID, occurredAt: OCC, eventType: 'OrderClosed', payload: {} }
}

// --- Example tests ----------------------------------------------------------------------------

describe('happy path', () => {
  it('opens, sells a coffee, tenders cash with change, and closes', () => {
    const events = [
      opened(),
      lineAdded('e-1', { name: 'Flat White', unitPriceMinor: 350n, vatRateBp: VAT_REDUCED_BP }),
      tendered('e-2', { amountMinor: 350n, tenderedMinor: 500n, changeMinor: 150n }),
      closed('e-3'),
    ]
    const state = reduceOrder(events)
    const t = computeTotals(state)

    expect(state.status).toBe('CLOSED')
    expect(t.subtotalMinor).toBe(350n)
    expect(t.totalMinor).toBe(350n)
    expect(t.vatMinor).toBe(extractVatMinor(350n, VAT_REDUCED_BP))
    expect(t.balanceMinor).toBe(0n)
    expect(t.cashTenderedMinor).toBe(500n)
    expect(t.changeMinor).toBe(150n)
  })
})

describe('snapshot / embedded modifiers / bands', () => {
  it('sums line + embedded modifier across quantity and splits VAT into the right bands', () => {
    // 2 × (coffee €3.00 @ 13.5% + extra shot €0.50 @ 23%) — the modifier travels inside LineAdded.
    const events = [
      opened(),
      lineAdded('e-1', {
        quantity: 2n,
        unitPriceMinor: 300n,
        vatRateBp: VAT_REDUCED_BP,
        modifiers: [
          { modifierId: 'm', name: 'Extra shot', unitPriceMinor: 50n, vatRateBp: VAT_STANDARD_BP },
        ],
      }),
    ]
    const t = computeTotals(reduceOrder(events))
    expect(t.subtotalMinor).toBe(700n) // 2*300 + 2*50
    const reduced = t.vatByBand.find((b) => b.vatRateBp === VAT_REDUCED_BP)
    const standard = t.vatByBand.find((b) => b.vatRateBp === VAT_STANDARD_BP)
    expect(reduced?.grossMinor).toBe(600n)
    expect(standard?.grossMinor).toBe(100n)
  })
})

describe('voiding', () => {
  it('voiding every line returns the order to zero', () => {
    const events = [
      opened(),
      lineAdded('e-1', { unitPriceMinor: 500n }),
      lineAdded('e-2', { unitPriceMinor: 250n }),
      lineVoided('e-3', 'e-1'),
      lineVoided('e-4', 'e-2'),
    ]
    const t = computeTotals(reduceOrder(events))
    expect(t.subtotalMinor).toBe(0n)
    expect(t.totalMinor).toBe(0n)
    expect(t.vatMinor).toBe(0n)
  })

  it('voids part of a quantity line, leaving the rest to sell', () => {
    // 3 × €2.00; void 1 → 2 remain → €4.00.
    const events = [
      opened(),
      lineAdded('e-1', { quantity: 3n, unitPriceMinor: 200n, vatRateBp: VAT_STANDARD_BP }),
      lineVoided('e-2', 'e-1', 1n),
    ]
    const t = computeTotals(reduceOrder(events))
    expect(t.subtotalMinor).toBe(400n)
    expect(t.totalMinor).toBe(400n)

    const [line] = reduceOrder(events).lines
    expect(line?.voidedQuantity).toBe(1n)
  })

  it('rejects voiding more units than remain active', () => {
    const events = [
      opened(),
      lineAdded('e-1', { quantity: 2n }),
      lineVoided('e-2', 'e-1', 3n),
    ]
    expect(() => reduceOrder(events)).toThrowError(/VOID_EXCEEDS_ACTIVE/)
  })

  it('rejects voiding an already fully-voided line', () => {
    const events = [opened(), lineAdded('e-1'), lineVoided('e-2', 'e-1'), lineVoided('e-3', 'e-1')]
    expect(() => reduceOrder(events)).toThrowError(/ALREADY_VOIDED/)
  })

  it('rejects voiding a missing line', () => {
    expect(() => reduceOrder([opened(), lineVoided('e-1', 'nope')])).toThrowError(/LINE_NOT_FOUND/)
  })
})

describe('discounts', () => {
  it('applies a percentage discount off the subtotal', () => {
    const events: OrderEvent[] = [
      opened(),
      lineAdded('e-1', { unitPriceMinor: 1000n, vatRateBp: VAT_STANDARD_BP }),
      {
        eventId: 'e-2',
        aggregateId: OID,
        occurredAt: OCC,
        eventType: 'DiscountApplied',
        payload: { discountId: 'd', name: '10% off', kind: 'PERCENT', rateBp: 1000 },
      },
    ]
    const t = computeTotals(reduceOrder(events))
    expect(t.subtotalMinor).toBe(1000n)
    expect(t.discountMinor).toBe(100n)
    expect(t.totalMinor).toBe(900n)
    expect(t.vatMinor).toBe(extractVatMinor(900n, VAT_STANDARD_BP))
  })

  it('an amount discount larger than the subtotal clamps the total at zero', () => {
    const events: OrderEvent[] = [
      opened(),
      lineAdded('e-1', { unitPriceMinor: 500n }),
      {
        eventId: 'e-2',
        aggregateId: OID,
        occurredAt: OCC,
        eventType: 'DiscountApplied',
        payload: { discountId: 'd', name: 'comp', kind: 'AMOUNT', amountMinor: 999n },
      },
    ]
    const t = computeTotals(reduceOrder(events))
    expect(t.totalMinor).toBe(0n)
    expect(t.discountMinor).toBe(500n)
  })
})

describe('lifecycle guards', () => {
  it('rejects any event before OrderOpened', () => {
    expect(() => reduceOrder([lineAdded('e-1')])).toThrowError(/ORDER_NOT_OPENED/)
  })

  it('rejects a second OrderOpened', () => {
    expect(() => reduceOrder([opened('a'), opened('b')])).toThrowError(/ALREADY_OPEN/)
  })

  it('rejects a duplicate event id', () => {
    const dup = lineAdded('same')
    expect(() => reduceOrder([opened(), dup, dup])).toThrowError(/DUPLICATE_EVENT/)
  })

  it('refuses to close an unpaid order', () => {
    const events = [opened(), lineAdded('e-1', { unitPriceMinor: 500n }), closed('e-2')]
    expect(() => reduceOrder(events)).toThrowError(/UNPAID/)
  })

  it('refunds only a closed order', () => {
    const refund: OrderEvent = {
      eventId: 'e-ref',
      aggregateId: OID,
      occurredAt: OCC,
      eventType: 'OrderRefunded',
      payload: { refundId: 'r', amountMinor: 100n },
    }
    expect(() => reduceOrder([opened(), lineAdded('e-1'), refund])).toThrowError(/NOT_CLOSED/)

    const closedEvents = [
      opened(),
      lineAdded('e-1', { unitPriceMinor: 100n }),
      tendered('e-2', { amountMinor: 100n }),
      closed('e-3'),
      refund,
    ]
    const state = reduceOrder(closedEvents)
    expect(state.status).toBe('REFUNDED')
    expect(computeTotals(state).refundedMinor).toBe(100n)
  })
})

// --- Model-based property tests ---------------------------------------------------------------

type Action =
  | {
      t: 'addLine'
      qty: number
      priceMinor: bigint
      rateBp: number
      mode: 'EAT_IN' | 'TAKEAWAY'
      mod: { priceMinor: bigint; rateBp: number } | null
    }
  | { t: 'void'; lineIdx: number; units: number | null }
  | { t: 'discountPct'; rateBp: number }
  | { t: 'discountAmt'; amountMinor: bigint }
  | { t: 'tender'; pct: number }

/** Turn a list of random actions into a stream of only-ever-valid events. */
function buildScenario(fulfilment: 'EAT_IN' | 'TAKEAWAY', actions: Action[]): OrderEvent[] {
  let n = 0
  const nextId = () => `evt-${n++}`
  const events: OrderEvent[] = []
  const push = (event: OrderEvent): string => {
    events.push(event)
    return event.eventId
  }
  // Track each line's total and already-voided quantity so generated voids never exceed what's active.
  const lines: { id: string; qty: bigint; voided: bigint }[] = []

  push(opened(nextId(), { fulfilment }))

  for (const a of actions) {
    switch (a.t) {
      case 'addLine': {
        const id = push(
          lineAdded(nextId(), {
            quantity: BigInt(a.qty),
            unitPriceMinor: a.priceMinor,
            vatRateBp: a.rateBp,
            fulfilment: a.mode,
            modifiers: a.mod
              ? [{ modifierId: 'm', name: 'Extra', unitPriceMinor: a.mod.priceMinor, vatRateBp: a.mod.rateBp }]
              : [],
          }),
        )
        lines.push({ id, qty: BigInt(a.qty), voided: 0n })
        break
      }
      case 'void': {
        const active = lines.filter((l) => l.voided < l.qty)
        if (active.length === 0) break
        const target = active[a.lineIdx % active.length]!
        const remaining = target.qty - target.voided
        const units =
          a.units === null ? remaining : (BigInt(a.units) % remaining) + 1n // in [1, remaining]
        push(lineVoided(nextId(), target.id, a.units === null ? undefined : units))
        target.voided += units
        break
      }
      case 'discountPct':
        push({
          eventId: nextId(),
          aggregateId: OID,
          occurredAt: OCC,
          eventType: 'DiscountApplied',
          payload: { discountId: 'd', name: 'pct', kind: 'PERCENT', rateBp: a.rateBp },
        })
        break
      case 'discountAmt':
        push({
          eventId: nextId(),
          aggregateId: OID,
          occurredAt: OCC,
          eventType: 'DiscountApplied',
          payload: { discountId: 'd', name: 'amt', kind: 'AMOUNT', amountMinor: a.amountMinor },
        })
        break
      case 'tender': {
        const balance = computeTotals(reduceOrder(events)).balanceMinor
        if (balance <= 0n) break
        let amount = (balance * BigInt(a.pct)) / 100n
        if (amount <= 0n) amount = balance
        if (amount > balance) amount = balance
        push(tendered(nextId(), { amountMinor: amount, tenderedMinor: amount, changeMinor: 0n }))
        break
      }
    }
  }
  return events
}

const rateArb = fc.constantFrom(VAT_ZERO_BP, 900, VAT_REDUCED_BP, VAT_STANDARD_BP)
const actionArb: fc.Arbitrary<Action> = fc.oneof(
  fc.record({
    t: fc.constant('addLine' as const),
    qty: fc.integer({ min: 1, max: 5 }),
    priceMinor: fc.bigInt({ min: 0n, max: 2000n }),
    rateBp: rateArb,
    mode: fc.constantFrom('EAT_IN' as const, 'TAKEAWAY' as const),
    mod: fc.option(
      fc.record({ priceMinor: fc.bigInt({ min: 0n, max: 500n }), rateBp: rateArb }),
      { nil: null },
    ),
  }),
  fc.record({
    t: fc.constant('void' as const),
    lineIdx: fc.nat(),
    units: fc.option(fc.nat({ max: 6 }), { nil: null }),
  }),
  fc.record({ t: fc.constant('discountPct' as const), rateBp: fc.integer({ min: 0, max: 5000 }) }),
  fc.record({
    t: fc.constant('discountAmt' as const),
    amountMinor: fc.bigInt({ min: 0n, max: 3000n }),
  }),
  fc.record({ t: fc.constant('tender' as const), pct: fc.integer({ min: 0, max: 100 }) }),
)
const fulfilmentArb = fc.constantFrom('EAT_IN' as const, 'TAKEAWAY' as const)

describe('invariants over random valid streams', () => {
  it('never throws, and totals stay non-negative and internally consistent', () => {
    fc.assert(
      fc.property(fulfilmentArb, fc.array(actionArb, { maxLength: 25 }), (mode, actions) => {
        const events = buildScenario(mode, actions)
        const t = computeTotals(reduceOrder(events))

        expect(t.subtotalMinor >= 0n).toBe(true)
        expect(t.discountMinor >= 0n).toBe(true)
        expect(t.totalMinor >= 0n).toBe(true)
        expect(t.vatMinor >= 0n).toBe(true)
        expect(t.vatMinor <= t.totalMinor).toBe(true)

        const bandVat = t.vatByBand.reduce((s, b) => s + b.vatMinor, 0n)
        const bandGross = t.vatByBand.reduce((s, b) => s + b.grossMinor, 0n)
        expect(bandVat).toBe(t.vatMinor)
        expect(bandGross).toBe(t.totalMinor) // discount pushed onto bands sums back exactly
        for (const b of t.vatByBand) expect(b.netMinor + b.vatMinor).toBe(b.grossMinor)
      }),
      { numRuns: 1000 },
    )
  })

  it('is a deterministic fold — incremental equals all-at-once (replay = projection)', () => {
    fc.assert(
      fc.property(fulfilmentArb, fc.array(actionArb, { maxLength: 25 }), (mode, actions) => {
        const events = buildScenario(mode, actions)
        let state: OrderState | null = null
        for (const e of events) state = reduce(state, e)
        expect(state).toEqual(reduceOrder(events))
      }),
      { numRuns: 1000 },
    )
  })

  it('voiding every line fully returns the order to zero', () => {
    fc.assert(
      fc.property(fulfilmentArb, fc.array(actionArb, { maxLength: 25 }), (mode, actions) => {
        const base = buildScenario(mode, actions)
        // Void every line still active, in full.
        const state = reduceOrder(base)
        let n = base.length
        const voids: OrderEvent[] = []
        for (const line of state.lines) {
          if (line.voidedQuantity < line.quantity) voids.push(lineVoided(`v-${n++}`, line.lineId))
        }
        const t = computeTotals(reduceOrder([...base, ...voids]))
        expect(t.subtotalMinor).toBe(0n)
        expect(t.totalMinor).toBe(0n)
        expect(t.vatMinor).toBe(0n)
      }),
    )
  })
})

// --- Command/event split (ADR 0007) -----------------------------------------------------------

const ctx = (aggregateId: string, eventId = 'cmd-evt'): DecideContext => ({
  eventId,
  aggregateId,
  occurredAt: OCC,
})

describe('decide (command → events)', () => {
  it('builds a full order end to end, each command folding cleanly', () => {
    // A holder object rather than a bare `let` — reassignment inside the `apply` closure keeps the
    // type as `OrderState | null` for the assertions below (a closure-mutated `let` narrows to null).
    const box: { state: OrderState | null } = { state: null }
    let seq = 0
    const apply = (command: OrderCommand, aggregateId: string) => {
      const result = decide(box.state, command, ctx(aggregateId, `c-${seq++}`))
      expect(result.ok).toBe(true)
      if (!result.ok) return
      for (const ev of result.value) box.state = reduce(box.state, ev)
    }

    apply({ type: 'OpenOrder', fulfilment: 'EAT_IN' }, OID)
    apply(
      { type: 'AddLine', productId: 'p', name: 'Flat White', quantity: 1n, unitPriceMinor: 350n, vatRateBp: VAT_REDUCED_BP, fulfilment: 'EAT_IN' },
      OID,
    )
    apply({ type: 'Tender', tenderId: 't', method: 'CASH', amountMinor: 350n, tenderedMinor: 350n, changeMinor: 0n }, OID)
    apply({ type: 'CloseOrder' }, OID)

    expect(box.state?.status).toBe('CLOSED')
    expect(box.state && computeTotals(box.state).totalMinor).toBe(350n)
  })

  it('returns an error (never throws) for an invalid command', () => {
    const state = reduceOrder([opened(), lineAdded('e-1', { unitPriceMinor: 500n })])
    const result = decide(state, { type: 'VoidLine', lineId: 'missing' }, ctx(OID))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('LINE_NOT_FOUND')
  })

  it('rejects closing an unpaid order as a DomainError, not a throw', () => {
    const state = reduceOrder([opened(), lineAdded('e-1', { unitPriceMinor: 500n })])
    const result = decide(state, { type: 'CloseOrder' }, ctx(OID))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('UNPAID')
  })

  // The core ADR-0007 guarantee: decide never emits an event that reduce throws on.
  type CommandSpec =
    | { k: 'add' }
    | { k: 'voidFirst'; units: number | null }
    | { k: 'discountPct'; rateBp: number }
    | { k: 'discountAmt'; amountMinor: bigint }
    | { k: 'tenderAll' }
    | { k: 'close' }
    | { k: 'refund'; amountMinor: bigint }

  const commandArb: fc.Arbitrary<CommandSpec> = fc.oneof(
    fc.constant({ k: 'add' as const }),
    fc.record({ k: fc.constant('voidFirst' as const), units: fc.option(fc.nat({ max: 4 }), { nil: null }) }),
    fc.record({ k: fc.constant('discountPct' as const), rateBp: fc.integer({ min: 0, max: 10000 }) }),
    fc.record({ k: fc.constant('discountAmt' as const), amountMinor: fc.bigInt({ min: 0n, max: 5000n }) }),
    fc.constant({ k: 'tenderAll' as const }),
    fc.constant({ k: 'close' as const }),
    fc.record({ k: fc.constant('refund' as const), amountMinor: fc.bigInt({ min: 0n, max: 5000n }) }),
  )

  function toCommand(spec: CommandSpec, state: OrderState): OrderCommand {
    switch (spec.k) {
      case 'add':
        return { type: 'AddLine', productId: 'p', name: 'X', quantity: 2n, unitPriceMinor: 250n, vatRateBp: VAT_REDUCED_BP, fulfilment: state.fulfilment }
      case 'voidFirst': {
        const target = state.lines[0]
        return {
          type: 'VoidLine',
          lineId: target?.lineId ?? 'missing',
          ...(spec.units === null ? {} : { quantity: BigInt(spec.units) }),
        }
      }
      case 'discountPct':
        return { type: 'ApplyDiscount', discount: { discountId: 'd', name: 'p', kind: 'PERCENT', rateBp: spec.rateBp } }
      case 'discountAmt':
        return { type: 'ApplyDiscount', discount: { discountId: 'd', name: 'a', kind: 'AMOUNT', amountMinor: spec.amountMinor } }
      case 'tenderAll': {
        const bal = computeTotals(state).balanceMinor
        return { type: 'Tender', tenderId: 't', method: 'CARD', amountMinor: bal > 0n ? bal : 1n }
      }
      case 'close':
        return { type: 'CloseOrder' }
      case 'refund':
        return { type: 'RefundOrder', refundId: 'r', amountMinor: spec.amountMinor }
      default:
        return { type: 'CloseOrder' }
    }
  }

  it('never emits an event that reduce throws on', () => {
    fc.assert(
      fc.property(
        fulfilmentArb,
        fc.array(actionArb, { maxLength: 15 }),
        commandArb,
        (mode, actions, spec) => {
          const state = reduceOrder(buildScenario(mode, actions))
          const command = toCommand(spec, state)
          const result = decide(state, command, ctx(state.orderId))
          if (result.ok) {
            let s: OrderState | null = state
            for (const ev of result.value) {
              expect(() => {
                s = reduce(s, ev)
              }).not.toThrow()
            }
          }
        },
      ),
      { numRuns: 1000 },
    )
  })
})
