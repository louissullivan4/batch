import {
  computeTotals,
  OrderReductionError,
  reduce,
  shift,
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
 *
 * Two aggregates flow through here: `order` (reduced + total-checked) and `shift` (reduced for its
 * lifecycle invariants — no double-close, no double-Z — but never total-checked; a shift carries no
 * order total). `ledger` is declared but still unwritten (ADR 0006), so it is rejected.
 */

/** Either aggregate's event; the wire union (ADR 0006). The store persists both identically. */
export type AnyEvent = OrderEvent | shift.ShiftEvent

export interface AppendResult {
  /** false when the unique (tenant_id, event_id) constraint already held the row. */
  readonly inserted: boolean
  readonly seq: bigint
}

/** One event pulled back down to a till during resync. Tenant + device scoped. */
export interface PulledEvent {
  readonly seq: bigint
  readonly aggregateType: string
  readonly event: AnyEvent
}

export interface SyncStore {
  /** Replay a single aggregate's already-persisted events, in server order. Tenant-scoped. */
  loadAggregateEvents(aggregateType: string, aggregateId: string): Promise<AnyEvent[]>
  /** Append idempotently. A constraint hit returns the existing row's seq with inserted=false. */
  append(
    event: AnyEvent,
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
  // Per-aggregate replay state, loaded once and advanced as events in the batch are accepted. Order
  // and shift keep separate maps — their aggregate ids share no namespace, and their state types and
  // reducers differ.
  const orderStateByAggregate = new Map<string, OrderState | null>()
  const shiftStateByAggregate = new Map<string, shift.ShiftState | null>()

  for (const item of request.events) {
    const { event, aggregateType } = item
    const { eventId, aggregateId } = event

    if (aggregateType === 'order') {
      // `event` is the wire union; `aggregateType` is the discriminator the client tagged it with. A
      // mismatched pair (a shift event tagged 'order') is not trusted on the strength of the cast —
      // the order reducer rejects it below, which is the real backstop.
      const orderEvent = event as OrderEvent

      if (!orderStateByAggregate.has(aggregateId)) {
        const prior = await store.loadAggregateEvents(aggregateType, aggregateId)
        let seeded: OrderState | null = null
        for (const e of prior) seeded = reduce(seeded, e as OrderEvent)
        orderStateByAggregate.set(aggregateId, seeded)
      }
      const current = orderStateByAggregate.get(aggregateId) ?? null

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
        next = reduce(current, orderEvent)
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

      const appended = await store.append(orderEvent, { aggregateType, deviceId })
      orderStateByAggregate.set(aggregateId, next)
      results.push({
        eventId,
        seq: appended.seq.toString(),
        status: appended.inserted ? 'accepted' : 'duplicate',
      })
      continue
    }

    if (aggregateType === 'shift') {
      // Shift replays through its own reducer so the server enforces the same lifecycle invariants the
      // till does (single open shift, no double-close, no double-Z, no movement after Z). There is no
      // total to re-derive — a shift carries none — so no `expectedTotalMinor` check runs here.
      const shiftEvent = event as shift.ShiftEvent

      if (!shiftStateByAggregate.has(aggregateId)) {
        const prior = await store.loadAggregateEvents(aggregateType, aggregateId)
        let seeded: shift.ShiftState | null = null
        for (const e of prior) seeded = shift.reduce(seeded, e as shift.ShiftEvent)
        shiftStateByAggregate.set(aggregateId, seeded)
      }
      const current = shiftStateByAggregate.get(aggregateId) ?? null

      if (current !== null && current.appliedEventIds.has(eventId)) {
        const seq = await store.findSeq(eventId)
        results.push({ eventId, seq: seq?.toString() ?? null, status: 'duplicate' })
        continue
      }

      let next: shift.ShiftState
      try {
        next = shift.reduce(current, shiftEvent)
      } catch (err) {
        results.push(
          reject(eventId, err instanceof shift.ShiftReductionError ? err.code : 'INVALID_EVENT'),
        )
        continue
      }

      const appended = await store.append(shiftEvent, { aggregateType, deviceId })
      shiftStateByAggregate.set(aggregateId, next)
      results.push({
        eventId,
        seq: appended.seq.toString(),
        status: appended.inserted ? 'accepted' : 'duplicate',
      })
      continue
    }

    // `ledger` is declared in the CHECK but has no reducer yet (ADR 0006); reject until it lands.
    results.push(reject(eventId, 'UNSUPPORTED_AGGREGATE'))
  }

  return { results }
}
