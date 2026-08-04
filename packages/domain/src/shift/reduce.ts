/**
 * The shift reducer (ADR 0010). One function, imported by both the till and the API, so a drawer
 * position computed on a tablet and the position re-derived on the server come from identical code.
 *
 * Rules enforced here:
 *  - The first event must be `ShiftOpened`; nothing mutates a non-existent shift.
 *  - A second `ShiftOpened` is rejected — a device has at most one open shift.
 *  - Replaying an event id already folded is **rejected**, not silently absorbed.
 *  - `ShiftClosed` is terminal: **every** event after it is rejected (the Z-seal is a replay
 *    invariant, not a UI guard).
 *  - The reducer is exhaustive over event types: the `default` branch is a compile error the day a
 *    new shift event is added without a case here.
 */

import type { CashCount, CashMovement, ShiftState } from './state'
import type {
  CashDeclaredPayload,
  CashMovementPayload,
  CashMovementType,
  ShiftClosedPayload,
  ShiftEvent,
  ShiftOpenedPayload,
} from './events'

export class ShiftReductionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    // Prefix the stable code so it shows up in logs and error matchers, not just on `.code`.
    super(`${code}: ${message}`)
    this.name = 'ShiftReductionError'
  }
}

function fail(code: string, message: string): never {
  throw new ShiftReductionError(code, message)
}

function assertNever(event: never): never {
  throw new ShiftReductionError('UNHANDLED_EVENT', `unhandled event: ${JSON.stringify(event)}`)
}

function openShift(
  event: Extract<ShiftEvent, { eventType: 'ShiftOpened' }>,
  payload: ShiftOpenedPayload,
): ShiftState {
  return {
    shiftId: event.aggregateId,
    status: 'OPEN',
    deviceId: payload.deviceId,
    currency: payload.currency,
    openedByStaffId: payload.openedByStaffId,
    currentStaffId: payload.openedByStaffId,
    openedAt: event.occurredAt,
    openingFloatMinor: 0n,
    floatDeclared: false,
    maxCountSeq: 0n,
    counts: [],
    movements: [],
    appliedEventIds: new Set([event.eventId]),
  }
}

/** Copy `state`, apply `patch`, and record `eventId` as folded. */
function commit(state: ShiftState, eventId: string, patch: Partial<ShiftState>): ShiftState {
  const appliedEventIds = new Set(state.appliedEventIds)
  appliedEventIds.add(eventId)
  return { ...state, ...patch, appliedEventIds }
}

/** Blind-count integrity: when denominations are given they must total `countedMinor` to the cent. */
function validateDenominations(payload: CashDeclaredPayload): void {
  if (payload.countedMinor < 0n) {
    fail('BAD_COUNT', `countedMinor must be >= 0, got ${payload.countedMinor}`)
  }
  if (payload.denominations.length === 0) return // single-total fallback path
  let sum = 0n
  for (const d of payload.denominations) {
    if (d.denominationMinor < 0n) {
      fail('BAD_COUNT', `denominationMinor must be >= 0, got ${d.denominationMinor}`)
    }
    if (d.count < 0n) fail('BAD_COUNT', `denomination count must be >= 0, got ${d.count}`)
    sum += d.denominationMinor * d.count
  }
  if (sum !== payload.countedMinor) {
    fail(
      'DENOMINATION_MISMATCH',
      `denominations total ${sum} but countedMinor is ${payload.countedMinor}`,
    )
  }
}

