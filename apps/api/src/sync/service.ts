import {
  computeTotals,
  OrderReductionError,
  reduce,
  type OrderEvent,
  type OrderState,
} from '@batch/domain'
import {
  toWire,
  type AggregateType,
  type SyncHighWaterResponse,
  type SyncPullResponse,
  type SyncRequest,
  type SyncResponse,
  type SyncResult,
} from '@batch/schemas'

/**
 * The sync algorithm, independent of Postgres. The route wires a `SyncStore` backed by a tenant
 * transaction; tests wire an in-memory one. Everything tenant-sensitive lives in the store, so this
 * function never sees a tenant id — it cannot leak one.
 */

export interface AppendResult {
  /** false when the unique (tenant_id, event_id) constraint already held the row. */
  readonly inserted: boolean
  readonly seq: bigint
}

/** One event pulled back down to a till during resync. Tenant + device scoped. */
export interface PulledEvent {
  readonly seq: bigint
  readonly aggregateType: string
  readonly event: OrderEvent
}

export interface SyncStore {
  /** Replay a single aggregate's already-persisted events, in server order. Tenant-scoped. */
  loadAggregateEvents(aggregateType: string, aggregateId: string): Promise<OrderEvent[]>
  /** Append idempotently. A constraint hit returns the existing row's seq with inserted=false. */
  append(
    event: OrderEvent,
    meta: { aggregateType: string; deviceId: string },
  ): Promise<AppendResult>
  /** The seq of an already-stored event, or null. Tenant-scoped. */
  findSeq(eventId: string): Promise<bigint | null>
  /** The device's high-water mark: greatest seq and event count. Tenant-scoped by RLS. */
  deviceHighWater(deviceId: string): Promise<{ maxSeq: bigint | null; eventCount: number }>
  /** The device's own events after `afterSeq`, in server order, capped at `limit`. */
  loadDeviceEventsAfter(deviceId: string, afterSeq: bigint, limit: number): Promise<PulledEvent[]>
}

/** `GET /v1/sync/highwater` — the device's high-water mark, shaped for the wire. */
export async function getDeviceHighWater(
  store: SyncStore,
  deviceId: string,
): Promise<SyncHighWaterResponse> {
  const { maxSeq, eventCount } = await store.deviceHighWater(deviceId)
  return { maxSeq: maxSeq === null ? null : maxSeq.toString(), eventCount }
}

/**
 * `GET /v1/sync/events` — a bounded down-pull of the device's own events, for rebuilding an evicted
 * till. `nextAfterSeq` is the last seq returned when the page filled, else null (drained). Money is
 * serialised back to strings via `toWire`.
 */
export async function pullDeviceEvents(
  store: SyncStore,
  deviceId: string,
  afterSeq: bigint,
  limit: number,
): Promise<SyncPullResponse> {
  const rows = await store.loadDeviceEventsAfter(deviceId, afterSeq, limit)
  const events = rows.map((row) => ({
    seq: row.seq.toString(),
    aggregateType: row.aggregateType as AggregateType,
    event: toWire(row.event) as SyncPullResponse['events'][number]['event'],
  }))
  const last = rows[rows.length - 1]
  const nextAfterSeq = last && rows.length === limit ? last.seq.toString() : null
  return { events, nextAfterSeq }
}

function reject(eventId: string, error: string): SyncResult {
  return { eventId, seq: null, status: 'rejected', error }
}

export async function processSyncBatch(
  store: SyncStore,
  deviceId: string,
  request: SyncRequest,
): Promise<SyncResponse> {
  const results: SyncResult[] = []
  // Per-aggregate replay state, loaded once and advanced as events in the batch are accepted.
  const stateByAggregate = new Map<string, OrderState | null>()

  for (const item of request.events) {
    const { event, aggregateType } = item
    const { eventId, aggregateId } = event

    if (aggregateType !== 'order') {
      // Only the order aggregate is reduced today; the ledger gets its own reducer later.
      results.push(reject(eventId, 'UNSUPPORTED_AGGREGATE'))
      continue
    }

    if (!stateByAggregate.has(aggregateId)) {
      const prior = await store.loadAggregateEvents(aggregateType, aggregateId)
      let seeded: OrderState | null = null
      for (const e of prior) seeded = reduce(seeded, e)
      stateByAggregate.set(aggregateId, seeded)
    }
    const current = stateByAggregate.get(aggregateId) ?? null

    // Already folded (persisted earlier, or seen earlier in this same batch)? Report the existing
    // seq and move on. Checking the replayed state here — rather than catching a reducer error —
    // treats every re-sent event uniformly, including OrderOpened (which would otherwise surface as
    // ALREADY_OPEN, not DUPLICATE_EVENT).
    if (current !== null && current.appliedEventIds.has(eventId)) {
      const seq = await store.findSeq(eventId)
      results.push({ eventId, seq: seq?.toString() ?? null, status: 'duplicate' })
      continue
    }

    let next: OrderState
    try {
      next = reduce(current, event)
    } catch (err) {
      results.push(reject(eventId, err instanceof OrderReductionError ? err.code : 'INVALID_EVENT'))
      continue
    }

    // Re-derive the total with the identical reducer the till used, and reject on mismatch.
    if (item.expectedTotalMinor !== undefined) {
      const actual = computeTotals(next).totalMinor
      if (actual !== item.expectedTotalMinor) {
        results.push(
          reject(eventId, `TOTAL_MISMATCH expected=${item.expectedTotalMinor} actual=${actual}`),
        )
        continue
      }
    }

    const appended = await store.append(event, { aggregateType, deviceId })
    stateByAggregate.set(aggregateId, next)
    results.push({
      eventId,
      seq: appended.seq.toString(),
      status: appended.inserted ? 'accepted' : 'duplicate',
    })
  }

  return { results }
}
