import { VAT_REDUCED_BP } from '@batch/domain'
import { openOpfsStore } from '@batch/storage/opfs'
import type { LocalStore } from '@batch/storage'
import { addLine, openOrder, orderTotalMinor, tenderCash } from './order'
import {
  ensureDeviceIdentity,
  HttpSyncTransport,
  LocalStorageKeyValue,
  localStats,
  migrateLocal,
  reconcileOnStartup,
  syncOutbox,
  appendEvent,
  type DeviceIdentity,
  type KeyValueStore,
  type LocalStats,
  type ReconcileReport,
  type SyncOutcome,
} from './sync'

/**
 * Wires the two finished, tested pieces — the local event/outbox core (`./sync`) and the order
 * builders (`./order`) — into a single runtime the harness UI can drive. No React here: this module
 * is plain async functions over module-scoped state, so the render path never awaits a `LocalStore`
 * write (root CLAUDE.md: never block paint on a `LocalStore` write).
 *
 * Network only happens inside `syncNow()` and `reconcile()` — the explicit "Sync now" action and the
 * startup reconcile. Nothing on the order path (`takeSampleOrder`) touches `fetch`.
 */

const CONFIG_TENANT_KEY = 'batch.config.tenantId'
const CONFIG_API_BASE_KEY = 'batch.config.apiBaseUrl'

// The device-identity canary and the config both live in this one `localStorage` bucket — by design
// (see `sync/kv.ts`): it is a different bucket than OPFS, so it survives an OPFS eviction.
const configKv: KeyValueStore = new LocalStorageKeyValue()

export interface TillConfig {
  readonly tenantId: string
  readonly apiBaseUrl: string
}

/** Config persisted from a previous session, or null if this device has never been configured. */
export function loadStoredConfig(): TillConfig | null {
  const tenantId = configKv.get(CONFIG_TENANT_KEY)
  const apiBaseUrl = configKv.get(CONFIG_API_BASE_KEY)
  if (!tenantId || !apiBaseUrl) return null
  return { tenantId, apiBaseUrl }
}

function saveConfig(config: TillConfig): void {
  configKv.set(CONFIG_TENANT_KEY, config.tenantId)
  configKv.set(CONFIG_API_BASE_KEY, config.apiBaseUrl)
}

interface Runtime {
  readonly store: LocalStore
  readonly kv: KeyValueStore
  readonly identity: DeviceIdentity
  readonly transport: HttpSyncTransport
  readonly tenantId: string
}

let runtime: Runtime | null = null

export function isInitialised(): boolean {
  return runtime !== null
}

export function currentIdentity(): DeviceIdentity | null {
  return runtime?.identity ?? null
}

/**
 * Open the local store, apply the schema, and establish device identity + transport. Safe to call
 * again with a different config (e.g. the operator re-points the till at a different tenant/API) —
 * the previous store handle is closed first.
 */
export async function initTill(config: TillConfig): Promise<{ identity: DeviceIdentity }> {
  saveConfig(config)

  if (runtime) {
    await runtime.store.close()
    runtime = null
  }

  const store = await openOpfsStore()
  await migrateLocal(store)
  const { identity } = ensureDeviceIdentity(configKv, config.tenantId)
  const transport = new HttpSyncTransport(config.apiBaseUrl, identity)

  runtime = { store, kv: configKv, identity, transport, tenantId: config.tenantId }
  return { identity }
}

function requireRuntime(): Runtime {
  if (!runtime) throw new Error('till not initialised — call initTill() first')
  return runtime
}

export interface SampleOrderResult {
  readonly orderId: string
  readonly totalMinor: bigint
  readonly tenderedMinor: bigint
  readonly changeMinor: bigint
  /** Wall-clock time for the three local `LocalStore` writes — budget is <200ms (till CLAUDE.md). */
  readonly commitMs: number
}

/**
 * Open a tab, add one line, and tender cash — entirely through the shared `@batch/domain` reducer
 * and the local outbox. No network call anywhere in this function (root CLAUDE.md: no `fetch` on
 * the order-entry / cash-tender path).
 */
export async function takeSampleOrder(): Promise<SampleOrderResult> {
  const { store } = requireRuntime()
  const start = performance.now()

  const { orderId, outgoing: opened } = openOrder({ fulfilment: 'EAT_IN' })
  await appendEvent(store, opened)

  const line = addLine(orderId, {
    productId: 'sample-flat-white',
    name: 'Flat White',
    quantity: 1n,
    unitPriceMinor: 350n, // EUR 3.50, VAT-inclusive
    vatRateBp: VAT_REDUCED_BP,
    fulfilment: 'EAT_IN',
  })
  await appendEvent(store, line)

  const priorEvents = [opened.event, line.event]
  const totalMinor = orderTotalMinor(priorEvents)
  const tenderedMinor = 500n // a fiver, to exercise change calculation
  const tender = tenderCash(orderId, priorEvents, { tenderedMinor })
  await appendEvent(store, tender)

  const commitMs = performance.now() - start
  return { orderId, totalMinor, tenderedMinor, changeMinor: tenderedMinor - totalMinor, commitMs }
}

/** Drain the outbox. The only place this module calls the network outside `reconcile()`. */
export async function syncNow(): Promise<SyncOutcome> {
  const { store, transport } = requireRuntime()
  return syncOutbox(store, transport)
}

/** Local counts for the unsynced-count/age indicator (till CLAUDE.md). */
export async function refreshStats(): Promise<LocalStats> {
  const { store } = requireRuntime()
  return localStats(store)
}

/** Run at startup, before the till is trusted to take orders — see `./sync/reconcile.ts`. */
export async function reconcile(): Promise<ReconcileReport> {
  const { store, kv, transport, tenantId } = requireRuntime()
  return reconcileOnStartup({ store, kv, transport, tenantId })
}
