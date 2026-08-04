import type { OrderEvent, shift } from '@batch/domain'
import { toJson, type AggregateType, type SyncEventInput, type SyncPulledEvent } from '@batch/schemas'
import type { Executor, LocalStore } from '@batch/storage'

/**
 * The local event log + outbox. Two invariants, both from ADR 0002 / the apps/till write path:
 *
 * 1. An event and its outbox row are written in ONE transaction. If they could diverge they would.
 * 2. Nothing here is ever deleted or rewritten. `events` is append-only; the outbox only ever has its
 *    `synced_at` / bookkeeping columns advanced. A rejected event stays queued, loudly, forever.
 */

/** An event on its way to the server: the domain event plus its sync envelope. */
export interface OutgoingEvent {
  readonly aggregateType: AggregateType
  /** Order or shift (ADR 0006). Storage is generic over both; only order events carry a total. */
  readonly event: OrderEvent | shift.ShiftEvent
  /** The client's computed total, for the server to re-derive and check. Tender/close carry it. */
  readonly expectedTotalMinor?: bigint
}

/**
 * The order-path narrowing of {@link OutgoingEvent}. The order screens and `useOrder` fold the
 * emitted events straight back through the order reducer, so on that path `.event` must stay
 * `OrderEvent`. The union above lives only at the storage/sync seam (the outbox is generic over both
 * aggregates); order-producing helpers return this narrower shape.
 */
export interface OutgoingOrderEvent extends OutgoingEvent {
  readonly event: OrderEvent
}

export interface AppendOutcome {
  readonly deviceSeq: number
  /** True if this exact event id was already in the local log — the append was a no-op. */
  readonly alreadyPresent: boolean
}

/** A queued, not-yet-synced event, rebuilt in the wire shape (money as strings) for POSTing. */
export interface QueuedEvent {
  readonly deviceSeq: number
  readonly syncEvent: SyncEventInput
}

// A `type` (not `interface`) so it satisfies the `Record<string, SqlValue>` row constraint.
type EventRow = {
  event_id: string
  aggregate_type: string
  aggregate_id: string
  event_type: string
  payload: string
  occurred_at: string
  expected_total_minor: string | null
  device_seq: number
}

async function nextDeviceSeq(tx: Executor): Promise<number> {
  const rows = await tx.select<{ m: number }>('select coalesce(max(device_seq), 0) as m from events')
  return (rows[0]?.m ?? 0) + 1
}

/**
 * Append one event + its outbox row inside an existing transaction. Idempotent on `event.eventId`.
 * `nextDeviceSeq` re-reads `max(device_seq)` each call, so within a multi-event transaction the
 * second event sees the first's insert and gets the next sequence.
 */
