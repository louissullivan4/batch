/**
 * Screen 3 — Cash tender (SPEC "Screen 3"). Fully offline: nothing here touches `fetch` — cash
 * tender must not touch the network (root CLAUDE.md, apps/till/CLAUDE.md). Back returns to order
 * entry with the order intact at any point before Complete — the "customer changed their mind" path.
 */

import { useCallback, useMemo, useState } from 'react'
import { parseKeypadInput } from '@batch/domain'
import { formatEuroMinor } from '../../format'
import { appendKeypadChar, backspaceKeypad } from '../../keypad'
import { useTileGesture } from '../../gestures'
import { Header, type HeaderProps } from '../../components/Header'
import { AlertTriangleIcon, ChevronLeftIcon } from '../../icons'
import './CashTender.css'

const ABSURD_THRESHOLD_MINOR = 50_000n // €500 (SPEC: "Check amount" caption, no dialog)

const QUICK_TENDERS: readonly { readonly label: string; readonly amountMinor: bigint | 'exact' }[] = [
  { label: 'Exact', amountMinor: 'exact' },
  { label: '€5', amountMinor: 500n },
  { label: '€10', amountMinor: 1000n },
  { label: '€20', amountMinor: 2000n },
  { label: '€50', amountMinor: 5000n },
]

function minorToPlainDecimal(minor: bigint): string {
  return formatEuroMinor(minor).replace('€', '')
}

export interface CashTenderProps {
  readonly totalMinor: bigint
  readonly headerProps: HeaderProps
  readonly onBack: () => void
  readonly onComplete: (tenderedMinor: bigint) => Promise<void>
}

function BackspaceKey({ onTap, onClearAll }: { readonly onTap: () => void; readonly onClearAll: () => void }): JSX.Element {
  const gesture = useTileGesture(onTap, onClearAll)
  return (
    <button type="button" className="keypad-key keypad-key--backspace" {...gesture}>
      ⌫
    </button>
  )
}

export function CashTender({ totalMinor, headerProps, onBack, onComplete }: CashTenderProps): JSX.Element {
  const [rawInput, setRawInput] = useState('')
  const [completing, setCompleting] = useState(false)

  const parsed = rawInput === '' ? null : parseKeypadInput(rawInput)
  const tenderedMinor = parsed?.ok ? parsed.value.amountMinor : 0n
  const hasEnough = tenderedMinor >= totalMinor && totalMinor >= 0n
  const changeMinor = hasEnough ? tenderedMinor - totalMinor : 0n
  const absurd = tenderedMinor > ABSURD_THRESHOLD_MINOR

  const appendChar = useCallback((ch: string) => setRawInput((prev) => appendKeypadChar(prev, ch)), [])
  const backspaceOne = useCallback(() => setRawInput((prev) => backspaceKeypad(prev)), [])
  const clearAll = useCallback(() => setRawInput(''), [])

  const setQuickTender = useCallback(
    (amount: bigint | 'exact') => setRawInput(minorToPlainDecimal(amount === 'exact' ? totalMinor : amount)),
    [totalMinor],
  )

  const handleComplete = useCallback(async () => {
    if (!hasEnough || completing) return
    setCompleting(true)
    try {
      await onComplete(tenderedMinor)
    } finally {
      setCompleting(false)
    }
  }, [hasEnough, completing, onComplete, tenderedMinor])

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
    <div className="cash-tender">
      <Header {...headerProps} />
      <div className="cash-tender-body">
        <button type="button" className="back-to-order" onClick={onBack}>
          <ChevronLeftIcon size={18} />
          Back to order
        </button>

        <div className="cash-tender-columns">
          <div className="cash-tender-left">
            <div className="cash-tender-total-row">
              <span className="cash-tender-total-label">Total</span>
              <span className="cash-tender-total-amount tnum">{formatEuroMinor(totalMinor)}</span>
            </div>

            <div className="tendered-readout tnum" data-empty={rawInput === ''}>
              €{rawInput === '' ? '0.00' : rawInput}
            </div>
            {absurd && (
              <div className="tendered-warning">
                <AlertTriangleIcon size={16} />
                Check amount
              </div>
            )}

            <div className="keypad">
              {keypadRows.map((row, i) => (
                <div className="keypad-row" key={i}>
                  {row.map((key) =>
                    key === '⌫' ? (
                      <BackspaceKey key={key} onTap={backspaceOne} onClearAll={clearAll} />
                    ) : (
                      <button key={key} type="button" className="keypad-key tnum" onClick={() => appendChar(key)}>
                        {key}
                      </button>
                    ),
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="cash-tender-right">
            {QUICK_TENDERS.map((q) => {
              const amount = q.amountMinor === 'exact' ? totalMinor : q.amountMinor
              const disabled = q.amountMinor !== 'exact' && amount < totalMinor
              const selected = !disabled && rawInput !== '' && tenderedMinor === amount
              return (
                <button
                  key={q.label}
                  type="button"
                  className="quick-tender"
                  data-selected={selected}
                  disabled={disabled}
                  onClick={() => setQuickTender(q.amountMinor)}
                >
                  {q.label}
                </button>
              )
            })}

            <div className="change-due-card">
              <span className="change-due-label">Change due</span>
              <span className="change-due-amount tnum">{hasEnough ? formatEuroMinor(changeMinor) : '—'}</span>
            </div>

            <button type="button" className="complete-sale" disabled={!hasEnough || completing} onClick={() => void handleComplete()}>
              Complete — change {formatEuroMinor(hasEnough ? changeMinor : 0n)}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
