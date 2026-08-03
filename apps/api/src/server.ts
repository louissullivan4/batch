import { buildApp } from './app'
import { createPool } from './db'
import { loadEnv } from './env'

async function main(): Promise<void> {
  const env = loadEnv()
  const pool = env.DATABASE_URL ? createPool(env.DATABASE_URL) : undefined
  const app = buildApp({ pool, logger: env.NODE_ENV !== 'test' })

  if (!pool) {
    app.log.warn(
      'DATABASE_URL is not set — /v1/sync/events is disabled; only health endpoints are up',
    )
  }

  await app.listen({ host: env.HOST, port: env.PORT })
}

main().catch((err: unknown) => {
  console.error(err)
  process.exitCode = 1
})
