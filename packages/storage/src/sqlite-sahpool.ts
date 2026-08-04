import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import type { QueryResult, Row, SqlValue } from './index'

/**
 * Shared SQLite-wasm + OPFS SAHPool plumbing, used by both concrete adapters:
 *   - `./opfs`        — opens the DB on the calling thread (works only where OPFS sync access handles
 *                       exist, i.e. inside a Worker; kept for that context and the contract fixtures).
 *   - `./opfs-worker` — runs THIS module inside a dedicated Worker and proxies over messages. That is
 *                       the adapter the browser till uses, because `FileSystemFileHandle.prototype.
 *                       createSyncAccessHandle` is exposed only in a Worker (never on the main thread,
 *                       in any browser). Opening SAHPool on the main thread throws "Missing required
 *                       OPFS APIs".
 *
 * The wasm boundary is typed with the minimal local interfaces below and reached through one cast, so
 * a sqlite-wasm version bump can't silently break our types and we never use `any`.
 */

export interface Sqlite3OoDb {
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

type InitModule = (opts?: {
  print?: (m: string) => void
  printErr?: (m: string) => void
}) => Promise<Sqlite3Static>

export interface SahPoolOptions {
  /** OPFS SAHPool name — namespaces this store's backing files. Defaults to the app's till DB. */
  readonly poolName?: string
  /** Logical database filename inside the pool. */
  readonly filename?: string
}

/** Boot sqlite-wasm, install the OPFS SAHPool VFS, and open (or create) the DB. Async; ops after are sync. */
export async function openSahPoolDb(options: SahPoolOptions = {}): Promise<Sqlite3OoDb> {
  const init = sqlite3InitModule as unknown as InitModule
  const sqlite3 = await init({ printErr: (m) => console.error('[sqlite]', m) })
  const pool = await sqlite3.installOpfsSAHPoolVfs({ name: options.poolName ?? 'batch-till' })
  return new pool.OpfsSAHPoolDb(options.filename ?? '/batch-till.sqlite3')
}

export interface Runners {
  run(sql: string, params: readonly SqlValue[]): QueryResult
  runSelect<T extends Row>(sql: string, params: readonly SqlValue[]): readonly T[]
}

/** The synchronous execute/select pair over an open SAHPool db. Identical in both adapters. */
export function createRunners(db: Sqlite3OoDb): Runners {
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
      lastInsertRowId: isInsert
        ? BigInt(db.selectValue('select last_insert_rowid()') as number)
        : null,
    }
  }

  const runSelect = <T extends Row>(sql: string, params: readonly SqlValue[]): readonly T[] => {
    const rows: Row[] = []
    db.exec({ sql, bind: params, rowMode: 'object', returnValue: 'resultRows', resultRows: rows })
    return rows as unknown as readonly T[]
  }

  return { run, runSelect }
}
