import type { SqlValue } from './index'

/**
 * The message protocol between the main-thread `LocalStore` proxy (`./opfs-worker`) and the Worker
 * that owns the SAHPool database (`./opfs.worker`). Each call carries a correlation `id`; the reply
 * echoes it. `bigint` and `Uint8Array` (the non-string `SqlValue`s and `lastInsertRowId`) are
 * structured-cloneable, so they cross postMessage without a serialisation step.
 *
 * Transactions need no dedicated message: the proxy sends `begin` / `commit` / `rollback` as ordinary
 * `exec`s. Because the proxy serialises all top-level operations and postMessage is FIFO, the Worker
 * sees `begin … statements … commit` with nothing interleaved — the transaction stays atomic.
 */

export type WorkerCall =
  | { readonly type: 'open'; readonly poolName?: string; readonly filename?: string }
  | { readonly type: 'exec'; readonly sql: string; readonly params: readonly SqlValue[] }
  | { readonly type: 'select'; readonly sql: string; readonly params: readonly SqlValue[] }
  | { readonly type: 'close' }

export type WorkerRequest = WorkerCall & { readonly id: number }

export type WorkerResponse =
  | { readonly id: number; readonly ok: true; readonly value: unknown }
  | { readonly id: number; readonly ok: false; readonly error: string }
