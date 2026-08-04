import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { createNodeSqliteStore } from '@batch/storage/testing'
import type { LocalStore } from '@batch/storage'
import { afterEach, describe, expect, it } from 'vitest'
import { addLine, openOrder, orderTotalMinor, tenderCash } from '../order'
import { FakeServer } from './fake-server'
import { appendEvent, localStats } from './outbox'
import { migrateLocal } from './schema'
import { syncOutbox } from './client'
import { uuidv7 } from './ids'
import type { DeviceIdentity, SyncTransport } from './types'

/**
 * The Sprint 1 exit-criteria proxies (1–4). These run the real sync core against a real SQLite
 * (`node:sqlite`) and the FakeServer — the CI stand-ins the sprint file names. "Offline" is a
 * transport that throws; "force-quit" is a store reopened over the same file; "two devices" is two
 * stores against one server. The real airplane-mode / iPad runs are the hardware confirmation.
 */

const id = (): DeviceIdentity => ({ tenantId: uuidv7(), deviceId: uuidv7() })

/** Take a full order (open → line → cash tender) into the local store, offline. Returns the count. */
async function takeOrderOffline(store: LocalStore): Promise<number> {
  const { orderId, outgoing: opened } = openOrder({ fulfilment: 'EAT_IN' })
  await appendEvent(store, opened)
  const line = addLine(orderId, {
    productId: 'flat-white',
    name: 'Flat White',
    quantity: 2n,
    unitPriceMinor: 350n,
    vatRateBp: 1350,
    fulfilment: 'EAT_IN',
  })
  await appendEvent(store, line)
  const priorEvents = [opened.event, line.event]
  const tender = tenderCash(orderId, priorEvents, { tenderedMinor: orderTotalMinor(priorEvents) })
  await appendEvent(store, tender)
  return 3
}

describe('exit criterion 1 — airplane mode', () => {
  let store: LocalStore
  afterEach(async () => store.close())

  it('takes a full order with the network off, queues everything, loses nothing; syncs on reconnect', async () => {
    store = createNodeSqliteStore()
    await migrateLocal(store)
    const server = new FakeServer()
    let online = false
    const transport = server.transportFor(id(), () => online)

    const n = await takeOrderOffline(store)
    expect(n).toBe(3)

    const offlineDrain = await syncOutbox(store, transport)
    expect(offlineDrain.offline).toBe(true)
    expect(offlineDrain.synced).toBe(0)
    expect((await localStats(store)).unsyncedCount).toBe(3) // nothing lost

    online = true
    const onlineDrain = await syncOutbox(store, transport)
    expect(onlineDrain.offline).toBe(false)
    expect(onlineDrain.synced).toBe(3)
    expect((await localStats(store)).unsyncedCount).toBe(0)
    expect(server.size).toBe(3)
  })
})

describe('exit criterion 2 — force-quit', () => {
  const files: string[] = []
  afterEach(() => {
    for (const f of files) rmSync(f, { force: true })
    files.length = 0
  })
  const tempFile = (): string => {
    const f = join(tmpdir(), `till-${uuidv7()}.sqlite`)
    files.push(f)
    return f
  }

  it('a kill before sync keeps the whole outbox on relaunch, then syncs exactly-once', async () => {
    const file = tempFile()
    let store = createNodeSqliteStore(file)
    await migrateLocal(store)
    await takeOrderOffline(store)
    await store.close() // force-quit

    store = createNodeSqliteStore(file) // relaunch, same OPFS-equivalent file
    expect((await localStats(store)).unsyncedCount).toBe(3)

    const server = new FakeServer()
    const drain = await syncOutbox(store, server.transportFor(id()))
    expect(drain.synced).toBe(3)
    expect(server.size).toBe(3)
    await store.close()
  })

  it('a crash after the event reached the server does not double-apply: replay dedupes', async () => {
    const file = tempFile()
    const identity = id()
    const server = new FakeServer()
    let store = createNodeSqliteStore(file)
    await migrateLocal(store)
    await takeOrderOffline(store)

    // The classic torn write: the batch reaches the server, but the process dies before the client
    // records the acknowledgement — so the rows are still queued locally.
    const queued = await store.select<{ event_id: string }>('select event_id from events')
    expect(queued).toHaveLength(3)
    // Send them straight to the server (bypassing markSynced) to model "landed but not acked".
    const { listUnsynced } = await import('./outbox')
    server.post(identity, { events: (await listUnsynced(store)).map((q) => q.syncEvent) })
    expect(server.size).toBe(3)
    await store.close() // crash

    // Relaunch: the outbox still shows all 3 unsynced. A normal drain re-sends them.
    store = createNodeSqliteStore(file)
    expect((await localStats(store)).unsyncedCount).toBe(3)
    const drain = await syncOutbox(store, server.transportFor(identity))
    expect(drain.synced).toBe(3) // all acknowledged...
    expect(server.size).toBe(3) // ...as duplicates — no second copy. Exactly-once.
    expect((await localStats(store)).unsyncedCount).toBe(0)
    await store.close()
  })
})

