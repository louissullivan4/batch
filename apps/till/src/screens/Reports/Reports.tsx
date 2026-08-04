/**
 * Screen 5 — X and Z reports (SPEC "Screen 5"). Five deliberate differences keep X and Z unconfusable:
 * different surfaces (X light, Z the only ink-dark panel in the product), different verbs (tap vs.
 * press-and-hold 1.5s), a precondition (Z needs a committed count), finality stated in the body (no
 * confirm dialog — the hold *is* the confirmation), and a receipt state after Z runs.
 *
 * X is a pure fold — `onRunX` calls `useShift.xReport()`, which appends no event (ADR 0010 exit
 * criterion #5); this component only reads the result and a session-local run counter for its own
 * "#N this shift" caption, which is UI chrome, not part of the shift's event log.
 */

import { useCallback, useRef, useState } from 'react'
import type { shift } from '@batch/domain'
import { formatEuroMinor } from '../../format'
import type { SyncPillState } from '../../components/Header'
import { ShiftScreenBar } from '../../components/ShiftScreenBar'
import { CheckIcon } from '../../icons'
import type { PendingClose } from '../VarianceResult/VarianceResult'
import { ZReceipt } from './ZReceipt'
import type { ZReceiptData } from './z-receipt'
import './Reports.css'

const HOLD_MS = 1500

export interface ReportsProps {
  readonly syncState: SyncPillState
  readonly hasCommittedCount: boolean
  readonly pendingClose: PendingClose | null
  /** The sealed Z receipt, present once Z has run — drives the receipt state and the printable doc. */
  readonly zReceipt: ZReceiptData | null
  readonly onBack: () => void
  readonly onRunX: () => Promise<shift.XReport | null>
  readonly onCountTheDrawer: () => void
  readonly onRunZ: (pending: PendingClose) => Promise<void>
}

function formatClock(d: Date): string {
  return d.toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit', hour12: false })
}

export function Reports({
  syncState,
  hasCommittedCount,
  pendingClose,
  zReceipt,
  onBack,
  onRunX,
  onCountTheDrawer,
  onRunZ,
}: ReportsProps): JSX.Element {
  const [xReport, setXReport] = useState<shift.XReport | null>(null)
  const [xRunCount, setXRunCount] = useState(0)
  const [lastXAt, setLastXAt] = useState<Date | null>(null)
  const [holdProgress, setHoldProgress] = useState(0) // 0..1
  const [holding, setHolding] = useState(false)
  const [running, setRunning] = useState(false)
  const holdStartRef = useRef<number | null>(null)
  const holdRafRef = useRef<number | null>(null)

  const handleRunX = useCallback(async () => {
    const report = await onRunX()
    if (report) {
      setXReport(report)
      setXRunCount((n) => n + 1)
      setLastXAt(new Date())
    }
  }, [onRunX])

  const zReady = hasCommittedCount && pendingClose !== null && zReceipt === null

  const cancelHold = useCallback(() => {
    if (holdRafRef.current !== null) cancelAnimationFrame(holdRafRef.current)
    holdRafRef.current = null
    holdStartRef.current = null
    setHolding(false)
    setHoldProgress(0)
  }, [])

  const tick = useCallback(() => {
    if (holdStartRef.current === null) return
    const elapsed = performance.now() - holdStartRef.current
    const progress = Math.min(1, elapsed / HOLD_MS)
    setHoldProgress(progress)
    if (progress >= 1) {
      holdStartRef.current = null
      setHolding(false)
      if (pendingClose) {
        setRunning(true)
        void onRunZ(pendingClose).finally(() => setRunning(false))
      }
      return
    }
    holdRafRef.current = requestAnimationFrame(tick)
  }, [onRunZ, pendingClose])

  const startHold = useCallback(() => {
    if (!zReady || running) return
    holdStartRef.current = performance.now()
    setHolding(true)
    holdRafRef.current = requestAnimationFrame(tick)
  }, [zReady, running, tick])

  return (
    <div className="reports">
      <ShiftScreenBar title="Reports" syncState={syncState} onBack={onBack} />
      <div className="reports-body">
        <section className="report-panel report-panel--x">
          <h2>X report</h2>
          <p className="report-x-caption">Run as often as you like. Changes nothing.</p>
          {xReport && (
            <div className="report-x-figures">
              <div className="report-x-row">
                <span>Cash sales</span>
                <span className="tnum">{formatEuroMinor(xReport.cashSalesMinor)}</span>
              </div>
              <div className="report-x-row">
                <span>Expected drawer</span>
                <span className="tnum">{formatEuroMinor(xReport.expectedDrawerMinor)}</span>
              </div>
              <div className="report-x-row">
                <span>Movements</span>
                <span className="tnum">{xReport.movementCount}</span>
              </div>
            </div>
          )}
          <button type="button" className="report-x-run" onClick={() => void handleRunX()}>
            Print X report
          </button>
          <p className="report-x-meta">
            {lastXAt ? `Last X ${formatClock(lastXAt)} · #${xRunCount} this shift` : 'Not run yet this session.'}
          </p>

          <div className="report-count-cta">
            <button type="button" className="report-count-btn" onClick={onCountTheDrawer} disabled={zReady || zReceipt !== null}>
              Count the drawer →
            </button>
          </div>
        </section>

        <section className="report-panel report-panel--z">
          {zReceipt ? (
            <div className="report-z-sealed">
              <CheckIcon size={28} />
              <span>
                Z #{zReceipt.zNumber} issued {formatClock(new Date())}
              </span>
              <button type="button" className="report-z-print" onClick={() => window.print()}>
                Print / Save as PDF
              </button>
              <p className="report-z-print-hint">Opens the print dialog — AirPrint to a printer, or “Save to Files” as a PDF for the folder.</p>
              <ZReceipt data={zReceipt} />
            </div>
          ) : (
            <>
              <h2>Z report</h2>
              {!hasCommittedCount && <p className="report-z-caption">Complete the drawer count first.</p>}
              {hasCommittedCount && !pendingClose && (
                <p className="report-z-caption">Go to the variance result to choose how this shift closes.</p>
              )}
              {zReady && (
                <p className="report-z-body">
                  Runs once. Locks this shift and issues the next Z, sequentially numbered. This cannot be undone.
                </p>
              )}
              <button
                type="button"
                className="report-z-hold"
                data-holding={holding}
                disabled={!zReady || running}
                onPointerDown={startHold}
                onPointerUp={cancelHold}
                onPointerLeave={cancelHold}
                onPointerCancel={cancelHold}
              >
                <span
                  className="report-z-hold-ring"
                  style={{ transform: `scaleX(${holdProgress})` }}
                  aria-hidden="true"
                />
                <span className="report-z-hold-label">{running ? 'Issuing Z…' : 'Hold to run Z'}</span>
              </button>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
