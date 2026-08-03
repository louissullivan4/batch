import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  add,
  allocateByWeights,
  applyRateBp,
  clampNonNegative,
  compare,
  divHalfAwayFromZero,
  equals,
  euro,
  formatMinor,
  formatMoney,
  isNegative,
  minor,
  multiply,
  negate,
  splitEvenly,
  subtract,
  sumMoney,
  zero,
} from './money'

const amountArb = fc.bigInt({ min: -100_000_000n, max: 100_000_000n })
const moneyArb = amountArb.map((a) => minor(a))

describe('construction', () => {
  it('euro(units, cents) composes minor units', () => {
    expect(euro(4, 50).amountMinor).toBe(450n)
    expect(euro(0, 0).amountMinor).toBe(0n)
    expect(euro(10).amountMinor).toBe(1000n)
  })

  it('rejects non-integer or out-of-range euro inputs', () => {
    expect(() => euro(1.5)).toThrow()
    expect(() => euro(-1)).toThrow()
    expect(() => euro(1, 100)).toThrow()
    expect(() => euro(1, -1)).toThrow()
  })
})

describe('arithmetic', () => {
  it('add is commutative and associative', () => {
    fc.assert(
      fc.property(amountArb, amountArb, amountArb, (x, y, z) => {
        const a = minor(x)
        const b = minor(y)
        const c = minor(z)
        expect(add(a, b)).toEqual(add(b, a))
        expect(add(add(a, b), c)).toEqual(add(a, add(b, c)))
      }),
    )
  })

  it('subtract inverts add', () => {
    fc.assert(
      fc.property(moneyArb, moneyArb, (a, b) => {
        expect(subtract(add(a, b), b)).toEqual(a)
      }),
    )
  })

  it('multiply by n equals adding n times', () => {
    fc.assert(
      fc.property(moneyArb, fc.integer({ min: 0, max: 40 }), (a, n) => {
        let acc = zero()
        for (let i = 0; i < n; i++) acc = add(acc, a)
        expect(multiply(a, BigInt(n))).toEqual(acc)
      }),
    )
  })

  it('negate is its own inverse and matches 0 - a', () => {
    fc.assert(
      fc.property(moneyArb, (a) => {
        expect(negate(negate(a))).toEqual(a)
        expect(negate(a)).toEqual(subtract(zero(), a))
      }),
    )
  })

  it('sumMoney equals a left fold of add', () => {
    fc.assert(
      fc.property(fc.array(moneyArb, { maxLength: 30 }), (items) => {
        const folded = items.reduce((acc, m) => add(acc, m), zero())
        expect(sumMoney(items)).toEqual(folded)
      }),
    )
  })

  it('rejects cross-currency operations', () => {
    const eur = minor(100n, 'EUR')
    const bad = { amountMinor: 100n, currency: 'USD' } as unknown as typeof eur
    expect(() => add(eur, bad)).toThrow()
  })
})

describe('comparison', () => {
  it('compare is a total order consistent with equals', () => {
    fc.assert(
      fc.property(moneyArb, moneyArb, (a, b) => {
        const c = compare(a, b)
        expect(c).toBe(-compare(b, a) || 0)
        expect(equals(a, b)).toBe(c === 0)
      }),
    )
  })

  it('clampNonNegative floors at zero', () => {
    fc.assert(
      fc.property(moneyArb, (a) => {
        const clamped = clampNonNegative(a)
        expect(isNegative(clamped)).toBe(false)
        expect(clamped).toEqual(isNegative(a) ? zero() : a)
      }),
    )
  })
})

describe('divHalfAwayFromZero', () => {
  it('rounds halves away from zero on known values', () => {
    expect(divHalfAwayFromZero(5n, 10n)).toBe(1n) // 0.5 -> 1
    expect(divHalfAwayFromZero(4n, 10n)).toBe(0n) // 0.4 -> 0
    expect(divHalfAwayFromZero(15n, 10n)).toBe(2n) // 1.5 -> 2
    expect(divHalfAwayFromZero(25n, 10n)).toBe(3n) // 2.5 -> 3
  })

  it('is odd: div(-n, d) === -div(n, d)', () => {
    fc.assert(
      fc.property(amountArb, fc.bigInt({ min: 1n, max: 1_000_000n }), (n, d) => {
        expect(divHalfAwayFromZero(-n, d)).toBe(-divHalfAwayFromZero(n, d))
      }),
    )
  })

  it('rejects a non-positive denominator', () => {
    expect(() => divHalfAwayFromZero(1n, 0n)).toThrow()
    expect(() => divHalfAwayFromZero(1n, -2n)).toThrow()
  })
})

