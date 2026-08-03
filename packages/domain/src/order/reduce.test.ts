import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { extractVatMinor, VAT_REDUCED_BP, VAT_STANDARD_BP, VAT_ZERO_BP } from '../vat'
import type {
  LineAddedPayload,
  ModifierAppliedPayload,
  OrderEvent,
  OrderOpenedPayload,
  OrderTenderedPayload,
} from './events'
import { OrderReductionError, reduce, reduceOrder } from './reduce'
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
      ...p,
    },
  }
}

function modifierApplied(
  eventId: string,
  p: Partial<ModifierAppliedPayload> & { lineId: string },
): OrderEvent {
  return {
    eventId,
    aggregateId: OID,
    occurredAt: OCC,
    eventType: 'ModifierApplied',
    payload: {
      modifierId: 'mod',
      name: 'Extra',
      unitPriceMinor: 50n,
      vatRateBp: VAT_STANDARD_BP,
      ...p,
    },
  }
}

function lineVoided(eventId: string, lineId: string): OrderEvent {
  return {
    eventId,
    aggregateId: OID,
    occurredAt: OCC,
    eventType: 'LineVoided',
    payload: { lineId },
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

describe('snapshot / modifiers / bands', () => {
  it('sums line + modifier across quantity and splits VAT into the right bands', () => {
    // 2 × (coffee €3.00 @ 13.5% + extra shot €0.50 @ 23%)
    const events = [
      opened(),
      lineAdded('e-1', { quantity: 2n, unitPriceMinor: 300n, vatRateBp: VAT_REDUCED_BP }),
      modifierApplied('e-2', { lineId: 'e-1', unitPriceMinor: 50n, vatRateBp: VAT_STANDARD_BP }),
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

  it('rejects voiding a line twice', () => {
    const events = [opened(), lineAdded('e-1'), lineVoided('e-2', 'e-1'), lineVoided('e-3', 'e-1')]
    expect(() => reduceOrder(events)).toThrowError(OrderReductionError)
  })

  it('rejects modifying a missing line', () => {
    expect(() => reduceOrder([opened(), modifierApplied('e-1', { lineId: 'nope' })])).toThrowError(
      /LINE_NOT_FOUND/,
    )
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
  | { t: 'addLine'; qty: number; priceMinor: bigint; rateBp: number; mode: 'EAT_IN' | 'TAKEAWAY' }
  | { t: 'modify'; lineIdx: number; priceMinor: bigint; rateBp: number }
  | { t: 'void'; lineIdx: number }
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
  const lines: { id: string; voided: boolean }[] = []

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
          }),
        )
        lines.push({ id, voided: false })
        break
      }
      case 'modify': {
        const active = lines.filter((l) => !l.voided)
        if (active.length === 0) break
        const target = active[a.lineIdx % active.length]!
        push(
          modifierApplied(nextId(), {
            lineId: target.id,
            unitPriceMinor: a.priceMinor,
            vatRateBp: a.rateBp,
          }),
        )
        break
      }
      case 'void': {
        const active = lines.filter((l) => !l.voided)
        if (active.length === 0) break
        const target = active[a.lineIdx % active.length]!
        push(lineVoided(nextId(), target.id))
        target.voided = true
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
  }),
  fc.record({
    t: fc.constant('modify' as const),
    lineIdx: fc.nat(),
    priceMinor: fc.bigInt({ min: 0n, max: 500n }),
    rateBp: rateArb,
  }),
  fc.record({ t: fc.constant('void' as const), lineIdx: fc.nat() }),
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
    )
  })

  it('is a deterministic fold — incremental equals all-at-once', () => {
    fc.assert(
      fc.property(fulfilmentArb, fc.array(actionArb, { maxLength: 25 }), (mode, actions) => {
        const events = buildScenario(mode, actions)
        let state: OrderState | null = null
        for (const e of events) state = reduce(state, e)
        expect(state).toEqual(reduceOrder(events))
      }),
    )
  })
})
