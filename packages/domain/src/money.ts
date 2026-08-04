/**
 * Money in Batch.
 *
 * An amount is a `bigint` count of **minor units** (euro cents). Never a `number`, never a float,
 * never a decimal library. `0.1 + 0.2 !== 0.3` in IEEE 754 and a till performs millions of
 * additions per shift; integer cents make every rounding decision explicit and testable instead of
 * emergent.
 *
 * Nothing outside this module constructs a `Money`. Use `euro`, `minor`, or `zero`.
 */

import { err, ok, type Result } from './result'

export type Currency = 'EUR'

export const DEFAULT_CURRENCY: Currency = 'EUR'

export interface Money {
  readonly amountMinor: bigint
  readonly currency: Currency
}

// --- Construction -----------------------------------------------------------------------------

/** Construct money from a raw minor-unit (cent) count. */
export function minor(amountMinor: bigint, currency: Currency = DEFAULT_CURRENCY): Money {
  return { amountMinor, currency }
}

/**
 * Construct money from whole units + cents, for readable test fixtures: `euro(4, 50)` is €4.50.
 * `units` must be a non-negative integer and `cents` in [0, 99]; build negatives with `negate`.
 */
export function euro(units: number, cents = 0, currency: Currency = DEFAULT_CURRENCY): Money {
  if (!Number.isInteger(units) || units < 0) {
    throw new RangeError(`euro(): units must be a non-negative integer, got ${units}`)
  }
  if (!Number.isInteger(cents) || cents < 0 || cents > 99) {
    throw new RangeError(`euro(): cents must be an integer in [0, 99], got ${cents}`)
  }
  return minor(BigInt(units) * 100n + BigInt(cents), currency)
}

/** The additive identity for a currency. */
export function zero(currency: Currency = DEFAULT_CURRENCY): Money {
  return minor(0n, currency)
}

/**
 * Parse an amount the operator typed on a keypad into `Money`, rejecting anything ambiguous rather
 * than guessing. Returns a `Result` — a bad entry is expected input, not a bug.
 *
 * Accepted (case/space tolerant, one optional leading `€`), all non-negative:
 *   `"4"` → €4.00 · `"4.5"` → €4.50 · `"4.50"` → €4.50 · `"0.09"` → €0.09
 *
 * Rejected as ambiguous or malformed — with a reason:
 *   - empty / whitespace only
 *   - a comma (`"1,50"`): the decimal separator is `.`; a comma could mean €1.50 or a €1,50-grouping
 *   - more than two decimal places (`"1.005"`): sub-cent, cannot be represented
 *   - a leading or trailing separator (`".5"`, `"1."`)
 *   - a sign, letters, a second `.`, or any other stray character
 *
 * Note this is the **decimal** reading: `"450"` is €450.00, not €4.50. A cents-entry keypad mode
 * (type `450` → €4.50) is a different, and by itself ambiguous, convention and is not this function.
 */
export function parseKeypadInput(input: string, currency: Currency = DEFAULT_CURRENCY): Result<Money> {
  const trimmed = input.trim().replace(/^€/, '').trim()
  if (trimmed === '') return err('empty amount')
  if (trimmed.includes(',')) return err(`use '.' as the decimal separator, not ',': "${input}"`)
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed)
  if (!match) return err(`not a valid amount: "${input}"`)
  const [, whole, frac] = match
  // whole is guaranteed by the capture group; frac is the optional decimals.
  const euros = BigInt(whole ?? '0')
  const cents = BigInt((frac ?? '').padEnd(2, '0'))
  return ok(minor(euros * 100n + cents, currency))
}

// --- Guards -----------------------------------------------------------------------------------

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new TypeError(`currency mismatch: ${a.currency} vs ${b.currency}`)
  }
}

export function isZero(a: Money): boolean {
  return a.amountMinor === 0n
}

export function isNegative(a: Money): boolean {
  return a.amountMinor < 0n
}

export function isPositive(a: Money): boolean {
  return a.amountMinor > 0n
}

// --- Arithmetic -------------------------------------------------------------------------------

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b)
  return minor(a.amountMinor + b.amountMinor, a.currency)
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b)
  return minor(a.amountMinor - b.amountMinor, a.currency)
}

export function negate(a: Money): Money {
  return minor(-a.amountMinor, a.currency)
}

/** Multiply by an integer factor — a line quantity, never a fractional rate. */
export function multiply(a: Money, factor: bigint): Money {
  return minor(a.amountMinor * factor, a.currency)
}

export function sumMoney(items: readonly Money[], currency: Currency = DEFAULT_CURRENCY): Money {
  let total = 0n
  for (const item of items) {
    if (item.currency !== currency) {
      throw new TypeError(`currency mismatch in sum: ${item.currency} vs ${currency}`)
    }
    total += item.amountMinor
  }
  return minor(total, currency)
}

// --- Comparison -------------------------------------------------------------------------------

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b)
  if (a.amountMinor < b.amountMinor) return -1
  if (a.amountMinor > b.amountMinor) return 1
  return 0
}

export function equals(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.amountMinor === b.amountMinor
}

export function maxMoney(a: Money, b: Money): Money {
  return compare(a, b) >= 0 ? a : b
}

export function minMoney(a: Money, b: Money): Money {
  return compare(a, b) <= 0 ? a : b
}

