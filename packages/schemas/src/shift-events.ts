import { z } from 'zod'
import type { shift } from '@batch/domain'
import {
  CountSchema,
  CurrencySchema,
  IsoDateTimeSchema,
  MoneyMinorSchema,
  UuidSchema,
} from './primitives'

/**
 * Zod validators for the shift events (ADR 0010). Parsing produces objects whose types match the
 * domain's `shift.ShiftEvent` exactly — enforced by the compile-time check at the bottom of this
 * file, kept in lock-step with `order-events.ts`. Money and denomination counts cross the wire as
 * decimal strings and parse back to `bigint`.
 *
 * Blind-count integrity is structural here too: `CashDeclaredPayloadSchema` has `countedMinor` and
 * no `expected*` field — there is nothing on the wire to leak an expected figure.
 */

// --- Payloads ---------------------------------------------------------------------------------

export const ShiftOpenedPayloadSchema = z.object({
  deviceId: z.string().min(1),
  openedByStaffId: z.string().min(1),
  currency: CurrencySchema,
})

/** One denomination row of a blind count: face value (money) and how many counted (a quantity). */
export const DenominationCountSchema = z.object({
  denominationMinor: MoneyMinorSchema,
  count: CountSchema,
})

export const CashDeclaredPayloadSchema = z.object({
  purpose: z.enum(['OPENING_FLOAT', 'COUNT']),
  countSeq: CountSchema,
  // `.readonly()` so the inferred element array is `readonly`, matching the domain payload type
  // (the drift guard at the foot of this file compares the two structurally, readonly included).
  denominations: z.array(DenominationCountSchema).readonly(),
  countedMinor: MoneyMinorSchema,
})

export const CashMovementPayloadSchema = z.object({
  movementId: z.string().min(1),
  amountMinor: MoneyMinorSchema,
  reason: z.string().min(1),
  authStaffId: z.string().min(1),
})

export const ShiftHandoverPayloadSchema = z.object({
  fromStaffId: z.string().min(1),
  toStaffId: z.string().min(1),
})

export const ShiftClosedPayloadSchema = z.object({
  zNumber: z.string().min(1),
  closedByStaffId: z.string().min(1),
  finalCountSeq: CountSchema,
  // Signed: a shortfall is negative. `MoneyMinorSchema` accepts a leading `-`.
  varianceMinor: MoneyMinorSchema,
  reasonCodes: z.array(z.string()).readonly(),
  authorised: z.boolean(),
})

// --- Events -----------------------------------------------------------------------------------

const envelopeShape = {
  eventId: UuidSchema,
  aggregateId: UuidSchema,
  occurredAt: IsoDateTimeSchema,
}

export const ShiftEventSchema = z.discriminatedUnion('eventType', [
  z.object({ ...envelopeShape, eventType: z.literal('ShiftOpened'), payload: ShiftOpenedPayloadSchema }),
  z.object({ ...envelopeShape, eventType: z.literal('CashDeclared'), payload: CashDeclaredPayloadSchema }),
  z.object({ ...envelopeShape, eventType: z.literal('PaidIn'), payload: CashMovementPayloadSchema }),
  z.object({ ...envelopeShape, eventType: z.literal('PaidOut'), payload: CashMovementPayloadSchema }),
  z.object({ ...envelopeShape, eventType: z.literal('Skim'), payload: CashMovementPayloadSchema }),
  z.object({ ...envelopeShape, eventType: z.literal('SafeDrop'), payload: CashMovementPayloadSchema }),
  z.object({ ...envelopeShape, eventType: z.literal('ShiftHandover'), payload: ShiftHandoverPayloadSchema }),
  z.object({ ...envelopeShape, eventType: z.literal('ShiftClosed'), payload: ShiftClosedPayloadSchema }),
])

export type ShiftEventInput = z.input<typeof ShiftEventSchema>
export type ShiftEventParsed = z.infer<typeof ShiftEventSchema>
/** The wire event type after parsing — an alias for readability at call sites. */
export type ShiftEvent = ShiftEventParsed

// --- Drift guard: the parsed schema must equal the domain event type, both directions. ---------

type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

// If this line stops compiling, the Zod schema and `@batch/domain`'s `shift.ShiftEvent` have diverged.
const _schemaMatchesDomain: Equals<ShiftEventParsed, shift.ShiftEvent> = true
void _schemaMatchesDomain
