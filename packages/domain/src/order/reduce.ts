/**
 * The order reducer. One function, imported by both the till and the API, so a total computed on a
 * tablet and the total re-derived on the server come from identical code.
 *
 * Rules enforced here:
 *  - The first event must be `OrderOpened`; nothing mutates a non-existent order.
 *  - Replaying an event id already folded is **rejected**, not silently absorbed (idempotency at
 *    the sync layer is separate — that one no-ops on the DB constraint).
 *  - `event_log` is append-only; there is no path that edits history. Corrections are compensating
 *    events (`LineVoided`, `OrderRefunded`).
 *  - The reducer is exhaustive over event types: the `default` branch is a compile error the day a
 *    new event is added without a case here.
 */

import type { DiscountAppliedPayload, OrderEvent, OrderOpenedPayload } from './events'
import type { OrderDiscount, OrderLine, OrderState } from './state'
import { computeTotals } from './totals'

export class OrderReductionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    // Prefix the stable code so it shows up in logs and error matchers, not just on `.code`.
    super(`${code}: ${message}`)
    this.name = 'OrderReductionError'
  }
}

function fail(code: string, message: string): never {
  throw new OrderReductionError(code, message)
}

function assertNever(event: never): never {
  throw new OrderReductionError('UNHANDLED_EVENT', `unhandled event: ${JSON.stringify(event)}`)
}

function requireOpen(state: OrderState, eventType: string): void {
  if (state.status !== 'OPEN') {
    fail('ORDER_NOT_OPEN', `${eventType} requires an OPEN order, but status is ${state.status}`)
  }
}

function openOrder(
  event: Extract<OrderEvent, { eventType: 'OrderOpened' }>,
  payload: OrderOpenedPayload,
): OrderState {
  return {
    orderId: event.aggregateId,
    status: 'OPEN',
    currency: payload.currency,
    fulfilment: payload.fulfilment,
    openedAt: event.occurredAt,
    staffId: payload.staffId,
    lines: [],
    discounts: [],
    tenders: [],
    refunds: [],
    appliedEventIds: new Set([event.eventId]),
  }
}

/** Apply `fn` to the line with `lineId`, or reject if there is no such line. */
function mapLine(
  state: OrderState,
  lineId: string,
  fn: (line: OrderLine) => OrderLine,
): readonly OrderLine[] {
  let found = false
  const lines = state.lines.map((line) => {
    if (line.lineId !== lineId) return line
    found = true
    return fn(line)
  })
  if (!found) fail('LINE_NOT_FOUND', `no line ${lineId} on order ${state.orderId}`)
  return lines
}

function toDiscount(payload: DiscountAppliedPayload): OrderDiscount {
  if (payload.kind === 'PERCENT') {
    if (!Number.isInteger(payload.rateBp) || payload.rateBp < 0 || payload.rateBp > 10000) {
      fail('BAD_DISCOUNT', `percent discount rateBp must be in [0, 10000], got ${payload.rateBp}`)
    }
    return {
      discountId: payload.discountId,
      name: payload.name,
      kind: 'PERCENT',
      rateBp: payload.rateBp,
    }
  }
  if (payload.amountMinor < 0n) {
    fail('BAD_DISCOUNT', `amount discount must be non-negative, got ${payload.amountMinor}`)
  }
  return {
    discountId: payload.discountId,
    name: payload.name,
    kind: 'AMOUNT',
    amountMinor: payload.amountMinor,
  }
}

/** Copy `state`, apply `patch`, and record `eventId` as folded. */
function commit(state: OrderState, eventId: string, patch: Partial<OrderState>): OrderState {
  const appliedEventIds = new Set(state.appliedEventIds)
  appliedEventIds.add(eventId)
  return { ...state, ...patch, appliedEventIds }
}