/** Clamp to zero from below. Used to keep totals and discounts from ever going negative. */
export function clampNonNegative(a: Money): Money {
  return isNegative(a) ? zero(a.currency) : a
}

// --- Rounding ---------------------------------------------------------------------------------

/**
 * Integer division of `numerator / denominator`, rounding halves **away from zero**.
 *
 * Away-from-zero (rather than half-up) is deliberate: it makes the operation odd — `div(-n, d)`
 * equals `-div(n, d)` — so extracting VAT from a refund reverses extracting it from the original
 * sale to the cent. In an append-only ledger where corrections are compensating events, that
 * symmetry is what stops a refunded order leaving a stray cent of tax behind.
 *
 * `denominator` must be positive.
 */
export function divHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new RangeError(`denominator must be positive, got ${denominator}`)
  }
  const sign = numerator < 0n ? -1n : 1n
  const n = numerator < 0n ? -numerator : numerator
  return sign * ((2n * n + denominator) / (2n * denominator))
}

/**
 * Apply a basis-point rate to an amount, rounding half away from zero.
 * 13.5% is `1350`; `applyRateBp(minor(1000n), 1350)` is €1.35. `applyRateBp(x, 10000)` is `x`.
 */
export function applyRateBp(amount: Money, rateBp: number): Money {
  if (!Number.isInteger(rateBp) || rateBp < 0) {
    throw new RangeError(`rateBp must be a non-negative integer, got ${rateBp}`)
  }
  return minor(divHalfAwayFromZero(amount.amountMinor * BigInt(rateBp), 10000n), amount.currency)
}

// --- Division policies ------------------------------------------------------------------------

/**
 * Split `total` into `parts` shares as evenly as possible.
 *
 * Rounding policy: the leftover minor units are handed out one each to the **first** shares, in
 * order — the earliest payer absorbs the extra cent. €10.00 across 3 => [334, 333, 333]. The sign
 * of `total` is preserved, so a refund splits identically with the sign flipped.
 */
export function splitEvenly(total: Money, parts: number): Money[] {
  if (!Number.isInteger(parts) || parts <= 0) {
    throw new RangeError(`parts must be a positive integer, got ${parts}`)
  }
  const p = BigInt(parts)
  const base = total.amountMinor / p // bigint division truncates toward zero
  const remainder = total.amountMinor - base * p // shares the sign of `total`
  const step = remainder < 0n ? -1n : 1n
  let owed = remainder < 0n ? -remainder : remainder

  const shares: Money[] = []
  for (let i = 0; i < parts; i++) {
    let share = base
    if (owed > 0n) {
      share += step
      owed -= 1n
    }
    shares.push(minor(share, total.currency))
  }
  return shares
}

/**
 * Allocate `total` across `weights` proportionally.
 *
 * Rounding policy: the largest-remainder (Hamilton) method — the leftover minor units go to the
 * weights with the largest fractional part, ties broken toward the earliest index. The result
 * always sums back to `total` exactly. A zero weight receives zero. Sign is preserved.
 *
 * Used to push an order-level discount and its VAT down onto rate bands without drift.
 */
export function allocateByWeights(total: Money, weights: readonly bigint[]): Money[] {
  if (weights.length === 0) {
    throw new RangeError('allocateByWeights(): need at least one weight')
  }
  let totalWeight = 0n
  for (const w of weights) {
    if (w < 0n) throw new RangeError('allocateByWeights(): weights must be non-negative')
    totalWeight += w
  }
  if (totalWeight === 0n) {
    throw new RangeError('allocateByWeights(): at least one weight must be positive')
  }

  const sign = total.amountMinor < 0n ? -1n : 1n
  const magnitude = total.amountMinor < 0n ? -total.amountMinor : total.amountMinor

  const entries = weights.map((weight, index) => {
    const numerator = magnitude * weight
    const base = numerator / totalWeight // floor, since everything here is non-negative
    const frac = numerator - base * totalWeight
    return { index, base, frac }
  })

  let distributed = 0n
  for (const e of entries) distributed += e.base
  let leftover = magnitude - distributed // 0 <= leftover < weights.length

  const bonus = new Map<number, bigint>()
  const byFrac = [...entries].sort((a, b) => {
    if (a.frac < b.frac) return 1
    if (a.frac > b.frac) return -1
    return a.index - b.index
  })
  for (const e of byFrac) {
    if (leftover <= 0n) break
    bonus.set(e.index, 1n)
    leftover -= 1n
  }

  return entries.map((e) => minor(sign * (e.base + (bonus.get(e.index) ?? 0n)), total.currency))
}

// --- Display ----------------------------------------------------------------------------------

const CURRENCY_SYMBOL: Record<Currency, string> = { EUR: '€' }

/**
 * Format minor units for display, straight from the `bigint` — never via a float. 450 => "€4.50",
 * -450 => "-€4.50". This is the only place a money value becomes a human string.
 */
export function formatMinor(amountMinor: bigint, currency: Currency = DEFAULT_CURRENCY): string {
  const negative = amountMinor < 0n
  const abs = negative ? -amountMinor : amountMinor
  const units = abs / 100n
  const cents = abs % 100n
  const centsStr = cents.toString().padStart(2, '0')
  return `${negative ? '-' : ''}${CURRENCY_SYMBOL[currency]}${units.toString()}.${centsStr}`
}

export function formatMoney(money: Money): string {
  return formatMinor(money.amountMinor, money.currency)
}
