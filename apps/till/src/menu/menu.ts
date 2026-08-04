/**
 * Till menu — a **seed fixture**, not the real catalogue.
 *
 * There is no product CRUD yet: products/prices/modifiers are ordinary CRUD tables owned by the
 * Sprint 6 back office (CLAUDE.md non-negotiable #7). To run the Sprint 3 till today, the menu is
 * hardcoded here. Prices and names mirror the design PNG so the order-entry grid matches the
 * screenshot; VAT bands are seed defaults (assumption A-017). When the back office lands, this file
 * is deleted and the menu is synced down.
 *
 * All prices are **VAT-inclusive** `bigint` minor units (A-009, non-negotiable #1). A line snapshots
 * the item's `unitPriceMinor` and `vatRateBp` at sale time, so a wrong seed rate corrupts no history.
 *
 * Money never becomes a `number` here — deltas and prices are `bigint` throughout.
 */

import { VAT_REDUCED_BP, VAT_STANDARD_BP, type LineModifier, type VatRateBp } from '@batch/domain'

// ---- Types -------------------------------------------------------------------------------------

export interface ModifierOption {
  readonly id: string
  /** Short label shown in the sheet, e.g. "Oat". */
  readonly name: string
  /** Longer label for the order line / receipt, e.g. "Oat milk". Defaults to `name`. */
  readonly summaryName?: string
  /** Added to the line's per-unit price when this option is chosen. 0 = free / default. */
  readonly priceDeltaMinor: bigint
  readonly outOfStock?: boolean
}

/** Exactly one option always selected (segmented control + radio circle in the design). */
export interface SingleGroup {
  readonly kind: 'single'
  readonly id: string
  readonly name: string
  readonly options: readonly ModifierOption[]
  readonly defaultOptionId: string
}

/** Zero or more options (separate pill chips + square checkbox in the design). */
export interface MultiGroup {
  readonly kind: 'multi'
  readonly id: string
  readonly name: string
  readonly options: readonly ModifierOption[]
}

/** A count with a default and a per-unit-above-default price (the shots stepper). */
export interface StepperGroup {
  readonly kind: 'stepper'
  readonly id: string
  readonly name: string
  /** Singular unit noun, e.g. "shot" — rendered as "2 shots". */
  readonly unitName: string
  readonly defaultCount: number
  readonly min: number
  readonly max: number
  readonly extraPriceMinor: bigint
}

export type ModifierGroup = SingleGroup | MultiGroup | StepperGroup

export interface MenuItem {
  readonly productId: string
  readonly name: string
  /** VAT-inclusive base price, minor units. */
  readonly priceMinor: bigint
  readonly vatRateBp: VatRateBp
  /** Groups this item offers. Empty = no options: a tap adds it to the order immediately. */
  readonly modifierGroupIds: readonly string[]
  /** "86'd" — out of stock. Still rendered (dimmed), tap shows a toast. */
  readonly outOfStock?: boolean
}

export interface MenuCategory {
  readonly id: string
  readonly name: string
  readonly items: readonly MenuItem[]
}

export interface Menu {
  readonly categories: readonly MenuCategory[]
  readonly modifierGroups: Readonly<Record<string, ModifierGroup>>
}

/** The draft state of a modifier sheet: which option per single group, which set per multi, counts. */
export interface ModifierSelection {
  readonly single: Readonly<Record<string, string>>
  readonly multi: Readonly<Record<string, readonly string[]>>
  readonly steppers: Readonly<Record<string, number>>
}

// ---- The fixture -------------------------------------------------------------------------------

const HOSPITALITY: VatRateBp = VAT_REDUCED_BP // prepared food & drink — 13.5% (A-017)
const RETAIL: VatRateBp = VAT_STANDARD_BP // packaged goods — 23% (A-017)

const MODIFIER_GROUPS: Record<string, ModifierGroup> = {
  size: {
    kind: 'single',
    id: 'size',
    name: 'Size',
    defaultOptionId: 'size-regular',
    options: [
      { id: 'size-regular', name: 'Regular', priceDeltaMinor: 0n },
      { id: 'size-large', name: 'Large', priceDeltaMinor: 40n },
    ],
  },
  milk: {
    kind: 'single',
    id: 'milk',
    name: 'Milk',
    defaultOptionId: 'milk-whole',
    options: [
      { id: 'milk-whole', name: 'Whole', summaryName: 'Whole milk', priceDeltaMinor: 0n },
      { id: 'milk-oat', name: 'Oat', summaryName: 'Oat milk', priceDeltaMinor: 40n },
      { id: 'milk-almond', name: 'Almond', summaryName: 'Almond milk', priceDeltaMinor: 40n },
      { id: 'milk-skim', name: 'Skim', summaryName: 'Skim milk', priceDeltaMinor: 0n },
    ],
  },
  shots: {
    kind: 'stepper',
    id: 'shots',
    name: 'Shots',
    unitName: 'shot',
    defaultCount: 2,
    min: 1,
    max: 6,
    extraPriceMinor: 60n,
  },
  temp: {
    kind: 'single',
    id: 'temp',
    name: 'Temperature',
    defaultOptionId: 'temp-hot',
    options: [
      { id: 'temp-hot', name: 'Hot', priceDeltaMinor: 0n },
      { id: 'temp-iced', name: 'Iced', priceDeltaMinor: 30n },
    ],
  },
  syrups: {
    kind: 'multi',
    id: 'syrups',
    name: 'Syrups',
    options: [
      { id: 'syrup-vanilla', name: 'Vanilla', priceDeltaMinor: 30n },
      { id: 'syrup-caramel', name: 'Caramel', priceDeltaMinor: 30n },
      { id: 'syrup-hazelnut', name: 'Hazelnut', priceDeltaMinor: 30n },
    ],
  },
}

