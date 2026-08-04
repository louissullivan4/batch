import type { Executor, LocalStore, Row, SqlValue } from './index'
import { createRunners, openSahPoolDb, type SahPoolOptions } from './sqlite-sahpool'

/**
 * A `LocalStore` that opens SQLite (OPFS SAHPool) on the **calling thread**.
 *
 * ⚠️ OPFS sync access handles (`createSyncAccessHandle`) exist only inside a dedicated Worker — never
 * on a browser main thread, in any engine. So this adapter works when called *from a Worker*; called
 * on the main thread it throws "Missing required OPFS APIs". The browser till therefore uses
 * `./opfs-worker` (which runs this same SAHPool code inside a Worker). This module stays as the
 * in-worker/primitive form and the shared implementation both adapters build on (ADR 0005).
 *
 * Everything else depends only on the `LocalStore` interface. A Capacitor/native-SQLite adapter is a
 * sibling file implementing the same interface — adding it must not touch a single caller.
 */

export type OpfsStoreOptions = SahPoolOptions

/**
 * Open (or create) the till's local database on the current thread. Async because wasm init and VFS
 * install are async; every statement after that is synchronous under the hood but still exposed as a
 * Promise, so calling code is identical to the worker-backed adapter.
 */
export async function openOpfsStore(options: OpfsStoreOptions = {}): Promise<LocalStore> {
  const db = await openSahPoolDb(options)
  const { run, runSelect } = createRunners(db)

  // Serialise every top-level operation onto one promise chain. SAHPool is a single synchronous
  // handle, and `transaction` yields at each `await work(...)`; without this, a concurrent top-level
  // `execute` (e.g. a background drain's `markSynced`) could run inside another op's open BEGIN and be
  // rolled back with it. Queuing makes each op — and a whole transaction — atomic against the others.
  const noop = (): void => undefined
  let tail: Promise<unknown> = Promise.resolve()
  const serialize = <T>(op: () => Promise<T>): Promise<T> => {
    const result = tail.then(op, op)
    tail = result.then(noop, noop)
    return result
  }

  // The executor handed to a transaction's `work`: it runs RAW (no re-serialising), because the
  // transaction already holds the lock for its whole body. Re-locking here would deadlock.
  const txExecutor: Executor = {
    execute(sql, params = []) {
      return Promise.resolve(run(sql, params))
    },
    select<T extends Row = Row>(sql: string, params: readonly SqlValue[] = []) {
      return Promise.resolve(runSelect<T>(sql, params))
    },
  }

  return {
    execute(sql, params = []) {
      return serialize(() => Promise.resolve(run(sql, params)))
    },
    select<T extends Row = Row>(sql: string, params: readonly SqlValue[] = []) {
      return serialize(() => Promise.resolve(runSelect<T>(sql, params)))
    },
    transaction<T>(work: (tx: Executor) => Promise<T>): Promise<T> {
      return serialize(async () => {
        db.exec({ sql: 'begin' })
        try {
          const result = await work(txExecutor)
          db.exec({ sql: 'commit' })
          return result
        } catch (err) {
          db.exec({ sql: 'rollback' })
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