function declareCash(state: ShiftState, eventId: string, payload: CashDeclaredPayload): ShiftState {
  validateDenominations(payload)
  const count: CashCount = {
    purpose: payload.purpose,
    countSeq: payload.countSeq,
    denominations: payload.denominations.map((d) => ({
      denominationMinor: d.denominationMinor,
      count: d.count,
    })),
    countedMinor: payload.countedMinor,
  }

  if (payload.purpose === 'OPENING_FLOAT') {
    if (payload.countSeq !== 0n) {
      fail('BAD_COUNT', `OPENING_FLOAT must carry countSeq 0, got ${payload.countSeq}`)
    }
    if (state.floatDeclared) fail('FLOAT_ALREADY_DECLARED', 'the opening float is already declared')
    return commit(state, eventId, {
      openingFloatMinor: payload.countedMinor,
      floatDeclared: true,
      counts: [...state.counts, count],
    })
  }

  // COUNT
  if (payload.countSeq < 1n) fail('BAD_COUNT', `COUNT must carry countSeq >= 1, got ${payload.countSeq}`)
  if (payload.countSeq <= state.maxCountSeq) {
    fail(
      'BAD_COUNT',
      `COUNT countSeq must exceed the last (${state.maxCountSeq}), got ${payload.countSeq}`,
    )
  }
  return commit(state, eventId, {
    counts: [...state.counts, count],
    maxCountSeq: payload.countSeq,
  })
}

function recordMovement(
  state: ShiftState,
  eventId: string,
  kind: CashMovementType,
  payload: CashMovementPayload,
): ShiftState {
  if (payload.amountMinor <= 0n) {
    fail('BAD_AMOUNT', `${kind} amount must be > 0, got ${payload.amountMinor}`)
  }
  if (payload.reason.trim() === '') fail('REASON_REQUIRED', `${kind} requires a non-empty reason`)
  const movement: CashMovement = {
    movementId: payload.movementId,
    kind,
    amountMinor: payload.amountMinor,
    reason: payload.reason,
    authStaffId: payload.authStaffId,
  }
  return commit(state, eventId, { movements: [...state.movements, movement] })
}

function closeShift(state: ShiftState, eventId: string, payload: ShiftClosedPayload): ShiftState {
  const hasCount = state.counts.some((c) => c.purpose === 'COUNT')
  if (!hasCount) fail('NO_COUNT_BEFORE_CLOSE', 'a shift cannot close without a committed drawer count')
  return commit(state, eventId, {
    status: 'CLOSED',
    zNumber: payload.zNumber,
    closedByStaffId: payload.closedByStaffId,
    finalCountSeq: payload.finalCountSeq,
    varianceMinor: payload.varianceMinor,
    reasonCodes: [...payload.reasonCodes],
    authorised: payload.authorised,
  })
}

export function reduce(state: ShiftState | null, event: ShiftEvent): ShiftState {
  if (event.eventType === 'ShiftOpened') {
    if (state !== null) fail('ALREADY_OPEN', `shift ${event.aggregateId} is already open`)
    return openShift(event, event.payload)
  }

  if (state === null) {
    fail('SHIFT_NOT_OPENED', `${event.eventType} arrived before ShiftOpened`)
  }
  if (state.appliedEventIds.has(event.eventId)) {
    fail('DUPLICATE_EVENT', `event ${event.eventId} has already been applied`)
  }
  // The Z-seal: once closed, the aggregate is terminal and rejects every further event.
  if (state.status === 'CLOSED') {
    fail('SHIFT_CLOSED', `${event.eventType} rejected: shift ${state.shiftId} is closed (Z-sealed)`)
  }

  switch (event.eventType) {
    case 'CashDeclared':
      return declareCash(state, event.eventId, event.payload)
    case 'PaidIn':
      return recordMovement(state, event.eventId, 'PaidIn', event.payload)
    case 'PaidOut':
      return recordMovement(state, event.eventId, 'PaidOut', event.payload)
    case 'Skim':
      return recordMovement(state, event.eventId, 'Skim', event.payload)
    case 'SafeDrop':
      return recordMovement(state, event.eventId, 'SafeDrop', event.payload)
    case 'ShiftHandover':
      return commit(state, event.eventId, { currentStaffId: event.payload.toStaffId })
    case 'ShiftClosed':
      return closeShift(state, event.eventId, event.payload)
    default:
      return assertNever(event)
  }
}

/** Fold a full event stream into shift state. Rejects an empty stream. */
export function reduceShift(events: readonly ShiftEvent[]): ShiftState {
  let state: ShiftState | null = null
  for (const event of events) state = reduce(state, event)
  if (state === null) fail('EMPTY_STREAM', 'a shift stream must contain at least ShiftOpened')
  return state
}
