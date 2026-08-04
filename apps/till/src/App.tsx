import { useCallback, useEffect, useRef, useState } from 'react'
import type { shift } from '@batch/domain'
import './App.css'
import { currentIdentity, initTill, loadStoredConfig, reconcile, refreshStats, syncNow, type TillConfig } from './runtime'
import { uuidv7, type LocalStats, type ReconcileReport, type SyncOutcome } from './sync'
import { useOrder } from './useOrder'
import { useShift, type VarianceInfo } from './useShift'
import { STAFF_ROSTER, findStaff } from './auth/staff-source'
import { Setup } from './screens/Setup'
import { OrderEntry } from './screens/OrderEntry/OrderEntry'
import { CashTender } from './screens/CashTender/CashTender'
import { Receipt, type ClosedOrderSnapshot } from './screens/Receipt/Receipt'
import { ShiftOpen } from './screens/ShiftOpen/ShiftOpen'
import { CashMovements } from './screens/CashMovements/CashMovements'
import { BlindCount } from './screens/BlindCount/BlindCount'
import { VarianceResult, type PendingClose } from './screens/VarianceResult/VarianceResult'
import { Reports } from './screens/Reports/Reports'
import { Toast, type ToastState } from './components/Toast'
import { DiagnosticsDrawer } from './components/DiagnosticsDrawer'
import { StoragePreflight } from './components/StoragePreflight'
import type { HeaderProps, SyncPillState } from './components/Header'

/**
 * The till: Screens 1-4 (Sprint 3, order/tender/receipt) plus the Sprint 4 shift & cash screens.
 * Screen routing is in-memory state — never a URL router; a barista never needs a back button that
 * isn't the SPEC's own "Back to order" / "Cancel". Staff auth for the *order* path stays a stub
 * (STAFF_NAME_STUB) — non-negotiable #5 exempts order-entry/cash-tender/PIN from any gating that
 * would slow the sale down; the shift screens are where real PIN auth (ADR 0009) lives this sprint.
 */

const STAFF_NAME_STUB = 'Aoife'

const DEFAULT_API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3000'