describe('applyRateBp', () => {
  it('0 bp is nothing, 10000 bp is identity', () => {
    fc.assert(
      fc.property(moneyArb, (a) => {
        expect(applyRateBp(a, 0)).toEqual(zero())
        expect(applyRateBp(a, 10000)).toEqual(a)
      }),
    )
  })

  it('computes a known percentage', () => {
    expect(applyRateBp(minor(1000n), 1350).amountMinor).toBe(135n) // 13.5% of €10.00
    expect(applyRateBp(minor(2300n), 2300).amountMinor).toBe(529n) // 23% of €23.00
  })
})

describe('splitEvenly', () => {
  it('shares sum to the total and differ by at most one minor unit', () => {
    fc.assert(
      fc.property(moneyArb, fc.integer({ min: 1, max: 50 }), (total, parts) => {
        const shares = splitEvenly(total, parts)
        expect(shares).toHaveLength(parts)
        expect(sumMoney(shares)).toEqual(total)
        const amounts = shares.map((s) => s.amountMinor)
        const max = amounts.reduce((a, b) => (a > b ? a : b))
        const min = amounts.reduce((a, b) => (a < b ? a : b))
        expect(max - min <= 1n).toBe(true)
      }),
    )
  })

  it('gives the remainder to the earliest payers', () => {
    expect(splitEvenly(euro(10, 0), 3).map((m) => m.amountMinor)).toEqual([334n, 333n, 333n])
  })

  it('preserves sign for refunds', () => {
    expect(splitEvenly(negate(euro(10, 0)), 3).map((m) => m.amountMinor)).toEqual([
      -334n,
      -333n,
      -333n,
    ])
  })

  it('rejects a non-positive part count', () => {
    expect(() => splitEvenly(euro(1), 0)).toThrow()
    expect(() => splitEvenly(euro(1), -3)).toThrow()
  })
})

describe('allocateByWeights', () => {
  const weightsArb = fc
    .array(fc.bigInt({ min: 0n, max: 100_000n }), { minLength: 1, maxLength: 8 })
    .filter((ws) => ws.some((w) => w > 0n))

  it('allocations sum back to the total exactly', () => {
    fc.assert(
      fc.property(moneyArb, weightsArb, (total, weights) => {
        const parts = allocateByWeights(total, weights)
        expect(parts).toHaveLength(weights.length)
        expect(sumMoney(parts)).toEqual(total)
      }),
    )
  })

  it('a zero weight receives nothing, and sign is preserved', () => {
    fc.assert(
      fc.property(moneyArb, weightsArb, (total, weights) => {
        const parts = allocateByWeights(total, weights)
        weights.forEach((w, i) => {
          const share = parts[i]!.amountMinor
          if (w === 0n) expect(share).toBe(0n)
          // same sign as total, or zero
          expect(share * total.amountMinor >= 0n).toBe(true)
        })
      }),
    )
  })

  it('splits proportionally with largest-remainder rounding', () => {
    // €10.01 across weights 1:1:1 -> 334, 334, 333 (the two largest remainders win)
    expect(allocateByWeights(minor(1001n), [1n, 1n, 1n]).map((m) => m.amountMinor)).toEqual([
      334n,
      334n,
      333n,
    ])
  })

  it('rejects empty or all-zero weights', () => {
    expect(() => allocateByWeights(euro(1), [])).toThrow()
    expect(() => allocateByWeights(euro(1), [0n, 0n])).toThrow()
    expect(() => allocateByWeights(euro(1), [-1n])).toThrow()
  })
})

describe('formatting', () => {
  it('formats known amounts without floats', () => {
    expect(formatMinor(450n)).toBe('€4.50')
    expect(formatMinor(0n)).toBe('€0.00')
    expect(formatMinor(5n)).toBe('€0.05')
    expect(formatMinor(-450n)).toBe('-€4.50')
    expect(formatMinor(100000n)).toBe('€1000.00')
    expect(formatMoney(euro(12, 34))).toBe('€12.34')
  })

  it('round-trips the digits of any amount', () => {
    fc.assert(
      fc.property(amountArb, (a) => {
        const formatted = formatMinor(a)
        const digits = formatted.replace(/[^0-9]/g, '')
        const reparsed = BigInt(digits) * (formatted.startsWith('-') ? -1n : 1n)
        expect(reparsed).toBe(a)
      }),
    )
  })
})
