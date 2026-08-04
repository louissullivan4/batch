/**
 * The sync/storage diagnostics drawer — the detail behind the header's at-a-glance sync pill.
 * Carries forward everything the Sprint 1 harness surfaced (device id, startup reconcile status,
 * unsynced count/age, local event count, last sync outcome, a manual "Sync now") because
 * apps/till/CLAUDE.md requires the unsynced count/age and eviction-detection state to stay visible
 * in the UI, not get lost when the harness screen was replaced by the designed till.
 *
 * Reachable by long-pressing the wordmark; never appears unprompted, and closes on a scrim tap or
 * the close button — it does not sit on the order path, so a light scrim is fine here (root
 * CLAUDE.md's "no modal blocks the order path" is about the order/tender flow, not an opt-in
 * diagnostics panel).
 */

import type { DeviceIdentity, LocalStats, ReconcileReport, SyncOutcome } from '../sync'
import './DiagnosticsDrawer.css'

export interface DiagnosticsDrawerProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly identity: DeviceIdentity | null
  readonly reconcileReport: ReconcileReport | null
  readonly stats: LocalStats | null
  readonly lastSync: SyncOutcome | null
  readonly busy: boolean
  readonly onSyncNow: () => void
}

function formatAge(iso: string | null): string {
  if (iso === null) return 'fully synced'
  const ms = Date.now() - Date.parse(iso)
  if (ms < 1000) return 'just now'
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return `${hours}h`
}

const RECONCILE_LABEL: Record<ReconcileReport['status'], string> = {
  'first-run': 'First run — device registered',
  healthy: 'Healthy — local store intact',
  'evicted-recovered': 'Recovered — store was wiped, resynced from server',
  'evicted-offline': 'Suspected loss — offline, cannot confirm yet',
}

export function DiagnosticsDrawer({
  open,
  onClose,
  identity,
  reconcileReport,
  stats,
  lastSync,
  busy,
  onSyncNow,
}: DiagnosticsDrawerProps): JSX.Element | null {
  if (!open) return null
  return (
    <div className="diagnostics-scrim" onClick={onClose}>
      <div className="diagnostics-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="diagnostics-header">
          <h2>Sync diagnostics</h2>
          <button type="button" className="diagnostics-close" onClick={onClose} aria-label="Close diagnostics">
            Close
          </button>
        </div>

        <dl className="diagnostics-grid">
          <div className="diagnostics-row">
            <dt>Device ID</dt>
            <dd>{identity?.deviceId ?? '—'}</dd>
          </div>
          <div className="diagnostics-row">
            <dt>Startup reconcile</dt>
            <dd data-tone={reconcileReport?.status === 'healthy' ? 'good' : 'neutral'}>
              {reconcileReport ? RECONCILE_LABEL[reconcileReport.status] : 'not run'}
            </dd>
          </div>
          <div className="diagnostics-row">
            <dt>Unsynced events</dt>
            <dd className="tnum">{stats ? stats.unsyncedCount : '—'}</dd>
          </div>
          <div className="diagnostics-row">
            <dt>Oldest unsynced age</dt>
            <dd className="tnum">{stats ? formatAge(stats.oldestUnsyncedAt) : '—'}</dd>
          </div>
          <div className="diagnostics-row">
            <dt>Local event count</dt>
            <dd className="tnum">{stats ? stats.eventCount : '—'}</dd>
          </div>
          <div className="diagnostics-row">
            <dt>Last sync outcome</dt>
            <dd>
              {lastSync
                ? lastSync.offline
                  ? 'Offline — queued'
                  : `${lastSync.synced} synced, ${lastSync.rejected} rejected, ${lastSync.remaining} remaining`
                : 'not run yet'}
            </dd>
          </div>
        </dl>

        <button type="button" className="diagnostics-sync-now" onClick={onSyncNow} disabled={busy}>
          Sync now
        </button>
      </div>
    </div>
  )
}
