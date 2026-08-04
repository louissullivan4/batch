import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import type { Executor, LocalStore, QueryResult, Row, SqlValue } from './index'

/**
 * The `LocalStore` adapter that Sprint 1 ships: SQLite compiled to wasm, persisted in the browser's
 * Origin Private File System via the **OPFS SAHPool** VFS. SAHPool is synchronous on the main thread
 * and needs no COOP/COEP headers — the pragmatic durable local DB for a PWA till.
 *
 * This is the ONLY concrete storage in the app. Everything else depends on the `LocalStore` interface
 * (ADR 0005). A Capacitor/native-SQLite adapter is a sibling file implementing the same interface —
 * adding it must not touch a single caller. Do not import this module from anything that must run in
 * Node; it pulls in the wasm binary and OPFS.
 *
 * The wasm boundary is typed with the minimal local interfaces below and reached through one cast, so
 * a sqlite-wasm version bump can't silently break our types and we never use `any`.
 */

interface Sqlite3OoDb {
  exec(opts: {
    sql: string
    bind?: readonly SqlValue[]
    rowMode?: 'object'
    returnValue?: 'resultRows'
    resultRows?: Row[]
  }): unknown
  selectValue(sql: string): unknown
  changes(): number | bigint
  close(): void
}

interface OpfsSahPoolUtil {
  OpfsSAHPoolDb: new (filename: string) => Sqlite3OoDb
}

interface Sqlite3Static {
  installOpfsSAHPoolVfs(opts: { name: string }): Promise<OpfsSahPoolUtil>
}

type InitModule = (opts?: { print?: (m: string) => void; printErr?: (m: string) => void }) => Promise<Sqlite3Static>

export interface OpfsStoreOptions {
  /** OPFS SAHPool name — namespaces this store's backing files. Defaults to the app's till DB. */
  readonly poolName?: string
  /** Logical database filename inside the pool. */
  readonly filename?: string
}

/**
 * Open (or create) the till's local database. Async because wasm init and VFS install are async;
 * every statement after that is synchronous under the hood but still exposed as a Promise, so calling
 * code is identical to a worker-backed adapter.
 */
export async function openOpfsStore(options: OpfsStoreOptions = {}): Promise<LocalStore> {
  const init = sqlite3InitModule as unknown as InitModule
  const sqlite3 = await init({ printErr: (m) => console.error('[sqlite]', m) })
  const pool = await sqlite3.installOpfsSAHPoolVfs({ name: options.poolName ?? 'batch-till' })
  const db = new pool.OpfsSAHPoolDb(options.filename ?? '/batch-till.sqlite3')

  const run = (sql: string, params: readonly SqlValue[]): QueryResult => {
    const returnsRows = /\breturning\b/i.test(sql) || /^\s*select\b/i.test(sql)
    if (returnsRows) {
      const rows: Row[] = []
      db.exec({ sql, bind: params, rowMode: 'object', returnValue: 'resultRows', resultRows: rows })
      return { rows, rowsAffected: rows.length, lastInsertRowId: null }
    }
    db.exec({ sql, bind: params })
    const isInsert = /^\s*insert\b/i.test(sql)
    return {
      rows: [],
      rowsAffected: Number(db.changes()),
      lastInsertRowId: isInsert ? BigInt(db.selectValue('select last_insert_rowid()') as number) : null,
    }
  }

  const runSelect = <T extends Row>(sql: string, params: readonly SqlValue[]): readonly T[] => {
    const rows: Row[] = []
    db.exec({ sql, bind: params, rowMode: 'object', returnValue: 'resultRows', resultRows: rows })
    return rows as unknown as readonly T[]
  }

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
