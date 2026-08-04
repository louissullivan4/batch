/**
 * React binding for the current order. Holds the order's events in state, derives the pane/total via
 * the shared `@batch/domain` reducer, and commits each mutation to the local store off the paint path.
 *
 * The optimistic update (`setEvents`) happens synchronously so the tile tap paints in <100ms; the
 * `LocalStore` write is awaited afterwards (apps/till/CLAUDE.md: never block the first frame on a
 * write). A ref mirrors the events so actions read the latest without stale closures.
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import { computeTotals, reduceOrder, type OrderEvent, type OrderState, type OrderTotals } from '@batch/domain'
import { commitEvent, commitEvents } from './runtime'
import { measure } from './perf'
import {
  activeLineViews,
  addItemOps,
  completeCashOps,
  replaceLineOps,
  voidLineOps,
  type OrderLineView,
} from './order-ops'
import type { MenuItem, ModifierSelection } from './menu/menu'
import type { OutgoingEvent } from './sync'

export interface UseOrder {
  readonly orderId: string | null
  readonly events: readonly OrderEvent[]
  readonly state: OrderState | null
  readonly totals: OrderTotals | null
  readonly lines: readonly OrderLineView[]
  readonly isEmpty: boolean
  addItem(item: MenuItem, selection?: ModifierSelection | null): void
  voidLine(lineId: string): void
  replaceLine(lineId: string, item: MenuItem, selection: ModifierSelection): void
  /** Tender the full balance in cash and close the order. Resolves once both events are committed. */
  completeCashSale(tenderedMinor: bigint): Promise<void>
  /** Start a fresh empty order (after a completed sale). */
  reset(): void
}

export interface UseOrderOptions {
  readonly staffId?: string
  readonly onCommitError?: (err: unknown) => void
}

export function useOrder(options: UseOrderOptions = {}): UseOrder {
  const { staffId, onCommitError } = options
  const [events, setEvents] = useState<readonly OrderEvent[]>([])
  const eventsRef = useRef<readonly OrderEvent[]>([])
  const orderIdRef = useRef<string | null>(null)

  const applyAndCommit = useCallback(
    (outgoing: readonly OutgoingEvent[]): Promise<void> => {
      if (outgoing.length === 0) return Promise.resolve()
      const next = [...eventsRef.current, ...outgoing.map((o) => o.event)]
      eventsRef.current = next
      setEvents(next) // optimistic: paints before the awaited commit below
      return measure('localCommit', async () => {
        for (const o of outgoing) await commitEvent(o)
      })
        .then(() => undefined)
        .catch((err: unknown) => {
          // A local write failing is pathological (storage full). Keep the in-memory order — the sale
          // is not lost — and surface it; the design shows a toast, never a blocking dialog.
          onCommitError?.(err)
        })
    },
    [onCommitError],
  )

  const addItem = useCallback(
    (item: MenuItem, selection: ModifierSelection | null = null): void => {
      const { orderId, outgoing } = addItemOps(eventsRef.current, orderIdRef.current, item, selection, staffId)
      orderIdRef.current = orderId
      void applyAndCommit(outgoing)
    },
    [applyAndCommit, staffId],
  )

  const voidLine = useCallback(
    (lineId: string): void => {
      const oid = orderIdRef.current
      if (oid === null) return
      void applyAndCommit(voidLineOps(oid, lineId))
    },
    [applyAndCommit],
  )

  const replaceLine = useCallback(
    (lineId: string, item: MenuItem, selection: ModifierSelection): void => {
      const oid = orderIdRef.current
      if (oid === null) return
      void applyAndCommit(replaceLineOps(eventsRef.current, oid, lineId, item, selection))
    },
    [applyAndCommit],
  )

  const completeCashSale = useCallback(async (tenderedMinor: bigint): Promise<void> => {
    const oid = orderIdRef.current
    if (oid === null) return
    const outgoing = completeCashOps(eventsRef.current, oid, tenderedMinor)
    const snapshot = eventsRef.current
    const next = [...snapshot, ...outgoing.map((o) => o.event)]
    eventsRef.current = next
    setEvents(next)
    try {
      // Tender + close commit ATOMICALLY (one transaction). Unlike add/void — where a failed write is
      // toasted and the line kept on screen — the terminal pair must not half-persist or show a
      // receipt for a sale the outbox never captured (sync-auditor finding). On failure, roll the
      // optimistic append back and rethrow so the caller stays on tender and the barista retries.
      await measure('localCommit', () => commitEvents(outgoing))
    } catch (err) {
      eventsRef.current = snapshot
      setEvents(snapshot)
      throw err instanceof Error ? err : new Error(String(err))
    }
  }, [])

  const reset = useCallback((): void => {
    eventsRef.current = []
    orderIdRef.current = null
    setEvents([])
  }, [])

  const state = useMemo(() => (events.length > 0 ? reduceOrder(events) : null), [events])
  const totals = useMemo(() => (state ? computeTotals(state) : null), [state])
  const lines = useMemo(() => (state ? activeLineViews(state) : []), [state])

  return {
    orderId: orderIdRef.current,
    events,
    state,
    totals,
    lines,
    isEmpty: lines.length === 0,
    addItem,
    voidLine,
    replaceLine,
    completeCashSale,
    reset,
  }
}
