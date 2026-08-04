import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import {
  currentIdentity,
  initTill,
  loadStoredConfig,
  reconcile,
  refreshStats,
  syncNow,
  type TillConfig,
} from './runtime'
import { uuidv7, type LocalStats, type ReconcileReport, type SyncOutcome } from './sync'
import { useOrder } from './useOrder'
import { Setup } from './screens/Setup'
import { OrderEntry } from './screens/OrderEntry/OrderEntry'
import { CashTender } from './screens/CashTender/CashTender'
import { Receipt, type ClosedOrderSnapshot } from './screens/Receipt/Receipt'
import { Toast, type ToastState } from './components/Toast'
import { DiagnosticsDrawer } from './components/DiagnosticsDrawer'
import type { HeaderProps, SyncPillState } from './components/Header'

/**
 * Sprint 3 till: the designed barista UI (Screens 1-4), replacing the Sprint 1 harness. Screen
 * routing is in-memory state — `order → tender → receipt` — never a URL router; a barista never
 * needs a back button that isn't the SPEC's own "Back to order".
 *
 * Staff auth is a Sprint 4 concern (device token + local PIN, root CLAUDE.md non-negotiable #5), so
 * the operator identity here is a static stub, not a login. Shifts are also Sprint 4; the header's
 * shift pill is a non-functional stub that toasts rather than opening real shift actions.
 */

// Sprint 4 will replace this with the authenticated staff member from the local PIN check.
const STAFF_NAME_STUB = 'Aoife'

const DEFAULT_API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3000'

type Screen = 'order' | 'tender' | 'receipt'

export function App(): JSX.Element {
  const [tenantId, setTenantId] = useState('')
  const [apiBaseUrl, setApiBaseUrl] = useState(DEFAULT_API_BASE_URL)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  const [syncing, setSyncing] = useState(false)
  const [reconcileReport, setReconcileReport] = useState<ReconcileReport | null>(null)
  const [stats, setStats] = useState<LocalStats | null>(null)
  const [lastSync, setLastSync] = useState<SyncOutcome | null>(null)

  const [screen, setScreen] = useState<Screen>('order')
  const [closedSnapshot, setClosedSnapshot] = useState<ClosedOrderSnapshot | null>(null)
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)
  const toastIdRef = useRef(0)

  const showToast = useCallback((message: string) => {
    toastIdRef.current += 1
    setToast({ id: toastIdRef.current, message })
  }, [])

  const order = useOrder({
    onCommitError: () =>
      // SPEC: a full-storage write failure is a toast, never a blocking dialog — the sale stays in
      // memory (useOrder keeps the optimistic state regardless of what happened to the write).
      showToast("Couldn't save that change — it's kept on screen, but check storage space."),
  })

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
  // never have to re-type the tenant id every shift. Runs once on mount only.
  useEffect(() => {
    const stored = loadStoredConfig()
    if (stored) {
      setTenantId(stored.tenantId)
      setApiBaseUrl(stored.apiBaseUrl)
      void connect(stored)
    } else {
      setTenantId(uuidv7())
    }
    // Runs once on mount only — re-running on `connect` identity changes would re-trigger auto-connect.
  }, [])

  // Drain the outbox per event when online (apps/till/CLAUDE.md write path), triggered from the UI
  // layer: each committed order event bumps `order.events.length`, which is the per-event drain
  // signal. Also re-drains whenever connectivity is regained. Never awaited by anything on the order
  // path — this effect runs after the paint, not before it.
  useEffect(() => {
    if (!ready || order.events.length === 0) return
    let cancelled = false
    void (async () => {
      setStats(await refreshStats())
      if (!online) return
      setSyncing(true)
      try {
        const outcome = await syncNow()
        if (!cancelled) setLastSync(outcome)
      } finally {
        if (!cancelled) setSyncing(false)
      }
      if (!cancelled) setStats(await refreshStats())
    })()
    return () => {
      cancelled = true
    }
  }, [ready, order.events.length, online])

  const openDiagnostics = useCallback(() => {
    setDiagnosticsOpen(true)
    void (async () => setStats(await refreshStats()))()
  }, [])

  const handleSyncNow = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      const outcome = await syncNow()
      setLastSync(outcome)
      setStats(await refreshStats())
    } finally {
      setBusy(false)
    }
  }, [])

  const handleCharge = useCallback(() => {
    if (!order.isEmpty) setScreen('tender')
  }, [order.isEmpty])

  const handleBackToOrder = useCallback(() => setScreen('order'), [])

  const handleCompleteCashSale = useCallback(
    async (tenderedMinor: bigint): Promise<void> => {
      const preTotals = order.totals
      const preLines = order.lines
      await order.completeCashSale(tenderedMinor)
      if (preTotals) {
        const changeMinor = tenderedMinor - preTotals.totalMinor
        setClosedSnapshot({
          lines: preLines,
          totals: {
            ...preTotals,
            tenderedMinor: preTotals.tenderedMinor + tenderedMinor,
            cashTenderedMinor: preTotals.cashTenderedMinor + tenderedMinor,
            changeMinor: preTotals.changeMinor + changeMinor,
            balanceMinor: preTotals.balanceMinor - tenderedMinor,
          },
          closedAt: new Date(),
        })
      }
      setScreen('receipt')
    },
    [order],
  )

  const handleNewSale = useCallback(() => {
    order.reset()
    setClosedSnapshot(null)
    setScreen('order')
  }, [order])

  const identity = currentIdentity()

  if (!ready) {
    return <Setup initialTenantId={tenantId} initialApiBaseUrl={apiBaseUrl} busy={busy} error={error} onSubmit={(c) => void connect(c)} />
  }

  const syncState: SyncPillState = !online ? 'offline' : syncing ? 'syncing' : 'synced'
  const headerProps: HeaderProps = {
    staffName: STAFF_NAME_STUB,
    syncState,
    onOpenDiagnostics: openDiagnostics,
    onShiftTap: () => showToast('Shifts arrive in Sprint 4'),
  }

  return (
    <>
      {screen === 'order' && <OrderEntry order={order} headerProps={headerProps} onCharge={handleCharge} onToast={showToast} />}

      {screen === 'tender' && order.totals && (
        <CashTender totalMinor={order.totals.totalMinor} headerProps={headerProps} onBack={handleBackToOrder} onComplete={handleCompleteCashSale} />
      )}

      {screen === 'receipt' && closedSnapshot && <Receipt snapshot={closedSnapshot} headerProps={headerProps} onNewSale={handleNewSale} />}

      <Toast toast={toast} onDismiss={() => setToast(null)} />

      <DiagnosticsDrawer
        open={diagnosticsOpen}
        onClose={() => setDiagnosticsOpen(false)}
        identity={identity}
        reconcileReport={reconcileReport}
        stats={stats}
        lastSync={lastSync}
        busy={busy}
        onSyncNow={() => void handleSyncNow()}
      />
    </>
  )
}