async function appendOne(tx: Executor, outgoing: OutgoingEvent, now: string): Promise<AppendOutcome> {
  const { event, aggregateType, expectedTotalMinor } = outgoing
  const existing = await tx.select<{ device_seq: number }>(
    'select device_seq from events where event_id = ?',
    [event.eventId],
  )
  const [found] = existing
  if (found) return { deviceSeq: found.device_seq, alreadyPresent: true }

  const deviceSeq = await nextDeviceSeq(tx)
  await tx.execute(
    `insert into events
       (event_id, aggregate_type, aggregate_id, event_type, payload, occurred_at,
        expected_total_minor, device_seq, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      event.eventId,
      aggregateType,
      event.aggregateId,
      event.eventType,
      toJson(event.payload),
      event.occurredAt,
      expectedTotalMinor === undefined ? null : expectedTotalMinor.toString(),
      deviceSeq,
      now,
    ],
  )
  await tx.execute('insert into outbox (event_id) values (?)', [event.eventId])
  return { deviceSeq, alreadyPresent: false }
}

/**
 * Append an event and queue it, in one transaction. Idempotent on `event.eventId`: re-appending the
 * same id (a retried local write after a crash) is a no-op that returns the existing `deviceSeq`.
 */
export function appendEvent(
  store: LocalStore,
  outgoing: OutgoingEvent,
  now: string = new Date().toISOString(),
): Promise<AppendOutcome> {
  return store.transaction((tx) => appendOne(tx, outgoing, now))
}

/**
 * Append several events **atomically** — all in one transaction, so the group commits or rolls back
 * as a unit. Used for the terminal cash-sale pair (`OrderTendered` + `OrderClosed`): a half-written
 * sale (tender persisted, close lost) would sync a tender the server can never reconcile to a close,
 * so the two must never diverge. Order is preserved; each event still gets a monotonic `device_seq`.
 */
export function appendEvents(
  store: LocalStore,
  outgoingList: readonly OutgoingEvent[],
  now: string = new Date().toISOString(),
): Promise<AppendOutcome[]> {
  return store.transaction(async (tx) => {
    const outcomes: AppendOutcome[] = []
    for (const outgoing of outgoingList) {
      outcomes.push(await appendOne(tx, outgoing, now))
    }
    return outcomes
  })
}

function rowToQueued(row: EventRow): QueuedEvent {
  // Payload was stored as JSON with money as decimal strings — exactly the wire shape. Rebuild the
  // request event without any bigint round-trip, so money stays a string end to end.
  const payload = JSON.parse(row.payload) as Record<string, unknown>
  const syncEvent: SyncEventInput = {
    aggregateType: row.aggregate_type as AggregateType,
    event: {
      eventId: row.event_id,
      aggregateId: row.aggregate_id,
      occurredAt: row.occurred_at,
      eventType: row.event_type,
      payload,
    } as SyncEventInput['event'],
    ...(row.expected_total_minor !== null
      ? { expectedTotalMinor: row.expected_total_minor }
      : {}),
  }
  return { deviceSeq: row.device_seq, syncEvent }
}

/** Every not-yet-acknowledged event, oldest first. */
export async function listUnsynced(store: LocalStore): Promise<QueuedEvent[]> {
  const rows = await store.select<EventRow>(
    `select e.event_id, e.aggregate_type, e.aggregate_id, e.event_type, e.payload,
            e.occurred_at, e.expected_total_minor, e.device_seq
       from outbox o join events e on e.event_id = o.event_id
      where o.synced_at is null
      order by e.device_seq`,
  )
  return rows.map(rowToQueued)
}

/** Mark an event acknowledged by the server. Advances the outbox row; never deletes it. */
export async function markSynced(
  store: LocalStore,
  eventId: string,
  serverSeq: string | null,
  now: string = new Date().toISOString(),
): Promise<void> {
  await store.execute('update outbox set synced_at = ?, server_seq = ?, last_error = null where event_id = ?', [
    now,
    serverSeq,
    eventId,
  ])
}

/** Record a rejection. The row stays unsynced (synced_at null) so it is retried and stays visible. */
export async function markRejected(store: LocalStore, eventId: string, error: string): Promise<void> {
  await store.execute(
    'update outbox set attempts = attempts + 1, last_error = ? where event_id = ?',
    [error, eventId],
  )
}

export interface LocalStats {
  readonly eventCount: number
  readonly maxDeviceSeq: number
  readonly unsyncedCount: number
  /** ISO timestamp of the oldest unsynced event, or null if fully synced. */
  readonly oldestUnsyncedAt: string | null
}

/** Local counts used by startup reconciliation and the unsynced-count/age indicator. */
export async function localStats(store: LocalStore): Promise<LocalStats> {
  const [counts] = await store.select<{ n: number; mx: number }>(
    'select count(*) as n, coalesce(max(device_seq), 0) as mx from events',
  )
  const [unsynced] = await store.select<{ n: number; oldest: string | null }>(
    `select count(*) as n, min(e.created_at) as oldest
       from outbox o join events e on e.event_id = o.event_id
      where o.synced_at is null`,
  )
  return {
    eventCount: counts?.n ?? 0,
    maxDeviceSeq: counts?.mx ?? 0,
    unsyncedCount: unsynced?.n ?? 0,
    oldestUnsyncedAt: unsynced?.oldest ?? null,
  }
}

/**
 * Insert an event pulled back down from the server during resync, marked already-synced. Used to
 * rebuild a locally-evicted store from the device's own server-side history. Idempotent on event id.
 */
export async function insertSynced(
  store: LocalStore,
  pulled: SyncPulledEvent,
  now: string = new Date().toISOString(),
): Promise<void> {
  const { event } = pulled
  await store.transaction(async (tx) => {
    const existing = await tx.select<{ event_id: string }>(
      'select event_id from events where event_id = ?',
      [event.eventId],
    )
    if (existing.length > 0) return
    const deviceSeq = await nextDeviceSeq(tx)
    await tx.execute(
      `insert into events
         (event_id, aggregate_type, aggregate_id, event_type, payload, occurred_at,
          expected_total_minor, device_seq, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.eventId,
        pulled.aggregateType,
        event.aggregateId,
        event.eventType,
        toJson(event.payload),
        event.occurredAt,
        null,
        deviceSeq,
        now,
      ],
    )
    await tx.execute('insert into outbox (event_id, synced_at, server_seq) values (?, ?, ?)', [
      event.eventId,
      now,
      pulled.seq,
    ])
  })
}
