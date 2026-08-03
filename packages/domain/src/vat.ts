/**
 * Irish VAT for Batch.
 *
 * Two things make POS VAT awkward, and both are handled here rather than at call sites:
 *
 *  1. Menu prices are **VAT-inclusive**, so tax is *extracted* from a gross amount, never added to
 *     a net one. The net-to-gross formula produces a number that is small, plausible, and wrong.
 *  2. The rate depends on **(product, fulfilment mode)**, not the product alone — the same coffee
 *     is one rate eaten in and another taken away.
 *
 * Rates below are the configured defaults only. The rate that governs a sale is snapshotted onto
 * the line event as `vatRateBp` at the moment of sale; historic receipts and VAT returns are always
 * computed from that snapshot, never from current configuration. Verify current rates at revenue.ie
 * — Irish hospitality VAT has moved repeatedly.
 */

import { divHalfAwayFromZero } from './money'

/** VAT rate in basis points. 23% is 2300, 13.5% is 1350, 9% is 900, 0% is 0. */
export type VatRateBp = number

export type FulfilmentMode = 'EAT_IN' | 'TAKEAWAY'

export const VAT_STANDARD_BP = 2300
export const VAT_REDUCED_BP = 1350
export const VAT_SECOND_REDUCED_BP = 900
export const VAT_ZERO_BP = 0

/**
 * A product's VAT rates, split by fulfilment. Stored on the (CRUD) product row and snapshotted onto
 * the line event when a sale happens. Modelling both modes now — even though M1 is counter-service
 * only — avoids rewriting every historic projection when eat-in/takeaway lands.
 */
export interface ProductTaxProfile {
  readonly vatRateBpEatIn: VatRateBp
  readonly vatRateBpTakeaway: VatRateBp
}

export function resolveVatRateBp(profile: ProductTaxProfile, mode: FulfilmentMode): VatRateBp {
  return mode === 'EAT_IN' ? profile.vatRateBpEatIn : profile.vatRateBpTakeaway
}

function assertRate(rateBp: VatRateBp): void {
  if (!Number.isInteger(rateBp) || rateBp < 0) {
    throw new RangeError(`vatRateBp must be a non-negative integer, got ${rateBp}`)
  }
}

/**
 * Extract VAT from a VAT-inclusive gross amount.
 *
 *   vat = gross * rateBp / (10000 + rateBp)
 *
 * rounded half away from zero (see `divHalfAwayFromZero` — the odd rounding is what makes a refund
 * reverse a sale to the cent).
 */
export function extractVatMinor(grossMinor: bigint, rateBp: VatRateBp): bigint {
  assertRate(rateBp)
  if (rateBp === 0) return 0n
  return divHalfAwayFromZero(grossMinor * BigInt(rateBp), BigInt(10000 + rateBp))
}

/** The net (ex-VAT) portion of a VAT-inclusive gross amount. */
export function netFromGrossMinor(grossMinor: bigint, rateBp: VatRateBp): bigint {
  return grossMinor - extractVatMinor(grossMinor, rateBp)
}

export interface VatLine {
  readonly grossMinor: bigint
  readonly vatRateBp: VatRateBp
}

export interface VatBand {
  readonly vatRateBp: VatRateBp
  readonly grossMinor: bigint
  readonly netMinor: bigint
  readonly vatMinor: bigint
}

/**
 * Group lines by rate band and compute VAT per band.
 *
 * Policy: VAT is extracted **once per band** from the band's gross subtotal — a single rounding per
 * rate, not per line then summed. That is both how a VAT return is filed (by rate) and how you
 * avoid per-line rounding drift. A mixed-rate ticket (hot coffee eat-in, chocolate bar at standard,
 * cold sandwich takeaway at zero) is the normal case, not the exception. Bands come back sorted by
 * descending rate so receipts render stably.
 */
export function vatBreakdown(lines: readonly VatLine[]): VatBand[] {
  const grossByRate = new Map<VatRateBp, bigint>()
  for (const line of lines) {
    assertRate(line.vatRateBp)
    grossByRate.set(line.vatRateBp, (grossByRate.get(line.vatRateBp) ?? 0n) + line.grossMinor)
  }

  const bands: VatBand[] = []
  for (const [vatRateBp, grossMinor] of grossByRate) {
    const vatMinor = extractVatMinor(grossMinor, vatRateBp)
    bands.push({ vatRateBp, grossMinor, netMinor: grossMinor - vatMinor, vatMinor })
  }
  bands.sort((a, b) => b.vatRateBp - a.vatRateBp)
  return bands
}

/** Total VAT across every band on the ticket. */
export function totalVatMinor(lines: readonly VatLine[]): bigint {
  let total = 0n
  for (const band of vatBreakdown(lines)) total += band.vatMinor
  return total
}
