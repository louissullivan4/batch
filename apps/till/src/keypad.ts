/**
 * Pure string-building helpers for the cash-tender keypad (SPEC Screen 3). The keypad builds a plain
 * decimal string exactly as typed — `parseKeypadInput` (`@batch/domain`) is the single source of
 * truth for turning that string into `Money`; this module never itself constructs an amount.
 */

const MAX_DECIMALS = 2

/** Append a digit or the decimal point, refusing a second `.` or a third decimal digit. */
export function appendKeypadChar(current: string, ch: string): string {
  if (ch === '.') {
    if (current.includes('.')) return current
    return current === '' ? '0.' : `${current}.`
  }
  const dotIndex = current.indexOf('.')
  if (dotIndex !== -1 && current.length - dotIndex - 1 >= MAX_DECIMALS) return current
  if (current === '0') return ch
  return current + ch
}

/** Remove the last typed character. */
export function backspaceKeypad(current: string): string {
  return current.slice(0, -1)
}
