/**
 * The denomination counter (SPEC Screens 1 & 3) — shared verbatim between shift-open (the opening
 * float) and blind count. Two columns (notes, coins), stepper rows, a live breakdown caption, and a
 * running total. Counts are `bigint` quantities (ADR 0010: "a denomination count is also `bigint`,
 * like an order line quantity") — this component never does float/number arithmetic on money.
 */

import { useCallback, useRef, useState } from 'react'
import type { shift } from '@batch/domain'
import { formatEuroMinor } from '../format'
import { useRepeatPress } from '../gestures'
import { COIN_DENOMINATIONS, NOTE_DENOMINATIONS, type DenominationRow } from '../shift-denominations'
import './DenominationCounter.css'

export interface DenominationCounterProps {
  readonly counts: ReadonlyMap<bigint, bigint>
  readonly onSetCount: (denominationMinor: bigint, count: bigint) => void
}

/** `counts` → the `DenominationCount[]` the shift domain expects, non-zero rows only kept implicit. */
export function denominationsFromCounts(counts: ReadonlyMap<bigint, bigint>): shift.DenominationCount[] {
  const out: shift.DenominationCount[] = []
  for (const [denominationMinor, count] of counts) {
    if (count > 0n) out.push({ denominationMinor, count })
  }
  return out
}

/** "3 × €20 · 5 × €10 …" — the live confirmation of what's being declared (SPEC Screen 1). */
export function breakdownCaption(counts: ReadonlyMap<bigint, bigint>): string {
  const parts: string[] = []
  for (const row of [...NOTE_DENOMINATIONS, ...COIN_DENOMINATIONS]) {
    const count = counts.get(row.denominationMinor) ?? 0n
    if (count > 0n) parts.push(`${count} × ${row.label}`)
  }
  return parts.join(' · ')
}

function StepButton({ label, disabled, onStep }: { readonly label: string; readonly disabled: boolean; readonly onStep: () => void }): JSX.Element {
  const gesture = useRepeatPress(onStep)
  return (
    <button type="button" className="denom-step" disabled={disabled} aria-label={label} {...gesture}>
      {label}
    </button>
  )
}

function DenomRow({
  row,
  count,
  subtotalMinor,
  onSetCount,
}: {
  readonly row: DenominationRow
  readonly count: bigint
  readonly subtotalMinor: bigint
  readonly onSetCount: (count: bigint) => void
}): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  const startEdit = useCallback(() => {
    setDraft(count.toString())
    setEditing(true)
  }, [count])

  const commit = useCallback(() => {
    const digits = draft.replace(/[^0-9]/g, '')
    onSetCount(digits === '' ? 0n : BigInt(digits))
    setEditing(false)
  }, [draft, onSetCount])

  return (
    <div className="denom-row">
      <span className="denom-label tnum">{row.label}</span>
      <StepButton label="−" disabled={count <= 0n} onStep={() => onSetCount(count > 0n ? count - 1n : 0n)} />
      {editing ? (
        <input
          ref={inputRef}
          className="denom-count-input tnum"
          type="text"
          inputMode="numeric"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
          }}
        />
      ) : (
        <button type="button" className="denom-count tnum" onClick={startEdit} aria-label={`${row.label} count — tap to type`}>
          {count.toString()}
        </button>
      )}
      <StepButton label="+" disabled={false} onStep={() => onSetCount(count + 1n)} />
      <span className="denom-subtotal tnum">{formatEuroMinor(subtotalMinor)}</span>
    </div>
  )
}

export function DenominationCounter({ counts, onSetCount }: DenominationCounterProps): JSX.Element {
  return (
    <div className="denomination-counter">
      <div className="denom-column">
        <h3 className="denom-column-label">Notes</h3>
        {NOTE_DENOMINATIONS.map((row) => {
          const count = counts.get(row.denominationMinor) ?? 0n
          return (
            <DenomRow
              key={row.denominationMinor.toString()}
              row={row}
              count={count}
              subtotalMinor={row.denominationMinor * count}
              onSetCount={(next) => onSetCount(row.denominationMinor, next)}
            />
          )
        })}
      </div>
      <div className="denom-column">
        <h3 className="denom-column-label">Coins</h3>
        {COIN_DENOMINATIONS.map((row) => {
          const count = counts.get(row.denominationMinor) ?? 0n
          return (
            <DenomRow
              key={row.denominationMinor.toString()}
              row={row}
              count={count}
              subtotalMinor={row.denominationMinor * count}
              onSetCount={(next) => onSetCount(row.denominationMinor, next)}
            />
          )
        })}
      </div>
    </div>
  )
}
