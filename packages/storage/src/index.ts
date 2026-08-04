/**
 * `LocalStore` — the till's on-device persistence contract.
 *
 * This interface is the entire value of ADR 0005 (the till is a web app with a native-storage escape
 * hatch). Sprint 1 ships exactly one implementation — OPFS + SQLite-wasm. If OPFS proves unreliable
 * on iOS, a Capacitor / native-SQLite adapter must be addable as a *single new file* with **zero
 * changes to calling code**. That is only possible if nothing here leaks how the bytes are stored.
 *
 * So this file names no filenames, no OPFS handles, no wasm module, no worker, no Capacitor plugin —
 * only SQL text, bound parameters, rows, and transactions. Every adapter is SQLite underneath; that
 * shared dialect is the basis of the abstraction, not a leak.
 *
 * How you *obtain* a store is deliberately NOT specified here: each adapter exports its own
 * `open…()` factory with its own construction options (an OPFS path differs from a Capacitor db name
 * and encryption key), and forcing a single factory signature would itself be a leak. Calling code
 * depends only on the `LocalStore` instance it is handed.
 */

/**
 * A value that can be bound into a statement or read back from a row.
 *
 * This is the SQLite storage-class set because every adapter is SQLite — nothing wider is portable.
 *
 * MONEY DURABILITY (non-negotiable #1: money is `bigint` minor units). Persist money — and any
 * 64-bit integer — as **TEXT** (a decimal string), converting at the domain boundary exactly as it
 * crosses the sync wire. Do **not** put money in an INTEGER column: adapters disagree on integers
 * outside the JS safe range — `node:sqlite` throws on binding them, `wa-sqlite` needs an opt-in to
 * read them as BigInt, and some native bridges return a lossy `number`. TEXT is lossless in every
 * adapter, so a value's durability never depends on which one happens to be installed. `bigint` is
 * *accepted* here for small ids/counters an adapter can bind safely, but money does not rely on it.
 */
export type SqlValue = string | number | bigint | Uint8Array | null

/** A result row: a read-only map of column name to value. */
export type Row = Readonly<Record<string, SqlValue>>

/** The outcome of a statement. */
export interface QueryResult {
  /** Rows produced by the statement — e.g. a `SELECT` or an `INSERT … RETURNING`. Empty otherwise. */
  readonly rows: readonly Row[]
  /** Rows changed by an `INSERT`/`UPDATE`/`DELETE`. Zero for `SELECT` and DDL. */
  readonly rowsAffected: number
  /**
   * `rowid` of the last inserted row when the statement inserted into a rowid table, else `null`.
   * A `bigint` because `rowid` is 64-bit; do not rely on it fitting a JS `number`.
   */
  readonly lastInsertRowId: bigint | null
}

/**
 * Runs statements against the store. Parameters bind positionally to `?` placeholders.
 *
 * Both a `LocalStore` and an open transaction are `Executor`s. A function typed to take an `Executor`
 * therefore runs identically inside or outside a transaction, and the caller never branches on which
 * it holds — that substitutability is what lets the event and its outbox row share one transaction.
 */
export interface Executor {
  /** Run any statement (DDL or write). Returns `rows` too, for `INSERT … RETURNING`. */
  execute(sql: string, params?: readonly SqlValue[]): Promise<QueryResult>
  /** Run a query and return only its rows, typed by the caller. */
  select<T extends Row = Row>(sql: string, params?: readonly SqlValue[]): Promise<readonly T[]>
}

/** The on-device store. Async everywhere, because at least one adapter (OPFS) runs off-thread. */
export interface LocalStore extends Executor {
  /**
   * Run `work` in a single transaction: commit if it resolves, roll back and rethrow if it throws.
   *
   * The order event and its outbox row MUST be written through the same `tx`. If they can land in
   * separate transactions they eventually will, and the outbox diverges from the log — the exact
   * failure ADR 0002 and the `apps/till` write path forbid.
   *
   * Not re-entrant: calling `transaction` again from inside `work` is unsupported (adapters back it
   * with a single `BEGIN`, not savepoints). Thread the `tx` down instead of opening a nested one.
   */
  transaction<T>(work: (tx: Executor) => Promise<T>): Promise<T>

  /** Release the underlying database handle. Idempotent; a closed store must not be reused. */
  close(): Promise<void>
}
