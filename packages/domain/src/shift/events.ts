/**
 * Shift aggregate events (ADR 0010).
 *
 * A shift is a **drawer session**: opened on a device, floated, paid in/out, counted, and sealed by
 * a terminal Z-read. These are the in-memory (parsed) shapes the reducer consumes — money is
 * `bigint` minor units here, a denomination *count* is a `bigint` quantity (like an order line
 * quantity). `@batch/schemas` defines the Zod validators that parse wire JSON (money as string) into
 * exactly these types; a compile-time check there keeps the two in lock-step.
 *
 * Blind-count integrity is **structural**: `CashDeclared` carries `countedMinor` only and never any
 * `expected*` figure — there is nothing on the client to inspect during a count. Expected drawer
 * cash is derived after the count commits, by `variance.ts`, from the sealed log.
 */

import type { Currency } from '../money'
// Reuse the shared envelope rather than duplicating it (ADR 0010 impl note); the order module owns
// and exports it. The dependency arrow is domain-internal only — no `apps/` import.
import type { EventEnvelope } from '../order/events'

export type { EventEnvelope }

/** Opening float (once, `countSeq` 0) or a drawer count (`countSeq` 1, 2, …). */
export type CashDeclarePurpose = 'OPENING_FLOAT' | 'COUNT'

/** A denomination row in a blind count: the coin/note value and how many were counted. */
export interface DenominationCount {
  /** The denomination's face value in minor units, e.g. `500n` for a €5 note. Money → `bigint`. */
  readonly denominationMinor: bigint
  /** How many of that denomination were counted. A quantity → `bigint`. */
  readonly count: bigint
}

export interface ShiftOpenedPayload {
  readonly deviceId: string
  readonly openedByStaffId: string
  readonly currency: Currency
}

/**
 * A cash declaration — the opening float or a drawer count. Carries **counted** cash only; it holds
 * no `expected*` field by construction (ADR 0010 blind-count integrity). When `denominations` are
 * given, `countedMinor` must equal Σ `denominationMinor * count`; the single-total fallback path
 * passes an empty `denominations` array with a non-zero `countedMinor`.
 */
export interface CashDeclaredPayload {
  readonly purpose: CashDeclarePurpose
  readonly countSeq: bigint
  readonly denominations: readonly DenominationCount[]
  readonly countedMinor: bigint
}

/** PaidIn / PaidOut / Skim / SafeDrop share a shape. A correction is a reversing movement, never an edit. */
export interface CashMovementPayload {
  readonly movementId: string
  readonly amountMinor: bigint
  readonly reason: string
  readonly authStaffId: string
}

export interface ShiftHandoverPayload {
  readonly fromStaffId: string
  readonly toStaffId: string
}

/**
 * The terminal Z-read. `varianceMinor` is a **snapshot** supplied by the caller — it depends on cash
 * *sales* from the order aggregate, which the shift reducer cannot see (ADR 0010 cross-aggregate
 * seam). `zNumber` is the caller-supplied per-device sequence (`{deviceId}-{n}`), stable offline.
 */
export interface ShiftClosedPayload {
  readonly zNumber: string
  readonly closedByStaffId: string
  readonly finalCountSeq: bigint
  readonly varianceMinor: bigint
  readonly reasonCodes: readonly string[]
  readonly authorised: boolean
}

export type ShiftEvent =
  | (EventEnvelope & { readonly eventType: 'ShiftOpened'; readonly payload: ShiftOpenedPayload })
  | (EventEnvelope & { readonly eventType: 'CashDeclared'; readonly payload: CashDeclaredPayload })
  | (EventEnvelope & { readonly eventType: 'PaidIn'; readonly payload: CashMovementPayload })
  | (EventEnvelope & { readonly eventType: 'PaidOut'; readonly payload: CashMovementPayload })
  | (EventEnvelope & { readonly eventType: 'Skim'; readonly payload: CashMovementPayload })
  | (EventEnvelope & { readonly eventType: 'SafeDrop'; readonly payload: CashMovementPayload })
  | (EventEnvelope & { readonly eventType: 'ShiftHandover'; readonly payload: ShiftHandoverPayload })
  | (EventEnvelope & { readonly eventType: 'ShiftClosed'; readonly payload: ShiftClosedPayload })

export type ShiftEventType = ShiftEvent['eventType']

/** The four cash-movement events, which share `CashMovementPayload`. */
export type CashMovementType = 'PaidIn' | 'PaidOut' | 'Skim' | 'SafeDrop'

export const CASH_MOVEMENT_TYPES: readonly CashMovementType[] = [
  'PaidIn',
  'PaidOut',
  'Skim',
  'SafeDrop',
]

export const SHIFT_EVENT_TYPES: readonly ShiftEventType[] = [
  'ShiftOpened',
  'CashDeclared',
  'PaidIn',
  'PaidOut',
  'Skim',
  'SafeDrop',
  'ShiftHandover',
  'ShiftClosed',
]