describe('exit criterion 3 — two devices, one tenant', () => {
  const stores: LocalStore[] = []
  afterEach(async () => {
    await Promise.all(stores.map((s) => s.close()))
    stores.length = 0
  })

  it('both devices, offline then reconnecting, land every event exactly once with no coordination', async () => {
    const tenantId = uuidv7()
    const server = new FakeServer()
    const deviceA: DeviceIdentity = { tenantId, deviceId: uuidv7() }
    const deviceB: DeviceIdentity = { tenantId, deviceId: uuidv7() }

    const mk = async (): Promise<LocalStore> => {
      const s = createNodeSqliteStore()
      await migrateLocal(s)
      stores.push(s)
      return s
    }
    const storeA = await mk()
    const storeB = await mk()

    await takeOrderOffline(storeA)
    await takeOrderOffline(storeB)

    const drainA = await syncOutbox(storeA, server.transportFor(deviceA))
    const drainB = await syncOutbox(storeB, server.transportFor(deviceB))
    expect(drainA.synced).toBe(3)
    expect(drainB.synced).toBe(3)
    expect(server.size).toBe(6) // all six, exactly once

    // A reconnect that re-drains (e.g. both devices retry) adds nothing.
    await syncOutbox(storeA, server.transportFor(deviceA))
    await syncOutbox(storeB, server.transportFor(deviceB))
    expect(server.size).toBe(6)
    expect(server.highWater(deviceA).eventCount).toBe(3)
    expect(server.highWater(deviceB).eventCount).toBe(3)
  })
})

describe('exit criterion 4 — reconnect-replay', () => {
  let store: LocalStore
  afterEach(async () => store.close())

  it('replaying already-delivered events returns duplicate, never a second row', async () => {
    store = createNodeSqliteStore()
    await migrateLocal(store)
    const identity = id()
    const server = new FakeServer()
    const transport: SyncTransport = server.transportFor(identity)

    await takeOrderOffline(store)
    const first = await syncOutbox(store, transport)
    expect(first.synced).toBe(3)
    expect(server.size).toBe(3)

    // Simulate the ambiguous reconnect: the client is unsure the acks landed and re-queues by
    // clearing synced_at, then drains again. The server dedupes on (tenant, event_id).
    await store.execute('update outbox set synced_at = null')
    expect((await localStats(store)).unsyncedCount).toBe(3)
    const replay = await syncOutbox(store, transport)
    expect(replay.synced).toBe(3) // all acknowledged as duplicate
    expect(server.size).toBe(3) // still three — no second copy
  })

  it('a rejected event stays queued and surfaces, never silently dropped', async () => {
    store = createNodeSqliteStore()
    await migrateLocal(store)
    const identity = id()
    const server = new FakeServer()

    // An order whose tender claims the wrong total — the server rejects it (TOTAL_MISMATCH).
    const { orderId, outgoing: opened } = openOrder({ fulfilment: 'EAT_IN' })
    await appendEvent(store, opened)
    const line = addLine(orderId, { productId: 'x', name: 'X', quantity: 1n, unitPriceMinor: 200n, vatRateBp: 1350, fulfilment: 'EAT_IN' })
    await appendEvent(store, line)
    const badTender = tenderCash(orderId, [opened.event, line.event], { tenderedMinor: 200n })
    // Corrupt the claimed total.
    const corrupted = { ...badTender, expectedTotalMinor: 999n }
    await appendEvent(store, corrupted)

    const drain = await syncOutbox(store, server.transportFor(identity))
    expect(drain.rejected).toBe(1)
    const [row] = await store.select<{ last_error: string; synced_at: string | null }>(
      'select last_error, synced_at from outbox where event_id = ?',
      [badTender.event.eventId],
    )
    expect(row?.synced_at).toBeNull() // still queued
    expect(row?.last_error).toContain('TOTAL_MISMATCH')
  })
})
