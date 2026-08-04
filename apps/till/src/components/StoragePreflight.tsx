/**
 * On-device storage preflight — a **dev-only** panel that reads the browser preconditions the Sprint 1
 * durability story depends on, so they can be checked on a physical iPad where there are no devtools.
 *
 * It is strictly read-only about storage: it calls existing platform APIs and the existing
 * `refreshStats()` runtime accessor. It does not touch the sync/outbox/OPFS *logic* (that stays in
 * `@batch/storage` and `src/sync`). Gated behind `import.meta.env.DEV` at the call site so it never
 * ships in a production build.
 */

import { useCallback, useEffect, useState } from 'react'
import { isInitialised, refreshStats } from '../runtime'
import './StoragePreflight.css'

interface Preflight {
  secureContext: boolean
  standalone: boolean
  swSupported: boolean
  swState: string
  storageApi: boolean
  persisted: boolean | null
  persistResult: boolean | null
  opfsGetDirectory: boolean
  syncAccessHandleOnPrototype: boolean
  quotaBytes: number | null
  usageBytes: number | null
  unsyncedCount: number | null
  oldestUnsyncedAt: string | null
}

// iOS exposes the non-standard `navigator.standalone`; the standard signal is the display-mode media
// query. Narrow the type here rather than reaching for `any` (banned).
interface IosNavigator {
  readonly standalone?: boolean
}

// Narrow the storage surface locally so the check doesn't depend on the TS DOM lib version having
// `getDirectory` on `StorageManager` (it varies by lib version). All methods are optional and probed.
interface StorageManagerLike {
  persisted?: () => Promise<boolean>
  persist?: () => Promise<boolean>
  estimate?: () => Promise<{ quota?: number; usage?: number }>
  getDirectory?: () => Promise<unknown>
}

function isStandalone(): boolean {
  const mql = typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches
  const ios = (navigator as unknown as IosNavigator).standalone === true
  return mql || ios
}

async function swState(): Promise<{ supported: boolean; state: string }> {
  if (!('serviceWorker' in navigator)) return { supported: false, state: 'unsupported' }
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) return { supported: true, state: 'not registered' }
  if (reg.active) return { supported: true, state: 'active' }
  if (reg.waiting) return { supported: true, state: 'waiting' }
  if (reg.installing) return { supported: true, state: 'installing' }
  return { supported: true, state: 'registered' }
}

function hasSyncAccessHandle(): boolean {
  // Main-thread check. `createSyncAccessHandle` is only exposed inside a Worker in every browser (see
  // ADR 0005 impl note), so this is expected to read false on the main thread even where OPFS works —
  // the store runs in a Worker. It's surfaced so the device confirms the class/OPFS surface exists.
  const g = globalThis as { FileSystemFileHandle?: { prototype: object } }
  return g.FileSystemFileHandle !== undefined && 'createSyncAccessHandle' in g.FileSystemFileHandle.prototype
}

async function collect(): Promise<Preflight> {
  const storage = (navigator as unknown as { storage?: StorageManagerLike }).storage
  const sw = await swState()

  let persisted: boolean | null = null
  let persistResult: boolean | null = null
  let quotaBytes: number | null = null
  let usageBytes: number | null = null
  if (storage) {
    try {
      persisted = typeof storage.persisted === 'function' ? await storage.persisted() : null
      // Requesting persistence is idempotent and is exactly what the till wants on a device (A-015);
      // doing it here from the tap that opened the panel is a valid user-gesture request.
      persistResult = typeof storage.persist === 'function' ? await storage.persist() : null
      if (typeof storage.estimate === 'function') {
        const est = await storage.estimate()
        quotaBytes = est.quota ?? null
        usageBytes = est.usage ?? null
      }
    } catch {
      // Leave the fields null — the panel shows "n/a", never throws.
    }
  }

  let unsyncedCount: number | null = null
  let oldestUnsyncedAt: string | null = null
  if (isInitialised()) {
    try {
      const stats = await refreshStats()
      unsyncedCount = stats.unsyncedCount
      oldestUnsyncedAt = stats.oldestUnsyncedAt
    } catch {
      // ignore — panel stays informational
    }
  }

  return {
    secureContext: window.isSecureContext,
    standalone: isStandalone(),
    swSupported: sw.supported,
    swState: sw.state,
    storageApi: storage !== undefined,
    persisted,
    persistResult,
    opfsGetDirectory: typeof storage?.getDirectory === 'function',
    syncAccessHandleOnPrototype: hasSyncAccessHandle(),
    quotaBytes,
    usageBytes,
    unsyncedCount,
    oldestUnsyncedAt,
  }
}

