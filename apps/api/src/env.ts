import { z } from 'zod'

/**
 * Runtime configuration. Everything the API needs comes from the environment (12-factor), so the
 * same Docker image runs on Railway, Hetzner, or a laptop with no code change.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  // Optional so `/healthz` can run without a database (e.g. a bare liveness deploy). Anything that
  // touches Postgres asserts its presence at use time.
  DATABASE_URL: z.string().url().optional(),
})

export type Env = z.infer<typeof EnvSchema>

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return EnvSchema.parse(source)
}
