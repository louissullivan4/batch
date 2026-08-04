/**
 * UUIDv7 — time-ordered ids, generated on the client. This is the idempotency key (ADR 0002): the
 * same id is reused on every retry of the same event, so the server's `unique (tenant_id, event_id)`
 * constraint makes replays no-op. Time-ordered (first 48 bits are the ms timestamp) so the outbox and
 * the server log sort naturally.
 *
 * ~20 lines and one call to Web Crypto — a dependency would violate the repo's under-50-lines rule.
 * `crypto` is `globalThis.crypto` (Web Crypto), present in both the browser and Node ≥ 20.
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)

  // 48-bit big-endian millisecond timestamp in bytes 0..5.
  const view = new DataView(bytes.buffer)
  view.setUint16(0, Math.floor(now / 0x1_0000_0000))
  view.setUint32(2, now % 0x1_0000_0000)

  // Version 7 in the high nibble of byte 6; RFC 4122 variant in the two high bits of byte 8.
  // `?? 0` only satisfies noUncheckedIndexedAccess — the indices are always in range for a 16-byte array.
  view.setUint8(6, ((bytes[6] ?? 0) & 0x0f) | 0x70)
  view.setUint8(8, ((bytes[8] ?? 0) & 0x3f) | 0x80)

  let hex = ''
  for (let i = 0; i < 16; i++) hex += (bytes[i] ?? 0).toString(16).padStart(2, '0')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