type Screen = 'order' | 'tender' | 'receipt' | 'shift-open' | 'blind-count' | 'variance' | 'reports'

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
  const [preflightOpen, setPreflightOpen] = useState(false)
  const toastIdRef = useRef(0)

  // Sprint 4: cash movements sheet, blind-count → variance hand-off, and the pending Z-close decision
  // (who authorised it, which reason codes) carried from the variance screen to the Reports hold.
  const [movementsOpen, setMovementsOpen] = useState(false)
  const [varianceInfo, setVarianceInfo] = useState<VarianceInfo | null>(null)
  const [pendingClose, setPendingClose] = useState<PendingClose | null>(null)
  const [zSealed, setZSealed] = useState<shift.ZReport | null>(null)

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

  const identity = currentIdentity()
  // No `onCommitError` toast here (unlike `useOrder`): a failed drawer write rolls the optimistic
  // append back and rethrows, and each shift handler below catches it, toasts, and stays put — so a
  // failed count/movement never advances the UI as if it had recorded.
  const shiftHook = useShift({ deviceId: identity?.deviceId ?? '' })

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

  // Drain the outbox to the server (apps/till/CLAUDE.md write path). Fires on: startup (`ready` flips
  // true → drains any events queued in a PRIOR session), every commit (`order.events.length` bumps →
  // per-event drain), and connectivity regain (`online`). It must NOT be gated on the in-memory order
  // being non-empty — a barista who sells offline then taps "New sale" leaves an empty order, and the
  // queued sales must still drain when wifi returns (sync-auditor finding). `syncNow` on an empty
  // outbox is a cheap no-op. Never awaited by anything on the order path — this runs after paint.
  useEffect(() => {
    if (!ready) return
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
      try {
        await order.completeCashSale(tenderedMinor)
      } catch {
        // The terminal write failed and rolled back — the sale is NOT recorded. Stay on the tender
        // screen (order intact) and tell the barista to retry rather than printing a false receipt.
        showToast("Couldn't record the sale — check storage and try again.")
        return
      }
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
    [order, showToast],
  )

  const handleNewSale = useCallback(() => {
    order.reset()
    setClosedSnapshot(null)
    setScreen('order')
  }, [order])

  // --- Sprint 4: shift & cash screens ------------------------------------------------------------

  const handleShiftTap = useCallback(() => {
    setScreen(shiftHook.isOpen ? 'reports' : 'shift-open')
  }, [shiftHook.isOpen])

  const handleOpenMovements = useCallback(() => {
    if (!shiftHook.isOpen) {
      showToast('Open a shift first.')
      return
    }
    setMovementsOpen(true)
  }, [shiftHook.isOpen, showToast])

  const handleOpenShift = useCallback(
    async (input: { openedByStaffId: string; denominations: readonly shift.DenominationCount[]; countedMinor: bigint }) => {
      try {
        await shiftHook.openShift(input)
      } catch {
        showToast("Couldn't open the shift — check storage and try again.")
        return
      }
      setZSealed(null)
      setPendingClose(null)
      setVarianceInfo(null)
      setScreen('order')
    },
    [shiftHook, showToast],
  )

  const handleMovementCommit = useCallback(
    async (kind: Parameters<typeof shiftHook.payMovement>[0], input: Parameters<typeof shiftHook.payMovement>[1]) => {
      try {
        await shiftHook.payMovement(kind, input)
      } catch {
        // Stay on the movements sheet so the barista can retry; the movement was rolled back.
        showToast("Couldn't record the movement — check storage and try again.")
        return
      }
      setMovementsOpen(false)
    },
    [shiftHook, showToast],
  )

  const handleBlindCountCommit = useCallback(
    async (input: { denominations: readonly shift.DenominationCount[]; countedMinor: bigint }) => {
      try {
        await shiftHook.recordCount(input)
      } catch {
        // The count did not persist — do NOT advance to the variance screen with a phantom count.
        showToast("Couldn't save the count — check storage and try again.")
        return
      }
      const v = await shiftHook.variance()
      setVarianceInfo(v)
      setScreen('variance')
    },
    [shiftHook, showToast],
  )

  const handleReadyToClose = useCallback((pending: PendingClose) => {
    setPendingClose(pending)
    setScreen('reports')
  }, [])

  const handleRunZ = useCallback(
    async (pending: PendingClose) => {
      let z: shift.ZReport
      try {
        z = await shiftHook.closeShift(pending)
      } catch {
        // The seal did not persist — the shift stays open. The manager retries the hold.
        showToast("Couldn't issue the Z — the shift is still open. Try the hold again.")
        return
      }
      setZSealed(z)
      setPendingClose(null)
      shiftHook.reset() // this device can open a fresh shift immediately; the Z receipt lives in `zSealed`
    },
    [shiftHook, showToast],
  )

  // Dev-only on-device storage preflight (import.meta.env.DEV → tree-shaken from production builds).
  const devOverlay = import.meta.env.DEV ? (
    <>
      {!preflightOpen && (
        <button type="button" className="preflight-fab" onClick={() => setPreflightOpen(true)}>
          Storage ▸
        </button>
      )}
      {preflightOpen && <StoragePreflight onClose={() => setPreflightOpen(false)} />}
    </>
  ) : null

  if (!ready) {
    return (
      <>
        <Setup initialTenantId={tenantId} initialApiBaseUrl={apiBaseUrl} busy={busy} error={error} onSubmit={(c) => void connect(c)} />
        {devOverlay}
      </>
    )
  }

  const syncState: SyncPillState = !online ? 'offline' : syncing ? 'syncing' : 'synced'
  const headerProps: HeaderProps = {
    staffName: STAFF_NAME_STUB,
    syncState,
    onOpenDiagnostics: openDiagnostics,
    onShiftTap: handleShiftTap,
    shiftOpen: shiftHook.isOpen,
    onOpenMovements: handleOpenMovements,
  }

  const counterName = findStaff(shiftHook.state?.currentStaffId)?.name ?? 'Staff'

  return (
    <>
      {screen === 'order' && <OrderEntry order={order} headerProps={headerProps} onCharge={handleCharge} onToast={showToast} />}

      {screen === 'tender' && order.totals && (
        <CashTender totalMinor={order.totals.totalMinor} headerProps={headerProps} onBack={handleBackToOrder} onComplete={handleCompleteCashSale} />
      )}

      {screen === 'receipt' && closedSnapshot && <Receipt snapshot={closedSnapshot} headerProps={headerProps} onNewSale={handleNewSale} />}

      {screen === 'shift-open' && (
        <ShiftOpen staff={STAFF_ROSTER} syncState={syncState} onBack={() => setScreen('order')} onOpen={handleOpenShift} />
      )}

      {screen === 'blind-count' && (
        <BlindCount
          counterName={counterName}
          syncState={syncState}
          onCancel={() => setScreen('order')}
          onCommit={handleBlindCountCommit}
        />
      )}

      {screen === 'variance' && varianceInfo && (
        <VarianceResult
          variance={varianceInfo}
          staff={STAFF_ROSTER}
          onRecount={() => setScreen('blind-count')}
          onReadyToClose={handleReadyToClose}
        />
      )}

      {screen === 'reports' && (
        <Reports
          syncState={syncState}
          hasCommittedCount={shiftHook.hasCommittedCount}
          pendingClose={pendingClose}
          zSealed={zSealed}
          onBack={() => setScreen('order')}
          onRunX={shiftHook.xReport}
          onCountTheDrawer={() => setScreen('blind-count')}
          onRunZ={handleRunZ}
        />
      )}

      {movementsOpen && (
        <div className="movements-scrim" onClick={() => setMovementsOpen(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <CashMovements staff={STAFF_ROSTER} onCancel={() => setMovementsOpen(false)} onCommit={handleMovementCommit} />
          </div>
        </div>
      )}

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

      {devOverlay}
    </>
  )
}
