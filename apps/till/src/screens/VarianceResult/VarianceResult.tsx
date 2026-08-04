/**
 * Screen 4 — Variance result (SPEC "Screen 4"). The expected figure appears here for the FIRST time —
 * everything up to this screen has been counted-only (ADR 0010 blind-count integrity). Over and short
 * are typographically identical; direction is word + triangle glyph, never colour (colour is reserved
 * for the one "Exact" success state). The close is never blocked: an over-threshold variance with no
 * manager present still closes, flagged unauthorised for back-office review.
 *
 * This screen does not itself commit `ShiftClosed` — it hands the close decision (who authorised it,
 * which reason codes) to the caller, which carries it to the Reports screen's hold-to-run-Z action
 * (screen 5's own precondition/finality). That keeps the irreversible Z-seal a single, deliberate
 * gesture rather than something a PIN entry alone can trigger.
 */

import { useState } from 'react'
import { formatEuroMinor } from '../../format'
import type { VarianceInfo } from '../../useShift'
import type { StaffFixtureEntry } from '../../auth/staff-fixture'
import { PinPad } from '../../components/PinPad'
import { CheckIcon, TriangleDownIcon, TriangleUpIcon } from '../../icons'
import './VarianceResult.css'

const DEFAULT_THRESHOLD_MINOR = 1000n // €10.00 (SPEC: "configurable, default €10")

const REASON_CODES = ['Change given wrong', 'Paid-out not recorded', 'Note counted twice', 'Not sure yet'] as const

export interface PendingClose {
  readonly closedByStaffId: string
  readonly reasonCodes: readonly string[]
  readonly authorised: boolean
}

export interface VarianceResultProps {
  readonly variance: VarianceInfo
  readonly staff: readonly StaffFixtureEntry[]
  readonly thresholdMinor?: bigint
  readonly onRecount: () => void
  /** Hands the close decision to the caller — see the file header note. */
  readonly onReadyToClose: (input: PendingClose) => void
}

type CloseMode = 'manager' | 'flag' | 'simple' | null

export function VarianceResult({
  variance,
  staff,
  thresholdMinor = DEFAULT_THRESHOLD_MINOR,
  onRecount,
  onReadyToClose,
}: VarianceResultProps): JSX.Element {
  const [selectedReasons, setSelectedReasons] = useState<readonly string[]>([])
  const [closeMode, setCloseMode] = useState<CloseMode>(null)

  const absVariance = variance.varianceMinor < 0n ? -variance.varianceMinor : variance.varianceMinor
  const overThreshold = absVariance > thresholdMinor

  const toggleReason = (code: string): void =>
    setSelectedReasons((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]))

  const handleAuthorised = (s: StaffFixtureEntry): void => {
    onReadyToClose({
      closedByStaffId: s.id,
      reasonCodes: selectedReasons,
      authorised: closeMode !== 'flag',
    })
  }

  return (
    <div className="variance-result">
      <div className="variance-card">
        <div className="variance-row">
          <span>Counted</span>
          <span className="tnum">{formatEuroMinor(variance.countedMinor)}</span>
        </div>
        <div className="variance-row">
          <span>Expected</span>
          <span className="tnum">{formatEuroMinor(variance.expectedMinor)}</span>
        </div>
        <hr className="variance-rule" />
        {variance.direction === 'EXACT' ? (
          <div className="variance-verdict variance-verdict--exact">
            <CheckIcon size={28} />
            <span className="tnum">Exact — {formatEuroMinor(variance.countedMinor)}</span>
          </div>
        ) : (
          <div className="variance-verdict">
            {variance.direction === 'OVER' ? <TriangleUpIcon size={28} /> : <TriangleDownIcon size={28} />}
            <span className="tnum">
              {variance.direction === 'OVER' ? 'Over' : 'Short'} {formatEuroMinor(absVariance)}
            </span>
          </div>
        )}
        <p className="variance-caption" onClick={onRecount} role="button" tabIndex={0}>
          Recorded against this shift · second count available
        </p>
      </div>

      <div className="variance-reasons">
        <span className="variance-reasons-label">What happened? (optional)</span>
        <div className="variance-reason-chips">
          {REASON_CODES.map((code) => (
            <button
              key={code}
              type="button"
              className="variance-reason-chip"
              data-selected={selectedReasons.includes(code)}
              onClick={() => toggleReason(code)}
            >
              {code}
            </button>
          ))}
        </div>
      </div>

      <div className="variance-close">
        {closeMode ? (
          <PinPad
            staff={staff}
            requireRole={closeMode === 'manager' ? 'MANAGER' : undefined}
            caption={closeMode === 'manager' ? 'Enter a manager PIN to close' : 'Enter a PIN to close'}
            onSuccess={handleAuthorised}
            onCancel={() => setCloseMode(null)}
          />
        ) : overThreshold ? (
          <>
            <button type="button" className="variance-close-manager" onClick={() => setCloseMode('manager')}>
              Manager PIN — close shift
            </button>
            <button type="button" className="variance-close-flag" onClick={() => setCloseMode('flag')}>
              No manager here — close and flag
            </button>
            <p className="variance-flag-caption">
              Closes normally. The variance is marked unauthorised and appears in the back-office review.
            </p>
          </>
        ) : (
          <button type="button" className="variance-close-manager" onClick={() => setCloseMode('simple')}>
            Close shift
          </button>
        )}
      </div>
    </div>
  )
}
