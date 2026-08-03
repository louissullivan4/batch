import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  extractVatMinor,
  netFromGrossMinor,
  resolveVatRateBp,
  totalVatMinor,
  vatBreakdown,
  VAT_REDUCED_BP,
  VAT_STANDARD_BP,
  VAT_ZERO_BP,
  type VatLine,
} from './vat'

const rateArb = fc.constantFrom(VAT_ZERO_BP, VAT_REDUCED_BP, VAT_STANDARD_BP, 900)
const grossArb = fc.bigInt({ min: -1_000_000n, max: 1_000_000n })

describe('resolveVatRateBp', () => {
  it('selects the rate for the fulfilment mode', () => {
    const profile = { vatRateBpEatIn: VAT_REDUCED_BP, vatRateBpTakeaway: VAT_ZERO_BP }
    expect(resolveVatRateBp(profile, 'EAT_IN')).toBe(VAT_REDUCED_BP)
    expect(resolveVatRateBp(profile, 'TAKEAWAY')).toBe(VAT_ZERO_BP)
  })
})

describe('extractVatMinor', () => {
  it('extracts VAT from clean VAT-inclusive grosses', () => {
    expect(extractVatMinor(11350n, VAT_REDUCED_BP)).toBe(1350n) // net 10000
    expect(extractVatMinor(12300n, VAT_STANDARD_BP)).toBe(2300n) // net 10000
    expect(extractVatMinor(999n, VAT_ZERO_BP)).toBe(0n)
  })

  it('net + vat always reconstructs the gross', () => {
    fc.assert(
      fc.property(grossArb, rateArb, (gross, rate) => {
        expect(netFromGrossMinor(gross, rate) + extractVatMinor(gross, rate)).toBe(gross)
      }),
    )
  })

  it('never exceeds the gross and is non-negative for a positive sale', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 1_000_000n }), rateArb, (gross, rate) => {
        const vat = extractVatMinor(gross, rate)
        expect(vat >= 0n).toBe(true)
        expect(vat <= gross).toBe(true)
      }),
    )
  })

  it('is odd, so a refund reverses a sale to the cent', () => {
    fc.assert(
      fc.property(grossArb, rateArb, (gross, rate) => {
        expect(extractVatMinor(-gross, rate)).toBe(-extractVatMinor(gross, rate))
      }),
    )
  })

  it('rejects a negative rate', () => {
    expect(() => extractVatMinor(100n, -1)).toThrow()
  })
})

describe('vatBreakdown', () => {
  it('groups by rate, one band per rate, sorted by descending rate', () => {
    const lines: VatLine[] = [
      { grossMinor: 450n, vatRateBp: VAT_REDUCED_BP }, // hot coffee eat-in
      { grossMinor: 150n, vatRateBp: VAT_STANDARD_BP }, // chocolate bar
      { grossMinor: 500n, vatRateBp: VAT_ZERO_BP }, // cold sandwich takeaway
      { grossMinor: 300n, vatRateBp: VAT_REDUCED_BP }, // another reduced-rate item
    ]
    const bands = vatBreakdown(lines)
    expect(bands.map((b) => b.vatRateBp)).toEqual([VAT_STANDARD_BP, VAT_REDUCED_BP, VAT_ZERO_BP])
    const reduced = bands.find((b) => b.vatRateBp === VAT_REDUCED_BP)!
    expect(reduced.grossMinor).toBe(750n) // 450 + 300, combined before extraction
  })

  it('band gross totals to the ticket gross, and net + vat = gross per band', () => {
    const lineArb = fc.record({ grossMinor: grossArb, vatRateBp: rateArb })
    fc.assert(
      fc.property(fc.array(lineArb, { maxLength: 40 }), (lines) => {
        const bands = vatBreakdown(lines)
        const ticketGross = lines.reduce((sum, l) => sum + l.grossMinor, 0n)
        const bandGross = bands.reduce((sum, b) => sum + b.grossMinor, 0n)
        expect(bandGross).toBe(ticketGross)
        for (const band of bands) {
          expect(band.netMinor + band.vatMinor).toBe(band.grossMinor)
        }
        const summed = bands.reduce((sum, b) => sum + b.vatMinor, 0n)
        expect(totalVatMinor(lines)).toBe(summed)
      }),
    )
  })
})
