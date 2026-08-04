import { afterEach, describe, expect, it } from 'vitest'
import type { Executor, LocalStore } from './index'
import { createNodeSqliteStore } from './testing'

/**
 * The contract test runs against `createNodeSqliteStore` (`./testing`), a `LocalStore` backed by
 * Node's built-in `node:sqlite` — a *third, independent* backend beside OPFS and Capacitor. If the
 * interface can be satisfied by node:sqlite, OPFS, and Capacitor alike, the abstraction genuinely
 * leaks nothing about any one engine. If a change to `index.ts` breaks this fixture, that is the leak
 * alarm firing. Every adapter added later must pass this same suite.
 */

/**
 * The kind of caller the abstraction exists for: it takes an `Executor`, so it neither knows nor
 * cares whether it was handed the store or an open transaction. Mirrors the till's write path — one
 * event row plus its outbox row. Reused verbatim below both inside and outside a transaction; if that
 * required two code paths, the interface would have failed its one job.
 */
async function appendEventWithOutbox(
  exec: Executor,
  event: { id: string; totalMinor: bigint },
): Promise<void> {
  // Money crosses as TEXT (a decimal string), never an INTEGER column — see index.ts.
  await exec.execute('insert into events (id, total_minor) values (?, ?)', [
    event.id,
    event.totalMinor.toString(),
  ])
  await exec.execute('insert into outbox (event_id, synced_at) values (?, null)', [event.id])
}

describe('LocalStore contract (node:sqlite fixture)', () => {
  let store: LocalStore

  // One statement per execute — the portable floor. Real adapters (and this fixture) prepare a
  // single statement at a time, so the till's local schema is applied statement by statement too.
  const migrate = async (s: LocalStore) => {
    await s.execute('create table events (id text primary key, total_minor text not null)')
    await s.execute('create table outbox (event_id text primary key, synced_at text)')
  }

  afterEach(async () => {
    await store.close()
  })

  it('commits a transaction: event and its outbox row both land through one tx', async () => {
    store = createNodeSqliteStore()
    await migrate(store)

    await store.transaction((tx) => appendEventWithOutbox(tx, { id: 'e1', totalMinor: 450n }))

    const events = await store.select('select id, total_minor from events')
    const outbox = await store.select('select event_id from outbox')
    expect(events).toEqual([{ id: 'e1', total_minor: '450' }])
    expect(outbox).toEqual([{ event_id: 'e1' }])
  })

  it('rolls back on throw: neither the event nor its outbox row persists', async () => {
    store = createNodeSqliteStore()
    await migrate(store)

    await expect(
      store.transaction(async (tx) => {
        await appendEventWithOutbox(tx, { id: 'e2', totalMinor: 100n })
        throw new Error('boom after the writes')
      }),
    ).rejects.toThrow('boom')

    const events = await store.select('select id from events')
    expect(events).toEqual([])
  })

  it('binds parameters positionally and filters correctly', async () => {
    store = createNodeSqliteStore()
    await migrate(store)
    await store.transaction(async (tx) => {
      await appendEventWithOutbox(tx, { id: 'a', totalMinor: 1n })
      await appendEventWithOutbox(tx, { id: 'b', totalMinor: 2n })
    })

    const rows = await store.select<{ id: string }>('select id from events where id = ?', ['b'])
    expect(rows).toEqual([{ id: 'b' }])
  })

  it('round-trips money beyond the JS safe integer range losslessly as TEXT', async () => {
    store = createNodeSqliteStore()
    await migrate(store)
    // 2^53 + 1 — the classic value a `number` cannot hold. As minor units this is > €90 trillion,
    // absurd for a coffee, but the point is the store never silently corrupts a bigint.
    const huge = 9_007_199_254_740_993n
    await store.transaction((tx) => appendEventWithOutbox(tx, { id: 'big', totalMinor: huge }))

    const [row] = await store.select<{ total_minor: string }>(
      'select total_minor from events where id = ?',
      ['big'],
    )
    expect(row).toBeDefined()
    expect(BigInt(row!.total_minor)).toBe(huge)
  })

  it('surfaces rows from INSERT … RETURNING and reports rowsAffected', async () => {
    store = createNodeSqliteStore()
    await migrate(store)
    const res = await store.execute(
      'insert into events (id, total_minor) values (?, ?) returning id',
      ['r1', '999'],
    )
    expect(res.rows).toEqual([{ id: 'r1' }])

    const del = await store.execute('delete from events where id = ?', ['r1'])
    expect(del.rowsAffected).toBe(1)
  })

  it('the SAME caller works unchanged with the store or a transaction (the whole point)', async () => {
    store = createNodeSqliteStore()
    await migrate(store)

    // Handed the store directly — auto-commit.
    await appendEventWithOutbox(store, { id: 'direct', totalMinor: 300n })
    // Handed a transaction — same function, not one character different.
    await store.transaction((tx) => appendEventWithOutbox(tx, { id: 'intx', totalMinor: 700n }))

    const ids = await store.select<{ id: string }>('select id from events order by id')
    expect(ids.map((r) => r.id)).toEqual(['direct', 'intx'])
  })
})
