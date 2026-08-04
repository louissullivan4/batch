import { describe, expect, it } from 'vitest'
import { VAT_REDUCED_BP } from '@batch/domain'
import {
  MENU,
  defaultSelection,
  hasOptions,
  itemGroups,
  linePreviewMinor,
  selectionToModifiers,
  type MenuItem,
} from './menu'

function item(productId: string): MenuItem {
  for (const cat of MENU.categories) {
    const found = cat.items.find((i) => i.productId === productId)
    if (found) return found
  }
  throw new Error(`no menu item ${productId}`)
}

describe('menu fixture', () => {
  it('Coffee grid matches the design PNG: 20 tiles, Scone 86’d', () => {
    const coffee = MENU.categories[0]
    expect(coffee?.name).toBe('Coffee')
    expect(coffee?.items).toHaveLength(20)
    expect(coffee?.items[0]?.name).toBe('Flat white')
    expect(coffee?.items[0]?.priceMinor).toBe(380n)
    expect(coffee?.items.find((i) => i.name === 'Scone')?.outOfStock).toBe(true)
  })

  it('prices are VAT-inclusive bigint in the hospitality band', () => {
    expect(item('flat-white').vatRateBp).toBe(VAT_REDUCED_BP)
    expect(typeof item('flat-white').priceMinor).toBe('bigint')
  })
})

describe('modifier helpers', () => {
  it('food items have no options → add immediately', () => {
    expect(hasOptions(MENU, item('croissant'))).toBe(false)
    expect(itemGroups(MENU, item('croissant'))).toHaveLength(0)
  })

  it('the default selection costs zero extra (common order = base price)', () => {
    const flat = item('flat-white')
    const sel = defaultSelection(MENU, flat)
    expect(selectionToModifiers(MENU, flat, sel)).toHaveLength(0)
    expect(linePreviewMinor(MENU, flat, sel)).toBe(380n)
  })

  it('reproduces the design: Flat white + Vanilla = €4.10', () => {
    const flat = item('flat-white')
    const sel = { ...defaultSelection(MENU, flat), multi: { syrups: ['syrup-vanilla'] } }
    expect(linePreviewMinor(MENU, flat, sel)).toBe(410n)
    const mods = selectionToModifiers(MENU, flat, sel)
    expect(mods).toEqual([
      { modifierId: 'syrup-vanilla', name: 'Vanilla', unitPriceMinor: 30n, vatRateBp: VAT_REDUCED_BP },
    ])
  })

  it('reproduces the order-pane line: Flat white, Oat + 1 extra shot = €4.80', () => {
    const flat = item('flat-white')
    const base = defaultSelection(MENU, flat)
    const sel = { ...base, single: { ...base.single, milk: 'milk-oat' }, steppers: { shots: 3 } }
    expect(linePreviewMinor(MENU, flat, sel)).toBe(480n) // 380 + 40 oat + 60 shot
    const names = selectionToModifiers(MENU, flat, sel).map((m) => m.name)
    expect(names).toEqual(['Oat', 'Extra shot'])
  })

  it('a non-default but free choice (Skim) still shows, priced at zero', () => {
    const flat = item('flat-white')
    const base = defaultSelection(MENU, flat)
    const sel = { ...base, single: { ...base.single, milk: 'milk-skim' } }
    const mods = selectionToModifiers(MENU, flat, sel)
    expect(mods).toEqual([{ modifierId: 'milk-skim', name: 'Skim', unitPriceMinor: 0n, vatRateBp: VAT_REDUCED_BP }])
    expect(linePreviewMinor(MENU, flat, sel)).toBe(380n)
  })

  it('going below the default shot count is not priced down', () => {
    const flat = item('flat-white')
    const base = defaultSelection(MENU, flat)
    const sel = { ...base, steppers: { shots: 1 } }
    expect(selectionToModifiers(MENU, flat, sel)).toHaveLength(0)
    expect(linePreviewMinor(MENU, flat, sel)).toBe(380n)
  })
})