function formatBytes(n: number | null): string {
  if (n === null) return 'n/a'
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  return `${v.toFixed(1)} ${units[i]}`
}

function formatAge(iso: string | null): string {
  if (iso === null) return 'none'
  const ms = Date.now() - Date.parse(iso)
  if (Number.isNaN(ms)) return iso
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

type Verdict = 'ok' | 'warn' | 'info'

function Row({ label, value, verdict }: { label: string; value: string; verdict: Verdict }): JSX.Element {
  const glyph = verdict === 'ok' ? '✓' : verdict === 'warn' ? '✗' : '·'
  return (
    <div className="preflight-row" data-verdict={verdict}>
      <span className="preflight-glyph" aria-hidden="true">
        {glyph}
      </span>
      <span className="preflight-label">{label}</span>
      <span className="preflight-value tnum">{value}</span>
    </div>
  )
}

function boolText(b: boolean | null, yes = 'yes', no = 'no'): string {
  return b === null ? 'n/a' : b ? yes : no
}

export function StoragePreflight({ onClose }: { onClose: () => void }): JSX.Element {
  const [data, setData] = useState<Preflight | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      setData(await collect())
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <div className="preflight-overlay" role="dialog" aria-label="Storage preflight">
      <div className="preflight-panel">
        <div className="preflight-header">
          <h2>Storage preflight</h2>
          <button type="button" className="preflight-close" onClick={onClose}>
            Close
          </button>
        </div>

        {data === null ? (
          <p className="preflight-loading">Reading…</p>
        ) : (
          <div className="preflight-rows">
            <Row label="Secure context" value={boolText(data.secureContext)} verdict={data.secureContext ? 'ok' : 'warn'} />
            <Row
              label="Launched from home screen"
              value={boolText(data.standalone, 'standalone', 'in browser')}
              verdict={data.standalone ? 'ok' : 'info'}
            />
            <Row
              label="Service worker"
              value={data.swState}
              verdict={!data.swSupported ? 'warn' : data.swState === 'active' ? 'ok' : 'info'}
            />
            <Row label="storage API" value={boolText(data.storageApi)} verdict={data.storageApi ? 'ok' : 'warn'} />
            <Row label="persist() result" value={boolText(data.persistResult, 'granted', 'denied')} verdict={data.persistResult ? 'ok' : 'warn'} />
            <Row label="persisted() status" value={boolText(data.persisted, 'persisted', 'best-effort')} verdict={data.persisted ? 'ok' : 'warn'} />
            <Row label="OPFS (getDirectory)" value={boolText(data.opfsGetDirectory)} verdict={data.opfsGetDirectory ? 'ok' : 'warn'} />
            <Row
              label="createSyncAccessHandle (main thread)"
              value={boolText(data.syncAccessHandleOnPrototype, 'present', 'worker-only')}
              verdict="info"
            />
            <Row label="Quota" value={formatBytes(data.quotaBytes)} verdict="info" />
            <Row label="Usage" value={formatBytes(data.usageBytes)} verdict="info" />
            <Row
              label="Unsynced events"
              value={data.unsyncedCount === null ? 'n/a' : String(data.unsyncedCount)}
              verdict={data.unsyncedCount && data.unsyncedCount > 0 ? 'info' : 'ok'}
            />
            <Row label="Oldest unsynced age" value={formatAge(data.oldestUnsyncedAt)} verdict="info" />
          </div>
        )}

        <button type="button" className="preflight-refresh" onClick={() => void refresh()} disabled={refreshing}>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
    </div>
  )
}
