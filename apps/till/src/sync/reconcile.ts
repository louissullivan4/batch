import type { LocalStore } from '@batch/storage'
import { uuidv7 } from './ids'
import type { KeyValueStore } from './kv'
import { insertSynced, localStats } from './outbox'
import type { DeviceIdentity, SyncTransport } from './types'

const KEY_DEVICE_ID = 'batch.device.id'
const KEY_CANARY = 'batch.device.canary'

/**
 * Ask the browser to keep our storage from being evicted under pressure. Returns what it granted, or
 * null where the API is absent (e.g. Node). Best-effort: a `false` is a signal to lean harder on
 * detection, not a failure.
 */
export async function requestPersistence(): Promise<boolean | null> {
  const nav = globalThis.navigator as Navigator | undefined
  if (nav?.storage?.persist) return nav.storage.persist()
  return null
}

/**
 * Read (or, on genuine first run, create) the device identity. The device id lives in the KV bucket
 * (`localStorage`), NOT in the OPFS store — so it survives an eviction that clears OPFS, which is what
 * lets the server high-water still be scoped to this device and the loss be detected.
 */
export function ensureDeviceIdentity(
  kv: KeyValueStore,
  tenantId: string,
): { identity: DeviceIdentity; hadCanary: boolean } {
  const hadCanary = kv.get(KEY_CANARY) !== null
  let deviceId = kv.get(KEY_DEVICE_ID)
  if (deviceId === null) {
    deviceId = uuidv7()
    kv.set(KEY_DEVICE_ID, deviceId)
  }
  if (!hadCanary) kv.set(KEY_CANARY, uuidv7())
  return { identity: { tenantId, deviceId }, hadCanary }
}

export type ReconcileStatus =
  | 'first-run' // nothing locally, nothing on the server for this device
  | 'healthy' // local store intact
  | 'evicted-recovered' // local store was wiped; the server had our events, resynced down
  | 'evicted-offline' // local store empty + canary present, but offline — can't confirm/recover yet

export interface ReconcileReport {
  readonly status: ReconcileStatus
  readonly identity: DeviceIdentity
  readonly localEventCount: number
  readonly serverMaxSeq: string | null
  readonly serverEventCount: number
  /** Events pulled back down from the server to rebuild a wiped store. */
  readonly recovered: number
  /** Result of `navigator.storage.persist()`, or null if unavailable. */
  readonly persisted: boolean | null
}

export interface ReconcileDeps {
  readonly store: LocalStore
  readonly kv: KeyValueStore
  readonly transport: SyncTransport
  readonly tenantId: string
  readonly persist?: () => Promise<boolean | null>
}

/**
 * Run at startup, before taking orders. Establishes identity, requests persistence, and — crucially —
 * makes an empty local store impossible to mistake for a fresh one when the server knows better. On a
 * detected eviction it resyncs the device's own events back down rather than starting silently empty
 * (ADR 0005 / Sprint 1 exit criterion 5).
 */
export async function reconcileOnStartup(deps: ReconcileDeps): Promise<ReconcileReport> {
  const { store, kv, transport, tenantId } = deps
  const persisted = await (deps.persist ?? requestPersistence)()
  const { identity, hadCanary } = ensureDeviceIdentity(kv, tenantId)

  const local = await localStats(store)
  if (local.eventCount > 0) {
    return {
      status: 'healthy',
      identity,
      localEventCount: local.eventCount,
      serverMaxSeq: null,
      serverEventCount: 0,
      recovered: 0,
      persisted,
    }
  }

  // Local store is empty. The server is the arbiter of whether that is a first run or a loss.
  let serverMaxSeq: string | null = null
  let serverEventCount = 0
  try {
    const hw = await transport.getHighWater()
    serverMaxSeq = hw.maxSeq
    serverEventCount = hw.eventCount
  } catch {
    // Offline: fall back to the canary. A canary with an empty store is a suspected eviction we
    // cannot yet confirm or repair; a clean slate with no canary is a genuine first run.
    return {
      status: hadCanary ? 'evicted-offline' : 'first-run',
      identity,
      localEventCount: 0,
      serverMaxSeq: null,
      serverEventCount: 0,
      recovered: 0,
      persisted,
    }
  }

  if (serverEventCount === 0) {
    return {
      status: 'first-run',
      identity,
      localEventCount: 0,
      serverMaxSeq,
      serverEventCount,
      recovered: 0,
      persisted,
    }
  }

  // Eviction: the server holds events for this device but the local store is empty. The data is safe;
  // pull it back down so the till is not silently empty.
  let recovered = 0
  let afterSeq = '0'
  for (;;) {
    const page = await transport.pullEvents(afterSeq)
    for (const pulled of page.events) {
      await insertSynced(store, pulled)
      recovered += 1
    }
    if (page.nextAfterSeq === null) break
    afterSeq = page.nextAfterSeq
  }

  return {
    status: 'evicted-recovered',
    identity,
    localEventCount: 0,
    serverMaxSeq,
    serverEventCount,
    recovered,
    persisted,
  }
}
