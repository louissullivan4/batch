import { describe, expect, it } from 'vitest'
import { shift } from '@batch/domain'
import { openShiftOps, movementOps, recordCountOps, closeShiftOps } from '../../shift-ops'
import { buildZReceipt } from './z-receipt'

/**
 * The Z receipt is assembled from a sealed shift. Build a real one through the shift builders, close
 * it €5 short, and assert the printed document carries the right figures and direction — the paper
 * record must match the sealed log to the cent.
 */
function sealedShortShift(): shift.ShiftState {
  const opened = openShiftOps({
    deviceId: 'device-9',
    openedByStaffId: 'staff-orla',
    denominations: [{ denominationMinor: 5000n, count: 3n }], // €150 float
    countedMinor: 150_00n,
  })
  let events = opened.outgoing.map((o) => o.event)
  let state = shift.reduceShift(events)

  const payOut = movementOps(state, 'PayOut', { amountMinor: 20_00n, reason: 'Milk run', authStaffId: 'staff-orla' })
  events = [...events, payOut.event]
  state = shift.reduceShift(events)

  // expected = 150 float + cash sales − 20 paid out. Count €5 short of that.
  const count = recordCountOps(state, [], 205_00n)
  events = [...events, count.event]
  state = shift.reduceShift(events)

  const close = closeShiftOps(state, {
    zNumber: 'device-9-1',
    closedByStaffId: 'staff-kyle',
    finalCountSeq: 1n,
    varianceMinor: -5_00n,
    reasonCodes: ['Change given wrong'],
    authorised: false,
  })
  events = [...events, close.event]
  return shift.reduceShift(events)
}

describe('buildZReceipt', () => {
  it('carries the sealed figures, resolves names, and reports SHORT to the cent', () => {
    const state = sealedShortShift()
    const receipt = buildZReceipt(state, {
      closedAtISO: '2026-08-04T18:04:00.000Z',
      shopName: 'Test Café',
      resolveStaffName: (id) => (id === 'staff-orla' ? 'Orla' : id === 'staff-kyle' ? 'Kyle' : (id ?? '—')),
    })

    expect(receipt.zNumber).toBe('device-9-1')
    expect(receipt.openedByName).toBe('Orla')
    expect(receipt.closedByName).toBe('Kyle')
    expect(receipt.openingFloatMinor).toBe(150_00n)
    expect(receipt.paidOutMinor).toBe(20_00n)
    expect(receipt.countedMinor).toBe(205_00n)
    expect(receipt.varianceMinor).toBe(-5_00n)
    expect(receipt.direction).toBe('SHORT')
    expect(receipt.expectedDrawerMinor).toBe(receipt.countedMinor - receipt.varianceMinor) // 210.00
    expect(receipt.reasonCodes).toEqual(['Change given wrong'])
    expect(receipt.authorised).toBe(false)
  })

  it('reports EXACT when counted equals expected', () => {
    const opened = openShiftOps({ deviceId: 'd1', openedByStaffId: 's1', denominations: [], countedMinor: 100_00n })
    let events = opened.outgoing.map((o) => o.event)
    let state = shift.reduceShift(events)
    events = [...events, recordCountOps(state, [], 100_00n).event]
    state = shift.reduceShift(events)
    events = [...events, closeShiftOps(state, { zNumber: 'd1-1', closedByStaffId: 's1', finalCountSeq: 1n, varianceMinor: 0n, reasonCodes: [], authorised: true }).event]
    state = shift.reduceShift(events)

    const receipt = buildZReceipt(state, { closedAtISO: '2026-08-04T18:00:00.000Z', shopName: 'x', resolveStaffName: (id) => id ?? '—' })
    expect(receipt.direction).toBe('EXACT')
    expect(receipt.varianceMinor).toBe(0n)
  })
})
