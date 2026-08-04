import { useCallback, useEffect, useState, type FormEvent } from 'react'
import './App.css'
import {
  currentIdentity,
  initTill,
  loadStoredConfig,
  reconcile,
  refreshStats,
  syncNow,
  takeSampleOrder,
  type SampleOrderResult,
  type TillConfig,
} from './runtime'
import {
  uuidv7,
  type LocalStats,
  type ReconcileReport,
  type SyncOutcome,
} from './sync'

/**
 * Sprint 1 harness for `apps/till`. NOT the designed barista UI (that lands gated in Sprint 3, behind
 * DP-01/DP-02) — this screen exists only to prove the sync core and order builders are wired: a real
 * `LocalStore` write path, a real reconcile-on-startup, a real (opt-in) sync to the API.
 */

const DEFAULT_API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3000'

function formatEuroMinor(minor: bigint): string {
  const negative = minor < 0n
  const abs = negative ? -minor : minor
  const whole = abs / 100n
  const cents = abs % 100n
  return `${negative ? '-' : ''}€${whole.toString()}.${cents.toString().padStart(2, '0')}`
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

const RECONCILE_TONE: Record<ReconcileReport['status'], 'neutral' | 'good' | 'warn'> = {
  'first-run': 'neutral',
  healthy: 'good',
  'evicted-recovered': 'warn',
  'evicted-offline': 'warn',
}

export function App(): JSX.Element {
  const [tenantId, setTenantId] = useState('')
  const [apiBaseUrl, setApiBaseUrl] = useState(DEFAULT_API_BASE_URL)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  const [reconcileReport, setReconcileReport] = useState<ReconcileReport | null>(null)
  const [stats, setStats] = useState<LocalStats | null>(null)
  const [lastSync, setLastSync] = useState<SyncOutcome | null>(null)
  const [lastSample, setLastSample] = useState<SampleOrderResult | null>(null)
  const [tapToUpdateMs, setTapToUpdateMs] = useState<number | null>(null)

  // Connectivity is informational only — offline is normal operation (root CLAUDE.md), never an error.
  useEffect(() => {
    const goOnline = (): void => setOnline(true)
    const goOffline = (): void => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  const connect = useCallback(async (config: TillConfig): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await initTill(config)
      setReady(true)
      const report = await reconcile()
      setReconcileReport(report)
      setStats(await refreshStats())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [])

  // Auto-connect on load if this device was configured in a previous session — a barista should
  // never have to re-type the tenant id every shift.
  useEffect(() => {
    const stored = loadStoredConfig()
    if (stored) {
      setTenantId(stored.tenantId)
      setApiBaseUrl(stored.apiBaseUrl)
      void connect(stored)
    } else {
      setTenantId(uuidv7())
    }
    // Runs once on mount only.
  }, [])

  const handleConnectSubmit = (event: FormEvent): void => {
    event.preventDefault()
    void connect({ tenantId, apiBaseUrl })
  }

  const handleTakeSample = async (): Promise<void> => {
    const tapStart = performance.now()
    setBusy(true)
    setError(null)
    try {
      const result = await takeSampleOrder()
      setLastSample(result)
      setStats(await refreshStats())
      setTapToUpdateMs(performance.now() - tapStart)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const handleSyncNow = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const outcome = await syncNow()
      setLastSync(outcome)
      setStats(await refreshStats())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const identity = currentIdentity()

  return (
    <div className="till-app">
      <header className="till-header">
        <h1>Batch Till — Sprint 1 harness</h1>
        <div className="connectivity" data-online={online}>
          <span className="dot" aria-hidden="true" />
          {online ? 'Online' : 'Offline (normal)'}
        </div>
      </header>

      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}

      <section>
        <h2>Device configuration</h2>
        <form onSubmit={handleConnectSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label>
            Tenant ID (UUID)
            <input
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
              spellCheck={false}
            />
          </label>
          <label>
            API base URL
            <input
              value={apiBaseUrl}
              onChange={(e) => setApiBaseUrl(e.target.value)}
              placeholder="http://localhost:3000"
              spellCheck={false}
            />
          </label>
          <div className="actions">
            <button type="submit" disabled={busy || !tenantId || !apiBaseUrl}>
              {ready ? 'Reconnect' : 'Connect'}
            </button>
          </div>
        </form>
        {identity && (
          <div className="status-card">
            <span className="label">Device ID</span>
            <span className="value">{identity.deviceId}</span>
          </div>
        )}
      </section>

      <section>
        <h2>Order path (no network)</h2>
        <div className="actions">
          <button onClick={() => void handleTakeSample()} disabled={!ready || busy}>
            Take sample order
          </button>
          <button className="secondary" onClick={() => void handleSyncNow()} disabled={!ready || busy}>
            Sync now
          </button>
        </div>
        {lastSample && (
          <div className="status-grid">
            <div className="status-card">
              <span className="label">Last order total</span>
              <span className="value">{formatEuroMinor(lastSample.totalMinor)}</span>
            </div>
            <div className="status-card">
              <span className="label">Change given</span>
              <span className="value">{formatEuroMinor(lastSample.changeMinor)}</span>
            </div>
            <div className="status-card">
              <span className="label">Local commit latency (budget &lt;200ms)</span>
              <span className="value">{lastSample.commitMs.toFixed(1)}ms</span>
            </div>
            {tapToUpdateMs !== null && (
              <div className="status-card">
                <span className="label">Tap-to-render latency (budget &lt;100ms)</span>
                <span className="value">{tapToUpdateMs.toFixed(1)}ms</span>
              </div>
            )}
          </div>
        )}
      </section>

      <section>
        <h2>Status</h2>
        <div className="status-grid">
          <div className="status-card">
            <span className="label">Startup reconcile</span>
            {reconcileReport ? (
              <span className="badge" data-tone={RECONCILE_TONE[reconcileReport.status]}>
                {RECONCILE_LABEL[reconcileReport.status]}
              </span>
            ) : (
              <span className="value">not run</span>
            )}
          </div>
          {reconcileReport && (
            <div className="status-card">
              <span className="label">Recovered / persisted</span>
              <span className="value">
                {reconcileReport.recovered} recovered · persist(){' '}
                {reconcileReport.persisted === null ? 'n/a' : String(reconcileReport.persisted)}
              </span>
            </div>
          )}
          <div className="status-card">
            <span className="label">Unsynced events</span>
            <span className="value">{stats ? stats.unsyncedCount : '—'}</span>
          </div>
          <div className="status-card">
            <span className="label">Oldest unsynced age</span>
            <span className="value">{stats ? formatAge(stats.oldestUnsyncedAt) : '—'}</span>
          </div>
          <div className="status-card">
            <span className="label">Local event count</span>
            <span className="value">{stats ? stats.eventCount : '—'}</span>
          </div>
          <div className="status-card">
            <span className="label">Last sync outcome</span>
            <span className="value">
              {lastSync
                ? lastSync.offline
                  ? 'Offline — queued'
                  : `${lastSync.synced} synced, ${lastSync.rejected} rejected, ${lastSync.remaining} remaining`
                : 'not run yet'}
            </span>
          </div>
        </div>
      </section>
    </div>
  )
}
