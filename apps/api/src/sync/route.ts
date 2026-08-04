import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { SyncRequestSchema } from '@batch/schemas'
import { resolveDeviceContext } from '../auth'
import { withTenantTx, type Pool } from '../db'
import { getDeviceHighWater, processSyncBatch, pullDeviceEvents } from './service'
import { createPgStore } from './store'

const PullQuerySchema = z.object({
  afterSeq: z
    .string()
    .regex(/^\d+$/)
    .default('0')
    .transform((s) => BigInt(s)),
  limit: z.coerce.number().int().min(1).max(500).default(500),
})

/**
 * `POST /v1/sync/events` — the till's outbox drains here (append, exactly-once).
 * `GET  /v1/sync/highwater` — the device's high-water mark, for startup eviction detection.
 * `GET  /v1/sync/events` — a bounded down-pull of the device's own events, to rebuild an evicted till.
 *
 * All run in one tenant transaction; device scoping is by `ctx.deviceId` + RLS. Auth (401) and
 * validation (400) errors are thrown and shaped by the app-level error handler. Partial batch success
 * on the append is expected and fine.
 */
export function registerSyncRoutes(app: FastifyInstance, deps: { pool: Pool }): void {
  app.post('/v1/sync/events', async (request) => {
    const ctx = resolveDeviceContext(request.headers)
    const batch = SyncRequestSchema.parse(request.body)
    return withTenantTx(deps.pool, ctx.tenantId, (client) =>
      processSyncBatch(createPgStore(client), ctx.deviceId, batch),
    )
  })

  app.get('/v1/sync/highwater', async (request) => {
    const ctx = resolveDeviceContext(request.headers)
    return withTenantTx(deps.pool, ctx.tenantId, (client) =>
      getDeviceHighWater(createPgStore(client), ctx.deviceId),
    )
  })

  app.get('/v1/sync/events', async (request) => {
    const ctx = resolveDeviceContext(request.headers)
    const { afterSeq, limit } = PullQuerySchema.parse(request.query)
    return withTenantTx(deps.pool, ctx.tenantId, (client) =>
      pullDeviceEvents(createPgStore(client), ctx.deviceId, afterSeq, limit),
    )
  })
}
