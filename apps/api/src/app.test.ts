import { describe, it, expect } from 'vitest'
import { buildApp } from './app'
import type { Pool } from './db'

describe('health endpoints', () => {
  it('/healthz is ok and never touches the database', async () => {
    const app = buildApp()
    const res = await app.inject({ method: 'GET', url: '/healthz' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
    await app.close()
  })

  it('/readyz reports no-db when no pool is configured', async () => {
    const app = buildApp()
    const res = await app.inject({ method: 'GET', url: '/readyz' })
    expect(res.statusCode).toBe(503)
    expect(res.json()).toEqual({ status: 'no-db' })
    await app.close()
  })

  it('actually binds a socket and shuts down cleanly', async () => {
    const app = buildApp()
    const address = await app.listen({ port: 0, host: '127.0.0.1' })
    expect(address).toContain('127.0.0.1:')
    await app.close()
  })
})

describe('sync route guards (no database touched)', () => {
  // A stand-in pool so the route mounts; both checks below fail before any query runs.
  const fakePool = {} as unknown as Pool

  it('rejects a request with no device/tenant headers (401)', async () => {
    const app = buildApp({ pool: fakePool })
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sync/events',
      payload: { events: [] },
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('rejects a malformed batch after auth (400)', async () => {
    const app = buildApp({ pool: fakePool })
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sync/events',
      headers: {
        'x-tenant-id': '0190b4c2-1e3a-7000-8000-000000000aaa',
        'x-device-id': '0190b4c2-1e3a-7000-8000-000000000bbb',
      },
      payload: { events: [] }, // empty batch violates .min(1)
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ error: 'INVALID_REQUEST' })
    await app.close()
  })
})
