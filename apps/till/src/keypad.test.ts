import { describe, expect, it } from 'vitest'
import { parseKeypadInput } from '@batch/domain'
import { appendKeypadChar, backspaceKeypad } from './keypad'

describe('appendKeypadChar', () => {
  it('builds a plain decimal string digit by digit', () => {
    let s = ''
    for (const ch of ['1', '6', '.', '2', '0']) s = appendKeypadChar(s, ch)
    expect(s).toBe('16.20')
    const parsed = parseKeypadInput(s)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.value.amountMinor).toBe(1620n)
  })

  it('refuses a second decimal point', () => {
    const s = appendKeypadChar(appendKeypadChar(appendKeypadChar('4', '.'), '5'), '.')
    expect(s).toBe('4.5')
  })

  it('refuses a third decimal digit', () => {
    let s = '4.5'
    s = appendKeypadChar(s, '0')
    expect(s).toBe('4.50')
    s = appendKeypadChar(s, '9')
    expect(s).toBe('4.50') // already 2 decimals — ignored
  })

  it('a leading "." seeds "0."', () => {
    expect(appendKeypadChar('', '.')).toBe('0.')
  })

  it('replaces a solitary leading zero rather than producing "05"', () => {
    expect(appendKeypadChar('0', '5')).toBe('5')
  })
})

describe('backspaceKeypad', () => {
  it('removes exactly one trailing character', () => {
    expect(backspaceKeypad('16.20')).toBe('16.2')
    expect(backspaceKeypad('')).toBe('')
  })
})