export function reduce(state: OrderState | null, event: OrderEvent): OrderState {
  if (event.eventType === 'OrderOpened') {
    if (state !== null) fail('ALREADY_OPEN', `order ${event.aggregateId} is already open`)
    return openOrder(event, event.payload)
  }

  if (state === null) {
    fail('ORDER_NOT_OPENED', `${event.eventType} arrived before OrderOpened`)
  }
  if (state.appliedEventIds.has(event.eventId)) {
    fail('DUPLICATE_EVENT', `event ${event.eventId} has already been applied`)
  }

  switch (event.eventType) {
    case 'LineAdded': {
      requireOpen(state, 'LineAdded')
      const p = event.payload
      if (p.quantity < 1n) fail('BAD_QUANTITY', `line quantity must be >= 1, got ${p.quantity}`)
      if (p.unitPriceMinor < 0n)
        fail('BAD_PRICE', `unit price must be >= 0, got ${p.unitPriceMinor}`)
      for (const mod of p.modifiers) {
        if (mod.unitPriceMinor < 0n)
          fail('BAD_PRICE', `modifier price must be >= 0, got ${mod.unitPriceMinor}`)
      }
      const line: OrderLine = {
        lineId: event.eventId,
        productId: p.productId,
        name: p.name,
        quantity: p.quantity,
        unitPriceMinor: p.unitPriceMinor,
        vatRateBp: p.vatRateBp,
        fulfilment: p.fulfilment,
        modifiers: p.modifiers.map((m) => ({
          modifierId: m.modifierId,
          name: m.name,
          unitPriceMinor: m.unitPriceMinor,
          vatRateBp: m.vatRateBp,
        })),
        voidedQuantity: 0n,
      }
      return commit(state, event.eventId, { lines: [...state.lines, line] })
    }

    case 'LineVoided': {
      requireOpen(state, 'LineVoided')
      const p = event.payload
      const lines = mapLine(state, p.lineId, (line) => {
        const remaining = line.quantity - line.voidedQuantity
        if (remaining <= 0n) fail('ALREADY_VOIDED', `line ${p.lineId} is already fully voided`)
        const toVoid = p.quantity ?? remaining
        if (toVoid < 1n) fail('BAD_VOID_QUANTITY', `void quantity must be >= 1, got ${toVoid}`)
        if (toVoid > remaining) {
          fail(
            'VOID_EXCEEDS_ACTIVE',
            `cannot void ${toVoid} of ${remaining} active unit(s) on line ${p.lineId}`,
          )
        }
        return { ...line, voidedQuantity: line.voidedQuantity + toVoid }
      })
      return commit(state, event.eventId, { lines })
    }

    case 'DiscountApplied': {
      requireOpen(state, 'DiscountApplied')
      return commit(state, event.eventId, {
        discounts: [...state.discounts, toDiscount(event.payload)],
      })
    }

    case 'OrderTendered': {
      requireOpen(state, 'OrderTendered')
      const p = event.payload
      if (p.amountMinor <= 0n) fail('BAD_TENDER', `tender amount must be > 0, got ${p.amountMinor}`)
      return commit(state, event.eventId, {
        tenders: [
          ...state.tenders,
          {
            tenderId: p.tenderId,
            method: p.method,
            amountMinor: p.amountMinor,
            tenderedMinor: p.tenderedMinor,
            changeMinor: p.changeMinor,
          },
        ],
      })
    }

    case 'OrderClosed': {
      requireOpen(state, 'OrderClosed')
      const balance = computeTotals(state).balanceMinor
      if (balance > 0n) fail('UNPAID', `cannot close: ${balance} minor units still outstanding`)
      return commit(state, event.eventId, { status: 'CLOSED' })
    }

    case 'OrderRefunded': {
      if (state.status !== 'CLOSED') {
        fail('NOT_CLOSED', `refund requires a CLOSED order, but status is ${state.status}`)
      }
      const p = event.payload
      if (p.amountMinor <= 0n) fail('BAD_REFUND', `refund amount must be > 0, got ${p.amountMinor}`)
      return commit(state, event.eventId, {
        status: 'REFUNDED',
        refunds: [
          ...state.refunds,
          { refundId: p.refundId, amountMinor: p.amountMinor, reason: p.reason },
        ],
      })
    }

    default:
      return assertNever(event)
  }
}

/** Fold a full event stream into order state. Rejects an empty stream. */
export function reduceOrder(events: readonly OrderEvent[]): OrderState {
  let state: OrderState | null = null
  for (const event of events) state = reduce(state, event)
  if (state === null) fail('EMPTY_STREAM', 'an order stream must contain at least OrderOpened')
  return state
}
