/**
 * The shift path through the shared local event/outbox core (`sync/outbox.ts`) — mirrors
 * `sync/outbox.test.ts`, which covers the same write path for order events. `useShift` is a thin
 * React wrapper over exactly this call sequence (optimistic append, then `commitEvent(s)` off the
 * paint path), so exercising it here at the outbox layer — the same way `useOrder` is exercised via
 * `order-ops.test.ts` + `outbox.test.ts` rather than a hook-level test — covers the write-path
 * guarantee without needing a DOM/hook test harness this repo doesn't otherwise use.
 */

import { createNodeSqliteStore } from '@batch/storage/testing'
import type { LocalStore } from '@batch/storage'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { shift } from '@batch/domain'
import { appendEvent, appendEvents } from './sync/outbox'
import { migrateLocal } from './sync/schema'
import { closeShiftOps, movementOps, openShiftOps, recordCountOps } from './shift-ops'

describe('shift events through the local outbox', () => {
  let store: LocalStore
  beforeEach(async () => {
    store = createNodeSqliteStore()
    await migrateLocal(store)
  })
  afterEach(async () => {
    await store.close()
  })

  it('writes ShiftOpened + CashDeclared(float) as one atomic append, tagged aggregate_type=shift', async () => {
    const { outgoing } = openShiftOps({
      deviceId: 'device-1',
      openedByStaffId: 'staff-aoife',
      denominations: [{ denominationMinor: 5000n, count: 3n }],
      countedMinor: 150_00n,
    })
    await appendEvents(store, outgoing)

    const rows = await store.select<{ aggregate_type: string; event_type: string }>(
      'select aggregate_type, event_type from events order by device_seq',
    )
    expect(rows).toEqual([
      { aggregate_type: 'shift', event_type: 'ShiftOpened' },
      { aggregate_type: 'shift', event_type: 'CashDeclared' },
    ])
    const outbox = await store.select<{ synced_at: string | null }>('select synced_at from outbox')
    expect(outbox.every((r) => r.synced_at === null)).toBe(true)
  })

  it('is idempotent on event id: re-appending a movement is a no-op', async () => {
    const opened = openShiftOps({ deviceId: 'd1', openedByStaffId: 's1', denominations: [], countedMinor: 0n })
    await appendEvents(store, opened.outgoing)
    const state = shift.reduceShift(opened.outgoing.map((o) => o.event))
    const movement = movementOps(state, 'PayOut', { amountMinor: 500n, reason: 'Milk run', authStaffId: 's1' })

    const first = await appendEvent(store, movement)
    const second = await appendEvent(store, movement)
    expect(first.alreadyPresent).toBe(false)
    expect(second.alreadyPresent).toBe(true)

    const rows = await store.select<{ n: number }>("select count(*) as n from events where event_type = 'PaidOut'")
    expect(rows[0]?.n).toBe(1)
  })

  it('the terminal Z-read (CloseShift) commits atomically after a count', async () => {
    const opened = openShiftOps({ deviceId: 'd1', openedByStaffId: 's1', denominations: [], countedMinor: 100_00n })
    await appendEvents(store, opened.outgoing)
    let state = shift.reduceShift(opened.outgoing.map((o) => o.event))

    const count = recordCountOps(state, [], 100_00n)
    await appendEvent(store, count)
    state = shift.reduce(state, count.event)

    const close = closeShiftOps(state, {
      zNumber: 'd1-1',
      closedByStaffId: 's1',
      finalCountSeq: 1n,
      varianceMinor: 0n,
      reasonCodes: [],
      authorised: true,
    })
    await appendEvent(store, close)

    const rows = await store.select<{ event_type: string }>(
      "select event_type from events where event_type = 'ShiftClosed'",
    )
    expect(rows).toHaveLength(1)
  })
})
