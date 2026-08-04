/**
 * Sprint 4 exit criterion #1 (the sprint goal, in a test):
 *
 *   "a 50-order mock shift with 3 paid-outs and a planted €20 discrepancy reconciles to the cent and
 *    reports the variance correctly."
 *
 * This is the whole reason the cross-aggregate seam (ADR 0010) exists: cash *sales* live in the
 * ORDER aggregate, so we drive 50 real orders through `@batch/domain`'s order `decide`/`computeTotals`
 * to get a true `cashSalesMinor`, run the shift through its own reducer, and reconcile the two with
 * `expectedDrawerMinor` + `computeVariance`.
 */

import { describe, it, expect } from 'vitest'
import {
  decide as decideOrder,
  reduce as reduceOrder,
  computeTotals,
  type DecideContext as OrderCtx,
  type OrderState,
} from '../order'
import { VAT_REDUCED_BP } from '../vat'
import type { ShiftEvent } from './events'
import { reduceShift } from './reduce'
import { computeVariance, expectedDrawerMinor } from './variance'

const OCC = '2026-08-04T09:00:00.000Z'

/** Build one fully-paid, cash, closed order and return the cash that hit the drawer (its total). */
function cashOrder(index: number, priceMinor: bigint): bigint {
  const orderId = `order-${index}`
  const octx = (eventId: string): OrderCtx => ({ eventId, aggregateId: orderId, occurredAt: OCC })

  let state: OrderState | null = null
  let seq = 0
  const apply = (command: Parameters<typeof decideOrder>[1]): void => {
    const result = decideOrder(state, command, octx(`${orderId}-e${seq++}`))
    if (!result.ok) throw new Error(`order command rejected: ${result.error.code}`)
    for (const ev of result.value) state = reduceOrder(state, ev)
  }

  apply({ type: 'OpenOrder', fulfilment: 'EAT_IN' })
  apply({
    type: 'AddLine',
    productId: 'coffee',
    name: 'Coffee',
    quantity: 1n,
    unitPriceMinor: priceMinor,
    vatRateBp: VAT_REDUCED_BP,
    fulfilment: 'EAT_IN',
  })

  // state is non-null after OpenOrder.
  const total = computeTotals(state!).totalMinor
  // Exact cash: the amount applied to the balance is what lands in the drawer (no change).
  apply({ type: 'Tender', tenderId: `${orderId}-t`, method: 'CASH', amountMinor: total, tenderedMinor: total, changeMinor: 0n })
  apply({ type: 'CloseOrder' })
  return total
}

describe('50-order shift reconciliation (Sprint 4 exit criterion #1)', () => {
  it('a planted €20.00 shortfall reports SHORT €20.00 to the cent, and a correct count reconciles EXACT', () => {
    // --- 50 real cash orders through the ORDER aggregate ---
    let cashSalesMinor = 0n
    for (let i = 0; i < 50; i++) {
      // Prices €2.50 … €7.40, deliberately varied so the total is not a round number.
      const priceMinor = 250n + BigInt(i) * 10n
      cashSalesMinor += cashOrder(i, priceMinor)
    }

    // --- the shift: open, float €150.00, three paid-outs ---
    const SID = 'shift-recon'
    const ev = (eventId: string, e: Omit<ShiftEvent, 'eventId' | 'aggregateId' | 'occurredAt'>): ShiftEvent =>
      ({ eventId, aggregateId: SID, occurredAt: OCC, ...e }) as ShiftEvent

    const openingFloatMinor = 15000n
    const paidOuts = [2000n, 500n, 1250n] // milk run, window cleaner, pastry supplier
    const paidOutTotal = paidOuts.reduce((s, a) => s + a, 0n)

    const base: ShiftEvent[] = [
      ev('s-open', { eventType: 'ShiftOpened', payload: { deviceId: 'device-A', openedByStaffId: 'staff-1', currency: 'EUR' } }),
      ev('s-float', { eventType: 'CashDeclared', payload: { purpose: 'OPENING_FLOAT', countSeq: 0n, denominations: [], countedMinor: openingFloatMinor } }),
      ...paidOuts.map((amountMinor, i) =>
        ev(`s-po-${i}`, { eventType: 'PaidOut', payload: { movementId: `po-${i}`, amountMinor, reason: 'supplier', authStaffId: 'staff-1' } }),
      ),
    ]

    const shiftState = reduceShift(base)
    const expected = expectedDrawerMinor(shiftState, cashSalesMinor)

    // Sanity: expected drawer = float + cash sales − paid-outs, exactly.
    expect(expected).toBe(openingFloatMinor + cashSalesMinor - paidOutTotal)

    // --- blind count, planted EXACTLY €20.00 short ---
    const SHORTFALL = 2000n
    const blindCountShort = expected - SHORTFALL
    const short = computeVariance(blindCountShort, expected)
    expect(short.direction).toBe('SHORT')
    expect(short.varianceMinor).toBe(-2000n) // −€20.00 to the cent

    // --- a correct blind count reconciles to zero ---
    const exact = computeVariance(expected, expected)
    expect(exact.direction).toBe('EXACT')
    expect(exact.varianceMinor).toBe(0n)
  })
})
