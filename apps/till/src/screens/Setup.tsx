/**
 * The device-configuration gate (Sprint 1 harness logic, restyled on tokens). Shown only when
 * `loadStoredConfig()` is null — i.e. this iPad has never been pointed at a tenant/API. Once
 * configured, `App` auto-connects on every subsequent load, so a barista never sees this screen
 * again during normal operation.
 */

import { type FormEvent, useState } from 'react'
import type { TillConfig } from '../runtime'
import './Setup.css'

export interface SetupProps {
  readonly initialTenantId: string
  readonly initialApiBaseUrl: string
  readonly busy: boolean
  readonly error: string | null
  readonly onSubmit: (config: TillConfig) => void
}

export function Setup({ initialTenantId, initialApiBaseUrl, busy, error, onSubmit }: SetupProps): JSX.Element {
  const [tenantId, setTenantId] = useState(initialTenantId)
  const [apiBaseUrl, setApiBaseUrl] = useState(initialApiBaseUrl)

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault()
    onSubmit({ tenantId, apiBaseUrl })
  }

  return (
    <div className="setup-screen">
      <form className="setup-card" onSubmit={handleSubmit}>
        <h1 className="setup-wordmark">Batch</h1>
        <p className="setup-subtitle">Connect this till before the first sale.</p>

        {error && (
          <div className="setup-error" role="alert">
            {error}
          </div>
        )}

        <label className="setup-field">
          <span>Tenant ID</span>
          <input
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            spellCheck={false}
          />
        </label>
        <label className="setup-field">
          <span>API base URL</span>
          <input
            value={apiBaseUrl}
            onChange={(e) => setApiBaseUrl(e.target.value)}
            placeholder="http://localhost:3000"
            spellCheck={false}
          />
        </label>

        <button type="submit" className="setup-submit" disabled={busy || !tenantId || !apiBaseUrl}>
          {busy ? 'Connecting…' : 'Connect'}
        </button>
      </form>
    </div>
  )
}
