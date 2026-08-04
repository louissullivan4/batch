import { describe, expect, it } from 'vitest'
import { computeTotals, reduceOrder, type OrderEvent } from '@batch/domain'
import {
  activeLineViews,
  addItemOps,
  completeCashOps,
  replaceLineOps,
  summarizeModifiers,
  voidLineOps,
} from './order-ops'
import { MENU, defaultSelection, type MenuItem, type ModifierSelection } from './menu/menu'

function item(productId: string): MenuItem {
  for (const cat of MENU.categories) {
    const found = cat.items.find((i) => i.productId === productId)
    if (found) return found
  }
  throw new Error(`no menu item ${productId}`)
}

/** Append the events of an OutgoingEvent[] to a running log. */
function apply(events: readonly OrderEvent[], outgoing: readonly { event: OrderEvent }[]): OrderEvent[] {
  return [...events, ...outgoing.map((o) => o.event)]
}

describe('addItemOps', () => {
  it('opens the order on the first add, then reduces to one active line', () => {
    const { orderId, outgoing } = addItemOps([], null, item('croissant'), null)
    expect(outgoing[0]?.event.eventType).toBe('OrderOpened')
    expect(outgoing[1]?.event.eventType).toBe('LineAdded')
    const state = reduceOrder(apply([], outgoing))
    expect(state.orderId).toBe(orderId)
    expect(activeLineViews(state)).toHaveLength(1)
    expect(activeLineViews(state)[0]?.quantity).toBe(1n)
  })

  it('a repeated identical add merges into one line at qty 2 (void + re-add), not two rows', () => {
    let events: OrderEvent[] = []
    const first = addItemOps(events, null, item('croissant'), null)
    events = apply(events, first.outgoing)

    const second = addItemOps(events, first.orderId, item('croissant'), null)
    // void the old line + re-add at higher quantity
    expect(second.outgoing.map((o) => o.event.eventType)).toEqual(['LineVoided', 'LineAdded'])
    events = apply(events, second.outgoing)

    const views = activeLineViews(reduceOrder(events))
    expect(views).toHaveLength(1)
    expect(views[0]?.quantity).toBe(2n)
  })

  it('different modifier configs stay as separate lines', () => {
    const flat = item('flat-white')
    const oat: ModifierSelection = { ...defaultSelection(MENU, flat), single: { ...defaultSelection(MENU, flat).single, milk: 'milk-oat' } }
    let events: OrderEvent[] = []
    const a = addItemOps(events, null, flat, defaultSelection(MENU, flat))
    events = apply(events, a.outgoing)
    const b = addItemOps(events, a.orderId, flat, oat)
    events = apply(events, b.outgoing)
    expect(activeLineViews(reduceOrder(events))).toHaveLength(2)
  })

  it('reproduces the design order pane: 2× Flat white (Oat + Extra shot) = €9.60', () => {
    const flat = item('flat-white')
    const base = defaultSelection(MENU, flat)
    const sel: ModifierSelection = { ...base, single: { ...base.single, milk: 'milk-oat' }, steppers: { shots: 3 } }
    let events: OrderEvent[] = []
    const a = addItemOps(events, null, flat, sel)
    events = apply(events, a.outgoing)
    const b = addItemOps(events, a.orderId, flat, sel)
    events = apply(events, b.outgoing)

    const views = activeLineViews(reduceOrder(events))
    expect(views).toHaveLength(1)
    expect(views[0]?.quantity).toBe(2n)
    expect(views[0]?.modifierSummary).toBe('Oat milk · Extra shot')
    expect(views[0]?.lineTotalMinor).toBe(960n)
  })
})

describe('voidLineOps', () => {
  it('voids the whole line, leaving no active lines', () => {
    const add = addItemOps([], null, item('brownie'), null)
    const events = apply([], add.outgoing)
    const lineId = activeLineViews(reduceOrder(events))[0]!.lineId
    const after = apply(events, voidLineOps(add.orderId, lineId))
    expect(activeLineViews(reduceOrder(after))).toHaveLength(0)
  })
})

describe('replaceLineOps', () => {
  it('swaps a line’s modifiers while preserving its quantity', () => {
    const flat = item('flat-white')
    const add = addItemOps([], null, flat, defaultSelection(MENU, flat))
    let events = apply([], add.outgoing)
    // bump to qty 2 first
    const bump = addItemOps(events, add.orderId, flat, defaultSelection(MENU, flat))
    events = apply(events, bump.outgoing)
    const lineId = activeLineViews(reduceOrder(events))[0]!.lineId

    const withOat: ModifierSelection = {
      ...defaultSelection(MENU, flat),
      single: { ...defaultSelection(MENU, flat).single, milk: 'milk-oat' },
    }
    const replaced = replaceLineOps(events, add.orderId, lineId, flat, withOat)
    events = apply(events, replaced)

    const views = activeLineViews(reduceOrder(events))
    expect(views).toHaveLength(1)
    expect(views[0]?.quantity).toBe(2n)
    expect(views[0]?.modifierSummary).toBe('Oat milk')
    expect(views[0]?.lineTotalMinor).toBe(2n * 420n) // (380 + 40 oat) × 2
  })
})

describe('completeCashOps', () => {
  it('tenders the balance and closes the order', () => {
    const add = addItemOps([], null, item('flat-white'), null)
    let events = apply([], add.outgoing)
    const total = computeTotals(reduceOrder(events)).totalMinor
    const ops = completeCashOps(events, add.orderId, 500n)
    expect(ops.map((o) => o.event.eventType)).toEqual(['OrderTendered', 'OrderClosed'])
    events = apply(events, ops)

    const state = reduceOrder(events)
    const t = computeTotals(state)
    expect(state.status).toBe('CLOSED')
    expect(t.balanceMinor).toBe(0n)
    expect(t.changeMinor).toBe(500n - total)
  })
})

describe('every produced event replays through the shared reducer', () => {
  it('folds a full build → merge → void → tender → close sequence without throwing', () => {
    const flat = item('flat-white')
    let events: OrderEvent[] = []
    const a = addItemOps(events, null, flat, defaultSelection(MENU, flat))
    events = apply(events, a.outgoing)
    const b = addItemOps(events, a.orderId, item('latte'), defaultSelection(MENU, item('latte')))
    events = apply(events, b.outgoing)
    const c = addItemOps(events, a.orderId, flat, defaultSelection(MENU, flat)) // merges the flat white
    events = apply(events, c.outgoing)
    const latteId = activeLineViews(reduceOrder(events)).find((v) => v.name === 'Latte')!.lineId
    events = apply(events, voidLineOps(a.orderId, latteId))
    const total = computeTotals(reduceOrder(events)).totalMinor
    events = apply(events, completeCashOps(events, a.orderId, total))

    // The whole sequence folds cleanly and the closed order balances.
    expect(() => reduceOrder(events)).not.toThrow()
    expect(reduceOrder(events).status).toBe('CLOSED')
    expect(computeTotals(reduceOrder(events)).balanceMinor).toBe(0n)
  })
})

describe('summarizeModifiers', () => {
  it('collapses repeats into ×N in first-seen order', () => {
    expect(
      summarizeModifiers([
        { modifierId: 'a', name: 'Oat milk', unitPriceMinor: 40n, vatRateBp: 1350 },
        { modifierId: 'b', name: 'Extra shot', unitPriceMinor: 60n, vatRateBp: 1350 },
        { modifierId: 'c', name: 'Extra shot', unitPriceMinor: 60n, vatRateBp: 1350 },
      ]),
    ).toBe('Oat milk · Extra shot ×2')
  })
})
