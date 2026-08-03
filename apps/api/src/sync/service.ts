import {
  computeTotals,
  OrderReductionError,
  reduce,
  type OrderEvent,
  type OrderState,
} from '@batch/domain'
import type { SyncRequest, SyncResponse, SyncResult } from '@batch/schemas'

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
