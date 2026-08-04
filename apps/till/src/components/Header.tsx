/**
 * Shared header for all three screens (SPEC Screen 1 "Header", reused verbatim on tender + receipt).
 *
 * Staff identity and shifts are stubs: till auth (device token + local PIN) and real shift
 * open/close land in Sprint 4. Rendering "Aoife" / "Shift open" here matches the SPEC visual without
 * scaffolding Sprint 4 logic — tapping the shift pill only toasts that it isn't wired up yet.
 *
 * The sync pill is the at-a-glance indicator (synced / syncing / offline — never red, never a
 * banner); the full unsynced-count/age detail lives one level down, in the diagnostics drawer
 * reachable by long-pressing the wordmark (apps/till/CLAUDE.md: unsynced count/age is required UI).
 */

import { useEffect, useRef, useState } from 'react'
import { CheckIcon, DashedRingIcon, RefreshIcon } from '../icons'
import { useLongPressOnly } from '../gestures'
import './Header.css'

export type SyncPillState = 'synced' | 'syncing' | 'offline'

export interface HeaderProps {
  readonly staffName: string
  readonly syncState: SyncPillState
  readonly onOpenDiagnostics: () => void
  readonly onShiftTap: () => void
}

const SYNC_COPY: Record<SyncPillState, string> = {
  synced: 'All orders are synced.',
  syncing: 'Syncing in the background — this never blocks an order.',
  offline: 'Orders are saved on this iPad and will sync automatically. No action required.',
}

function useClock(): string {
  const [label, setLabel] = useState(() => formatClock(new Date()))
  useEffect(() => {
    const id = setInterval(() => setLabel(formatClock(new Date())), 15_000)
    return () => clearInterval(id)
  }, [])
  return label
}

function formatClock(d: Date): string {
  return d.toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function SyncPill({ state }: { readonly state: SyncPillState }): JSX.Element {
  const [open, setOpen] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const toggle = (): void => {
    setOpen((prev) => !prev)
    if (closeTimer.current !== null) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setOpen(false), 4000)
  }

  useEffect(() => () => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current)
  }, [])

  return (
    <div className="sync-pill-wrap">
      <button type="button" className="sync-pill" data-state={state} onClick={toggle} aria-expanded={open}>
        {state === 'synced' && <CheckIcon size={14} />}
        {state === 'syncing' && <RefreshIcon size={14} className="sync-pill-spin" />}
        {state === 'offline' && <DashedRingIcon size={14} />}
        <span>{state === 'synced' ? 'Synced' : state === 'syncing' ? 'Syncing' : 'Offline'}</span>
      </button>
      {open && (
        <div className="sync-popover" role="status">
          {SYNC_COPY[state]}
        </div>
      )}
    </div>
  )
}

export function Header({ staffName, syncState, onOpenDiagnostics, onShiftTap }: HeaderProps): JSX.Element {
  const clock = useClock()
  const wordmarkGesture = useLongPressOnly(onOpenDiagnostics)

  return (
    <header className="till-header">
      <div className="till-header-left">
        <button type="button" className="wordmark" {...wordmarkGesture} aria-label="Batch — long-press for diagnostics">
          Batch
        </button>
        <span className="staff-name">{staffName}</span>
        {/* Shift open/close is Sprint 4 (real shift lifecycle). Stub pill matches the SPEC visual. */}
        <button type="button" className="shift-pill" onClick={onShiftTap}>
          <CheckIcon size={14} />
          <span>Shift open</span>
        </button>
      </div>
      <div className="till-header-right">
        <SyncPill state={syncState} />
        <span className="clock tnum">{clock}</span>
      </div>
    </header>
  )
}
