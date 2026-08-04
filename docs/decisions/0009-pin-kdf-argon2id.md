# 0009 — Staff PIN hashing: Argon2id, PHC string, verified on-device

Date: 2026-08-04
Status: accepted
Relates to: Sprint 4 task 6, non-negotiable #5 (PIN verifies locally, offline).

## Context

Staff authorise shift and cash actions with a **4-digit PIN**. Non-negotiable #5 requires that
verification happen **locally, with no network call** — the hash is synced to the device and checked
there, so a barista can authorise a paid-out on a dead café network. The SPEC (Sprint 4) mandates a
**memory-hard KDF (Argon2id), never plain SHA**, because the realistic threat is *offline* brute
force: the salted hash sits on an iPad that can be stolen or imaged.

Two hard truths shape this:

1. A 4-digit PIN has only **10,000** possible values. No KDF makes 10⁴ guesses "hard" in absolute
   terms — an attacker with the hash and a fast Argon2id will still grind the whole space in minutes
   to hours. The KDF buys **time and cost per guess**, not immunity. The honest protections are:
   the per-staff random salt (no rainbow tables, no cross-staff reuse), the KDF cost, and the UI
   lockout (5 failures → 30s cooldown, SPEC). This is accepted, with the residual risk logged as an
   assumption, not hidden.
2. The hash **format is synced and stored**. Changing the algorithm or parameters later means
   re-hashing every staff PIN — which requires the plaintext PIN, which we do not keep. So the
   encoding must be **self-describing** (parameters travel *with* each hash) to allow the cost to be
   raised for new/rotated PINs without a format migration.

## Decision

- **Algorithm: Argon2id.** Memory-hard, side-channel-resistant, the current OWASP default for
  password storage. Not scrypt, not bcrypt, never a bare hash.
- **Parameters (minimum): m = 19456 KiB (19 MiB), t = 2, p = 1.** OWASP's floor for Argon2id. On an
  iPad this is ~tens of ms — irrelevant on the auth path (a PIN check is never on the order/tender
  path, non-negotiable #5), painful at brute-force scale. The owner can raise the cost later; see
  the self-describing point below.
- **Salt: 16 random bytes per staff member**, generated where the PIN is set (back office, Sprint 6),
  never on the till.
- **Encoding: the PHC string format** — `$argon2id$v=19$m=19456,t=2,p=1$<b64 salt>$<b64 hash>`. The
  parameters and salt live *inside* the string, so `verify(pin, phc)` reads the cost from the stored
  hash. Raising the cost for a newly-set PIN needs **no schema change**; old and new hashes coexist.
- **Library: `hash-wasm`.** Pure-WASM Argon2id, runs identically in the browser and in Node (so the
  same verify path is unit-tested), ~a few KB of JS + a WASM blob that Workbox precaches with the
  rest of the shell (offline-safe, non-negotiable #5). No native addon, no Capacitor plugin, keeps
  the ADR-0005 "one adapter" story intact. Hand-rolling Argon2id is not a ~50-line job, so the
  dependency clears the repo's anti-pattern bar.
- **Where it runs: `apps/till` only, off the order path.** PIN verification is a till-local auth
  primitive, not order/shift *domain* logic, so it does **not** go in the pure `packages/domain`
  reducer core (which forbids I/O and async WASM init). It lives in `apps/till/src/auth/`. The server
  does not verify PINs this sprint.
- **Verification is constant-work per attempt**: always run the KDF, never short-circuit on "no such
  staff" — an unknown PIN and a wrong PIN take the same time and return the same result.

## Consequences

Makes easy: offline PIN checks that are genuinely memory-hard; raising cost later without a format
migration; one tested verify path shared by browser and Node.

Makes hard: adds `hash-wasm` + a WASM blob to the till bundle (precached, so it is a cold-load size
cost, not a runtime one). A 4-digit PIN remains low-entropy by product choice — documented, not
engineered away.

To reverse: the PHC prefix (`$argon2id$…`) is stored in every synced staff row. Switching KDFs means
new hashes for everyone, which needs the plaintext at PIN-set time — cheap going forward (next time
each staff member sets a PIN), impossible retroactively. Self-describing encoding is what keeps a
*parameter* bump (the likely change) free.

## Alternatives rejected

- **Plain SHA-256 / HMAC:** GPU-trivial against a 10⁴ space; the SPEC forbids it explicitly.
- **bcrypt:** not memory-hard; weaker against GPU/ASIC than Argon2id; 72-byte cap irrelevant here but
  the algorithm is simply the worse choice in 2026.
- **Native Argon2 (node-argon2 / a Capacitor plugin):** breaks the "runs in the browser PWA today,
  one adapter" story (ADR 0005) and can't be precached as a portable WASM blob.
- **Longer PIN / passphrase:** a real entropy fix, but a café till needs a 4-digit tap. Product
  constraint wins; the residual risk is logged (assumptions) rather than denied.
- **Store parameters in a separate column:** loses the coexistence property — every hash would have
  to share one parameter set, so raising the cost becomes a fleet-wide migration. PHC keeps it local
  to each hash.
