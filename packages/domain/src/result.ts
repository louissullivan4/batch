/**
 * A tiny `Result` for operations that validate and can fail without throwing — the return type of
 * `decide` (command → events) and `parseKeypadInput`. A throw is for a bug; a `Result` is for an
 * expected, recoverable rejection the caller must handle (a bad total, a void of a missing line).
 *
 * Deliberately minimal — no combinators. Pattern-match on `ok`.
 */

export type Result<T, E = string> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E }

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value }
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error }
}

/** A rejected domain operation: a stable `code` for matching plus a human `message`. */
export interface DomainError {
  readonly code: string
  readonly message: string
}
