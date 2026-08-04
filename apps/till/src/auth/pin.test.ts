import { describe, expect, it } from 'vitest'
import { verifyPin } from './pin'
import { STAFF_FIXTURE } from './staff-fixture'

// The generator script's dev PINs are not shipped (ADR 0009) — tests re-derive nothing from the
// fixture's PHC strings, so they can only assert against a hash generated fresh, in-test.
describe('verifyPin', () => {
  it('accepts the correct PIN against its own PHC hash', async () => {
    // Any fixture entry's hash was produced from a real PIN — we don't know the plaintext here, so
    // hash a known PIN in-test and verify against that hash instead of the committed fixture.
    const { argon2id } = await import('hash-wasm')
    const phc = await argon2id({
      password: '1357',
      salt: new Uint8Array(16).fill(7),
      iterations: 2,
      parallelism: 1,
      memorySize: 19456,
      hashLength: 32,
      outputType: 'encoded',
    })
    await expect(verifyPin('1357', phc)).resolves.toBe(true)
  })

  it('rejects a wrong PIN against a real PHC hash', async () => {
    const { argon2id } = await import('hash-wasm')
    const phc = await argon2id({
      password: '1357',
      salt: new Uint8Array(16).fill(7),
      iterations: 2,
      parallelism: 1,
      memorySize: 19456,
      hashLength: 32,
      outputType: 'encoded',
    })
    await expect(verifyPin('9999', phc)).resolves.toBe(false)
  })

  it('returns false for an unknown staff member (null phc), constant-work', async () => {
    await expect(verifyPin('0000', null)).resolves.toBe(false)
  })

  it('unknown-staff and wrong-PIN paths both do real Argon2id work and take comparable time', async () => {
    const { argon2id } = await import('hash-wasm')
    const phc = await argon2id({
      password: '1357',
      salt: new Uint8Array(16).fill(7),
      iterations: 2,
      parallelism: 1,
      memorySize: 19456,
      hashLength: 32,
      outputType: 'encoded',
    })
    const start1 = performance.now()
    await verifyPin('9999', phc)
    const wrongMs = performance.now() - start1

    const start2 = performance.now()
    await verifyPin('9999', null)
    const unknownMs = performance.now() - start2

    // Not a strict timing-attack proof (that needs statistics over many trials on real hardware) —
    // just a sanity check that the unknown-staff path isn't short-circuiting to near-zero time
    // while the known-staff path pays the full KDF cost.
    expect(unknownMs).toBeGreaterThan(wrongMs / 4)
  })

  it('the fixture carries only Argon2id PHC strings, never a plaintext PIN', () => {
    for (const entry of STAFF_FIXTURE) {
      expect(entry.pinPhc.startsWith('$argon2id$')).toBe(true)
      expect(entry.pinPhc).not.toMatch(/^\d{4}$/)
    }
  })
})
