import { z } from 'zod'
import { MoneyMinorSchema, UuidSchema } from './primitives'
import { OrderEventSchema } from './order-events'

/**
 * The till → server sync contract. One direction only: transactions flow up, append-only. Config
 * (menu, prices) flows the other way and is a separate schema. See the `sync-protocol` skill.
 */

// Non-negotiable #7 / ADR 0006: event-source exactly three aggregates — order, shift, ledger.
// Only `order` events are emitted today; `shift` lands in Sprint 4, `ledger` with the finance module.
export const AggregateTypeSchema = z.enum(['order', 'shift', 'ledger'])

export const SyncEventSchema = z.object({
  aggregateType: AggregateTypeSchema,
  /**
   * The client's own computed order total. The server re-derives it from the reducer and rejects on
   * mismatch. Only events that assert a total (tender, close) need carry it.
   */
  expectedTotalMinor: MoneyMinorSchema.optional(),
  event: OrderEventSchema,
})

export const SyncRequestSchema = z.object({
  events: z.array(SyncEventSchema).min(1).max(500),
})

export const SyncResultStatusSchema = z.enum(['accepted', 'duplicate', 'rejected'])

export const SyncResultSchema = z.object({
  eventId: UuidSchema,
  /** Server sequence number (bigint as string). Present for accepted and duplicate; null if rejected. */
  seq: z.string().nullable(),
  status: SyncResultStatusSchema,
  error: z.string().optional(),
})

export const SyncResponseSchema = z.object({
  results: z.array(SyncResultSchema),
})

/**
 * `GET /v1/sync/highwater` — the per-device high-water mark. The till compares this against its local
 * store on startup: if the server is ahead of an empty local store, the local store was evicted and
 * those events are safe on the server (ADR 0005 durability detection). `maxSeq` is a bigint as a
 * string; null when the server holds nothing for the device.
 */
export const SyncHighWaterResponseSchema = z.object({
  maxSeq: z.string().nullable(),
  eventCount: z.number().int().min(0),
})

/** One event replayed back down to the till during resync. `event` parses wire JSON → domain shape. */
export const SyncPulledEventSchema = z.object({
  seq: z.string(),
  aggregateType: AggregateTypeSchema,
  event: OrderEventSchema,
})

/**
 * `GET /v1/sync/events?afterSeq=&limit=` — a bounded down-pull of the device's own events in server
 * order, used to rebuild a locally-evicted store rather than starting silently empty. Paged via
 * `nextAfterSeq` (null when drained). The till stays dumb about history: this pulls the device's
 * stream, not the tenant's whole ledger.
 */
export const SyncPullResponseSchema = z.object({
  events: z.array(SyncPulledEventSchema),
  nextAfterSeq: z.string().nullable(),
})

export type SyncHighWaterResponse = z.infer<typeof SyncHighWaterResponseSchema>
export type SyncPulledEvent = z.infer<typeof SyncPulledEventSchema>
export type SyncPullResponse = z.infer<typeof SyncPullResponseSchema>

export type AggregateType = z.infer<typeof AggregateTypeSchema>
export type SyncEvent = z.infer<typeof SyncEventSchema>
export type SyncEventInput = z.input<typeof SyncEventSchema>
export type SyncRequest = z.infer<typeof SyncRequestSchema>
export type SyncRequestInput = z.input<typeof SyncRequestSchema>
export type SyncResult = z.infer<typeof SyncResultSchema>
export type SyncResultStatus = z.infer<typeof SyncResultStatusSchema>
export type SyncResponse = z.infer<typeof SyncResponseSchema>
