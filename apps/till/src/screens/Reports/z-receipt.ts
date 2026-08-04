/**
 * Assembles the printable Z-report document from a **sealed** shift, purely — no I/O, no formatting
 * (the component formats). The Z-read resets the in-memory shift immediately after (App `handleRunZ`),
 * so the receipt is snapshotted here at close time from the CLOSED `ShiftState`, which carries every
 * field the paper record needs: times, staff, reason codes, and the authorised flag.
 *
 * Money stays `bigint` minor units throughout (non-negotiable #1); the drawer subtractions are stored
 * signed (paid-out/skim/safe-drop as negatives) so the printed column literally sums to the expected
 * figure.
 */

import { shift } from '@batch/domain'

export type VarianceDirection = 'OVER' | 'SHORT' | 'EXACT'

export interface ZReceiptData {
  readonly zNumber: string
  readonly shopName: string
  readonly deviceId: string
  readonly currency: string
  readonly openedAtISO: string
  readonly closedAtISO: string
  readonly openedByName: string
  readonly closedByName: string
  readonly openingFloatMinor: bigint
  readonly cashSalesMinor: bigint
  readonly paidInMinor: bigint
  readonly paidOutMinor: bigint
  readonly skimMinor: bigint
  readonly safeDropMinor: bigint
  readonly expectedDrawerMinor: bigint
  readonly countedMinor: bigint
  /** Signed: positive = over, negative = short, 0 = exact. */
  readonly varianceMinor: bigint
  readonly direction: VarianceDirection
  readonly finalCountSeq: bigint
  readonly movementCount: number
  readonly reasonCodes: readonly string[]
  readonly authorised: boolean
}

export interface BuildZReceiptOpts {
  /** When the Z was issued (device clock) — captured by the caller at close. */
  readonly closedAtISO: string
  /** A human label for the till/shop; the tenant id until a real shop name exists. */
  readonly shopName: string
  /** Resolve a staff id to a display name (roster lookup lives in the app, not the domain). */
  readonly resolveStaffName: (id: string | undefined) => string
}

export function buildZReceipt(state: shift.ShiftState, opts: BuildZReceiptOpts): ZReceiptData {
  // `zReport` throws on a non-CLOSED shift — the caller only reaches here after a committed seal.
  const report = shift.zReport(state)
  const direction: VarianceDirection =
    report.varianceMinor > 0n ? 'OVER' : report.varianceMinor < 0n ? 'SHORT' : 'EXACT'
  return {
    zNumber: report.zNumber,
    shopName: opts.shopName,
    deviceId: state.deviceId,
    currency: state.currency,
    openedAtISO: state.openedAt,
    closedAtISO: opts.closedAtISO,
    openedByName: opts.resolveStaffName(state.openedByStaffId),
    closedByName: opts.resolveStaffName(report.closedByStaffId),
    openingFloatMinor: report.openingFloatMinor,
    cashSalesMinor: report.cashSalesMinor,
    paidInMinor: report.paidInMinor,
    paidOutMinor: report.paidOutMinor,
    skimMinor: report.skimMinor,
    safeDropMinor: report.safeDropMinor,
    expectedDrawerMinor: report.expectedDrawerMinor,
    countedMinor: report.countedMinor,
    varianceMinor: report.varianceMinor,
    direction,
    finalCountSeq: report.finalCountSeq,
    movementCount: report.movementCount,
    reasonCodes: state.reasonCodes ?? [],
    authorised: state.authorised ?? false,
  }
}
