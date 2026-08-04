import { createNodeSqliteStore } from '@batch/storage/testing'
import type { LocalStore } from '@batch/storage'
import { afterEach, describe, expect, it } from 'vitest'
import { addLine, openOrder, orderTotalMinor, tenderCash } from '../order'
import { FakeServer } from './fake-server'
import { MemoryKeyValue } from './kv'
import { appendEvent, localStats } from './outbox'
import { syncOutbox } from './client'
import { migrateLocal } from './schema'
import { ensureDeviceIdentity, reconcileOnStartup } from './reconcile'
import { uuidv7 } from './ids'
import type { DeviceIdentity } from './types'

/** Take and sync a 3-event order, so the server holds this device's history. */
async function takeAndSync(store: LocalStore, server: FakeServer, identity: DeviceIdentity): Promise<void> {
  const { orderId, outgoing: opened } = openOrder({ fulfilment: 'EAT_IN' })
  await appendEvent(store, opened)
  const line = addLine(orderId, { productId: 'fw', name: 'Flat White', quantity: 2n, unitPriceMinor: 350n, vatRateBp: 1350, fulfilment: 'EAT_IN' })
  await appendEvent(store, line)
  const tender = tenderCash(orderId, [opened.event, line.event], { tenderedMinor: orderTotalMinor([opened.event, line.event]) })
  await appendEvent(store, tender)
  await syncOutbox(store, server.transportFor(identity))
}

describe('startup reconciliation (exit criterion 5 — eviction detection)', () => {
  const stores: LocalStore[] = []
  afterEach(async () => {
    await Promise.all(stores.map((s) => s.close()))
    stores.length = 0
  })
  const store = async (): Promise<LocalStore> => {
    const s = createNodeSqliteStore()
    await migrateLocal(s)
    stores.push(s)
    return s
  }

  it('first run: empty store, empty server, no canary — registers the device, does not alarm', async () => {
    const kv = new MemoryKeyValue()
    const server = new FakeServer()
    const tenantId = uuidv7()
    const report = await reconcileOnStartup({
      store: await store(),
      kv,
      transport: server.transportFor({ tenantId, deviceId: uuidv7() }),
      tenantId,
      persist: () => Promise.resolve(true),
    })
    expect(report.status).toBe('first-run')
    expect(report.persisted).toBe(true)
    expect(kv.get('batch.device.id')).not.toBeNull() // device now registered
    expect(kv.get('batch.device.canary')).not.toBeNull()
  })

  it('healthy: a non-empty local store starts without consulting the server', async () => {
    const kv = new MemoryKeyValue()
    const tenantId = uuidv7()
    const { identity } = ensureDeviceIdentity(kv, tenantId)
    const s = await store()
    const { outgoing } = openOrder({ fulfilment: 'EAT_IN' })
    await appendEvent(s, outgoing)

    const server = new FakeServer()
    // Offline transport: if reconcile touched it, it would throw. Healthy must not.
    const report = await reconcileOnStartup({
      store: s,
      kv,
      transport: server.transportFor(identity, () => false),
      tenantId,
    })
    expect(report.status).toBe('healthy')
    expect(report.localEventCount).toBe(1)
  })

  it('eviction recovered: OPFS wiped but canary survives — detects loss and resyncs down', async () => {
    const kv = new MemoryKeyValue()
    const tenantId = uuidv7()
    const { identity } = ensureDeviceIdentity(kv, tenantId)
    const server = new FakeServer()

    // Device takes and syncs an order; the server now holds its 3 events.
    const before = await store()
    await takeAndSync(before, server, identity)
    expect(server.size).toBe(3)

    // OPFS eviction: a brand-new empty store, but the KV bucket (device id + canary) survived.
    const after = await store()
    expect((await localStats(after)).eventCount).toBe(0)

    const report = await reconcileOnStartup({
      store: after,
      kv,
      transport: server.transportFor(identity),
      tenantId,
      persist: () => Promise.resolve(true),
    })

    expect(report.status).toBe('evicted-recovered')
    expect(report.serverEventCount).toBe(3)
    expect(report.recovered).toBe(3)
    // Not silently empty: the store was rebuilt from the server's copy.
    expect((await localStats(after)).eventCount).toBe(3)
  })

  it('eviction offline: empty store + canary but no network — flags suspected eviction', async () => {
    const kv = new MemoryKeyValue()
    const tenantId = uuidv7()
    const { identity } = ensureDeviceIdentity(kv, tenantId) // sets the canary
    const server = new FakeServer()
    const report = await reconcileOnStartup({
      store: await store(),
      kv,
      transport: server.transportFor(identity, () => false), // offline
      tenantId,
    })
    expect(report.status).toBe('evicted-offline')
  })
})
