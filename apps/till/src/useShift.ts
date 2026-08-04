/**
 * React binding for the current shift (ADR 0010, ADR 0009). Holds the open shift's events in memory
 * (mirrors `useOrder` — a device has one shift live at a time, and reload-recovery of an in-progress
 * shift is a future concern, same as the order pane), projects `shift.reduce`, and commits each
 * mutation to the local store off the paint path — the same optimistic-append + `await commit` +
 * rollback-on-failure discipline as `useOrder`.
 *
 * Blind-count integrity (ADR 0010, exit criterion #2) is structural here, not a UI convention:
 * `variance()` returns `null` until a `CashDeclared(COUNT)` event has actually been folded into
 * `state`, and even then it *computes* the expected figure fresh from the committed log — there is no
 * `expectedMinor` field cached anywhere on `state` or on this hook for a screen to read early.
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import { shift } from '@batch/domain'
import { cashSalesSinceMinor, commitEvents, nextZNumber } from './runtime'
import { measure } from './perf'
import {
  closeShiftOps,
  handoverOps,
  movementOps,
  openShiftOps,
  recordCountOps,
  type MovementInput,
  type MovementKind,
  type OutgoingShiftEvent,
} from './shift-ops'

export interface VarianceInfo {
  readonly countSeq: bigint
  readonly countedMinor: bigint
  readonly expectedMinor: bigint
  readonly varianceMinor: bigint
  readonly direction: shift.VarianceDirection
}

export interface UseShiftOptions {
  readonly deviceId: string
  readonly onCommitError?: (err: unknown) => void
}

export interface UseShift {
  readonly state: shift.ShiftState | null
  readonly isOpen: boolean
  /** True once a `CashDeclared(COUNT)` has committed — the count/no-count gate for X and Z. */
  readonly hasCommittedCount: boolean
  openShift(input: {
    openedByStaffId: string
    denominations: readonly shift.DenominationCount[]
    countedMinor: bigint
  }): Promise<void>
  recordCount(input: { denominations: readonly shift.DenominationCount[]; countedMinor: bigint }): Promise<void>
  payMovement(kind: MovementKind, input: MovementInput): Promise<void>
  handOver(fromStaffId: string, toStaffId: string): Promise<void>
  /**
   * The blind-count variance, computed fresh from the committed log. Resolves `null` before any count
   * has been recorded — never a cached figure (ADR 0010 blind-count integrity).
   */
  variance(): Promise<VarianceInfo | null>
  /** The mid-shift X report: a pure fold, appends no event (ADR 0010 exit criterion #5). */
  xReport(): Promise<shift.XReport | null>
  /** The terminal Z-read. Resolves the sealed `ZReport`; throws if no count has been committed. */
  closeShift(input: {
    closedByStaffId: string
    reasonCodes: readonly string[]
    authorised: boolean
  }): Promise<shift.ZReport>
  /** Start fresh after Z (or to discard an in-memory shift that failed to open). */
  reset(): void
}

