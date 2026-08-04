import type {
  SyncHighWaterResponse,
  SyncPullResponse,
  SyncRequestInput,
  SyncResponse,
} from '@batch/schemas'

/**
 * The server, as the sync code sees it. The browser wires an HTTP implementation (`HttpSyncTransport`);
 * tests wire a fake that models the server's exactly-once contract. Everything above this interface —
 * outbox draining, reconciliation — is transport-agnostic and fully testable in Node.
 */
export interface SyncTransport {
  /** Drain: append a batch. Per-event `accepted` / `duplicate` / `rejected`. */
  postEvents(batch: SyncRequestInput): Promise<SyncResponse>
  /** The device's high-water mark on the server — for startup eviction detection. */
  getHighWater(): Promise<SyncHighWaterResponse>
  /** Bounded down-pull of the device's own events after `afterSeq`, to rebuild an evicted store. */
  pullEvents(afterSeq: string, limit?: number): Promise<SyncPullResponse>
}

/** The identity every request carries. The device id must be stable across process death. */
export interface DeviceIdentity {
  readonly tenantId: string
  readonly deviceId: string
}
