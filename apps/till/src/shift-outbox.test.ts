/**
 * The shift path through the shared local event/outbox core (`sync/outbox.ts`) — mirrors
 * `sync/outbox.test.ts`, which covers the same write path for order events. `useShift` is a thin
 * React wrapper over exactly this call sequence (optimistic append, then `commitEvent(s)` off the
 * paint path), so exercising it here at the outbox layer — the same way `useOrder` is exercised via
 * `order-ops.test.ts` + `outbox.test.ts` rather than a hook-level test — covers the write-path
 * guarantee without needing a DOM/hook test harness this repo doesn't otherwise use.
 */

import { createNodeSqliteStore } from '@batch/storage/testing'
import type { Executor, LocalStore } from '@batch/storage'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { shift } from '@batch/domain'
import { appendEvent, appendEvents, markRejected, markSynced } from './sync/outbox'
import { migrateLocal } from './sync/schema'
import { closeShiftOps, movementOps, openShiftOps, recordCountOps } from './shift-ops'

/**
 * Wrap a store so a chosen `execute` inside a transaction throws — to prove the whole group rolls
 * back. Only `transaction` is intercepted; everything else delegates. The `LocalStore.transaction`
 * contract is "commit if it resolves, roll back and rethrow if it throws" (packages/storage).
 */
function failingStore(base: LocalStore, failOn: (sql: string) => boolean): LocalStore {
  return {
    execute: base.execute.bind(base),
    select: base.select.bind(base),
    close: base.close.bind(base),
    transaction: (work) =>
      base.transaction((tx) => {
        const wrapped: Executor = {
          select: tx.select.bind(tx),
          execute: (sql, params) => {
            if (failOn(sql)) throw new Error('injected mid-transaction failure')
            return tx.execute(sql, params)
          },
        }
        return work(wrapped)
      }),
  }
}

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

  it('rolls a multi-event group back atomically: a mid-group failure leaves zero rows', async () => {
    const { outgoing } = openShiftOps({
      deviceId: 'd1',
      openedByStaffId: 's1',
      denominations: [{ denominationMinor: 5000n, count: 3n }],
      countedMinor: 150_00n,
    })
    expect(outgoing).toHaveLength(2) // ShiftOpened + CashDeclared(float)

    // Fail the SECOND event's insert-into-events, mid-transaction, after the first has been written.
    let eventInserts = 0
    const poisoned = failingStore(store, (sql) => {
      if (/insert\s+into\s+events/i.test(sql)) {
        eventInserts += 1
        return eventInserts === 2
      }
      return false
    })

    await expect(appendEvents(poisoned, outgoing)).rejects.toThrow(/injected/)

    // The already-written first event must NOT survive — the group committed as a unit or not at all.
    const evs = await store.select<{ n: number }>('select count(*) as n from events')
    expect(evs[0]?.n).toBe(0)
    const ob = await store.select<{ n: number }>('select count(*) as n from outbox')
    expect(ob[0]?.n).toBe(0)
  })

  it('never deletes: markSynced/markRejected advance the outbox row, they do not remove it', async () => {
    const { outgoing } = openShiftOps({ deviceId: 'd1', openedByStaffId: 's1', denominations: [], countedMinor: 100_00n })
    await appendEvents(store, outgoing)
    const openEvt = outgoing[0]!
    const floatEvt = outgoing[1]!

    await markSynced(store, openEvt.event.eventId, '42')
    await markRejected(store, floatEvt.event.eventId, 'BOOM')

    // Both event rows are still present — the log is append-only regardless of sync outcome.
    const evs = await store.select<{ n: number }>('select count(*) as n from events')
    expect(evs[0]?.n).toBe(2)

    // The synced row advanced (synced_at + server_seq set), it was not removed.
    const synced = await store.select<{ synced_at: string | null; server_seq: string | null }>(
      'select synced_at, server_seq from outbox where event_id = ?',
      [openEvt.event.eventId],
    )
    expect(synced[0]?.synced_at).not.toBeNull()
    expect(synced[0]?.server_seq).toBe('42')

    // The rejected row stays unsynced and visible, with the error recorded for the operator.
    const rejected = await store.select<{ synced_at: string | null; attempts: number; last_error: string | null }>(
      'select synced_at, attempts, last_error from outbox where event_id = ?',
      [floatEvt.event.eventId],
    )
    expect(rejected[0]?.synced_at).toBeNull()
    expect(rejected[0]?.attempts).toBe(1)
    expect(rejected[0]?.last_error).toBe('BOOM')
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
