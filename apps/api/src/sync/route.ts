import type { FastifyInstance } from 'fastify'
import { SyncRequestSchema } from '@batch/schemas'
import { resolveDeviceContext } from '../auth'
import { withTenantTx, type Pool } from '../db'
import { processSyncBatch } from './service'
import { createPgStore } from './store'

/**
 * `POST /v1/sync/events` — the till's outbox drains here. Auth errors (401) and validation errors
 * (400, ZodError) are thrown and shaped by the app-level error handler. The whole batch runs in one
 * tenant transaction, so its inserts commit together; per-event results report accepted / duplicate
 * / rejected, and partial success is expected and fine.
 */
export function registerSyncRoutes(app: FastifyInstance, deps: { pool: Pool }): void {
  app.post('/v1/sync/events', async (request) => {
    const ctx = resolveDeviceContext(request.headers)
    const batch = SyncRequestSchema.parse(request.body)
    return withTenantTx(deps.pool, ctx.tenantId, (client) =>
      processSyncBatch(createPgStore(client), ctx.deviceId, batch),
    )
  })
}
