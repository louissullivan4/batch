/** The projected state of a shift, folded from its events. All money is `bigint` minor units. */

import type { Currency } from '../money'
import type { CashDeclarePurpose, CashMovementType, DenominationCount } from './events'

export type ShiftStatus = 'OPEN' | 'CLOSED'

/** A committed cash movement, tagged with which of the four events produced it. */
export interface CashMovement {
  readonly movementId: string
  readonly kind: CashMovementType
  readonly amountMinor: bigint
  readonly reason: string
  readonly authStaffId: string
}

/** A committed declaration — the opening float (`purpose` OPENING_FLOAT, `countSeq` 0) or a count. */
export interface CashCount {
  readonly purpose: CashDeclarePurpose
  readonly countSeq: bigint
  readonly denominations: readonly DenominationCount[]
  readonly countedMinor: bigint
}

export interface ShiftState {
  readonly shiftId: string
  readonly status: ShiftStatus
  readonly deviceId: string
  readonly currency: Currency
  readonly openedByStaffId: string
  /** Who currently holds the drawer — moves on `ShiftHandover`, starts as the opener. */
  readonly currentStaffId: string
  readonly openedAt: string
  /** The declared opening float; `0n` until an `OPENING_FLOAT` declaration commits. */
  readonly openingFloatMinor: bigint
  readonly floatDeclared: boolean
  /** Highest committed `COUNT` sequence; `0n` means no count yet (counts start at 1). */
  readonly maxCountSeq: bigint
  /** Every declaration in commit order — the float and each count, recounts included. */
  readonly counts: readonly CashCount[]
  readonly movements: readonly CashMovement[]
  // --- Set only once, by ShiftClosed (the terminal Z-read). ---
  readonly closedByStaffId?: string
  readonly zNumber?: string
  readonly varianceMinor?: bigint
  readonly finalCountSeq?: bigint
  readonly reasonCodes?: readonly string[]
  readonly authorised?: boolean
  /** Every event id folded so far — the reducer rejects a replay of any of them. */
  readonly appliedEventIds: ReadonlySet<string>
}
