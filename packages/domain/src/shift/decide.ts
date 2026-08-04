/**
 * `decide` — the command side of the shift aggregate (ADR 0007, ADR 0010).
 *
 * It turns an operator intent (`ShiftCommand`) into the event(s) to append, or a `DomainError` if
 * the intent is invalid against the current state. Purity holds by taking time and ids through
 * `ctx` — `decide` reads no clock and generates no id.
 *
 * The validity guarantee is structural, exactly as on the order aggregate: `decide` shapes the
 * candidate event, folds it through `reduce`, and returns the error instead of the event if `reduce`
 * rejects. So `decide` can never emit an event `reduce` would throw on — asserted in the tests.
 *
 * One deviation from `order/decide.ts`: `build` takes `state`, because a `RecordCount`'s `countSeq`
 * is `maxCountSeq + 1` — a function of prior counts. Everything else the caller supplies (the
 * `zNumber`, `varianceMinor` and `finalCountSeq` on close are computed by the caller from its local
 * store and the order aggregate, per ADR 0010).
 */

import type { Currency } from '../money'
import { err, ok, type DomainError, type Result } from '../result'
import type { DenominationCount, ShiftEvent } from './events'
import { ShiftReductionError, reduce } from './reduce'
import type { ShiftState } from './state'

/** The ambient facts a command needs to become an event — supplied, never read from the clock. */
export interface DecideContext {
  /** Client-generated UUIDv7 for the event being minted. */
  readonly eventId: string
  /** The shift id. For `OpenShift` this is the new shift's id. */
  readonly aggregateId: string
  /** Device clock, ISO 8601 — copied onto the event's `occurredAt`. */
  readonly occurredAt: string
}

export type ShiftCommand =
  | {
      readonly type: 'OpenShift'
      readonly deviceId: string
      readonly openedByStaffId: string
      readonly currency?: Currency
    }
  | {
      readonly type: 'DeclareFloat'
      readonly denominations: readonly DenominationCount[]
      readonly countedMinor: bigint
    }
  | {
      readonly type: 'RecordCount'
      readonly denominations: readonly DenominationCount[]
      readonly countedMinor: bigint
    }
  | { readonly type: 'PayIn'; readonly movementId: string; readonly amountMinor: bigint; readonly reason: string; readonly authStaffId: string }
  | { readonly type: 'PayOut'; readonly movementId: string; readonly amountMinor: bigint; readonly reason: string; readonly authStaffId: string }
  | { readonly type: 'Skim'; readonly movementId: string; readonly amountMinor: bigint; readonly reason: string; readonly authStaffId: string }
  | { readonly type: 'SafeDrop'; readonly movementId: string; readonly amountMinor: bigint; readonly reason: string; readonly authStaffId: string }
  | { readonly type: 'HandOver'; readonly fromStaffId: string; readonly toStaffId: string }
  | {
      readonly type: 'CloseShift'
      readonly zNumber: string
      readonly closedByStaffId: string
      readonly finalCountSeq: bigint
      readonly varianceMinor: bigint
      readonly reasonCodes: readonly string[]
      readonly authorised: boolean
    }

export type ShiftCommandType = ShiftCommand['type']

function assertNeverCommand(command: never): never {
  throw new TypeError(`unhandled command: ${JSON.stringify(command)}`)
}

/** Shape a command into its event. No domain validation here — that is `reduce`'s job, run below. */
function build(state: ShiftState | null, command: ShiftCommand, ctx: DecideContext): ShiftEvent {
  const envelope = { eventId: ctx.eventId, aggregateId: ctx.aggregateId, occurredAt: ctx.occurredAt }
  switch (command.type) {
    case 'OpenShift':
      return {
        ...envelope,
        eventType: 'ShiftOpened',
        payload: {
          deviceId: command.deviceId,
          openedByStaffId: command.openedByStaffId,
          currency: command.currency ?? 'EUR',
        },
      }
    case 'DeclareFloat':
      return {
        ...envelope,
        eventType: 'CashDeclared',
        payload: {
          purpose: 'OPENING_FLOAT',
          countSeq: 0n,
          denominations: command.denominations,
          countedMinor: command.countedMinor,
        },
      }
    case 'RecordCount':
      return {
        ...envelope,
        eventType: 'CashDeclared',
        payload: {
          purpose: 'COUNT',
          // Successive counts are 1, 2, … — the next sequence after the last committed count.
          countSeq: (state?.maxCountSeq ?? 0n) + 1n,
          denominations: command.denominations,
          countedMinor: command.countedMinor,
        },
      }
    case 'PayIn':
      return { ...envelope, eventType: 'PaidIn', payload: movementPayload(command) }
    case 'PayOut':
      return { ...envelope, eventType: 'PaidOut', payload: movementPayload(command) }
    case 'Skim':
      return { ...envelope, eventType: 'Skim', payload: movementPayload(command) }
    case 'SafeDrop':
      return { ...envelope, eventType: 'SafeDrop', payload: movementPayload(command) }
    case 'HandOver':
      return {
        ...envelope,
        eventType: 'ShiftHandover',
        payload: { fromStaffId: command.fromStaffId, toStaffId: command.toStaffId },
      }
    case 'CloseShift':
      return {
        ...envelope,
        eventType: 'ShiftClosed',
        payload: {
          zNumber: command.zNumber,
          closedByStaffId: command.closedByStaffId,
          finalCountSeq: command.finalCountSeq,
          varianceMinor: command.varianceMinor,
          reasonCodes: command.reasonCodes,
          authorised: command.authorised,
        },
      }
    default:
      return assertNeverCommand(command)
  }
}

function movementPayload(command: {
  readonly movementId: string
  readonly amountMinor: bigint
  readonly reason: string
  readonly authStaffId: string
}): { readonly movementId: string; readonly amountMinor: bigint; readonly reason: string; readonly authStaffId: string } {
  return {
    movementId: command.movementId,
    amountMinor: command.amountMinor,
    reason: command.reason,
    authStaffId: command.authStaffId,
  }
}

/**
 * Decide the event(s) for a command against current state. Returns `ok(events)` or `err(DomainError)`
 * — never throws for an invalid command. The emitted events are guaranteed to fold cleanly through
 * `reduce` (they were just checked against it).
 */
export function decide(
  state: ShiftState | null,
  command: ShiftCommand,
  ctx: DecideContext,
): Result<ShiftEvent[], DomainError> {
  const event = build(state, command, ctx)
  try {
    reduce(state, event)
  } catch (e) {
    if (e instanceof ShiftReductionError) return err({ code: e.code, message: e.message })
    throw e // a non-domain error is a real bug, not a rejected command.
  }
  return ok([event])
}
