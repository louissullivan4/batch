/**
 * The inverse of `menu.ts`'s `selectionToModifiers`: given an order line's already-applied modifiers,
 * reconstruct the `ModifierSelection` the modifier sheet should pre-fill when the barista taps an
 * existing line to edit it (SPEC Screen 2, "editing an existing line").
 *
 * `selectionToModifiers` only ever emits *non-default* choices onto the line (defaults are implied
 * and never appear on the receipt), so the reverse mapping is: a single-select group is the one
 * option present among its non-default ids, else the group default; a multi-select group is exactly
 * the options present; a stepper group's count is its default plus however many
 * `${groupId}-extra-N` entries are present. This file is new — it does not modify `menu.ts` (which is
 * out of scope for this sprint), only reads its exported shapes.
 */

import type { OrderModifier } from '@batch/domain'
import { itemGroups, type Menu, type MenuItem, type ModifierSelection } from './menu'

export function findMenuItem(menu: Menu, productId: string): MenuItem | undefined {
  for (const category of menu.categories) {
    const found = category.items.find((i) => i.productId === productId)
    if (found) return found
  }
  return undefined
}

export function selectionFromModifiers(
  menu: Menu,
  item: MenuItem,
  modifiers: readonly OrderModifier[],
): ModifierSelection {
  const single: Record<string, string> = {}
  const multi: Record<string, string[]> = {}
  const steppers: Record<string, number> = {}
  const presentIds = new Set(modifiers.map((m) => m.modifierId))

  for (const group of itemGroups(menu, item)) {
    if (group.kind === 'single') {
      const chosen = group.options.find((o) => o.id !== group.defaultOptionId && presentIds.has(o.id))
      single[group.id] = chosen ? chosen.id : group.defaultOptionId
    } else if (group.kind === 'multi') {
      multi[group.id] = group.options.filter((o) => presentIds.has(o.id)).map((o) => o.id)
    } else {
      const extraCount = modifiers.filter((m) => m.modifierId.startsWith(`${group.id}-extra-`)).length
      steppers[group.id] = group.defaultCount + extraCount
    }
  }

  return { single, multi, steppers }
}
