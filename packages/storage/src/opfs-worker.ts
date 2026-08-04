import type { Executor, LocalStore, QueryResult, Row, SqlValue } from './index'
import type { WorkerCall, WorkerRequest, WorkerResponse } from './opfs-worker-protocol'
import type { SahPoolOptions } from './sqlite-sahpool'

/**
 * The `LocalStore` the browser till uses: a thin main-thread proxy over a Worker that owns the OPFS
 * SAHPool database (`./opfs.worker`). This is required, not an optimisation — OPFS sync access handles
 * live only in a Worker (ADR 0005). It also keeps the SQLite write off the paint path (apps/till).
 *
 * Same interface, same semantics as `./opfs`; a caller cannot tell which one it holds. Operations are
 * serialised onto one promise chain exactly as in the direct adapter, so a `transaction` — sent to the
 * Worker as `begin … commit` — is atomic against any concurrent top-level `execute`.
 */

export type OpfsWorkerStoreOptions = SahPoolOptions

interface Pending {
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
}

export async function openOpfsWorkerStore(options: SahPoolOptions = {}): Promise<LocalStore> {
  const worker = new Worker(new URL('./opfs.worker.ts', import.meta.url), { type: 'module' })
  let nextId = 1
  const pending = new Map<number, Pending>()

  worker.onmessage = (event: MessageEvent<WorkerResponse>): void => {
    const res = event.data
    const p = pending.get(res.id)
    if (!p) return
    pending.delete(res.id)
    if (res.ok) p.resolve(res.value)
    else p.reject(new Error(res.error))
  }
  // A worker-level failure (script load, unhandled throw) can never resolve outstanding calls — fail
  // them loudly rather than hang the till.
  worker.onerror = (event: ErrorEvent): void => {
    const error = new Error(`till storage worker failed: ${event.message}`)
    for (const p of pending.values()) p.reject(error)
    pending.clear()
  }

  const request = <T>(call: WorkerCall): Promise<T> => {
    const id = nextId++
    const message: WorkerRequest = { ...call, id }
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
      worker.postMessage(message)
    })
  }

  await request<null>({ type: 'open', poolName: options.poolName, filename: options.filename })

  const rawExec = (sql: string, params: readonly SqlValue[] = []): Promise<QueryResult> =>
    request<QueryResult>({ type: 'exec', sql, params })
  const rawSelect = <T extends Row>(
    sql: string,
    params: readonly SqlValue[] = [],
  ): Promise<readonly T[]> => request<readonly T[]>({ type: 'select', sql, params })

  const noop = (): void => undefined
  let tail: Promise<unknown> = Promise.resolve()
  const serialize = <T>(op: () => Promise<T>): Promise<T> => {
    const result = tail.then(op, op)
    tail = result.then(noop, noop)
    return result
  }

  // Raw executor for inside a transaction — the transaction already holds the serialise slot for its
  // whole body, so these must NOT re-serialise (that would deadlock).
  const txExecutor: Executor = {
    execute: (sql, params = []) => rawExec(sql, params),
    select: <T extends Row = Row>(sql: string, params: readonly SqlValue[] = []) =>
      rawSelect<T>(sql, params),
  }

  return {
    execute: (sql, params = []) => serialize(() => rawExec(sql, params)),
    select: <T extends Row = Row>(sql: string, params: readonly SqlValue[] = []) =>
      serialize(() => rawSelect<T>(sql, params)),
    transaction<T>(work: (tx: Executor) => Promise<T>): Promise<T> {
      return serialize(async () => {
        await rawExec('begin')
        try {
          const result = await work(txExecutor)
          await rawExec('commit')
          return result
        } catch (err) {
          await rawExec('rollback')
          throw err
        }
      })
    },
    close: () =>
      serialize(async () => {
        await request<null>({ type: 'close' })
        worker.terminate()
      }),
  }
}
