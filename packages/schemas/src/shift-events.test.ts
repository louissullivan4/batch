import { describe, it, expect } from 'vitest'
import { shift } from '@batch/domain'
import { ShiftEventSchema } from './shift-events'
import { SyncRequestSchema } from './sync'
import { toWire } from './serialize'

// UUIDv7-shaped ids (version nibble 7) — these must survive validation.
const SHIFT_ID = '0190b4c2-1e3a-7c8d-8f2a-1b2c3d4e5f70'
const E_OPEN = '0190b4c2-1e3a-7000-8000-0000000000a1'
const E_COUNT = '0190b4c2-1e3a-7000-8000-0000000000a2'
const E_CLOSE = '0190b4c2-1e3a-7000-8000-0000000000a3'
const OCC = '2026-08-04T08:00:00.000Z'

const openedWire = {
  eventId: E_OPEN,
  aggregateId: SHIFT_ID,
  occurredAt: OCC,
  eventType: 'ShiftOpened',
  payload: { deviceId: 'device-A', openedByStaffId: 'staff-1', currency: 'EUR' },
}

const countWire = {
  eventId: E_COUNT,
  aggregateId: SHIFT_ID,
  occurredAt: OCC,
  eventType: 'CashDeclared',
  payload: {
    purpose: 'COUNT',
    countSeq: '1',
    denominations: [
      { denominationMinor: '500', count: '4' },
      { denominationMinor: '200', count: '5' },
    ],
    countedMinor: '3000',
  },
}

describe('ShiftEventSchema parsing', () => {
  it('parses wire strings into bigint money, counts, and denomination counts', () => {
    const parsed = ShiftEventSchema.parse(countWire)
    if (parsed.eventType !== 'CashDeclared') throw new Error('unreachable')
    expect(parsed.payload.countSeq).toBe(1n)
    expect(parsed.payload.countedMinor).toBe(3000n)
    expect(parsed.payload.denominations[0]!.denominationMinor).toBe(500n)
    expect(parsed.payload.denominations[0]!.count).toBe(4n)
    expect(typeof parsed.payload.countedMinor).toBe('bigint')
  })

  it('accepts a UUIDv7 event id (which z.string().uuid() would reject)', () => {
    expect(ShiftEventSchema.safeParse(openedWire).success).toBe(true)
  })

  it('parses a signed (negative) variance on ShiftClosed', () => {
    const closeWire = {
      eventId: E_CLOSE,
      aggregateId: SHIFT_ID,
      occurredAt: OCC,
      eventType: 'ShiftClosed',
      payload: {
        zNumber: 'device-A-1',
        closedByStaffId: 'staff-1',
        finalCountSeq: '1',
        varianceMinor: '-2000',
        reasonCodes: ['TILL_ERROR'],
        authorised: false,
      },
    }
    const parsed = ShiftEventSchema.parse(closeWire)
    if (parsed.eventType !== 'ShiftClosed') throw new Error('unreachable')
    expect(parsed.payload.varianceMinor).toBe(-2000n)
    expect(parsed.payload.authorised).toBe(false)
  })

  it('rejects money written as a JSON number', () => {
    const bad = { ...countWire, payload: { ...countWire.payload, countedMinor: 3000 } }
    expect(ShiftEventSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects an unknown event type', () => {
    expect(ShiftEventSchema.safeParse({ ...openedWire, eventType: 'Nope' }).success).toBe(false)
  })

  it('has no expected* field on a parsed CashDeclared payload (blind-count integrity)', () => {
    const parsed = ShiftEventSchema.parse(countWire)
    if (parsed.eventType !== 'CashDeclared') throw new Error('unreachable')
    const keys = Object.keys(parsed.payload)
    expect(keys.some((k) => k.toLowerCase().startsWith('expected'))).toBe(false)
  })
})

describe('wire round-trip (domain -> toWire -> parse)', () => {
  it('reproduces a CashDeclared event with its denomination counts crossing as strings', () => {
    const domainEvent: shift.ShiftEvent = {
      eventId: E_COUNT,
      aggregateId: SHIFT_ID,
      occurredAt: OCC,
      eventType: 'CashDeclared',
      payload: {
        purpose: 'COUNT',
        countSeq: 2n,
        denominations: [{ denominationMinor: 500n, count: 3n }],
        countedMinor: 1500n,
      },
    }
    const wire = toWire(domainEvent) as { payload: { countedMinor: unknown; denominations: { count: unknown }[] } }
    expect(wire.payload.countedMinor).toBe('1500') // string on the wire
    expect(wire.payload.denominations[0]!.count).toBe('3')
    expect(ShiftEventSchema.parse(toWire(domainEvent))).toEqual(domainEvent)
  })

  it('reduces parsed wire shift events through the domain reducer', () => {
    const events = [openedWire, countWire].map((w) => ShiftEventSchema.parse(w))
    const state = shift.reduceShift(events)
    expect(state.status).toBe('OPEN')
    expect(state.maxCountSeq).toBe(1n)
  })
})

describe('sync spine carries a shift event', () => {
  it('a shift event round-trips through the widened SyncRequest union', () => {
    const req = SyncRequestSchema.parse({
      events: [
        { aggregateType: 'shift', event: openedWire },
        { aggregateType: 'shift', event: countWire },
      ],
    })
    expect(req.events).toHaveLength(2)
    const second = req.events[1]!.event
    if (second.eventType !== 'CashDeclared') throw new Error('unreachable')
    expect(second.payload.countedMinor).toBe(3000n)
  })

  it('still accepts an order event through the same union', () => {
    const orderOpen = {
      eventId: E_OPEN,
      aggregateId: SHIFT_ID,
      occurredAt: OCC,
      eventType: 'OrderOpened',
      payload: { currency: 'EUR', fulfilment: 'EAT_IN' },
    }
    expect(SyncRequestSchema.safeParse({ events: [{ aggregateType: 'order', event: orderOpen }] }).success).toBe(true)
  })
})
