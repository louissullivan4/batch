/**
 * The inline staff PIN pad (SPEC: "3×4, 4 dots above, dots fill on entry"), reused wherever the
 * shift screens need authorisation — never a separate trip. Verifies entirely on-device via
 * `verifyPin` (ADR 0009); no network call anywhere in this component (root CLAUDE.md non-negotiable
 * #5). "The authorising staff member is whoever's PIN validates — no name picker to falsify" (SPEC):
 * a completed 4-digit entry is checked against every candidate staff member's PHC hash, and the one
 * that matches is the identity returned.
 *
 * Wrong PIN: dots shake once (120ms), clear, caption "Try again" in ink (not red). 5 failures → 30s
 * cooldown, caption states the remaining time — a session-local counter (SPEC: "session-local counter
 * is fine"), so it resets if the component unmounts.
 */

import { useCallback, useEffect, useState } from 'react'
import { verifyPin } from '../auth/pin'
import type { StaffFixtureEntry, StaffRole } from '../auth/staff-fixture'
import './PinPad.css'

const PIN_LENGTH = 4
const MAX_FAILURES = 5
const COOLDOWN_MS = 30_000
const SHAKE_MS = 120

export interface PinPadProps {
  readonly staff: readonly StaffFixtureEntry[]
  /** Restrict which staff can authorise (SPEC Screen 4: "Manager PIN — close shift"). */
  readonly requireRole?: StaffRole
  readonly onSuccess: (staff: StaffFixtureEntry) => void
  readonly onCancel?: () => void
  readonly caption?: string
}

const KEYS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['', '0', '⌫'],
]

export function PinPad({ staff, requireRole, onSuccess, onCancel, caption }: PinPadProps): JSX.Element {
  const [digits, setDigits] = useState('')
  const [shake, setShake] = useState(false)
  const [message, setMessage] = useState<string | null>(caption ?? null)
  const [verifying, setVerifying] = useState(false)
  const [failures, setFailures] = useState(0)
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null)
  const [nowTick, setNowTick] = useState(() => Date.now())

  useEffect(() => {
    if (cooldownUntil === null) return
    const id = setInterval(() => setNowTick(Date.now()), 500)
    return () => clearInterval(id)
  }, [cooldownUntil])

  const cooldownRemainingS = cooldownUntil !== null ? Math.max(0, Math.ceil((cooldownUntil - nowTick) / 1000)) : 0
  const inCooldown = cooldownUntil !== null && cooldownRemainingS > 0

  // Clear the cooldown once it elapses — as an effect, not a render-time side effect.
  useEffect(() => {
    if (cooldownUntil !== null && !inCooldown) setCooldownUntil(null)
  }, [cooldownUntil, inCooldown])

  const attempt = useCallback(
    async (pin: string): Promise<void> => {
      setVerifying(true)
      const candidates = requireRole ? staff.filter((s) => s.role === requireRole) : staff
      const results = await Promise.all(candidates.map(async (s) => ({ s, ok: await verifyPin(pin, s.pinPhc) })))
      const match = results.find((r) => r.ok)?.s
      setVerifying(false)
      if (match) {
        setDigits('')
        setFailures(0)
        setMessage(null)
        onSuccess(match)
        return
      }
      setShake(true)
      setTimeout(() => setShake(false), SHAKE_MS)
      setDigits('')
      const nextFailures = failures + 1
      setFailures(nextFailures)
      if (nextFailures >= MAX_FAILURES) {
        setCooldownUntil(Date.now() + COOLDOWN_MS)
        setMessage(`Too many attempts — try again in ${Math.ceil(COOLDOWN_MS / 1000)}s`)
      } else {
        setMessage('Try again')
      }
    },
    [staff, requireRole, failures, onSuccess],
  )

  const press = useCallback(
    (key: string) => {
      if (inCooldown || verifying) return
      if (key === '') return
      if (key === '⌫') {
        setDigits((d) => d.slice(0, -1))
        return
      }
      setDigits((d) => {
        const next = d.length >= PIN_LENGTH ? d : d + key
        if (next.length === PIN_LENGTH) void attempt(next)
        return next
      })
    },
    [inCooldown, verifying, attempt],
  )

  const dots = Array.from({ length: PIN_LENGTH }, (_, i) => i < digits.length)

  return (
    <div className="pin-pad">
      <div className={`pin-dots${shake ? ' pin-dots--shake' : ''}`} aria-hidden="true">
        {dots.map((filled, i) => (
          <span key={i} className="pin-dot" data-filled={filled} />
        ))}
      </div>
      <p className="pin-caption" role="status">
        {inCooldown
          ? `Too many attempts — try again in ${cooldownRemainingS}s`
          : (message ?? requireRole === 'MANAGER'
              ? 'Enter a manager PIN'
              : 'Enter your PIN')}
      </p>
      <div className="pin-keys">
        {KEYS.map((row, i) => (
          <div className="pin-key-row" key={i}>
            {row.map((key, j) =>
              key === '' ? (
                <span key={j} className="pin-key pin-key--blank" aria-hidden="true" />
              ) : (
                <button
                  key={key}
                  type="button"
                  className="pin-key tnum"
                  disabled={inCooldown || verifying}
                  onClick={() => press(key)}
                >
                  {key}
                </button>
              ),
            )}
          </div>
        ))}
      </div>
      {onCancel && (
        <button type="button" className="pin-cancel" onClick={onCancel}>
          Cancel
        </button>
      )}
    </div>
  )
}

export type { StaffFixtureEntry, StaffRole }
