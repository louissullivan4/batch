import type { WorkerRequest, WorkerResponse } from './opfs-worker-protocol'
import { createRunners, openSahPoolDb, type Runners, type Sqlite3OoDb } from './sqlite-sahpool'

/**
 * The dedicated Worker that owns the till's SAHPool database. It exists because OPFS sync access
 * handles (`createSyncAccessHandle`) are exposed only inside a Worker — opening SAHPool on the main
 * thread throws "Missing required OPFS APIs" in every browser. All the real work is the shared
 * `sqlite-sahpool` code; this file is just the message loop. See `./opfs-worker` for the proxy.
 */

// The worker global. Typed locally (rather than via the WebWorker lib, which conflicts with DOM in a
// single tsconfig) — the package's minimal-boundary-types convention, same as the wasm boundary.
interface WorkerScope {
  onmessage: ((event: { readonly data: WorkerRequest }) => void) | null
  postMessage(message: WorkerResponse): void
}
const scope = globalThis as unknown as WorkerScope

let db: Sqlite3OoDb | null = null
let runners: Runners | null = null

function assertNever(x: never): never {
  throw new Error(`unknown storage worker request: ${JSON.stringify(x)}`)
}

async function handle(request: WorkerRequest): Promise<unknown> {
  switch (request.type) {
    case 'open': {
      db = await openSahPoolDb({ poolName: request.poolName, filename: request.filename })
      runners = createRunners(db)
      return null
    }
    case 'exec': {
      if (!runners) throw new Error('storage worker: not opened')
      return runners.run(request.sql, request.params)
    }
    case 'select': {
      if (!runners) throw new Error('storage worker: not opened')
      return runners.runSelect(request.sql, request.params)
    }
    case 'close': {
      db?.close()
      db = null
      runners = null
      return null
    }
    default:
      return assertNever(request)
  }
}

scope.onmessage = (event): void => {
  const request = event.data
  void handle(request).then(
    (value) => scope.postMessage({ id: request.id, ok: true, value }),
    (err: unknown) =>
      scope.postMessage({
        id: request.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }),
  )
}
