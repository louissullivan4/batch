import type { IncomingHttpHeaders } from 'node:http'
import { UuidSchema } from '@batch/schemas'

export interface DeviceContext {
  readonly tenantId: string
  readonly deviceId: string
}

export class UnauthenticatedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnauthenticatedError'
  }
}

function header(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name]
  return Array.isArray(value) ? value[0] : value
}

/**
 * Resolve the tenant and device for a request.
 *
 * ⚠️ DEV STUB. This currently trusts `x-tenant-id` / `x-device-id` headers, which a non-negotiable
 * (`apps/api/CLAUDE.md`: never trust a client-supplied tenant id) forbids in production. Sprint 4
 * replaces this with a verified device token → (tenant, device) lookup. It is deliberately the ONLY
 * place tenant identity enters the system, so that swap touches one function.
 */
export function resolveDeviceContext(headers: IncomingHttpHeaders): DeviceContext {
  const tenantId = header(headers, 'x-tenant-id')
  const deviceId = header(headers, 'x-device-id')

  const tenant = UuidSchema.safeParse(tenantId)
  const device = UuidSchema.safeParse(deviceId)
  if (!tenant.success) throw new UnauthenticatedError('missing or invalid x-tenant-id')
  if (!device.success) throw new UnauthenticatedError('missing or invalid x-device-id')

  return { tenantId: tenant.data, deviceId: device.data }
}
