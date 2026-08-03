import { z } from 'zod'
import type { OrderEvent } from '@batch/domain'
import {
  CountSchema,
  CurrencySchema,
  FulfilmentSchema,
  IsoDateTimeSchema,
  MoneyMinorSchema,
  UuidSchema,
  VatRateBpSchema,
} from './primitives'

/**
 * Zod validators for the order events. Parsing produces objects whose types match the domain's
 * `OrderEvent` exactly — enforced by the compile-time check at the bottom of this file. So the wire
 * boundary and the reducer can never drift: add a field in one place and the other stops compiling.
 */

// --- Payloads ---------------------------------------------------------------------------------

export const OrderOpenedPayloadSchema = z.object({
  currency: CurrencySchema,
  fulfilment: FulfilmentSchema,
  staffId: z.string().optional(),
})

export const LineAddedPayloadSchema = z.object({
  productId: z.string().min(1),
  name: z.string().min(1),
  quantity: CountSchema,
  unitPriceMinor: MoneyMinorSchema,
  vatRateBp: VatRateBpSchema,
  fulfilment: FulfilmentSchema,
})

export const ModifierAppliedPayloadSchema = z.object({
  lineId: UuidSchema,
  modifierId: z.string().min(1),
  name: z.string().min(1),
  unitPriceMinor: MoneyMinorSchema,
  vatRateBp: VatRateBpSchema,
})

export const LineVoidedPayloadSchema = z.object({
  lineId: UuidSchema,
  reason: z.string().optional(),
})

export const DiscountAppliedPayloadSchema = z.discriminatedUnion('kind', [
  z.object({
    discountId: z.string().min(1),
    name: z.string().min(1),
    kind: z.literal('PERCENT'),
    rateBp: z.number().int().min(0).max(10000),
  }),
  z.object({
    discountId: z.string().min(1),
    name: z.string().min(1),
    kind: z.literal('AMOUNT'),
    amountMinor: MoneyMinorSchema,
  }),
])

export const OrderTenderedPayloadSchema = z.object({
  tenderId: z.string().min(1),
  method: z.enum(['CASH', 'CARD']),
  amountMinor: MoneyMinorSchema,
  tenderedMinor: MoneyMinorSchema.optional(),
  changeMinor: MoneyMinorSchema.optional(),
})

export const OrderClosedPayloadSchema = z.object({})

export const OrderRefundedPayloadSchema = z.object({
  refundId: z.string().min(1),
  amountMinor: MoneyMinorSchema,
  reason: z.string().optional(),
})

// --- Events -----------------------------------------------------------------------------------

const envelopeShape = {
  eventId: UuidSchema,
  aggregateId: UuidSchema,
  occurredAt: IsoDateTimeSchema,
}

export const OrderEventSchema = z.discriminatedUnion('eventType', [
  z.object({
    ...envelopeShape,
    eventType: z.literal('OrderOpened'),
    payload: OrderOpenedPayloadSchema,
  }),
  z.object({
    ...envelopeShape,
    eventType: z.literal('LineAdded'),
    payload: LineAddedPayloadSchema,
  }),
  z.object({
    ...envelopeShape,
    eventType: z.literal('ModifierApplied'),
    payload: ModifierAppliedPayloadSchema,
  }),
  z.object({
    ...envelopeShape,
    eventType: z.literal('LineVoided'),
    payload: LineVoidedPayloadSchema,
  }),
  z.object({
    ...envelopeShape,
    eventType: z.literal('DiscountApplied'),
    payload: DiscountAppliedPayloadSchema,
  }),
  z.object({
    ...envelopeShape,
    eventType: z.literal('OrderTendered'),
    payload: OrderTenderedPayloadSchema,
  }),
  z.object({
    ...envelopeShape,
    eventType: z.literal('OrderClosed'),
    payload: OrderClosedPayloadSchema,
  }),
  z.object({
    ...envelopeShape,
    eventType: z.literal('OrderRefunded'),
    payload: OrderRefundedPayloadSchema,
  }),
])

export type OrderEventInput = z.input<typeof OrderEventSchema>
export type OrderEventParsed = z.infer<typeof OrderEventSchema>

// --- Drift guard: the parsed schema must equal the domain event type, both directions. ---------

type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

// If this line stops compiling, the Zod schema and `@batch/domain`'s `OrderEvent` have diverged.
const _schemaMatchesDomain: Equals<OrderEventParsed, OrderEvent> = true
void _schemaMatchesDomain
