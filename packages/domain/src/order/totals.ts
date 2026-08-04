/**
 * Order totals — a pure projection of `OrderState`.
 *
 * This is the number the till shows and the server re-derives to verify. Because the till and the
 * API import this identical function from `@batch/domain`, the two can never disagree on money.
 */

import { allocateByWeights, divHalfAwayFromZero, minor, type Currency } from '../money'
import { vatBreakdown, type VatBand, type VatLine } from '../vat'
import type { OrderState } from './state'

export interface OrderTotals {
  readonly currency: Currency
  /** Gross of all active lines and modifiers, before discounts. VAT-inclusive. */
  readonly subtotalMinor: bigint
  readonly discountMinor: bigint
  /** What the customer pays: subtotal − discount, clamped at zero. VAT-inclusive. */
  readonly totalMinor: bigint
  /** VAT contained within the total, summed across bands. */
  readonly vatMinor: bigint
  readonly vatByBand: readonly VatBand[]
  /** Amount applied to the balance across all tenders. */
  readonly tenderedMinor: bigint
  /** Physical cash taken in (CASH tenders). */
  readonly cashTenderedMinor: bigint
  /** Change handed back. */
  readonly changeMinor: bigint
  /** total − applied tenders. Positive = still owed, negative = overpaid. */
  readonly balanceMinor: bigint
  readonly refundedMinor: bigint
}

/**
 * VAT-bearing gross entries: each active line contributes its base at the line's rate, and each
 * modifier contributes at its own rate (an extra shot may sit in a different band than the coffee).
 * Modifiers are per-unit, so they scale with the line quantity.
 */
function grossEntries(state: OrderState): VatLine[] {
  const entries: VatLine[] = []
  for (const line of state.lines) {
    const activeQty = line.quantity - line.voidedQuantity
    if (activeQty <= 0n) continue
    entries.push({ grossMinor: activeQty * line.unitPriceMinor, vatRateBp: line.vatRateBp })
    for (const mod of line.modifiers) {
      entries.push({ grossMinor: activeQty * mod.unitPriceMinor, vatRateBp: mod.vatRateBp })
    }
  }
  return entries
}

export function computeTotals(state: OrderState): OrderTotals {
  const { currency } = state
  const entries = grossEntries(state)
  const subtotal = entries.reduce((sum, e) => sum + e.grossMinor, 0n)

  // Discounts stack in event order, each applied to the running (already-discounted) amount, and
  // the running total is clamped so it can never fall below zero.
  let running = subtotal
  for (const d of state.discounts) {
    if (d.kind === 'PERCENT') {
      running -= divHalfAwayFromZero(running * BigInt(d.rateBp ?? 0), 10000n)
    } else {
      running -= d.amountMinor ?? 0n
    }
    if (running < 0n) running = 0n
  }
  const total = running
  const discount = subtotal - total

  // Push the discount proportionally down onto the gross entries so VAT is extracted from the
  // amount actually paid, per band, with no rounding drift (allocation sums back to `total`).
  let vatLines: VatLine[]
  if (subtotal === 0n || total === subtotal) {
    vatLines = entries
  } else {
    const allocated = allocateByWeights(
      minor(total, currency),
      entries.map((e) => e.grossMinor),
    )
    vatLines = entries.map((e, i) => {
      const share = allocated[i]
      // allocateByWeights returns one share per weight; lengths match by construction.
      if (share === undefined) throw new Error('vat allocation length mismatch')
      return { grossMinor: share.amountMinor, vatRateBp: e.vatRateBp }
    })
  }
  const vatByBand = vatBreakdown(vatLines)
  const vatMinor = vatByBand.reduce((sum, b) => sum + b.vatMinor, 0n)

  let tendered = 0n
  let cashTendered = 0n
  let change = 0n
  for (const t of state.tenders) {
    tendered += t.amountMinor
    if (t.method === 'CASH') {
      cashTendered += t.tenderedMinor ?? t.amountMinor
      change += t.changeMinor ?? 0n
    }
  }
  const refunded = state.refunds.reduce((sum, r) => sum + r.amountMinor, 0n)

  return {
    currency,
    subtotalMinor: subtotal,
    discountMinor: discount,
    totalMinor: total,
    vatMinor,
    vatByBand,
    tenderedMinor: tendered,
    cashTenderedMinor: cashTendered,
    changeMinor: change,
    balanceMinor: total - tendered,
    refundedMinor: refunded,
  }
}
