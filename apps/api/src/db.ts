import pg from 'pg'

/**
 * Postgres access. The one rule that cannot slip: every query that reads or writes tenant data runs
 * inside a transaction that first sets `app.tenant_id`, so row-level security scopes it. A plain
 * `SET` (session level) would leak across pooled connections — it must be `SET LOCAL`, which
 * `set_config(..., true)` is.
 */

export type Pool = pg.Pool
export type PoolClient = pg.PoolClient

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, max: 10, application_name: 'batch-api' })
}

/**
 * Run `fn` inside a transaction scoped to `tenantId`. The tenant is applied with
 * `set_config('app.tenant_id', $1, true)` — the parameterised, transaction-local form of `SET
 * LOCAL` (plain `SET LOCAL app.tenant_id = $1` cannot bind a parameter).
 */
export async function withTenantTx<T>(
  pool: pg.Pool,
  tenantId: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  if (!UUID_RE.test(tenantId)) {
    throw new Error('withTenantTx: tenantId must be a UUID')
  }
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query('select set_config($1, $2, true)', ['app.tenant_id', tenantId])
    const result = await fn(client)
    await client.query('commit')
    return result
  } catch (err) {
    await client.query('rollback')
    throw err
  } finally {
    client.release()
  }
}
