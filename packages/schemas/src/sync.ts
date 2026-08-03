import { z } from 'zod'
import { MoneyMinorSchema, UuidSchema } from './primitives'
import { OrderEventSchema } from './order-events'

/**
 * The till → server sync contract. One direction only: transactions flow up, append-only. Config
 * (menu, prices) flows the other way and is a separate schema. See the `sync-protocol` skill.
 */

// Non-negotiable #7: event-source exactly two aggregates — order and ledger.
export const AggregateTypeSchema = z.enum(['order', 'ledger'])

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

export type AggregateType = z.infer<typeof AggregateTypeSchema>
export type SyncEvent = z.infer<typeof SyncEventSchema>
export type SyncRequest = z.infer<typeof SyncRequestSchema>
export type SyncRequestInput = z.input<typeof SyncRequestSchema>
export type SyncResult = z.infer<typeof SyncResultSchema>
export type SyncResultStatus = z.infer<typeof SyncResultStatusSchema>
export type SyncResponse = z.infer<typeof SyncResponseSchema>
