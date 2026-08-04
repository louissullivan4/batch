import {
  SyncHighWaterResponseSchema,
  SyncPullResponseSchema,
  SyncResponseSchema,
  type SyncHighWaterResponse,
  type SyncPullResponse,
  type SyncRequestInput,
  type SyncResponse,
} from '@batch/schemas'
import type { LocalStore } from '@batch/storage'
import { listUnsynced, markRejected, markSynced } from './outbox'
import type { DeviceIdentity, SyncTransport } from './types'

export interface SyncOutcome {
  readonly synced: number
  readonly rejected: number
  /** Events still queued after this drain (because the network dropped, or they were rejected). */
  readonly remaining: number
  /** True if a transport error stopped the drain — normal offline operation, not an error state. */
  readonly offline: boolean
}

/**
 * Drain the outbox to the server, **one event per request** (ADR 0005 durability: keep the unsynced
 * window as small as connectivity allows). `accepted` and `duplicate` both mark the row synced — a
 * duplicate means a prior attempt already landed it, which is success. A `rejected` event is recorded
 * and left queued (never deleted). A transport error means we are offline: stop, leave the rest
 * queued, and report it — the caller retries on the next connectivity signal.
 */
export async function syncOutbox(store: LocalStore, transport: SyncTransport): Promise<SyncOutcome> {
  const queued = await listUnsynced(store)
  let synced = 0
  let rejected = 0

  for (const item of queued) {
    const batch: SyncRequestInput = { events: [item.syncEvent] }
    let response: SyncResponse
    try {
      response = await transport.postEvents(batch)
    } catch {
      // Offline (or the server is unreachable). Everything from here stays queued.
      const remaining = queued.length - synced - rejected
      return { synced, rejected, remaining, offline: true }
    }

    const [result] = response.results
    if (!result) continue
    if (result.status === 'accepted' || result.status === 'duplicate') {
      await markSynced(store, result.eventId, result.seq ?? '')
      synced += 1
    } else {
      await markRejected(store, result.eventId, result.error ?? 'rejected')
      rejected += 1
    }
  }

  return { synced, rejected, remaining: rejected, offline: false }
}

/** HTTP implementation of the transport. Adds the device/tenant headers to every request. */
export class HttpSyncTransport implements SyncTransport {
  constructor(
    private readonly baseUrl: string,
    private readonly identity: DeviceIdentity,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      'x-tenant-id': this.identity.tenantId,
      'x-device-id': this.identity.deviceId,
    }
  }

  async postEvents(batch: SyncRequestInput): Promise<SyncResponse> {
    const res = await this.fetchFn(`${this.baseUrl}/v1/sync/events`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(batch),
    })
    if (!res.ok) throw new Error(`sync POST failed: ${res.status}`)
    return SyncResponseSchema.parse(await res.json())
  }

  async getHighWater(): Promise<SyncHighWaterResponse> {
    const res = await this.fetchFn(`${this.baseUrl}/v1/sync/highwater`, { headers: this.headers() })
    if (!res.ok) throw new Error(`highwater GET failed: ${res.status}`)
    return SyncHighWaterResponseSchema.parse(await res.json())
  }

  async pullEvents(afterSeq: string, limit = 500): Promise<SyncPullResponse> {
    const url = `${this.baseUrl}/v1/sync/events?afterSeq=${encodeURIComponent(afterSeq)}&limit=${limit}`
    const res = await this.fetchFn(url, { headers: this.headers() })
    if (!res.ok) throw new Error(`pull GET failed: ${res.status}`)
    return SyncPullResponseSchema.parse(await res.json())
  }
}
