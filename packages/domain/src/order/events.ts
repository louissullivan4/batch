/**
 * Order aggregate events.
 *
 * These are the in-memory (parsed) shapes the reducer consumes — money is `bigint` minor units
 * here. `@batch/schemas` defines the Zod validators that parse wire JSON (money as string) into
 * exactly these types; a compile-time check there keeps the two in lock-step.
 *
 * The snapshot rule lives in these payloads: every price, rate, and name is embedded as it was at
 * the moment of sale. There is never a reference to a mutable product/modifier row, so tomorrow's
 * price edit cannot change yesterday's receipt.
 */

import type { Currency } from '../money'
import type { FulfilmentMode, VatRateBp } from '../vat'

/** Fields every event carries. `recordedAt` is added server-side and is not part of the payload. */
export interface EventEnvelope {
  /** Client-generated UUIDv7, stable across retries — the idempotency key. */
  readonly eventId: string
  /** The order id. */
  readonly aggregateId: string
  /** Device clock, ISO 8601. Shown on receipts; never used for ordering. */
  readonly occurredAt: string
}

export interface OrderOpenedPayload {
  readonly currency: Currency
  /** Order-level default; each line still snapshots its own fulfilment (a ticket can mix). */
  readonly fulfilment: FulfilmentMode
  readonly staffId?: string
}

/** A modifier snapshotted onto a line at the moment of sale (ADR 0008). Per-unit, own VAT rate. */
export interface LineModifier {
  readonly modifierId: string
  readonly name: string
  readonly unitPriceMinor: bigint
  readonly vatRateBp: VatRateBp
}

export interface LineAddedPayload {
  readonly productId: string
  readonly name: string
  readonly quantity: bigint
  readonly unitPriceMinor: bigint
  readonly vatRateBp: VatRateBp
  readonly fulfilment: FulfilmentMode
  /** Modifiers chosen when the line was added (ADR 0008); embedded, not a separate event. */
  readonly modifiers: readonly LineModifier[]
}

export interface LineVoidedPayload {
  readonly lineId: string
  /** How many of the line's units to void. Omitted = void all still-active units (ADR 0008). */
  readonly quantity?: bigint
  readonly reason?: string
}

export type DiscountKind = 'PERCENT' | 'AMOUNT'

export type DiscountAppliedPayload =
  | {
      readonly discountId: string
      readonly name: string
      readonly kind: 'PERCENT'
      readonly rateBp: number
    }
  | {
      readonly discountId: string
      readonly name: string
      readonly kind: 'AMOUNT'
      readonly amountMinor: bigint
    }

export type TenderMethod = 'CASH' | 'CARD'

export interface OrderTenderedPayload {
  readonly tenderId: string
  readonly method: TenderMethod
  /** Amount applied to the order balance. */
  readonly amountMinor: bigint
  /** Cash physically handed over (CASH only). */
  readonly tenderedMinor?: bigint
  /** Change returned (CASH only). */
  readonly changeMinor?: bigint
}

export type OrderClosedPayload = Record<string, never>

export interface OrderRefundedPayload {
  readonly refundId: string
  readonly amountMinor: bigint
  readonly reason?: string
}

export type OrderEvent =
  | (EventEnvelope & { readonly eventType: 'OrderOpened'; readonly payload: OrderOpenedPayload })
  | (EventEnvelope & { readonly eventType: 'LineAdded'; readonly payload: LineAddedPayload })
  | (EventEnvelope & { readonly eventType: 'LineVoided'; readonly payload: LineVoidedPayload })
  | (EventEnvelope & {
      readonly eventType: 'DiscountApplied'
      readonly payload: DiscountAppliedPayload
    })
  | (EventEnvelope & {
      readonly eventType: 'OrderTendered'
      readonly payload: OrderTenderedPayload
    })
  | (EventEnvelope & { readonly eventType: 'OrderClosed'; readonly payload: OrderClosedPayload })
  | (EventEnvelope & {
      readonly eventType: 'OrderRefunded'
      readonly payload: OrderRefundedPayload
    })

export type OrderEventType = OrderEvent['eventType']

export const ORDER_EVENT_TYPES: readonly OrderEventType[] = [
  'OrderOpened',
  'LineAdded',
  'LineVoided',
  'DiscountApplied',
  'OrderTendered',
  'OrderClosed',
  'OrderRefunded',
]
