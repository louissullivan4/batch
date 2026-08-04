import { createNodeSqliteStore } from '@batch/storage/testing'
import type { LocalStore } from '@batch/storage'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addLine, openOrder } from '../order'
import { appendEvent, appendEvents, listUnsynced, localStats, markRejected, markSynced } from './outbox'
import { migrateLocal } from './schema'

describe('outbox write path', () => {
  let store: LocalStore
  beforeEach(async () => {
    store = createNodeSqliteStore()
    await migrateLocal(store)
  })
  afterEach(async () => {
    await store.close()
  })

  it('writes the event and its outbox row together (one transaction)', async () => {
    const { outgoing } = openOrder({ fulfilment: 'EAT_IN' })
    await appendEvent(store, outgoing)

    const events = await store.select('select event_id from events')
    const outbox = await store.select('select event_id, synced_at from outbox')
    expect(events).toHaveLength(1)
    expect(outbox).toEqual([{ event_id: outgoing.event.eventId, synced_at: null }])
  })

  it('is idempotent on event id: re-appending is a no-op with a stable device_seq', async () => {
    const { outgoing } = openOrder({ fulfilment: 'EAT_IN' })
    const first = await appendEvent(store, outgoing)
    const second = await appendEvent(store, outgoing)

    expect(first.alreadyPresent).toBe(false)
    expect(second.alreadyPresent).toBe(true)
    expect(second.deviceSeq).toBe(first.deviceSeq)
    const rows = await store.select<{ n: number }>('select count(*) as n from events')
    expect(rows[0]?.n).toBe(1)
  })

  it('assigns a monotonic device_seq across appends', async () => {
    const { orderId, outgoing: opened } = openOrder({ fulfilment: 'EAT_IN' })
    const a = await appendEvent(store, opened)
    const b = await appendEvent(
      store,
      addLine(orderId, { productId: 'fw', name: 'Flat White', quantity: 1n, unitPriceMinor: 350n, vatRateBp: 1350, fulfilment: 'EAT_IN' }),
    )
    expect(b.deviceSeq).toBe(a.deviceSeq + 1)
  })

  it('appendEvents writes a group atomically with monotonic device_seq', async () => {
    const { orderId, outgoing: opened } = openOrder({ fulfilment: 'EAT_IN' })
    const line = addLine(orderId, {
      productId: 'fw',
      name: 'Flat White',
      quantity: 1n,
      unitPriceMinor: 350n,
      vatRateBp: 1350,
      fulfilment: 'EAT_IN',
    })
    const outcomes = await appendEvents(store, [opened, line])

    expect(outcomes).toHaveLength(2)
    expect(outcomes[1]?.deviceSeq).toBe(outcomes[0]!.deviceSeq + 1)
    const rows = await store.select<{ n: number }>('select count(*) as n from events')
    expect(rows[0]?.n).toBe(2)
    const outbox = await store.select<{ n: number }>('select count(*) as n from outbox where synced_at is null')
    expect(outbox[0]?.n).toBe(2)
  })

  it('appendEvents is idempotent on event id (a re-committed pair is a no-op)', async () => {
    const { outgoing } = openOrder({ fulfilment: 'EAT_IN' })
    await appendEvents(store, [outgoing])
    const second = await appendEvents(store, [outgoing])
    expect(second[0]?.alreadyPresent).toBe(true)
    const rows = await store.select<{ n: number }>('select count(*) as n from events')
    expect(rows[0]?.n).toBe(1)
  })

  it('stores money as TEXT — a value beyond the JS safe range survives losslessly', async () => {
    const { orderId, outgoing: opened } = openOrder({ fulfilment: 'EAT_IN' })
    await appendEvent(store, opened)
    const huge = 9_007_199_254_740_993n
    await appendEvent(
      store,
      addLine(orderId, { productId: 'x', name: 'X', quantity: 1n, unitPriceMinor: huge, vatRateBp: 1350, fulfilment: 'EAT_IN' }),
    )

    const queued = await listUnsynced(store)
    const line = queued.find((q) => q.syncEvent.event.eventType === 'LineAdded')
    // On the wire money is a string; the outbox rebuilds exactly that, no bigint round-trip.
    const payload = line?.syncEvent.event.payload as { unitPriceMinor: string }
    expect(payload.unitPriceMinor).toBe('9007199254740993')
  })

  it('markSynced advances the row but never deletes it; markRejected keeps it queued', async () => {
    const { outgoing } = openOrder({ fulfilment: 'EAT_IN' })
    await appendEvent(store, outgoing)

    await markRejected(store, outgoing.event.eventId, 'TOTAL_MISMATCH')
    let stats = await localStats(store)
    expect(stats.unsyncedCount).toBe(1) // rejection does not remove it

    await markSynced(store, outgoing.event.eventId, '42')
    stats = await localStats(store)
    expect(stats.unsyncedCount).toBe(0)
    const [row] = await store.select<{ synced_at: string; server_seq: string; attempts: number }>(
      'select synced_at, server_seq, attempts from outbox where event_id = ?',
      [outgoing.event.eventId],
    )
    expect(row?.server_seq).toBe('42')
    expect(row?.synced_at).not.toBeNull()
    expect(row?.attempts).toBe(1) // the earlier rejection is still recorded
    // The row is still there — append-only outbox.
    const outboxRows = await store.select<{ n: number }>('select count(*) as n from outbox')
    expect(outboxRows[0]?.n).toBe(1)
  })
})
