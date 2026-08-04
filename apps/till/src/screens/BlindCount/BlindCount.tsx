/**
 * Screen 3 — Blind count (SPEC "Screen 3"). Structural integrity (ADR 0010, exit criterion #2): this
 * component renders from denomination-grid state ONLY. There is no `expected*` property anywhere in
 * this file, its state, or its props — nothing to inspect via dev tools or a shoulder-peek. The
 * expected figure exists nowhere on the client until `CashDeclared(COUNT)` has already committed; the
 * variance screen computes it afterwards, from the sealed log.
 */

import { useCallback, useMemo, useState } from 'react'
import type { shift } from '@batch/domain'
import { parseKeypadInput } from '@batch/domain'
import { formatEuroMinor } from '../../format'
import { appendKeypadChar, backspaceKeypad } from '../../keypad'
import type { SyncPillState } from '../../components/Header'
import { ShiftScreenBar } from '../../components/ShiftScreenBar'
import { breakdownCaption, denominationsFromCounts, DenominationCounter } from '../../components/DenominationCounter'
import './BlindCount.css'

export interface BlindCountProps {
  readonly counterName: string
  readonly syncState: SyncPillState
  readonly onCancel: () => void
  readonly onCommit: (input: { denominations: readonly shift.DenominationCount[]; countedMinor: bigint }) => Promise<void>
}

export function BlindCount({ counterName, syncState, onCancel, onCommit }: BlindCountProps): JSX.Element {
  const [counts, setCounts] = useState<ReadonlyMap<bigint, bigint>>(new Map())
  const [singleTotalMode, setSingleTotalMode] = useState(false)
  const [rawTotal, setRawTotal] = useState('')
  const [confirmingEmpty, setConfirmingEmpty] = useState(false)
  const [committing, setCommitting] = useState(false)

  const denominations = useMemo(() => denominationsFromCounts(counts), [counts])
  const gridTotalMinor = useMemo(() => denominations.reduce((sum, d) => sum + d.denominationMinor * d.count, 0n), [denominations])
  const caption = useMemo(() => breakdownCaption(counts), [counts])

  const parsedSingle = rawTotal === '' ? null : parseKeypadInput(rawTotal)
  const singleTotalMinor = parsedSingle?.ok ? parsedSingle.value.amountMinor : 0n

  const totalMinor = singleTotalMode ? singleTotalMinor : gridTotalMinor

  const setCount = useCallback((denominationMinor: bigint, count: bigint) => {
    setCounts((prev) => {
      const next = new Map(prev)
      next.set(denominationMinor, count)
      return next
    })
  }, [])

  const doCommit = useCallback(async () => {
    if (committing) return
    setCommitting(true)
    try {
      if (singleTotalMode) {
        await onCommit({ denominations: [], countedMinor: singleTotalMinor })
      } else {
        await onCommit({ denominations, countedMinor: gridTotalMinor })
      }
    } finally {
      setCommitting(false)
      setConfirmingEmpty(false)
    }
  }, [committing, singleTotalMode, singleTotalMinor, denominations, gridTotalMinor, onCommit])

  const handleCommitTap = useCallback(() => {
    if (totalMinor === 0n && !confirmingEmpty) {
      setConfirmingEmpty(true)
      return
    }
    void doCommit()
  }, [totalMinor, confirmingEmpty, doCommit])

  const keypadRows = useMemo(
    () => [
      ['1', '2', '3'],
      ['4', '5', '6'],
      ['7', '8', '9'],
      ['.', '0', '⌫'],
    ],
    [],
  )

  return (
    <div className="blind-count">
      <ShiftScreenBar
        title="Count the drawer"
        caption={`${counterName} · Blind count — the expected amount is shown after you commit.`}
        syncState={syncState}
      />
      <div className="blind-count-body">
        <div className="blind-count-main">
          {singleTotalMode ? (
            <div className="blind-count-single">
              <div className="blind-count-single-readout tnum" data-empty={rawTotal === ''}>
                €{rawTotal === '' ? '0.00' : rawTotal}
              </div>
              <div className="blind-count-keypad">
                {keypadRows.map((row, i) => (
                  <div className="blind-count-keypad-row" key={i}>
                    {row.map((key) =>
                      key === '⌫' ? (
                        <button key={key} type="button" className="blind-count-key" onClick={() => setRawTotal((p) => backspaceKeypad(p))}>
                          ⌫
                        </button>
                      ) : (
                        <button
                          key={key}
                          type="button"
                          className="blind-count-key tnum"
                          onClick={() => setRawTotal((p) => appendKeypadChar(p, key))}
                        >
                          {key}
                        </button>
                      ),
                    )}
                  </div>
                ))}
              </div>
              <button type="button" className="blind-count-back-to-grid" onClick={() => setSingleTotalMode(false)}>
                Use the denomination breakdown instead
              </button>
            </div>
          ) : (
            <DenominationCounter counts={counts} onSetCount={setCount} />
          )}
        </div>

        <aside className="blind-count-summary">
          <span className="blind-count-summary-caption">You&apos;ve counted</span>
          <span className="blind-count-summary-total tnum">{formatEuroMinor(totalMinor)}</span>
          {!singleTotalMode && <p className="blind-count-summary-breakdown">{caption || 'No cash counted yet.'}</p>}

          {!confirmingEmpty ? (
            <button type="button" className="blind-count-commit" disabled={committing} onClick={handleCommitTap}>
              {singleTotalMode ? `Commit total — no breakdown` : `Commit count — ${formatEuroMinor(totalMinor)}`}
            </button>
          ) : (
            <div className="blind-count-empty-confirm">
              <p>Commit an empty drawer?</p>
              <div className="blind-count-empty-confirm-actions">
                <button type="button" onClick={() => setConfirmingEmpty(false)} disabled={committing}>
                  Back
                </button>
                <button type="button" className="blind-count-commit" onClick={() => void doCommit()} disabled={committing}>
                  Commit €0.00
                </button>
              </div>
            </div>
          )}

          {!singleTotalMode && (
            <button type="button" className="blind-count-single-toggle" onClick={() => setSingleTotalMode(true)}>
              Enter one total instead
            </button>
          )}

          <button type="button" className="blind-count-cancel" onClick={onCancel}>
            Cancel
          </button>
        </aside>
      </div>
    </div>
  )
}
