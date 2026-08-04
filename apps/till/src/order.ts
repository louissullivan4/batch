import {
  computeTotals,
  reduceOrder,
  type FulfilmentMode,
  type LineModifier,
  type OrderEvent,
  type VatRateBp,
} from '@batch/domain'
import { uuidv7 } from './sync'
import type { OutgoingEvent } from './sync'

/**
 * Builds order events on the till, using the SAME `@batch/domain` reducer the server uses to check
 * them (non-negotiable #6). Prices and VAT are snapshotted onto each line at build time (#2), and the
 * tender's `expectedTotalMinor` is derived by replaying the order through the shared reducer — so the
 * server re-derives the identical number or rejects.
 */

const now = (): string => new Date().toISOString()

export function openOrder(input: { fulfilment: FulfilmentMode; staffId?: string }): {
  orderId: string
  outgoing: OutgoingEvent
} {
  const orderId = uuidv7()
  const event: OrderEvent = {
    eventId: uuidv7(),
    aggregateId: orderId,
    occurredAt: now(),
    eventType: 'OrderOpened',
    payload: { currency: 'EUR', fulfilment: input.fulfilment, ...(input.staffId ? { staffId: input.staffId } : {}) },
  }
  return { orderId, outgoing: { aggregateType: 'order', event } }
}

export function addLine(
  orderId: string,
  line: {
    productId: string
    name: string
    quantity: bigint
    unitPriceMinor: bigint
    vatRateBp: VatRateBp
    fulfilment: FulfilmentMode
    modifiers?: readonly LineModifier[]
  },
): OutgoingEvent {
  const event: OrderEvent = {
    eventId: uuidv7(),
    aggregateId: orderId,
    occurredAt: now(),
    eventType: 'LineAdded',
    payload: { ...line, modifiers: line.modifiers ?? [] },
  }
  return { aggregateType: 'order', event }
}

/**
 * Void some or all of a line (ADR 0008). `quantity` omitted voids every still-active unit; the line
 * id equals the `LineAdded` event's id. Reason is free text (e.g. "customer changed mind").
 */
export function voidLine(
  orderId: string,
  lineId: string,
  opts: { quantity?: bigint; reason?: string } = {},
): OutgoingEvent {
  const event: OrderEvent = {
    eventId: uuidv7(),
    aggregateId: orderId,
    occurredAt: now(),
    eventType: 'LineVoided',
    payload: {
      lineId,
      ...(opts.quantity !== undefined ? { quantity: opts.quantity } : {}),
      ...(opts.reason !== undefined ? { reason: opts.reason } : {}),
    },
  }
  return { aggregateType: 'order', event }
}

/** Close a fully-tendered order (A-007) — the terminal event of a completed sale. */
export function closeOrder(orderId: string): OutgoingEvent {
  const event: OrderEvent = {
    eventId: uuidv7(),
    aggregateId: orderId,
    occurredAt: now(),
    eventType: 'OrderClosed',
    payload: {},
  }
  return { aggregateType: 'order', event }
}

/** Replay the order so far and return its current total — the display total and the tender check. */
export function orderTotalMinor(events: readonly OrderEvent[]): bigint {
  return computeTotals(reduceOrder(events)).totalMinor
}

/**
 * Tender the full balance in cash. `expectedTotalMinor` is computed from the prior events via the
 * shared reducer, so the server can verify it.
 */
export function tenderCash(
  orderId: string,
  priorEvents: readonly OrderEvent[],
  input: { tenderedMinor: bigint },
): OutgoingEvent {
  const totalMinor = orderTotalMinor(priorEvents)
  const event: OrderEvent = {
    eventId: uuidv7(),
    aggregateId: orderId,
    occurredAt: now(),
    eventType: 'OrderTendered',
    payload: {
      tenderId: uuidv7(),
      method: 'CASH',
      amountMinor: totalMinor,
      tenderedMinor: input.tenderedMinor,
      changeMinor: input.tenderedMinor - totalMinor,
    },
  }
  return { aggregateType: 'order', event, expectedTotalMinor: totalMinor }
}
