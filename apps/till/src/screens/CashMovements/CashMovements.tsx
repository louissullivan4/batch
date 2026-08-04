/**
 * Screen 2 — Cash movements (SPEC "Screen 2"). Presented as a sheet over the till, same scrim/
 * geometry as the modifier sheet, so a paid-out mid-rush costs seconds. Reason is required (a
 * movement without one is unreconcilable by definition); authorisation is whoever's PIN validates —
 * no name picker to falsify. Fully offline: nothing here touches `fetch`.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { parseKeypadInput } from '@batch/domain'
import { formatEuroMinor } from '../../format'
import { appendKeypadChar, backspaceKeypad } from '../../keypad'
import type { MovementKind } from '../../shift-ops'
import type { StaffFixtureEntry } from '../../auth/staff-fixture'
import { PinPad } from '../../components/PinPad'
import { CheckIcon, RadioGlyph } from '../../icons'
import './CashMovements.css'

interface MovementTileSpec {
  readonly kind: MovementKind
  readonly label: string
  readonly sub: string
}

const TILES: readonly MovementTileSpec[] = [
  { kind: 'PayIn', label: 'Paid in', sub: 'Cash added to the drawer.' },
  { kind: 'PayOut', label: 'Paid out', sub: 'Cash spent from the drawer.' },
  { kind: 'Skim', label: 'Skim', sub: 'Cash out to reduce the float, counted later.' },
  { kind: 'SafeDrop', label: 'Safe drop', sub: 'Cash out to the safe, counted later.' },
]

const REASONS: Record<MovementKind, readonly string[]> = {
  PayIn: ['Change from safe', 'Float correction'],
  PayOut: ['Milk run', 'Cleaning', 'Window cleaner', 'Courier'],
  Skim: ['Over limit', 'End of rush'],
  SafeDrop: ['Over limit', 'End of rush'],
}

const VERB: Record<MovementKind, string> = {
  PayIn: 'Pay in',
  PayOut: 'Pay out',
  Skim: 'Skim',
  SafeDrop: 'Safe drop',
}

export interface CashMovementsProps {
  readonly staff: readonly StaffFixtureEntry[]
  readonly onCancel: () => void
  readonly onCommit: (kind: MovementKind, input: { amountMinor: bigint; reason: string; authStaffId: string }) => Promise<void>
}

export function CashMovements({ staff, onCancel, onCommit }: CashMovementsProps): JSX.Element {
  const [kind, setKind] = useState<MovementKind | null>(null)
  const [rawAmount, setRawAmount] = useState('')
  const [reason, setReason] = useState<string | null>(null)
  const [customReason, setCustomReason] = useState('')
  const [showCustomInput, setShowCustomInput] = useState(false)
  const [authorisedBy, setAuthorisedBy] = useState<StaffFixtureEntry | null>(null)
  const [committing, setCommitting] = useState(false)

  // A new movement type resets the reason (the lists differ per type) and any pending authorisation.
  useEffect(() => {
    setReason(null)
    setCustomReason('')
    setShowCustomInput(false)
    setAuthorisedBy(null)
  }, [kind])

  const parsed = rawAmount === '' ? null : parseKeypadInput(rawAmount)
  const amountMinor = parsed?.ok ? parsed.value.amountMinor : 0n
  const effectiveReason = showCustomInput ? customReason.trim() : (reason ?? '')

  const canAuthorise = kind !== null && amountMinor > 0n && effectiveReason !== ''
  const canCommit = canAuthorise && authorisedBy !== null

  const appendChar = useCallback((ch: string) => setRawAmount((prev) => appendKeypadChar(prev, ch)), [])
  const backspaceOne = useCallback(() => setRawAmount((prev) => backspaceKeypad(prev)), [])

  const keypadRows = useMemo(
    () => [
      ['1', '2', '3'],
      ['4', '5', '6'],
      ['7', '8', '9'],
      ['.', '0', '⌫'],
    ],
    [],
  )

  const handleCommit = useCallback(async () => {
    if (!kind || !authorisedBy || committing) return
    setCommitting(true)
    try {
      await onCommit(kind, { amountMinor, reason: effectiveReason, authStaffId: authorisedBy.id })
    } finally {
      setCommitting(false)
    }
  }, [kind, authorisedBy, amountMinor, effectiveReason, onCommit, committing])

  return (
    <div className="cash-movements">
      <div className="cash-movements-header">
        <h2>Cash movements</h2>
      </div>

      <div className="cash-movements-body">
        <div className="movement-tile-grid">
          {TILES.map((t) => (
            <button
              key={t.kind}
              type="button"
              className="movement-tile"
              data-selected={t.kind === kind}
              onClick={() => setKind(t.kind)}
            >
              <span className="movement-tile-label">
                <RadioGlyph selected={t.kind === kind} />
                {t.label}
              </span>
              <span className="movement-tile-sub">{t.sub}</span>
            </button>
          ))}
        </div>

        {kind && (
          <div className="movement-detail">
            <div className="movement-amount-row">
              <div className="movement-readout tnum" data-empty={rawAmount === ''}>
                €{rawAmount === '' ? '0.00' : rawAmount}
              </div>
              <div className="movement-keypad">
                {keypadRows.map((row, i) => (
                  <div className="movement-keypad-row" key={i}>
                    {row.map((key) =>
                      key === '⌫' ? (
                        <button key={key} type="button" className="movement-key" onClick={backspaceOne}>
                          ⌫
                        </button>
                      ) : (
                        <button key={key} type="button" className="movement-key tnum" onClick={() => appendChar(key)}>
                          {key}
                        </button>
                      ),
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="movement-reasons">
              <span className="movement-reasons-label">Reason</span>
              <div className="movement-reason-chips">
                {REASONS[kind].map((r) => (
                  <button
                    key={r}
                    type="button"
                    className="movement-reason-chip"
                    data-selected={!showCustomInput && reason === r}
                    onClick={() => {
                      setShowCustomInput(false)
                      setReason(r)
                    }}
                  >
                    {r}
                  </button>
                ))}
                <button
                  type="button"
                  className="movement-reason-chip"
                  data-selected={showCustomInput}
                  onClick={() => setShowCustomInput(true)}
                >
                  Other…
                </button>
              </div>
              {showCustomInput && (
                <input
                  className="movement-reason-input"
                  type="text"
                  placeholder="Type a reason"
                  value={customReason}
                  autoFocus
                  onChange={(e) => setCustomReason(e.target.value)}
                />
              )}
            </div>

            <div className="movement-auth">
              {authorisedBy ? (
                <p className="movement-authorised">
                  <CheckIcon size={16} />
                  Authorised by {authorisedBy.name}
                </p>
              ) : canAuthorise ? (
                <PinPad staff={staff} onSuccess={setAuthorisedBy} caption="Enter a PIN to authorise" />
              ) : (
                <p className="movement-auth-hint">Enter an amount and a reason to authorise.</p>
              )}
            </div>

            <button type="button" className="movement-commit" disabled={!canCommit || committing} onClick={() => void handleCommit()}>
              {VERB[kind]} {formatEuroMinor(amountMinor)}
            </button>
          </div>
        )}
      </div>

      <div className="cash-movements-footer">
        <button type="button" className="movement-close" onClick={onCancel}>
          Close
        </button>
      </div>
    </div>
  )
}
