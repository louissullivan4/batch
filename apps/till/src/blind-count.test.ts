/**
 * Blind-count integrity (ADR 0010, exit criterion #2), asserted structurally rather than by
 * convention: the expected drawer figure must not exist as any property on the client at any point
 * before `CashDeclared(COUNT)` commits — not on the command, not on the event, not on the projected
 * `ShiftState`. This test inspects the actual object shapes rather than trusting a comment.
 */

import { describe, expect, it } from 'vitest'
import { shift } from '@batch/domain'
import { movementOps, openShiftOps, recordCountOps } from './shift-ops'

function keysMentioningExpected(value: unknown, seen = new Set<unknown>()): string[] {
  if (value === null || typeof value !== 'object') return []
  if (seen.has(value)) return []
  seen.add(value)
  const found: string[] = []
  for (const [key, v] of Object.entries(value)) {
    if (/expected/i.test(key)) found.push(key)
    found.push(...keysMentioningExpected(v, seen))
  }
  return found
}

describe('blind-count integrity', () => {
  it('the RecordCount command and its CashDeclared event carry no expected* field', () => {
    const opened = openShiftOps({ deviceId: 'd1', openedByStaffId: 's1', denominations: [], countedMinor: 100_00n })
    const state = shift.reduceShift(opened.outgoing.map((o) => o.event))
    const denominations = [{ denominationMinor: 2000n, count: 5n }]
    const countedMinor = 100_00n
    const countEvent = recordCountOps(state, denominations, countedMinor)

    expect(keysMentioningExpected(countEvent)).toEqual([])
    expect(Object.keys(countEvent.event.payload)).toEqual(['purpose', 'countSeq', 'denominations', 'countedMinor'])
  })

  it('ShiftState never carries an expected* field, before OR after a count commits', () => {
    const opened = openShiftOps({ deviceId: 'd1', openedByStaffId: 's1', denominations: [], countedMinor: 100_00n })
    let events = opened.outgoing.map((o) => o.event)
    let state = shift.reduceShift(events)

    // Before any count: no count at all yet.
    expect(keysMentioningExpected(state)).toEqual([])

    // Add a movement — still nothing expected-shaped anywhere on state.
    const movement = movementOps(state, 'PayOut', { amountMinor: 5_00n, reason: 'Milk run', authStaffId: 's1' })
    events = [...events, movement.event]
    state = shift.reduce(state, movement.event)
    expect(keysMentioningExpected(state)).toEqual([])

    // Commit a count — even now, `state` itself carries `countedMinor` only. Expected is computed
    // separately, on demand, by `variance.ts` — never cached on the aggregate.
    const count = recordCountOps(state, [], 90_00n)
    events = [...events, count.event]
    state = shift.reduce(state, count.event)
    expect(keysMentioningExpected(state)).toEqual([])
    expect(state.counts[0]?.denominations).toBeDefined()
    for (const c of state.counts) {
      expect(Object.keys(c)).toEqual(['purpose', 'countSeq', 'denominations', 'countedMinor'])
    }

    // Expected is only ever obtainable by calling the dedicated pure function, after the fact.
    const expected = shift.expectedDrawerMinor(state, 0n)
    expect(expected).toBe(95_00n) // 100 float − 5 paid out
  })
})
