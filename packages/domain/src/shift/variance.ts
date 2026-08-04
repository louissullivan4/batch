/**
 * Cash reconciliation for a shift (ADR 0010) — the cross-aggregate seam.
 *
 * Cash *sales* are `order`-aggregate `OrderTendered{method:'CASH'}` events, not shift events, so the
 * expected drawer figure is a pure function of **both** the shift state and a `cashSalesMinor` scalar
 * the caller supplies (the till sums CASH tenders since `ShiftOpened` from its local order store).
 * Keeping this out of the reducer is what preserves single-stream replay purity.
 *
 * No rounding happens here: every input is already an exact `bigint` in minor units, and expected
 * cash is pure addition and subtraction. There is no division, so there is no rounding policy to
 * state — a reconciliation that divided money would have to.
 */

import type { DenominationCount } from './events'
import type { ShiftState } from './state'

/** Total a denomination breakdown: Σ `denominationMinor * count`. Exact, no rounding. */
export function sumDenominations(denominations: readonly DenominationCount[]): bigint {
  let sum = 0n
  for (const d of denominations) sum += d.denominationMinor * d.count
  return sum
}

/**
 * Expected drawer cash (ADR 0010):
 *
 *   openingFloatMinor + cashSalesMinor + Σ PaidIn − Σ PaidOut − Σ Skim − Σ SafeDrop
 *
 * `cashSalesMinor` is supplied by the caller — it lives in the order aggregate.
 */
export function expectedDrawerMinor(state: ShiftState, cashSalesMinor: bigint): bigint {
  let expected = state.openingFloatMinor + cashSalesMinor
  for (const m of state.movements) {
    switch (m.kind) {
      case 'PaidIn':
        expected += m.amountMinor
        break
      case 'PaidOut':
      case 'Skim':
      case 'SafeDrop':
        expected -= m.amountMinor
        break
    }
  }
  return expected
}

export type VarianceDirection = 'OVER' | 'SHORT' | 'EXACT'

export interface Variance {
  /** counted − expected. Positive is over the drawer, negative is short. */
  readonly varianceMinor: bigint
  readonly direction: VarianceDirection
}

/**
 * Variance = `countedMinor − expectedMinor`. OVER when the drawer holds more than expected (▲),
 * SHORT when less (▼), EXACT at zero. Symmetric: swapping counted and expected negates the variance
 * and flips OVER/SHORT.
 */
export function computeVariance(countedMinor: bigint, expectedMinor: bigint): Variance {
  const varianceMinor = countedMinor - expectedMinor
  const direction: VarianceDirection = varianceMinor > 0n ? 'OVER' : varianceMinor < 0n ? 'SHORT' : 'EXACT'
  return { varianceMinor, direction }
}
