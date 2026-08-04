/**
 * Screen 1 — Shift open (SPEC "Screen 1"). Staff chips + the shared denomination counter + a live
 * summary pane + a single inline confirm strip (no modal). `ShiftOpened` + `CashDeclared` commit as
 * one atomic pair (`shift-ops.openShiftOps`) and are irreversible once committed (append-only) — a
 * wrong float is corrected by a movement afterwards (Cash movements), never edited here.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { shift } from '@batch/domain'
import { formatEuroMinor } from '../../format'
import { RadioGlyph } from '../../icons'
import type { StaffFixtureEntry } from '../../auth/staff-fixture'
import type { SyncPillState } from '../../components/Header'
import { ShiftScreenBar } from '../../components/ShiftScreenBar'
import { breakdownCaption, denominationsFromCounts, DenominationCounter } from '../../components/DenominationCounter'
import './ShiftOpen.css'

export interface ShiftOpenProps {
  readonly staff: readonly StaffFixtureEntry[]
  readonly syncState: SyncPillState
  readonly onBack: () => void
  readonly onOpen: (input: {
    openedByStaffId: string
    denominations: readonly shift.DenominationCount[]
    countedMinor: bigint
  }) => Promise<void>
}

export function ShiftOpen({ staff, syncState, onBack, onOpen }: ShiftOpenProps): JSX.Element {
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null)
  const [counts, setCounts] = useState<ReadonlyMap<bigint, bigint>>(new Map())
  const [confirming, setConfirming] = useState(false)
  const [opening, setOpening] = useState(false)

  const denominations = useMemo(() => denominationsFromCounts(counts), [counts])
  const totalMinor = useMemo(() => denominations.reduce((sum, d) => sum + d.denominationMinor * d.count, 0n), [denominations])
  const caption = useMemo(() => breakdownCaption(counts), [counts])

  const setCount = useCallback((denominationMinor: bigint, count: bigint) => {
    setCounts((prev) => {
      const next = new Map(prev)
      next.set(denominationMinor, count)
      return next
    })
  }, [])

  // The confirm strip is a 5s window, not a modal (SPEC): tapping away or letting it time out just
  // reverts to the button — nothing is recorded until "Declare" is pressed.
  useEffect(() => {
    if (!confirming) return
    const id = setTimeout(() => setConfirming(false), 5000)
    return () => clearTimeout(id)
  }, [confirming])

  const canOpen = selectedStaffId !== null && totalMinor > 0n
  const selectedStaff = staff.find((s) => s.id === selectedStaffId) ?? null

  const handleDeclare = useCallback(async () => {
    if (!selectedStaffId || opening) return
    setOpening(true)
    try {
      await onOpen({ openedByStaffId: selectedStaffId, denominations, countedMinor: totalMinor })
    } finally {
      setOpening(false)
      setConfirming(false)
    }
  }, [selectedStaffId, denominations, totalMinor, onOpen, opening])

  return (
    <div className="shift-open">
      <ShiftScreenBar title="Open shift" syncState={syncState} onBack={onBack} />
      <div className="shift-open-body">
        <div className="shift-open-main">
          <section>
            <h2 className="shift-section-label">Who's opening?</h2>
            <div className="staff-chip-row">
              {staff.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="staff-chip"
                  data-selected={s.id === selectedStaffId}
                  onClick={() => setSelectedStaffId(s.id)}
                >
                  <RadioGlyph selected={s.id === selectedStaffId} />
                  <span>{s.name}</span>
                </button>
              ))}
            </div>
          </section>

          <section>
            <h2 className="shift-section-label">Count the opening float</h2>
            <DenominationCounter counts={counts} onSetCount={setCount} />
          </section>
        </div>

        <aside className="shift-open-summary">
          <span className="shift-open-summary-caption">Float</span>
          <span className="shift-open-summary-total tnum" data-empty={totalMinor === 0n}>
            {formatEuroMinor(totalMinor)}
          </span>
          <p className="shift-open-summary-breakdown">{caption || 'No cash counted yet.'}</p>

          {!confirming ? (
            <button
              type="button"
              className="shift-open-confirm-btn"
              disabled={!canOpen}
              onClick={() => setConfirming(true)}
            >
              Open shift — {formatEuroMinor(totalMinor)}
            </button>
          ) : (
            <div className="shift-open-confirm-strip">
              <p>
                Declare {formatEuroMinor(totalMinor)} float, opened by {selectedStaff?.name}?
              </p>
              <div className="shift-open-confirm-actions">
                <button type="button" className="shift-open-back-btn" onClick={() => setConfirming(false)} disabled={opening}>
                  Back
                </button>
                <button type="button" className="shift-open-declare-btn" onClick={() => void handleDeclare()} disabled={opening}>
                  Declare
                </button>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
