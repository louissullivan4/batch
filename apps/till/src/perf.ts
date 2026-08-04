/**
 * Performance instrumentation (Sprint 3 task 8, apps/till/CLAUDE.md budgets).
 *
 * Three budgets, enforced not aspired:
 *   - tap → visual response   < 100 ms
 *   - local order commit      < 200 ms
 *   - cold start → first tap  < 3000 ms
 *
 * "Fail loudly on budget breach" = a bright `console.error` in dev the moment a path blows its
 * budget, plus a returned flag the UI can badge. It deliberately does **not** throw: a genuinely
 * slow device must still take the order (offline-first — the sale matters more than the metric), and
 * throwing would make CI flaky on a loaded machine. Catching the regression the day it lands is the
 * goal; a red console line does that without breaking the till.
 */

export const BUDGET_MS = {
  tapResponse: 100,
  localCommit: 200,
  coldStart: 3000,
} as const

export type PerfPath = keyof typeof BUDGET_MS

const isDev = (): boolean => {
  try {
    return Boolean(import.meta.env?.DEV)
  } catch {
    return false
  }
}

export interface PerfSample {
  readonly path: PerfPath
  readonly ms: number
  readonly budgetMs: number
  readonly overBudget: boolean
}

/** Optional sink so a dev overlay can render the latest samples. Set to null to detach. */
let sink: ((sample: PerfSample) => void) | null = null
export function setPerfSink(fn: ((sample: PerfSample) => void) | null): void {
  sink = fn
}

/** Record a measured latency against its budget. Returns the sample (with `overBudget`). */
export function recordLatency(path: PerfPath, ms: number): PerfSample {
  const budgetMs = BUDGET_MS[path]
  const overBudget = ms > budgetMs
  const sample: PerfSample = { path, ms, budgetMs, overBudget }
  if (isDev()) {
    const line = `[perf] ${path} ${ms.toFixed(1)}ms (budget ${budgetMs}ms)`
    if (overBudget) console.error(`🔴 BUDGET BREACH — ${line}`)
    else console.debug(line)
  }
  sink?.(sample)
  return sample
}

/** Time an async unit of work (e.g. a LocalStore commit) and record it against `path`. */
export async function measure<T>(path: PerfPath, work: () => Promise<T>): Promise<{ result: T; sample: PerfSample }> {
  const start = performance.now()
  const result = await work()
  const sample = recordLatency(path, performance.now() - start)
  return { result, sample }
}