/** Full espresso-drink option set (matches the Flat white sheet in the design). */
const ESPRESSO_MODS = ['size', 'milk', 'shots', 'temp', 'syrups'] as const
/** Milk drinks without a shot count (hot chocolate, chai). */
const MILK_DRINK_MODS = ['size', 'milk', 'temp', 'syrups'] as const
/** Tea: size, milk, temperature. */
const TEA_MODS = ['size', 'milk', 'temp'] as const

function drink(
  productId: string,
  name: string,
  priceMinor: bigint,
  modifierGroupIds: readonly string[],
  outOfStock = false,
): MenuItem {
  return { productId, name, priceMinor, vatRateBp: HOSPITALITY, modifierGroupIds, ...(outOfStock ? { outOfStock } : {}) }
}

function food(productId: string, name: string, priceMinor: bigint, outOfStock = false): MenuItem {
  return { productId, name, priceMinor, vatRateBp: HOSPITALITY, modifierGroupIds: [], ...(outOfStock ? { outOfStock } : {}) }
}

function retail(productId: string, name: string, priceMinor: bigint): MenuItem {
  return { productId, name, priceMinor, vatRateBp: RETAIL, modifierGroupIds: [] }
}

// The default "Coffee" grid mirrors the design PNG tile-for-tile (drink + food tiles mixed), so the
// order-entry screenshot matches the reference. Real category taxonomy is a Sprint 6 back-office
// concern; here it is display order only.
const COFFEE: MenuCategory = {
  id: 'coffee',
  name: 'Coffee',
  items: [
    drink('flat-white', 'Flat white', 380n, ESPRESSO_MODS),
    drink('latte', 'Latte', 390n, ESPRESSO_MODS),
    drink('cappuccino', 'Cappuccino', 380n, ESPRESSO_MODS),
    drink('americano', 'Americano', 340n, ESPRESSO_MODS),
    drink('espresso', 'Espresso', 280n, ESPRESSO_MODS),
    drink('cortado', 'Cortado', 350n, ESPRESSO_MODS),
    drink('mocha', 'Mocha', 420n, ESPRESSO_MODS),
    drink('hot-chocolate', 'Hot chocolate', 390n, MILK_DRINK_MODS),
    drink('tea', 'Tea', 280n, TEA_MODS),
    drink('chai-latte', 'Chai latte', 400n, MILK_DRINK_MODS),
    drink('iced-latte', 'Iced latte', 420n, ESPRESSO_MODS),
    drink('cold-brew', 'Cold brew', 400n, ['size', 'shots', 'temp', 'syrups']),
    food('croissant', 'Croissant', 290n),
    food('almond-croissant', 'Almond croissant', 320n),
    food('pain-au-chocolat', 'Pain au chocolat', 310n),
    food('sausage-roll', 'Sausage roll', 360n),
    food('ham-cheese-toastie', 'Ham & cheese toastie', 550n),
    food('banana-bread', 'Banana bread', 340n),
    food('scone', 'Scone', 300n, true),
    food('brownie', 'Brownie', 300n),
  ],
}

const TEA: MenuCategory = {
  id: 'tea',
  name: 'Tea',
  items: [
    drink('breakfast-tea', 'Breakfast tea', 280n, TEA_MODS),
    drink('earl-grey', 'Earl grey', 290n, TEA_MODS),
    drink('green-tea', 'Green tea', 290n, ['size', 'temp']),
    drink('peppermint', 'Peppermint', 290n, ['size', 'temp']),
    drink('chamomile', 'Chamomile', 290n, ['size', 'temp']),
  ],
}

const FOOD: MenuCategory = {
  id: 'food',
  name: 'Food',
  items: [
    food('croissant-f', 'Croissant', 290n),
    food('almond-croissant-f', 'Almond croissant', 320n),
    food('pain-au-chocolat-f', 'Pain au chocolat', 310n),
    food('sausage-roll-f', 'Sausage roll', 360n),
    food('ham-cheese-toastie-f', 'Ham & cheese toastie', 550n),
    food('banana-bread-f', 'Banana bread', 340n),
    food('brownie-f', 'Brownie', 300n),
    food('scone-f', 'Scone', 300n, true),
  ],
}

