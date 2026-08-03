import Fastify, { type FastifyInstance } from 'fastify'
import { ZodError } from 'zod'
import { UnauthenticatedError } from './auth'
import type { Pool } from './db'
import { registerHealthRoutes } from './routes/health'
import { registerSyncRoutes } from './sync/route'

export interface AppDeps {
  pool?: Pool
  logger?: boolean
}

/**
 * Build the Fastify app without listening, so tests can drive it via `inject`. Sync routes are only
 * mounted when a pool is supplied — a health-only deploy needs no database.
 */
export function buildApp(deps: AppDeps = {}): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? false })

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof UnauthenticatedError) {
      return reply.code(401).send({ error: error.message })
    }
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: 'INVALID_REQUEST', issues: error.issues })
    }
    app.log.error(error)
    return reply.code(500).send({ error: 'INTERNAL' })
  })

  registerHealthRoutes(app, deps)

  if (deps.pool) {
    if (process.env.NODE_ENV === 'production') {
      // Fail closed: auth.ts is a header-trust dev stub. Refuse to expose the sync endpoint in
      // production until verified device-token auth lands (Sprint 4). Health endpoints stay up.
      app.log.error(
        'SECURITY: /v1/sync/events NOT mounted in production — replace the header-trust auth stub ' +
          '(apps/api/src/auth.ts) with device-token auth before enabling sync.',
      )
    } else {
      registerSyncRoutes(app, { pool: deps.pool })
    }
  }

  return app
}
