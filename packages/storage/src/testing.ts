import { DatabaseSync } from 'node:sqlite'
import type { Executor, LocalStore, QueryResult, Row, SqlValue } from './index'

/**
 * A `LocalStore` backed by Node's built-in `node:sqlite`. **Test / CI only** — the shipped browser
 * adapter is `./opfs`. Its purpose is to run the till's sync logic (outbox, exactly-once, eviction
 * reconciliation) in Node, where OPFS does not exist, against a *real* SQLite that behaves like the
 * one on device. Because everything above the interface depends only on `LocalStore`, the same code
 * that runs on the OPFS adapter runs here unchanged — that is the whole point of the seam.
 *
 * Pass a `filename` to persist across store instances (the CI stand-in for a force-quit + relaunch,
 * or a reboot). Default `:memory:` is ephemeral.
 *
 * Node-only: this module imports `node:sqlite`. Never import it from browser/app code — it lives on a
 * separate entry point (`@batch/storage/testing`) so a bundler never pulls it into the till.
 *
 * Like the OPFS adapter, every top-level operation is serialised onto one promise chain, so a
 * concurrent `execute` cannot interleave inside another op's open transaction. That serialisation is
 * a `LocalStore` contract guarantee (see the contract test), not an OPFS quirk.
 */
export function createNodeSqliteStore(filename = ':memory:'): LocalStore {
  const db = new DatabaseSync(filename)

  const runExec = (sql: string, params: readonly SqlValue[]): QueryResult => {
    const returnsRows = /\breturning\b/i.test(sql) || /^\s*select\b/i.test(sql)
    if (returnsRows) {
      const rows = db.prepare(sql).all(...(params as SqlValue[])) as unknown as Row[]
      return { rows, rowsAffected: rows.length, lastInsertRowId: null }
    }
    if (params.length === 0) {
      db.exec(sql)
      return { rows: [], rowsAffected: 0, lastInsertRowId: null }
    }
    const info = db.prepare(sql).run(...(params as SqlValue[]))
    return {
      rows: [],
      rowsAffected: Number(info.changes),
      lastInsertRowId: info.lastInsertRowid === undefined ? null : BigInt(info.lastInsertRowid),
    }
  }

  const runSelect = <T extends Row>(sql: string, params: readonly SqlValue[]): readonly T[] =>
    db.prepare(sql).all(...(params as SqlValue[])) as unknown as readonly T[]

  const noop = (): void => undefined
  let tail: Promise<unknown> = Promise.resolve()
  const serialize = <T>(op: () => Promise<T>): Promise<T> => {
    const result = tail.then(op, op)
    tail = result.then(noop, noop)
    return result
  }

  // Raw executor for use inside a transaction (which already holds the lock — re-locking deadlocks).
  const txExecutor: Executor = {
    execute: (sql, params = []) => Promise.resolve(runExec(sql, params)),
    select: <T extends Row = Row>(sql: string, params: readonly SqlValue[] = []) =>
      Promise.resolve(runSelect<T>(sql, params)),
  }

  return {
    execute: (sql, params = []) => serialize(() => Promise.resolve(runExec(sql, params))),
    select: <T extends Row = Row>(sql: string, params: readonly SqlValue[] = []) =>
      serialize(() => Promise.resolve(runSelect<T>(sql, params))),
    transaction<T>(work: (tx: Executor) => Promise<T>): Promise<T> {
      return serialize(async () => {
        db.exec('begin')
        try {
          const result = await work(txExecutor)
          db.exec('commit')
          return result
        } catch (err) {
          db.exec('rollback')
          throw err
        }
      })
    },
    close() {
      db.close()
      return Promise.resolve()
    },
  }
}