const COLD: MenuCategory = {
  id: 'cold-drinks',
  name: 'Cold drinks',
  items: [
    drink('iced-latte-c', 'Iced latte', 420n, ESPRESSO_MODS),
    drink('cold-brew-c', 'Cold brew', 400n, ['size', 'shots', 'syrups']),
    drink('iced-tea', 'Iced tea', 350n, ['size']),
    food('sparkling-water', 'Sparkling water', 250n),
    food('orange-juice', 'Orange juice', 320n),
  ],
}

const RETAIL_CAT: MenuCategory = {
  id: 'retail',
  name: 'Retail',
  items: [
    retail('beans-250', 'Coffee beans 250g', 1200n),
    retail('reusable-cup', 'Reusable cup', 1500n),
    retail('tote-bag', 'Tote bag', 900n),
    retail('batch-mug', 'Batch mug', 1000n),
  ],
}

export const MENU: Menu = {
  categories: [COFFEE, TEA, FOOD, COLD, RETAIL_CAT],
  modifierGroups: MODIFIER_GROUPS,
}

// ---- Pure helpers ------------------------------------------------------------------------------

/** The modifier groups an item offers, resolved in order. Unknown ids are skipped (never thrown). */
export function itemGroups(menu: Menu, item: MenuItem): ModifierGroup[] {
  const out: ModifierGroup[] = []
  for (const id of item.modifierGroupIds) {
    const g = menu.modifierGroups[id]
    if (g) out.push(g)
  }
  return out
}

/** True if tapping the item should open the modifier sheet rather than add immediately. */
export function hasOptions(menu: Menu, item: MenuItem): boolean {
  return itemGroups(menu, item).length > 0
}

/** The zero-tap default selection — every group pre-set to its sensible default (SPEC: "common order costs zero taps"). */
export function defaultSelection(menu: Menu, item: MenuItem): ModifierSelection {
  const single: Record<string, string> = {}
  const multi: Record<string, readonly string[]> = {}
  const steppers: Record<string, number> = {}
  for (const g of itemGroups(menu, item)) {
    if (g.kind === 'single') single[g.id] = g.defaultOptionId
    else if (g.kind === 'multi') multi[g.id] = []
    else steppers[g.id] = g.defaultCount
  }
  return { single, multi, steppers }
}

function findOption(group: SingleGroup | MultiGroup, optionId: string): ModifierOption | undefined {
  return group.options.find((o) => o.id === optionId)
}

/**
 * Convert a selection to the `LineModifier[]` snapshotted onto the line event. Only **non-default**
 * choices are emitted (defaults are implied and stay off the receipt): a changed single-select, every
 * ticked multi-select, and each extra stepper unit above the default. A modifier inherits the item's
 * VAT band (A-005 allows its own; the seed menu keeps them equal — A-017). Every price stays `bigint`.
 */
export function selectionToModifiers(menu: Menu, item: MenuItem, sel: ModifierSelection): LineModifier[] {
  const mods: LineModifier[] = []
  for (const g of itemGroups(menu, item)) {
    if (g.kind === 'single') {
      const chosen = sel.single[g.id] ?? g.defaultOptionId
      if (chosen === g.defaultOptionId) continue
      const opt = findOption(g, chosen)
      if (opt)
        mods.push({ modifierId: opt.id, name: opt.summaryName ?? opt.name, unitPriceMinor: opt.priceDeltaMinor, vatRateBp: item.vatRateBp })
    } else if (g.kind === 'multi') {
      for (const optionId of sel.multi[g.id] ?? []) {
        const opt = findOption(g, optionId)
        if (opt)
          mods.push({ modifierId: opt.id, name: opt.summaryName ?? opt.name, unitPriceMinor: opt.priceDeltaMinor, vatRateBp: item.vatRateBp })
      }
    } else {
      const count = sel.steppers[g.id] ?? g.defaultCount
      const extra = Math.max(0, count - g.defaultCount)
      for (let i = 0; i < extra; i++) {
        mods.push({
          modifierId: `${g.id}-extra-${i + 1}`,
          name: `Extra ${g.unitName}`,
          unitPriceMinor: g.extraPriceMinor,
          vatRateBp: item.vatRateBp,
        })
      }
    }
  }
  return mods
}

/** Live per-unit price for the sheet's Confirm button: base + every selected delta. */
export function linePreviewMinor(menu: Menu, item: MenuItem, sel: ModifierSelection): bigint {
  return item.priceMinor + selectionToModifiers(menu, item, sel).reduce((sum, m) => sum + m.unitPriceMinor, 0n)
}
