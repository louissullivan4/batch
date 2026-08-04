/**
 * The minimal top bar shared by the four shift screens that aren't the main order-entry Header
 * (SPEC Screen 3: "minimal header ... No other navigation"). Reuses the sync-pill visual language
 * from `Header.css` (never red, never a banner — offline is normal operation, root CLAUDE.md) without
 * pulling in the full order Header (staff-name stub, diagnostics long-press) that doesn't apply here.
 */

import type { SyncPillState } from './Header'
import { CheckIcon, ChevronLeftIcon, DashedRingIcon, RefreshIcon } from '../icons'
import '../components/Header.css'
import './ShiftScreenBar.css'

export interface ShiftScreenBarProps {
  readonly title: string
  readonly caption?: string
  readonly syncState: SyncPillState
  readonly onBack?: () => void
}

export function ShiftScreenBar({ title, caption, syncState, onBack }: ShiftScreenBarProps): JSX.Element {
  return (
    <div className="shift-bar">
      <div className="shift-bar-left">
        {onBack && (
          <button type="button" className="shift-bar-back" onClick={onBack} aria-label="Back">
            <ChevronLeftIcon size={18} />
          </button>
        )}
        <div className="shift-bar-titles">
          <h1 className="shift-bar-title">{title}</h1>
          {caption && <p className="shift-bar-caption">{caption}</p>}
        </div>
      </div>
      <span className="sync-pill" data-state={syncState}>
        {syncState === 'synced' && <CheckIcon size={14} />}
        {syncState === 'syncing' && <RefreshIcon size={14} className="sync-pill-spin" />}
        {syncState === 'offline' && <DashedRingIcon size={14} />}
        <span>{syncState === 'synced' ? 'Synced' : syncState === 'syncing' ? 'Syncing' : 'Offline'}</span>
      </span>
    </div>
  )
}
