/**
 * Shift command → `OutgoingEvent` builders (ADR 0010) — mirrors `order.ts`. Every command is run
 * through the shared `shift.decide`, so the events built here are exactly the ones the server
 * re-derives (non-negotiable #6); this file adds no shift domain logic of its own, only client-side
 * plumbing (id/time generation and the denomination→countedMinor total).
 *
 * `decide` cannot fail for any command this module builds from validated screen state (amounts are
 * always > 0, reasons always non-empty, etc. before a screen calls these) — a rejection here is a
 * client bug, not an expected user error, so it throws `ShiftCommandError` rather than returning a
 * `Result` a second time.
 */

import { shift } from '@batch/domain'
import { uuidv7 } from './sync'
import type { OutgoingEvent } from './sync'

const now = (): string => new Date().toISOString()

export class ShiftCommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`)
    this.name = 'ShiftCommandError'
  }
}

/** The shift-path narrowing of `OutgoingEvent` — mirrors `OutgoingOrderEvent` in `sync/outbox.ts`. */
export interface OutgoingShiftEvent extends OutgoingEvent {
  readonly event: shift.ShiftEvent
}

function decideOne(
  state: shift.ShiftState | null,
  shiftId: string,
  command: shift.ShiftCommand,
): OutgoingShiftEvent {
  const ctx: shift.DecideContext = { eventId: uuidv7(), aggregateId: shiftId, occurredAt: now() }
  const result = shift.decide(state, command, ctx)
  if (!result.ok) throw new ShiftCommandError(result.error.code, result.error.message)
  const event = result.value[0]
  if (!event) throw new ShiftCommandError('NO_EVENT', 'decide returned no event for a valid command')
  return { aggregateType: 'shift', event }
}

/** Σ `denominationMinor * count` — all `bigint` (ADR 0010, root CLAUDE.md non-negotiable #1). */
export function sumDenominationsMinor(denominations: readonly shift.DenominationCount[]): bigint {
  return shift.sumDenominations(denominations)
}

export interface OpenShiftInput {
  readonly deviceId: string
  readonly openedByStaffId: string
  readonly denominations: readonly shift.DenominationCount[]
  readonly countedMinor: bigint
}

/**
 * Open a shift and declare its opening float as one atomic pair — `ShiftOpened` then
 * `CashDeclared(OPENING_FLOAT)`. Screen 1 always commits both together (SPEC: "Open shift" only
 * enables once a non-zero float is on screen), so there is no valid "opened but unfloated" state to
 * expose separately here.
 */
export function openShiftOps(
  input: OpenShiftInput,
): { readonly shiftId: string; readonly outgoing: readonly [OutgoingShiftEvent, OutgoingShiftEvent] } {
  const shiftId = uuidv7()
  const opened = decideOne(null, shiftId, {
    type: 'OpenShift',
    deviceId: input.deviceId,
    openedByStaffId: input.openedByStaffId,
  })
  const openedState = shift.reduce(null, opened.event)
  const floated = decideOne(openedState, shiftId, {
    type: 'DeclareFloat',
    denominations: input.denominations,
    countedMinor: input.countedMinor,
  })
  return { shiftId, outgoing: [opened, floated] }
}

/**
 * Record a drawer count — the opening declaration's sibling for screen 3 (blind count). `countSeq`
 * is derived by `decide` from `state.maxCountSeq`, never passed in, so a recount always gets the next
 * sequence regardless of what the caller thinks it is (ADR 0010).
 */
export function recordCountOps(
  state: shift.ShiftState,
  denominations: readonly shift.DenominationCount[],
  countedMinor: bigint,
): OutgoingShiftEvent {
  return decideOne(state, state.shiftId, { type: 'RecordCount', denominations, countedMinor })
}

export type MovementKind = 'PayIn' | 'PayOut' | 'Skim' | 'SafeDrop'

export interface MovementInput {
  readonly amountMinor: bigint
  readonly reason: string
  readonly authStaffId: string
}

/** One of the four cash-movement commands (screen 2). Always a single event. */
export function movementOps(state: shift.ShiftState, kind: MovementKind, input: MovementInput): OutgoingShiftEvent {
  return decideOne(state, state.shiftId, { type: kind, movementId: uuidv7(), ...input })
}

/** PIN-swap handover (Decided-but-not-framed section): drawer stays open, no count. */
export function handoverOps(state: shift.ShiftState, fromStaffId: string, toStaffId: string): OutgoingShiftEvent {
  return decideOne(state, state.shiftId, { type: 'HandOver', fromStaffId, toStaffId })
}

export interface CloseShiftInput {
  readonly zNumber: string
  readonly closedByStaffId: string
  readonly finalCountSeq: bigint
  readonly varianceMinor: bigint
  readonly reasonCodes: readonly string[]
  readonly authorised: boolean
}

/** The terminal Z-read (screen 5's hold-to-confirm). Seals the aggregate — see `reduce.ts`. */
export function closeShiftOps(state: shift.ShiftState, input: CloseShiftInput): OutgoingShiftEvent {
  return decideOne(state, state.shiftId, { type: 'CloseShift', ...input })
}
