/**
 * Pure order-mutation logic for the till UI — no React, no I/O. Each function turns the current
 * order (its events) plus an operator intent into the `OutgoingEvent[]` to append. The React hook
 * (`useOrder`) is a thin wrapper that holds the events in state and commits these off the paint path.
 *
 * Everything routes through the shared `@batch/domain` reducer/totals (non-negotiable #6), so the
 * numbers here are the same ones the server re-derives. Money stays `bigint` throughout.
 *
 * Append-only in practice: there is no "edit a line" event. Increasing a line's quantity or changing
 * its modifiers is expressed as **void the old line + add a new one** — two appended events, never a
 * mutation of a prior one (non-negotiable #3, ADR 0008).
 */

import { reduceOrder, type OrderModifier, type OrderState, type VatRateBp } from '@batch/domain'
import { addLine, closeOrder, openOrder, tenderCash, voidLine } from './order'
import { MENU, selectionToModifiers, type MenuItem, type ModifierSelection } from './menu/menu'
import type { OrderEvent } from '@batch/domain'
import type { OutgoingEvent } from './sync'

/** A line as the order pane renders it — only still-active units, with a display summary. */
export interface OrderLineView {
  readonly lineId: string
  readonly productId: string
  readonly name: string
  /** Still-active quantity (`quantity - voidedQuantity`), always ≥ 1 for a visible line. */
  readonly quantity: bigint
  readonly unitPriceMinor: bigint
  readonly vatRateBp: VatRateBp
  readonly modifiers: readonly OrderModifier[]
  /** "Oat milk · Extra shot", or "" when the line has no modifiers. */
  readonly modifierSummary: string
  /** Active qty × (unit + Σ modifier deltas) — matches `computeTotals` for this line. */
  readonly lineTotalMinor: bigint
}

/** Stable identity of a line's *configuration* (product + its modifier set), for merge-on-repeat. */
function signatureOf(productId: string, modifierIds: readonly string[]): string {
  return `${productId}|${[...modifierIds].sort().join(',')}`
}

function modifiersUnitMinor(modifiers: readonly { readonly unitPriceMinor: bigint }[]): bigint {
  return modifiers.reduce((sum, m) => sum + m.unitPriceMinor, 0n)
}

/** Collapse repeated modifiers into "Name" / "Name ×2", first-seen order, " · " separated. */
export function summarizeModifiers(modifiers: readonly OrderModifier[]): string {
  const order: string[] = []
  const counts = new Map<string, number>()
  for (const m of modifiers) {
    if (!counts.has(m.name)) order.push(m.name)
    counts.set(m.name, (counts.get(m.name) ?? 0) + 1)
  }
  return order
    .map((name) => {
      const n = counts.get(name) ?? 1
      return n > 1 ? `${name} ×${n}` : name
    })
    .join(' · ')
}

/** The active lines of a state, shaped for the order pane. */
export function activeLineViews(state: OrderState): OrderLineView[] {
  const views: OrderLineView[] = []
  for (const line of state.lines) {
    const activeQty = line.quantity - line.voidedQuantity
    if (activeQty <= 0n) continue
    const unit = line.unitPriceMinor + modifiersUnitMinor(line.modifiers)
    views.push({
      lineId: line.lineId,
      productId: line.productId,
      name: line.name,
      quantity: activeQty,
      unitPriceMinor: line.unitPriceMinor,
      vatRateBp: line.vatRateBp,
      modifiers: line.modifiers,
      modifierSummary: summarizeModifiers(line.modifiers),
      lineTotalMinor: activeQty * unit,
    })
  }
  return views
}

function findActiveLineBySignature(state: OrderState, signature: string): OrderState['lines'][number] | undefined {
  return state.lines.find(
    (l) => l.quantity - l.voidedQuantity > 0n && signatureOf(l.productId, l.modifiers.map((m) => m.modifierId)) === signature,
  )
}

export interface AddItemResult {
  readonly orderId: string
  readonly outgoing: readonly OutgoingEvent[]
}

/**
 * Add one unit of `item` (with `selection`, or none for a no-option item). Opens the order if this is
 * the first line. If an identical configuration is already on the order, its quantity goes up by one
 * (void old + re-add at qty+1) rather than creating a second row — SPEC "+1 to an existing identical
 * line", and how the design shows "2× Flat white".
 */
export function addItemOps(
  events: readonly OrderEvent[],
  orderId: string | null,
  item: MenuItem,
  selection: ModifierSelection | null,
  staffId?: string,
): AddItemResult {
  const outgoing: OutgoingEvent[] = []
  let oid = orderId

  if (oid === null) {
    const opened = openOrder({ fulfilment: 'EAT_IN', ...(staffId !== undefined ? { staffId } : {}) })
    oid = opened.orderId
    outgoing.push(opened.outgoing)
  }

  const modifiers = selection ? selectionToModifiers(MENU, item, selection) : []
  const signature = signatureOf(item.productId, modifiers.map((m) => m.modifierId))
  const state = events.length > 0 ? reduceOrder(events) : null
  const existing = state ? findActiveLineBySignature(state, signature) : undefined

  if (existing) {
    const nextQty = existing.quantity - existing.voidedQuantity + 1n
    outgoing.push(voidLine(oid, existing.lineId))
    outgoing.push(
      addLine(oid, {
        productId: item.productId,
        name: item.name,
        quantity: nextQty,
        unitPriceMinor: item.priceMinor,
        vatRateBp: item.vatRateBp,
        fulfilment: 'EAT_IN',
        modifiers,
      }),
    )
  } else {
    outgoing.push(
      addLine(oid, {
        productId: item.productId,
        name: item.name,
        quantity: 1n,
        unitPriceMinor: item.priceMinor,
        vatRateBp: item.vatRateBp,
        fulfilment: 'EAT_IN',
        modifiers,
      }),
    )
  }

  return { orderId: oid, outgoing }
}

/** Void an entire line (the design's × → confirm → Remove). */
export function voidLineOps(orderId: string, lineId: string): OutgoingEvent[] {
  return [voidLine(orderId, lineId)]
}

/**
 * Replace a line's modifiers (the "Update line" path from the sheet): void the old line, add a new
 * one at the same active quantity with the new configuration.
 */
export function replaceLineOps(
  events: readonly OrderEvent[],
  orderId: string,
  lineId: string,
  item: MenuItem,
  selection: ModifierSelection,
): OutgoingEvent[] {
  const state = reduceOrder(events)
  const line = state.lines.find((l) => l.lineId === lineId)
  if (!line) return []
  const activeQty = line.quantity - line.voidedQuantity
  if (activeQty <= 0n) return []
  const modifiers = selectionToModifiers(MENU, item, selection)
  return [
    voidLine(orderId, lineId),
    addLine(orderId, {
      productId: item.productId,
      name: item.name,
      quantity: activeQty,
      unitPriceMinor: item.priceMinor,
      vatRateBp: item.vatRateBp,
      fulfilment: 'EAT_IN',
      modifiers,
    }),
  ]
}

/**
 * Complete a cash sale: tender the full balance and close the order (A-007). `tenderCash` derives the
 * expected total from the prior events with the shared reducer, so the server verifies the same number.
 */
export function completeCashOps(
  events: readonly OrderEvent[],
  orderId: string,
  tenderedMinor: bigint,
): OutgoingEvent[] {
  return [tenderCash(orderId, events, { tenderedMinor }), closeOrder(orderId)]
}