export function useShift(options: UseShiftOptions): UseShift {
  const { deviceId, onCommitError } = options
  const [events, setEvents] = useState<readonly shift.ShiftEvent[]>([])
  const eventsRef = useRef<readonly shift.ShiftEvent[]>([])

  const state = useMemo(() => (events.length > 0 ? shift.reduceShift(events) : null), [events])
  const stateRef = useRef<shift.ShiftState | null>(null)
  stateRef.current = state

  const applyAndCommit = useCallback(
    (outgoing: readonly OutgoingShiftEvent[]): Promise<void> => {
      if (outgoing.length === 0) return Promise.resolve()
      const next = [...eventsRef.current, ...outgoing.map((o) => o.event)]
      eventsRef.current = next
      setEvents(next) // optimistic: paints before the awaited commit below (root CLAUDE.md)
      return measure('localCommit', async () => {
        await commitEvents(outgoing)
      })
        .then(() => undefined)
        .catch((err: unknown) => {
          onCommitError?.(err)
        })
    },
    [onCommitError],
  )

  const openShift = useCallback(
    async (input: {
      openedByStaffId: string
      denominations: readonly shift.DenominationCount[]
      countedMinor: bigint
    }): Promise<void> => {
      const { outgoing } = openShiftOps({ deviceId, ...input })
      await applyAndCommit(outgoing)
    },
    [applyAndCommit, deviceId],
  )

  const recordCount = useCallback(
    async (input: { denominations: readonly shift.DenominationCount[]; countedMinor: bigint }): Promise<void> => {
      const current = stateRef.current
      if (!current) return
      await applyAndCommit([recordCountOps(current, input.denominations, input.countedMinor)])
    },
    [applyAndCommit],
  )

  const payMovement = useCallback(
    async (kind: MovementKind, input: MovementInput): Promise<void> => {
      const current = stateRef.current
      if (!current) return
      await applyAndCommit([movementOps(current, kind, input)])
    },
    [applyAndCommit],
  )

  const handOver = useCallback(
    async (fromStaffId: string, toStaffId: string): Promise<void> => {
      const current = stateRef.current
      if (!current) return
      await applyAndCommit([handoverOps(current, fromStaffId, toStaffId)])
    },
    [applyAndCommit],
  )

  /** The latest committed COUNT (not the float) — undefined before any count exists. */
  const latestCount = useCallback((s: shift.ShiftState): shift.CashCount | undefined => {
    for (let i = s.counts.length - 1; i >= 0; i -= 1) {
      const c = s.counts[i]
      if (c && c.purpose === 'COUNT') return c
    }
    return undefined
  }, [])

  const variance = useCallback(async (): Promise<VarianceInfo | null> => {
    const current = stateRef.current
    if (!current) return null
    const count = latestCount(current)
    if (!count) return null // blind-count integrity: nothing to report before a count commits
    const cashSalesMinor = await cashSalesSinceMinor(current.openedAt)
    const expectedMinor = shift.expectedDrawerMinor(current, cashSalesMinor)
    const v = shift.computeVariance(count.countedMinor, expectedMinor)
    return {
      countSeq: count.countSeq,
      countedMinor: count.countedMinor,
      expectedMinor,
      varianceMinor: v.varianceMinor,
      direction: v.direction,
    }
  }, [latestCount])

  const xReport = useCallback(async (): Promise<shift.XReport | null> => {
    const current = stateRef.current
    if (!current) return null
    const cashSalesMinor = await cashSalesSinceMinor(current.openedAt)
    return shift.xReport(current, cashSalesMinor) // pure fold — appends nothing
  }, [])

  const closeShift = useCallback(
    async (input: { closedByStaffId: string; reasonCodes: readonly string[]; authorised: boolean }): Promise<shift.ZReport> => {
      const current = stateRef.current
      if (!current) throw new Error('cannot close: no open shift')
      const v = await variance()
      if (!v) throw new Error('cannot close: no committed drawer count')
      const zNumber = await nextZNumber()
      const outgoing = closeShiftOps(current, {
        zNumber,
        closedByStaffId: input.closedByStaffId,
        finalCountSeq: v.countSeq,
        varianceMinor: v.varianceMinor,
        reasonCodes: input.reasonCodes,
        authorised: input.authorised,
      })
      const snapshot = eventsRef.current
      const next = [...snapshot, outgoing.event]
      eventsRef.current = next
      setEvents(next)
      try {
        // The Z-read commits atomically, same discipline as the order path's terminal tender+close
        // pair — a half-written seal (event lost after the UI already shows "closed") is worse than
        // staying open and letting the manager retry the hold.
        await measure('localCommit', () => commitEvents([outgoing]))
      } catch (err) {
        eventsRef.current = snapshot
        setEvents(snapshot)
        throw err instanceof Error ? err : new Error(String(err))
      }
      return shift.zReport(shift.reduceShift(next))
    },
    [variance],
  )

  const reset = useCallback((): void => {
    eventsRef.current = []
    setEvents([])
  }, [])

  return {
    state,
    isOpen: state?.status === 'OPEN',
    hasCommittedCount: state ? state.counts.some((c) => c.purpose === 'COUNT') : false,
    openShift,
    recordCount,
    payMovement,
    handOver,
    variance,
    xReport,
    closeShift,
    reset,
  }
}
