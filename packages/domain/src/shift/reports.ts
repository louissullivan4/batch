/**
 * Shift reports (ADR 0010) — pure folds over shift state. **No events, no mutation.**
 *
 * The X report is deliberately not an event: it is a pure projection of current state and appends
 * nothing, which is exactly why "X does not mutate any state" holds by construction (ADR 0010). Z is
 * derived from the already-sealed `ShiftClosed` — it reads the terminal state, it does not write.
 */

import { expectedDrawerMinor } from './variance'
import { ShiftReductionError } from './reduce'
import type { CashMovementType } from './events'
import type { ShiftState } from './state'

/** The drawer breakdown shared by both reports — a per-kind fold of the movements plus the float. */
interface DrawerBreakdown {
  readonly openingFloatMinor: bigint
  readonly paidInMinor: bigint
  readonly paidOutMinor: bigint
  readonly skimMinor: bigint
  readonly safeDropMinor: bigint
  readonly movementCount: number
  /** Highest declaration sequence seen, float (0) included; `0n` when only the float exists. */
  readonly latestCountSeq: bigint
}

const MOVEMENT_FIELD: Record<CashMovementType, keyof Pick<DrawerBreakdown, 'paidInMinor' | 'paidOutMinor' | 'skimMinor' | 'safeDropMinor'>> = {
  PaidIn: 'paidInMinor',
  PaidOut: 'paidOutMinor',
  Skim: 'skimMinor',
  SafeDrop: 'safeDropMinor',
}

function drawerBreakdown(state: ShiftState): DrawerBreakdown {
  let paidInMinor = 0n
  let paidOutMinor = 0n
  let skimMinor = 0n
  let safeDropMinor = 0n
  for (const m of state.movements) {
    switch (MOVEMENT_FIELD[m.kind]) {
      case 'paidInMinor':
        paidInMinor += m.amountMinor
        break
      case 'paidOutMinor':
        paidOutMinor += m.amountMinor
        break
      case 'skimMinor':
        skimMinor += m.amountMinor
        break
      case 'safeDropMinor':
        safeDropMinor += m.amountMinor
        break
    }
  }
  let latestCountSeq = 0n
  for (const c of state.counts) if (c.countSeq > latestCountSeq) latestCountSeq = c.countSeq
  return {
    openingFloatMinor: state.openingFloatMinor,
    paidInMinor,
    paidOutMinor,
    skimMinor,
    safeDropMinor,
    movementCount: state.movements.length,
    latestCountSeq,
  }
}

export interface XReport extends DrawerBreakdown {
  readonly cashSalesMinor: bigint
  readonly expectedDrawerMinor: bigint
}

/**
 * The mid-shift X report: a pure snapshot of the drawer given the caller's `cashSalesMinor` (summed
 * from the order aggregate). Repeatable and non-destructive — it changes nothing.
 */
export function xReport(state: ShiftState, cashSalesMinor: bigint): XReport {
  return {
    ...drawerBreakdown(state),
    cashSalesMinor,
    expectedDrawerMinor: expectedDrawerMinor(state, cashSalesMinor),
  }
}

export interface ZReport extends DrawerBreakdown {
  readonly zNumber: string
  readonly closedByStaffId: string
  readonly finalCountSeq: bigint
  readonly varianceMinor: bigint
  /** The counted total of the final count referenced by `finalCountSeq`. */
  readonly countedMinor: bigint
  /**
   * Expected drawer at close, reconstructed from the sealed figures: `counted − variance`. And
   * `cashSalesMinor` is backed out from it, since the Z-read stores the variance snapshot rather
   * than the sales figure. Both are pure derivations of the terminal state — no fresh input needed.
   */
  readonly expectedDrawerMinor: bigint
  readonly cashSalesMinor: bigint
}

/**
 * The Z report, derived from a **CLOSED** shift. Rejects an open shift — Z reads the terminal state,
 * so there is nothing to report until the shift is sealed.
 */
export function zReport(state: ShiftState): ZReport {
  const { zNumber, closedByStaffId, finalCountSeq, varianceMinor } = state
  // These fields are all set together by `ShiftClosed`; checking them individually narrows the
  // optionals to non-undefined without a non-null assertion.
  if (
    state.status !== 'CLOSED' ||
    zNumber === undefined ||
    closedByStaffId === undefined ||
    finalCountSeq === undefined ||
    varianceMinor === undefined
  ) {
    throw new ShiftReductionError('NOT_CLOSED', 'zReport requires a CLOSED shift')
  }

  const finalCount =
    state.counts.find((c) => c.purpose === 'COUNT' && c.countSeq === finalCountSeq) ??
    [...state.counts].reverse().find((c) => c.purpose === 'COUNT')
  const countedMinor = finalCount?.countedMinor ?? 0n
  const expected = countedMinor - varianceMinor

  const breakdown = drawerBreakdown(state)
  // Back out cash sales from the expected identity (ADR 0010), so the Z shows the full drawer picture.
  const cashSalesMinor =
    expected -
    breakdown.openingFloatMinor -
    breakdown.paidInMinor +
    breakdown.paidOutMinor +
    breakdown.skimMinor +
    breakdown.safeDropMinor

  return {
    ...breakdown,
    zNumber,
    closedByStaffId,
    finalCountSeq,
    varianceMinor,
    countedMinor,
    expectedDrawerMinor: expected,
    cashSalesMinor,
  }
}
