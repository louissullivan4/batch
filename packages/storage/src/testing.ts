import { DatabaseSync } from 'node:sqlite'
import type { Executor, LocalStore, Row, SqlValue } from './index'

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
 */
export function createNodeSqliteStore(filename = ':memory:'): LocalStore {
  const db = new DatabaseSync(filename)

  const executor = (): Executor => ({
    execute(sql, params = []) {
      const returnsRows = /\breturning\b/i.test(sql) || /^\s*select\b/i.test(sql)
      if (returnsRows) {
        const rows = db.prepare(sql).all(...(params as SqlValue[])) as unknown as Row[]
        return Promise.resolve({ rows, rowsAffected: rows.length, lastInsertRowId: null })
      }
      if (params.length === 0) {
        db.exec(sql)
        return Promise.resolve({ rows: [], rowsAffected: 0, lastInsertRowId: null })
      }
      const info = db.prepare(sql).run(...(params as SqlValue[]))
      return Promise.resolve({
        rows: [],
        rowsAffected: Number(info.changes),
        lastInsertRowId: info.lastInsertRowid === undefined ? null : BigInt(info.lastInsertRowid),
      })
    },
    select<T extends Row = Row>(sql: string, params: readonly SqlValue[] = []) {
      const rows = db.prepare(sql).all(...(params as SqlValue[])) as unknown as T[]
      return Promise.resolve(rows as readonly T[])
    },
  })

  const base = executor()

  return {
    execute: base.execute,
    select: base.select,
    async transaction<T>(work: (tx: Executor) => Promise<T>): Promise<T> {
      db.exec('begin')
      try {
        const result = await work(executor())
        db.exec('commit')
        return result
      } catch (err) {
        db.exec('rollback')
        throw err
      }
    },
    close() {
      db.close()
      return Promise.resolve()
    },
  }
}
