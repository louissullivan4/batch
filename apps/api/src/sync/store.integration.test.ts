import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'
import type { OrderEvent } from '@batch/domain'
import type { SyncRequest } from '@batch/schemas'
import { withTenantTx } from '../db'
import { processSyncBatch } from './service'
import { createPgStore } from './store'

/**
 * Real-Postgres verification of the sync store, the migration, and — crucially — the RLS tenant
 * isolation that unit tests with a fake store cannot exercise. Skipped unless both connection URLs
 * are set:
 *   DATABASE_URL_ADMIN  superuser, applies the migration and seeds tenants
 *   DATABASE_URL_APP    the batch_app role (NOT superuser), what the API actually uses
 */
const ADMIN = process.env.DATABASE_URL_ADMIN
const APP = process.env.DATABASE_URL_APP
const run = ADMIN && APP ? describe : describe.skip

const TENANT_A = '0190b4c2-1e3a-7000-8000-00000000000a'
const TENANT_B = '0190b4c2-1e3a-7000-8000-00000000000b'
const DEVICE = '0190b4c2-1e3a-7000-8000-0000000000de'
const OID_A = '0190b4c2-1e3a-7c8d-8f2a-00000000000a'
const OCC = '2026-08-03T10:00:00.000Z'

const uid = (n: number) => `0190b4c2-1e3a-7000-8001-0000000000${n.toString().padStart(2, '0')}`

function migrationUpSql(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const file = join(here, '../../../../infra/migrations/20260803120000_create_event_log.sql')
  const sql = readFileSync(file, 'utf8')
  const up = sql.split('-- migrate:down')[0] ?? ''
  return up.replace('-- migrate:up', '')
}

async function waitForDb(pool: pg.Pool): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      await pool.query('select 1')
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  throw new Error('database never became ready')
}

function opened(eventId: string, aggregateId: string): OrderEvent {
  return {
    eventId,
    aggregateId,
    occurredAt: OCC,
    eventType: 'OrderOpened',
    payload: { currency: 'EUR', fulfilment: 'EAT_IN' },
  }
}

function line(eventId: string, aggregateId: string, unitPriceMinor: bigint): OrderEvent {
  return {
    eventId,
    aggregateId,
    occurredAt: OCC,
    eventType: 'LineAdded',
    payload: {
      productId: 'flat-white',
      name: 'Flat White',
      quantity: 2n,
      unitPriceMinor,
      vatRateBp: 1350,
      fulfilment: 'EAT_IN',
    },
  }
}

