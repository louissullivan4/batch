/**
 * Display formatting for the till. Money in, string out — never the reverse (parsing keypad input is
 * `parseKeypadInput` in `@batch/domain`). All amounts are `bigint` minor units (non-negotiable #1);
 * this only renders them, so no rounding or float ever enters.
 */

/** `1620n` → `"€16.20"`, `-380n` → `"-€3.80"`. Euro, two decimals, minus sign outside the symbol. */
export function formatEuroMinor(minor: bigint): string {
  const negative = minor < 0n
  const abs = negative ? -minor : minor
  const whole = abs / 100n
  const cents = abs % 100n
  return `${negative ? '-' : ''}€${whole.toString()}.${cents.toString().padStart(2, '0')}`
}

/** A signed price delta for a modifier option: `40n` → `"+€0.40"`, `0n` → `"Free"`. */
export function formatDeltaMinor(minor: bigint): string {
  if (minor === 0n) return 'Free'
  const sign = minor < 0n ? '-' : '+'
  return `${sign}${formatEuroMinor(minor < 0n ? -minor : minor)}`
}
