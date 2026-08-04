import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import type { ShiftEvent } from './events'
import { reduceShift } from './reduce'
import { computeVariance, expectedDrawerMinor, sumDenominations } from './variance'
import { xReport, zReport } from './reports'

const SID = 'shift-1'
const OCC = '2026-08-04T08:00:00.000Z'

function open(): ShiftEvent {
  return {
    eventId: 'o',
    aggregateId: SID,
    occurredAt: OCC,
    eventType: 'ShiftOpened',
    payload: { deviceId: 'device-A', openedByStaffId: 'staff-1', currency: 'EUR' },
  }
}

function float(countedMinor: bigint): ShiftEvent {
  return {
    eventId: 'f',
    aggregateId: SID,
    occurredAt: OCC,
    eventType: 'CashDeclared',
    payload: { purpose: 'OPENING_FLOAT', countSeq: 0n, denominations: [], countedMinor },
  }
}

function move(
  eventId: string,
  eventType: 'PaidIn' | 'PaidOut' | 'Skim' | 'SafeDrop',
  amountMinor: bigint,
): ShiftEvent {
  return {
    eventId,
    aggregateId: SID,
    occurredAt: OCC,
    eventType,
    payload: { movementId: eventId, amountMinor, reason: 'r', authStaffId: 'staff-1' },
  }
}

function count(eventId: string, countSeq: bigint, countedMinor: bigint): ShiftEvent {
  return {
    eventId,
    aggregateId: SID,
    occurredAt: OCC,
    eventType: 'CashDeclared',
    payload: { purpose: 'COUNT', countSeq, denominations: [], countedMinor },
  }
}

describe('sumDenominations', () => {
  it('totals value × count exactly', () => {
    expect(
      sumDenominations([
        { denominationMinor: 500n, count: 4n }, // 2000
        { denominationMinor: 200n, count: 3n }, // 600
        { denominationMinor: 5n, count: 7n }, // 35
      ]),
    ).toBe(2635n)
  })

  it('is zero for an empty breakdown', () => {
    expect(sumDenominations([])).toBe(0n)
  })
})

describe('expectedDrawerMinor', () => {
  it('is float + cash sales + paid-in − paid-out − skim − safe-drop', () => {
    const state = reduceShift([
      open(),
      float(10000n),
      move('m1', 'PaidIn', 500n),
      move('m2', 'PaidOut', 2000n),
      move('m3', 'Skim', 1000n),
      move('m4', 'SafeDrop', 3000n),
    ])
    // 10000 + 25000 + 500 − 2000 − 1000 − 3000
    expect(expectedDrawerMinor(state, 25000n)).toBe(29500n)
  })
})

describe('computeVariance', () => {
  it('reports SHORT when counted is under expected', () => {
    expect(computeVariance(9800n, 10000n)).toEqual({ varianceMinor: -200n, direction: 'SHORT' })
  })

  it('reports OVER when counted is above expected', () => {
    expect(computeVariance(10500n, 10000n)).toEqual({ varianceMinor: 500n, direction: 'OVER' })
  })

  it('reports EXACT at parity', () => {
    expect(computeVariance(10000n, 10000n)).toEqual({ varianceMinor: 0n, direction: 'EXACT' })
  })

  it('is symmetric: swapping counted/expected negates the variance and flips direction', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -50000n, max: 50000n }), fc.bigInt({ min: -50000n, max: 50000n }), (a, b) => {
        const forward = computeVariance(a, b)
        const backward = computeVariance(b, a)
        expect(backward.varianceMinor).toBe(-forward.varianceMinor)
        if (forward.direction === 'OVER') expect(backward.direction).toBe('SHORT')
        else if (forward.direction === 'SHORT') expect(backward.direction).toBe('OVER')
        else expect(backward.direction).toBe('EXACT')
      }),
      { numRuns: 1000 },
    )
  })
})

describe('xReport — pure, non-mutating snapshot', () => {
  it('reports the drawer breakdown and does not mutate state', () => {
    const state = reduceShift([
      open(),
      float(10000n),
      move('m1', 'PaidOut', 2000n),
      move('m2', 'PaidIn', 500n),
    ])
    const before = JSON.stringify(state, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
    const r1 = xReport(state, 25000n)
    const r2 = xReport(state, 25000n)
    const after = JSON.stringify(state, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))

    expect(after).toBe(before) // repeatable and non-destructive
    expect(r1).toEqual(r2)
    expect(r1.openingFloatMinor).toBe(10000n)
    expect(r1.paidOutMinor).toBe(2000n)
    expect(r1.paidInMinor).toBe(500n)
    expect(r1.cashSalesMinor).toBe(25000n)
    expect(r1.expectedDrawerMinor).toBe(33500n) // 10000 + 25000 + 500 − 2000
    expect(r1.movementCount).toBe(2)
  })
})

describe('zReport — derived from a CLOSED shift', () => {
  it('rejects an open shift', () => {
    const state = reduceShift([open(), float(10000n)])
    expect(() => zReport(state)).toThrowError(/NOT_CLOSED/)
  })

  it('reconstructs the drawer picture and backs out cash sales from the sealed variance', () => {
    // Expected = 10000 float + 20000 sales − 2000 paid out = 28000. Counted 27800 => SHORT 200.
    const closed: ShiftEvent = {
      eventId: 'z',
      aggregateId: SID,
      occurredAt: OCC,
      eventType: 'ShiftClosed',
      payload: {
        zNumber: 'device-A-1',
        closedByStaffId: 'staff-1',
        finalCountSeq: 1n,
        varianceMinor: -200n,
        reasonCodes: ['TILL_ERROR'],
        authorised: false,
      },
    }
    const state = reduceShift([open(), float(10000n), move('m1', 'PaidOut', 2000n), count('c1', 1n, 27800n), closed])
    const z = zReport(state)
    expect(z.zNumber).toBe('device-A-1')
    expect(z.finalCountSeq).toBe(1n)
    expect(z.countedMinor).toBe(27800n)
    expect(z.varianceMinor).toBe(-200n)
    expect(z.expectedDrawerMinor).toBe(28000n) // counted − variance
    expect(z.cashSalesMinor).toBe(20000n) // backed out: 28000 − 10000 float + 2000 paid out
    expect(z.paidOutMinor).toBe(2000n)
  })
})
