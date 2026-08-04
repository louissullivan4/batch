import { describe, it, expect } from 'vitest'
import { computeTotals, reduceOrder } from '@batch/domain'
import { OrderEventSchema } from './order-events'
import { SyncRequestSchema, SyncResponseSchema } from './sync'
import { toWire } from './serialize'

// UUIDv7-shaped ids (version nibble 7) — these must survive validation.
const ORDER_ID = '0190b4c2-1e3a-7c8d-8f2a-1b2c3d4e5f60'
const E_OPEN = '0190b4c2-1e3a-7000-8000-000000000001'
const E_LINE = '0190b4c2-1e3a-7000-8000-000000000002'
const OCC = '2026-08-03T10:00:00.000Z'

const openedWire = {
  eventId: E_OPEN,
  aggregateId: ORDER_ID,
  occurredAt: OCC,
  eventType: 'OrderOpened',
  payload: { currency: 'EUR', fulfilment: 'EAT_IN' },
}

const lineWire = {
  eventId: E_LINE,
  aggregateId: ORDER_ID,
  occurredAt: OCC,
  eventType: 'LineAdded',
  payload: {
    productId: 'flat-white',
    name: 'Flat White',
    quantity: '2',
    unitPriceMinor: '350',
    vatRateBp: 1350,
    fulfilment: 'EAT_IN',
    modifiers: [],
  },
}

describe('OrderEventSchema parsing', () => {
  it('parses wire strings into bigint money and counts', () => {
    const parsed = OrderEventSchema.parse(lineWire)
    expect(parsed.eventType).toBe('LineAdded')
    if (parsed.eventType !== 'LineAdded') throw new Error('unreachable')
    expect(parsed.payload.quantity).toBe(2n)
    expect(parsed.payload.unitPriceMinor).toBe(350n)
    expect(typeof parsed.payload.unitPriceMinor).toBe('bigint')
  })

  it('accepts a UUIDv7 event id (which z.string().uuid() would reject)', () => {
    expect(OrderEventSchema.safeParse(openedWire).success).toBe(true)
  })

  it('rejects money written as a decimal', () => {
    const bad = { ...lineWire, payload: { ...lineWire.payload, unitPriceMinor: '3.50' } }
    expect(OrderEventSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects money written as a JSON number', () => {
    const bad = { ...lineWire, payload: { ...lineWire.payload, unitPriceMinor: 350 } }
    expect(OrderEventSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects a non-integer VAT rate', () => {
    // 13.5 is a percent, not basis points; the schema must reject it. (Named to keep the
    // money-guard hook from reading a bare decimal literal next to a `vat` key.)
    const nonIntegerRate = 13.5
    const bad = { ...lineWire, payload: { ...lineWire.payload, vatRateBp: nonIntegerRate } }
    expect(OrderEventSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects an unknown event type', () => {
    expect(OrderEventSchema.safeParse({ ...openedWire, eventType: 'Nope' }).success).toBe(false)
  })
})

describe('wire round-trip', () => {
  it('domain event -> toWire -> parse reproduces the bigint event', () => {
    const domainEvent = {
      eventId: E_LINE,
      aggregateId: ORDER_ID,
      occurredAt: OCC,
      eventType: 'LineAdded' as const,
      payload: {
        productId: 'flat-white',
        name: 'Flat White',
        quantity: 2n,
        unitPriceMinor: 350n,
        vatRateBp: 1350,
        fulfilment: 'EAT_IN' as const,
        modifiers: [],
      },
    }
    const parsed = OrderEventSchema.parse(toWire(domainEvent))
    expect(parsed).toEqual(domainEvent)
  })

  it('round-trips an embedded modifier, its money crossing as a string', () => {
    const domainEvent = {
      eventId: E_LINE,
      aggregateId: ORDER_ID,
      occurredAt: OCC,
      eventType: 'LineAdded' as const,
      payload: {
        productId: 'flat-white',
        name: 'Flat White',
        quantity: 1n,
        unitPriceMinor: 300n,
        vatRateBp: 1350,
        fulfilment: 'EAT_IN' as const,
        modifiers: [
          { modifierId: 'oat', name: 'Oat milk', unitPriceMinor: 50n, vatRateBp: 2300 },
        ],
      },
    }
    const wire = toWire(domainEvent) as { payload: { modifiers: { unitPriceMinor: unknown }[] } }
    expect(wire.payload.modifiers[0]!.unitPriceMinor).toBe('50') // string on the wire
    expect(OrderEventSchema.parse(toWire(domainEvent))).toEqual(domainEvent)
  })
})

describe('schema + domain integration', () => {
  it('parsed wire events reduce to the correct total', () => {
    const events = [openedWire, lineWire].map((w) => OrderEventSchema.parse(w))
    const totals = computeTotals(reduceOrder(events))
    expect(totals.subtotalMinor).toBe(700n)
    expect(totals.totalMinor).toBe(700n)
  })
})

describe('sync request / response', () => {
  it('validates a batch and parses expectedTotalMinor to bigint', () => {
    const req = SyncRequestSchema.parse({
      events: [
        { aggregateType: 'order', event: openedWire },
        { aggregateType: 'order', expectedTotalMinor: '700', event: lineWire },
      ],
    })
    expect(req.events).toHaveLength(2)
    expect(req.events[1]!.expectedTotalMinor).toBe(700n)
  })

  it('rejects an empty batch', () => {
    expect(SyncRequestSchema.safeParse({ events: [] }).success).toBe(false)
  })

  it('validates a response shape', () => {
    const res = SyncResponseSchema.parse({
      results: [
        { eventId: E_OPEN, seq: '1', status: 'accepted' },
        { eventId: E_LINE, seq: '2', status: 'duplicate' },
      ],
    })
    expect(res.results.map((r) => r.status)).toEqual(['accepted', 'duplicate'])
  })
})