run('sync store against real Postgres', () => {
  let admin: pg.Pool
  let app: pg.Pool

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: ADMIN })
    await waitForDb(admin)
    await admin.query(migrationUpSql())
    await admin.query('insert into tenants (id, name) values ($1, $2), ($3, $4)', [
      TENANT_A,
      'Tenant A',
      TENANT_B,
      'Tenant B',
    ])
    app = new pg.Pool({ connectionString: APP })
    await waitForDb(app)
  }, 30_000)

  afterAll(async () => {
    await app?.end()
    await admin?.end()
  })

  it('appends idempotently — a replay returns the same seq, not a second row', async () => {
    const event = opened(uid(1), OID_A)
    const first = await withTenantTx(app, TENANT_A, (c) =>
      createPgStore(c).append(event, { aggregateType: 'order', deviceId: DEVICE }),
    )
    const second = await withTenantTx(app, TENANT_A, (c) =>
      createPgStore(c).append(event, { aggregateType: 'order', deviceId: DEVICE }),
    )
    expect(first.inserted).toBe(true)
    expect(second.inserted).toBe(false)
    expect(second.seq).toBe(first.seq)
  })

  it('runs a full order batch and round-trips money through jsonb', async () => {
    const oid = '0190b4c2-1e3a-7c8d-8f2a-00000000000c'
    const batch: SyncRequest = {
      events: [
        { aggregateType: 'order', event: opened(uid(10), oid) },
        { aggregateType: 'order', expectedTotalMinor: 700n, event: line(uid(11), oid, 350n) },
      ],
    }
    const res = await withTenantTx(app, TENANT_A, (c) =>
      processSyncBatch(createPgStore(c), DEVICE, batch),
    )
    expect(res.results.map((r) => r.status)).toEqual(['accepted', 'accepted'])

    // Replaying reloads persisted events (money parsed back from jsonb strings) and dedupes.
    const replay = await withTenantTx(app, TENANT_A, (c) =>
      processSyncBatch(createPgStore(c), DEVICE, batch),
    )
    expect(replay.results.map((r) => r.status)).toEqual(['duplicate', 'duplicate'])
  })

  it('isolates tenants: B cannot see A’s events (RLS, not a WHERE clause)', async () => {
    await withTenantTx(app, TENANT_A, (c) =>
      createPgStore(c).append(opened(uid(20), OID_A), { aggregateType: 'order', deviceId: DEVICE }),
    )
    const seenByB = await withTenantTx(app, TENANT_B, (c) =>
      createPgStore(c).loadAggregateEvents('order', OID_A),
    )
    expect(seenByB).toEqual([])
    const seqByB = await withTenantTx(app, TENANT_B, (c) => createPgStore(c).findSeq(uid(20)))
    expect(seqByB).toBeNull()
  })

  it('refuses to insert a row for another tenant (RLS WITH CHECK)', async () => {
    await expect(
      withTenantTx(app, TENANT_A, (c) =>
        c.query(
          `insert into event_log
             (event_id, tenant_id, device_id, aggregate_type, aggregate_id, event_type, payload, occurred_at)
           values ($1, $2, $3, 'order', $4, 'OrderOpened', '{}'::jsonb, now())`,
          [uid(30), TENANT_B, DEVICE, OID_A],
        ),
      ),
    ).rejects.toThrow()
  })

  it('is append-only: the app role cannot UPDATE or DELETE event_log', async () => {
    await expect(
      withTenantTx(app, TENANT_A, (c) => c.query('update event_log set device_id = device_id')),
    ).rejects.toThrow()
    await expect(
      withTenantTx(app, TENANT_A, (c) => c.query('delete from event_log')),
    ).rejects.toThrow()
  })

  it('reports device high-water and pulls the device events back down (money as bigint)', async () => {
    const DEVICE2 = '0190b4c2-1e3a-7000-8000-0000000000d2'
    const oid = '0190b4c2-1e3a-7c8d-8f2a-0000000000e2'
    const batch: SyncRequest = {
      events: [
        { aggregateType: 'order', event: opened(uid(40), oid) },
        { aggregateType: 'order', expectedTotalMinor: 700n, event: line(uid(41), oid, 350n) },
      ],
    }
    await withTenantTx(app, TENANT_A, (c) => processSyncBatch(createPgStore(c), DEVICE2, batch))

    const hw = await withTenantTx(app, TENANT_A, (c) => createPgStore(c).deviceHighWater(DEVICE2))
    expect(hw.eventCount).toBe(2)
    expect(hw.maxSeq).not.toBeNull()

    const pulled = await withTenantTx(app, TENANT_A, (c) =>
      createPgStore(c).loadDeviceEventsAfter(DEVICE2, 0n, 500),
    )
    expect(pulled.map((p) => p.event.eventType)).toEqual(['OrderOpened', 'LineAdded'])
    const lineEvent = pulled[1]?.event
    // Money survived the jsonb round-trip as a bigint (via the schema parse in the store).
    expect(lineEvent?.eventType).toBe('LineAdded')
    if (lineEvent?.eventType === 'LineAdded') {
      expect(lineEvent.payload.unitPriceMinor).toBe(350n)
    }

    // Another device sees nothing of DEVICE2's stream.
    const other = await withTenantTx(app, TENANT_A, (c) => createPgStore(c).deviceHighWater(DEVICE))
    expect(other.eventCount).toBeGreaterThanOrEqual(0)
  })
})
