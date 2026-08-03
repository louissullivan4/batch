import type { FastifyInstance } from 'fastify'
import type { Pool } from '../db'

/**
 * `/healthz` is liveness — it must never touch the database, so a dead DB doesn't get the process
 * killed by an orchestrator. `/readyz` is readiness — it pings Postgres and reports whether the API
 * can actually serve sync traffic.
 */
export function registerHealthRoutes(app: FastifyInstance, deps: { pool?: Pool }): void {
  app.get('/healthz', async () => ({ status: 'ok' }))

  app.get('/readyz', async (_request, reply) => {
    if (!deps.pool) return reply.code(503).send({ status: 'no-db' })
    try {
      await deps.pool.query('select 1')
      return { status: 'ready' }
    } catch {
      return reply.code(503).send({ status: 'unavailable' })
    }
  })
}
