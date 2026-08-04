import type { OrderEvent } from '@batch/domain'
import { OrderEventSchema, toJson } from '@batch/schemas'
import type { PoolClient } from '../db'
import type { AppendResult, PulledEvent, SyncStore } from './service'

/**
 * Postgres-backed `SyncStore`, bound to a client that already ran `set_config('app.tenant_id', …)`.
 * Every query here relies on RLS for tenant scoping — there is no `tenant_id` in the WHERE clauses
 * because the policy adds it, which is exactly what keeps a bug from selecting across tenants.
 */

interface EventRow {
  event_id: string
  aggregate_id: string
  event_type: string
  payload: unknown
  occurred_at: Date
}

interface PulledRow extends EventRow {
  seq: string
  aggregate_type: string
}

function rowToEvent(row: EventRow): OrderEvent {
  return OrderEventSchema.parse({
    eventId: row.event_id,
    aggregateId: row.aggregate_id,
    occurredAt: row.occurred_at.toISOString(),
    eventType: row.event_type,
    payload: row.payload,
  })
}

export function createPgStore(client: PoolClient): SyncStore {
  async function findSeq(eventId: string): Promise<bigint | null> {
    const res = await client.query<{ seq: string }>(
      'select seq from event_log where event_id = $1',
      [eventId],
    )
    const row = res.rows[0]
    return row ? BigInt(row.seq) : null
  }

  return {
    async loadAggregateEvents(aggregateType, aggregateId): Promise<OrderEvent[]> {
      const res = await client.query<EventRow>(
        `select event_id, aggregate_id, event_type, payload, occurred_at
           from event_log
          where aggregate_type = $1 and aggregate_id = $2
          order by seq`,
        [aggregateType, aggregateId],
      )
      return res.rows.map(rowToEvent)
    },

    findSeq,

    async append(event, meta): Promise<AppendResult> {
      // tenant_id is taken from the transaction GUC, never from the client, and the RLS WITH CHECK
      // re-asserts it. on conflict do nothing gives exactly-once without a racy pre-SELECT.
      const res = await client.query<{ seq: string }>(
        `insert into event_log
           (event_id, tenant_id, device_id, aggregate_type, aggregate_id, event_type, payload, occurred_at)
         values ($1, current_setting('app.tenant_id')::uuid, $2, $3, $4, $5, $6::jsonb, $7)
         on conflict (tenant_id, event_id) do nothing
         returning seq`,
        [
          event.eventId,
          meta.deviceId,
          meta.aggregateType,
          event.aggregateId,
          event.eventType,
          toJson(event.payload),
          event.occurredAt,
        ],
      )
      const inserted = res.rows[0]
      if (inserted) return { inserted: true, seq: BigInt(inserted.seq) }

      const existing = await findSeq(event.eventId)
      if (existing === null) {
        throw new Error(`append: conflict on ${event.eventId} but no existing row is visible`)
      }
      return { inserted: false, seq: existing }
    },

    async deviceHighWater(deviceId): Promise<{ maxSeq: bigint | null; eventCount: number }> {
      // Per-device, tenant-scoped by RLS. The till compares this against its local store on startup.
      const res = await client.query<{ max_seq: string | null; n: string }>(
        'select max(seq)::text as max_seq, count(*)::text as n from event_log where device_id = $1',
        [deviceId],
      )
      const row = res.rows[0]
      return {
        maxSeq: row && row.max_seq !== null ? BigInt(row.max_seq) : null,
        eventCount: row ? Number(row.n) : 0,
      }
    },

    async loadDeviceEventsAfter(deviceId, afterSeq, limit): Promise<PulledEvent[]> {
      const res = await client.query<PulledRow>(
        `select seq::text as seq, aggregate_type, event_id, aggregate_id, event_type, payload, occurred_at
           from event_log
          where device_id = $1 and seq > $2
          order by seq
          limit $3`,
        [deviceId, afterSeq.toString(), limit],
      )
      return res.rows.map((row) => ({
        seq: BigInt(row.seq),
        aggregateType: row.aggregate_type,
        event: rowToEvent(row),
      }))
    },
  }
}
