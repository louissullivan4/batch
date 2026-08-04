import { describe, expect, it } from 'vitest'
import { shift } from '@batch/domain'
import {
  closeShiftOps,
  handoverOps,
  movementOps,
  openShiftOps,
  recordCountOps,
  sumDenominationsMinor,
} from './shift-ops'

const NOTE_50 = { denominationMinor: 5000n, count: 2n } // €100.00
const NOTE_20 = { denominationMinor: 2000n, count: 2n } // €40.00
const COIN_2 = { denominationMinor: 200n, count: 5n } // €10.00

function apply(events: shift.ShiftEvent[], outgoing: readonly { event: shift.ShiftEvent }[]): shift.ShiftEvent[] {
  return [...events, ...outgoing.map((o) => o.event)]
}

describe('sumDenominationsMinor', () => {
  it('is exact bigint arithmetic — Σ denominationMinor × count', () => {
    expect(sumDenominationsMinor([NOTE_50, NOTE_20, COIN_2])).toBe(150_00n)
    expect(sumDenominationsMinor([])).toBe(0n)
  })
})

describe('openShiftOps', () => {
  it('emits ShiftOpened then CashDeclared(OPENING_FLOAT) as an atomic pair', () => {
    const { shiftId, outgoing } = openShiftOps({
      deviceId: 'device-1',
      openedByStaffId: 'staff-aoife',
      denominations: [NOTE_50, NOTE_20, COIN_2],
      countedMinor: 150_00n,
    })
    expect(outgoing.map((o) => o.event.eventType)).toEqual(['ShiftOpened', 'CashDeclared'])
    expect(outgoing.every((o) => o.aggregateType === 'shift')).toBe(true)
    const state = shift.reduceShift(apply([], outgoing))
    expect(state.shiftId).toBe(shiftId)
    expect(state.status).toBe('OPEN')
    expect(state.openingFloatMinor).toBe(150_00n)
    expect(state.floatDeclared).toBe(true)
  })

  it('the single-total fallback passes empty denominations + a typed total', () => {
    const { outgoing } = openShiftOps({
      deviceId: 'device-1',
      openedByStaffId: 'staff-aoife',
      denominations: [],
      countedMinor: 200_00n,
    })
    const state = shift.reduceShift(apply([], outgoing))
    expect(state.openingFloatMinor).toBe(200_00n)
  })
})

describe('recordCountOps', () => {
  it('records a COUNT at the next sequence after the float', () => {
    const opened = openShiftOps({
      deviceId: 'd1',
      openedByStaffId: 's1',
      denominations: [NOTE_50],
      countedMinor: 100_00n,
    })
    let events = apply([], opened.outgoing)
    let state = shift.reduceShift(events)

    const count1 = recordCountOps(state, [NOTE_50, COIN_2], 110_00n)
    expect(count1.event.eventType).toBe('CashDeclared')
    events = apply(events, [count1])
    state = shift.reduceShift(events)
    expect(state.maxCountSeq).toBe(1n)

    // a recount is a NEW CashDeclared, sequence 2 — both persist (ADR 0010)
    const count2 = recordCountOps(state, [NOTE_50], 100_00n)
    events = apply(events, [count2])
    state = shift.reduceShift(events)
    expect(state.maxCountSeq).toBe(2n)
    expect(state.counts.filter((c) => c.purpose === 'COUNT')).toHaveLength(2)
  })
})

describe('movementOps', () => {
  it('builds one of the four movement events, each with a fresh movementId', () => {
    const opened = openShiftOps({ deviceId: 'd1', openedByStaffId: 's1', denominations: [], countedMinor: 100_00n })
    const state = shift.reduceShift(apply([], opened.outgoing))
    const payOut = movementOps(state, 'PayOut', { amountMinor: 12_50n, reason: 'Milk run', authStaffId: 's1' })
    expect(payOut.event.eventType).toBe('PaidOut')
    expect(payOut.event.payload).toMatchObject({ amountMinor: 12_50n, reason: 'Milk run' })
  })
})

describe('handoverOps', () => {
  it('moves currentStaffId without a count', () => {
    const opened = openShiftOps({ deviceId: 'd1', openedByStaffId: 's1', denominations: [], countedMinor: 0n })
    let events = apply([], opened.outgoing)
    let state = shift.reduceShift(events)
    events = apply(events, [handoverOps(state, 's1', 's2')])
    state = shift.reduceShift(events)
    expect(state.currentStaffId).toBe('s2')
  })
})

describe('a full open → sale → count → variance → close → Z replay', () => {
  it('folds cleanly and the Z report matches the committed figures', () => {
    const opened = openShiftOps({
      deviceId: 'device-9',
      openedByStaffId: 'staff-aoife',
      denominations: [{ denominationMinor: 5000n, count: 3n }], // €150 float
      countedMinor: 150_00n,
    })
    let events = apply([], opened.outgoing)
    let state = shift.reduceShift(events)

    // A paid-out mid-shift.
    events = apply(events, [movementOps(state, 'PayOut', { amountMinor: 20_00n, reason: 'Milk run', authStaffId: 'staff-aoife' })])
    state = shift.reduceShift(events)

    // cashSalesMinor supplied by the caller (order aggregate, ADR 0010 seam) — say €80 in cash sales.
    const cashSalesMinor = 80_00n
    const expected = shift.expectedDrawerMinor(state, cashSalesMinor)
    expect(expected).toBe(150_00n + 80_00n - 20_00n) // 210.00

    // Drawer actually holds €205 — €5 short.
    const countedMinor = 205_00n
    events = apply(events, [recordCountOps(state, [], countedMinor)])
    state = shift.reduceShift(events)

    const variance = shift.computeVariance(countedMinor, expected)
    expect(variance.direction).toBe('SHORT')
    expect(variance.varianceMinor).toBe(-5_00n)

    const close = closeShiftOps(state, {
      zNumber: 'device-9-1',
      closedByStaffId: 'staff-aoife',
      finalCountSeq: 1n,
      varianceMinor: variance.varianceMinor,
      reasonCodes: ['Not sure yet'],
      authorised: false,
    })
    events = apply(events, [close])
    state = shift.reduceShift(events)
    expect(state.status).toBe('CLOSED')

    const z = shift.zReport(state)
    expect(z.zNumber).toBe('device-9-1')
    expect(z.varianceMinor).toBe(-5_00n)
    expect(z.countedMinor).toBe(205_00n)
    expect(z.cashSalesMinor).toBe(80_00n)

    // Every further command is rejected — the Z-seal (ADR 0010).
    expect(() =>
      shift.reduce(
        state,
        movementOps(state, 'PayIn', { amountMinor: 1n, reason: 'x', authStaffId: 'a' }).event,
      ),
    ).toThrow()
  })
})

describe('X is a pure fold — appends no event', () => {
  it('xReport does not mutate the event log and is repeatable', () => {
    const opened = openShiftOps({ deviceId: 'd1', openedByStaffId: 's1', denominations: [], countedMinor: 100_00n })
    const events = apply([], opened.outgoing)
    const state = shift.reduceShift(events)
    const eventCountBefore = events.length

    const x1 = shift.xReport(state, 50_00n)
    const x2 = shift.xReport(state, 50_00n)

    // Same input, same output — no hidden counter, no side effect on `state` or `events`.
    expect(x1).toEqual(x2)
    expect(events.length).toBe(eventCountBefore)
    expect(state.appliedEventIds.size).toBe(events.length)
  })
})
