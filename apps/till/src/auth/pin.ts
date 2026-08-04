/**
 * Staff PIN verification (ADR 0009). Argon2id via `hash-wasm`, run entirely on-device against a
 * synced PHC string — no network call anywhere in this module (root CLAUDE.md non-negotiable #5).
 * Called off the order/tender path, from the shift screens' inline PIN pad only.
 */

import { argon2Verify } from 'hash-wasm'

/**
 * A syntactically valid Argon2id PHC string that no real 4-digit PIN will ever match (the hash was
 * produced from random bytes, not a PIN). Verifying against it when the staff id is unknown keeps
 * `verifyPin` constant-work either way (ADR 0009: "an unknown PIN and a wrong PIN take the same time
 * and return the same result") — there is no early return that skips the KDF for a bad lookup.
 */
const DUMMY_PHC =
  '$argon2id$v=19$m=19456,t=2,p=1$5T2cKZN2KACbRk/Cdm9jnw$ievgOyufOOIZfWzbykxMYq3Mxlvmkv6tG5DcRwwx13I'

/**
 * Verify a typed PIN against a staff member's stored PHC hash. `phc` is `null` for "no such staff" —
 * the caller still pays the full Argon2id cost against a dummy hash, and the result is always `false`
 * in that case, so an attacker (or a timing side-channel) cannot distinguish "wrong PIN" from "no such
 * staff id" (ADR 0009).
 */
export async function verifyPin(pin: string, phc: string | null): Promise<boolean> {
  const hash = phc ?? DUMMY_PHC
  let matched: boolean
  try {
    matched = await argon2Verify({ password: pin, hash })
  } catch {
    // A malformed PHC string (corrupt sync row) must fail closed, not throw through the UI.
    matched = false
  }
  return phc !== null && matched
}
