/**
 * `decide` — the command side of the order aggregate (ADR 0007).
 *
 * It turns an operator intent (`OrderCommand`) into the event(s) to append, or a `DomainError` if
 * the intent is invalid against the current state. It is the *only* place an order event is minted
 * from an intent. Purity holds by taking time and ids through `ctx` — `decide` reads no clock and
 * generates no id (non-negotiable: no `Date.now()` / randomness in `packages/domain`).
 *
 * The validity guarantee is structural: `decide` shapes the candidate event, then folds it through
 * `reduce`. If `reduce` rejects, `decide` returns that error instead of the event — so `decide` can
 * never emit an event `reduce` would throw on. That property is asserted in the tests, and it is why
 * there is a single source of validation truth for the aggregate.
 */

import type { Currency } from '../money'
import { err, ok, type DomainError, type Result } from '../result'
import type { FulfilmentMode, VatRateBp } from '../vat'
import type { DiscountAppliedPayload, LineModifier, OrderEvent, TenderMethod } from './events'
import { OrderReductionError, reduce } from './reduce'
import type { OrderState } from './state'

/** The ambient facts a command needs to become an event — supplied, never read from the clock. */
export interface DecideContext {
  /** Client-generated UUIDv7 for the event being minted. */
  readonly eventId: string
  /** The order id. For `OpenOrder` this is the new order's id. */
  readonly aggregateId: string
  /** Device clock, ISO 8601 — copied onto the event's `occurredAt`. */
  readonly occurredAt: string
}

export type OrderCommand =
  | { readonly type: 'OpenOrder'; readonly currency?: Currency; readonly fulfilment: FulfilmentMode; readonly staffId?: string }
  | {
      readonly type: 'AddLine'
      readonly productId: string
      readonly name: string
      readonly quantity: bigint
      readonly unitPriceMinor: bigint
      readonly vatRateBp: VatRateBp
      readonly fulfilment: FulfilmentMode
      readonly modifiers?: readonly LineModifier[]
    }
  | { readonly type: 'VoidLine'; readonly lineId: string; readonly quantity?: bigint; readonly reason?: string }
  | { readonly type: 'ApplyDiscount'; readonly discount: DiscountAppliedPayload }
  | {
      readonly type: 'Tender'
      readonly tenderId: string
      readonly method: TenderMethod
      readonly amountMinor: bigint
      readonly tenderedMinor?: bigint
      readonly changeMinor?: bigint
    }
  | { readonly type: 'CloseOrder' }
  | { readonly type: 'RefundOrder'; readonly refundId: string; readonly amountMinor: bigint; readonly reason?: string }

export type OrderCommandType = OrderCommand['type']

function assertNeverCommand(command: never): never {
  throw new TypeError(`unhandled command: ${JSON.stringify(command)}`)
}

/** Shape a command into its event. No domain validation here — that is `reduce`'s job, run below. */
function build(command: OrderCommand, ctx: DecideContext): OrderEvent {
  const envelope = { eventId: ctx.eventId, aggregateId: ctx.aggregateId, occurredAt: ctx.occurredAt }
  switch (command.type) {
    case 'OpenOrder':
      return {
        ...envelope,
        eventType: 'OrderOpened',
        payload: {
          currency: command.currency ?? 'EUR',
          fulfilment: command.fulfilment,
          ...(command.staffId !== undefined ? { staffId: command.staffId } : {}),
        },
      }
    case 'AddLine':
      return {
        ...envelope,
        eventType: 'LineAdded',
        payload: {
          productId: command.productId,
          name: command.name,
          quantity: command.quantity,
          unitPriceMinor: command.unitPriceMinor,
          vatRateBp: command.vatRateBp,
          fulfilment: command.fulfilment,
          modifiers: command.modifiers ?? [],
        },
      }
    case 'VoidLine':
      return {
        ...envelope,
        eventType: 'LineVoided',
        payload: {
          lineId: command.lineId,
          ...(command.quantity !== undefined ? { quantity: command.quantity } : {}),
          ...(command.reason !== undefined ? { reason: command.reason } : {}),
        },
      }
    case 'ApplyDiscount':
      return { ...envelope, eventType: 'DiscountApplied', payload: command.discount }
    case 'Tender':
      return {
        ...envelope,
        eventType: 'OrderTendered',
        payload: {
          tenderId: command.tenderId,
          method: command.method,
          amountMinor: command.amountMinor,
          ...(command.tenderedMinor !== undefined ? { tenderedMinor: command.tenderedMinor } : {}),
          ...(command.changeMinor !== undefined ? { changeMinor: command.changeMinor } : {}),
        },
      }
    case 'CloseOrder':
      return { ...envelope, eventType: 'OrderClosed', payload: {} }
    case 'RefundOrder':
      return {
        ...envelope,
        eventType: 'OrderRefunded',
        payload: {
          refundId: command.refundId,
          amountMinor: command.amountMinor,
          ...(command.reason !== undefined ? { reason: command.reason } : {}),
        },
      }
    default:
      return assertNeverCommand(command)
  }
}

/**
 * Decide the event(s) for a command against current state. Returns `ok(events)` or `err(DomainError)`
 * — never throws for an invalid command. The emitted events are guaranteed to fold cleanly through
 * `reduce` (they were just checked against it).
 */
export function decide(
  state: OrderState | null,
  command: OrderCommand,
  ctx: DecideContext,
): Result<OrderEvent[], DomainError> {
  const event = build(command, ctx)
  try {
    reduce(state, event)
  } catch (e) {
    if (e instanceof OrderReductionError) return err({ code: e.code, message: e.message })
    throw e // a non-domain error is a real bug, not a rejected command.
  }
  return ok([event])
}
