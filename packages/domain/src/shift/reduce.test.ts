import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import type {
  CashDeclaredPayload,
  CashMovementPayload,
  ShiftClosedPayload,
  ShiftEvent,
  ShiftOpenedPayload,
} from './events'
import { reduce, reduceShift, ShiftReductionError } from './reduce'
import { decide, type DecideContext, type ShiftCommand } from './decide'
import type { ShiftState } from './state'

const SID = 'shift-1'
const OCC = '2026-08-04T08:00:00.000Z'

// --- Typed event builders ---------------------------------------------------------------------

function opened(eventId = 's-open', p: Partial<ShiftOpenedPayload> = {}): ShiftEvent {
  return {
    eventId,
    aggregateId: SID,
    occurredAt: OCC,
    eventType: 'ShiftOpened',
    payload: { deviceId: 'device-A', openedByStaffId: 'staff-1', currency: 'EUR', ...p },
  }
}

function declared(eventId: string, p: Partial<CashDeclaredPayload> = {}): ShiftEvent {
  return {
    eventId,
    aggregateId: SID,
    occurredAt: OCC,
    eventType: 'CashDeclared',
    payload: { purpose: 'OPENING_FLOAT', countSeq: 0n, denominations: [], countedMinor: 0n, ...p },
  }
}

function movement(
  eventId: string,
  eventType: 'PaidIn' | 'PaidOut' | 'Skim' | 'SafeDrop',
  p: Partial<CashMovementPayload> = {},
): ShiftEvent {
  return {
    eventId,
    aggregateId: SID,
    occurredAt: OCC,
    eventType,
    payload: { movementId: `mv-${eventId}`, amountMinor: 500n, reason: 'petty cash', authStaffId: 'staff-1', ...p },
  }
}

function closed(eventId: string, p: Partial<ShiftClosedPayload> = {}): ShiftEvent {
  return {
    eventId,
    aggregateId: SID,
    occurredAt: OCC,
    eventType: 'ShiftClosed',
    payload: {
      zNumber: 'device-A-1',
      closedByStaffId: 'staff-1',
      finalCountSeq: 1n,
      varianceMinor: 0n,
      reasonCodes: [],
      authorised: true,
      ...p,
    },
  }
}

// --- Example / lifecycle tests ----------------------------------------------------------------

describe('shift happy path', () => {
  it('opens, floats, pays out, counts, and closes', () => {
    const events = [
      opened(),
      declared('s-1', { purpose: 'OPENING_FLOAT', countSeq: 0n, countedMinor: 15000n }),
      movement('s-2', 'PaidOut', { amountMinor: 2000n, reason: 'milk run' }),
      declared('s-3', { purpose: 'COUNT', countSeq: 1n, countedMinor: 13000n }),
      closed('s-4', { finalCountSeq: 1n }),
    ]
    const state = reduceShift(events)
    expect(state.status).toBe('CLOSED')
    expect(state.openingFloatMinor).toBe(15000n)
    expect(state.movements).toHaveLength(1)
    expect(state.maxCountSeq).toBe(1n)
    expect(state.zNumber).toBe('device-A-1')
  })

  it('handover moves the drawer holder without closing', () => {
    const state = reduceShift([
      opened(),
      { ...opened('s-h'), eventType: 'ShiftHandover', payload: { fromStaffId: 'staff-1', toStaffId: 'staff-2' } } as ShiftEvent,
    ])
    expect(state.status).toBe('OPEN')
    expect(state.currentStaffId).toBe('staff-2')
  })
})

describe('shift lifecycle guards', () => {
  it('rejects any event before ShiftOpened', () => {
    expect(() => reduceShift([declared('s-1')])).toThrowError(/SHIFT_NOT_OPENED/)
  })

  it('rejects a second ShiftOpened', () => {
    expect(() => reduceShift([opened('a'), opened('b')])).toThrowError(/ALREADY_OPEN/)
  })

  it('rejects a duplicate event id, not silently absorbing it', () => {
    const dup = movement('same', 'PaidIn')
    expect(() => reduceShift([opened(), dup, dup])).toThrowError(/DUPLICATE_EVENT/)
  })

  it('rejects a second opening float', () => {
    const events = [
      opened(),
      declared('s-1', { purpose: 'OPENING_FLOAT', countSeq: 0n, countedMinor: 10000n }),
      declared('s-2', { purpose: 'OPENING_FLOAT', countSeq: 0n, countedMinor: 5000n }),
    ]
    expect(() => reduceShift(events)).toThrowError(/FLOAT_ALREADY_DECLARED/)
  })

  it('rejects a movement with no reason', () => {
    expect(() => reduceShift([opened(), movement('s-1', 'PaidOut', { reason: '   ' })])).toThrowError(
      /REASON_REQUIRED/,
    )
  })

  it('rejects a non-positive movement amount', () => {
    expect(() => reduceShift([opened(), movement('s-1', 'PaidIn', { amountMinor: 0n })])).toThrowError(
      /BAD_AMOUNT/,
    )
  })

  it('rejects a denomination breakdown that does not total countedMinor', () => {
    const bad = declared('s-1', {
      purpose: 'OPENING_FLOAT',
      countSeq: 0n,
      denominations: [{ denominationMinor: 500n, count: 3n }], // 1500
      countedMinor: 1000n,
    })
    expect(() => reduceShift([opened(), bad])).toThrowError(/DENOMINATION_MISMATCH/)
  })

  it('accepts the single-total fallback: empty denominations with a non-zero counted total', () => {
    const state = reduceShift([
      opened(),
      declared('s-1', { purpose: 'OPENING_FLOAT', countSeq: 0n, denominations: [], countedMinor: 12345n }),
    ])
    expect(state.openingFloatMinor).toBe(12345n)
  })

  it('accepts a denomination breakdown that totals countedMinor exactly', () => {
    const state = reduceShift([
      opened(),
      declared('s-1', {
        purpose: 'OPENING_FLOAT',
        countSeq: 0n,
        denominations: [
          { denominationMinor: 500n, count: 4n }, // 2000
          { denominationMinor: 200n, count: 5n }, // 1000
        ],
        countedMinor: 3000n,
      }),
    ])
    expect(state.openingFloatMinor).toBe(3000n)
  })

  it('rejects a COUNT that does not advance the sequence', () => {
    const events = [
      opened(),
      declared('s-1', { purpose: 'COUNT', countSeq: 1n, countedMinor: 100n }),
      declared('s-2', { purpose: 'COUNT', countSeq: 1n, countedMinor: 100n }),
    ]
    expect(() => reduceShift(events)).toThrowError(/BAD_COUNT/)
  })

  it('refuses to close without a committed COUNT', () => {
    const events = [
      opened(),
      declared('s-1', { purpose: 'OPENING_FLOAT', countSeq: 0n, countedMinor: 10000n }),
      closed('s-2'),
    ]
    expect(() => reduceShift(events)).toThrowError(/NO_COUNT_BEFORE_CLOSE/)
  })

  it('carries the caller-supplied variance snapshot onto the closed state', () => {
    const state = reduceShift([
      opened(),
      declared('s-1', { purpose: 'COUNT', countSeq: 1n, countedMinor: 9800n }),
      closed('s-2', { finalCountSeq: 1n, varianceMinor: -2000n, reasonCodes: ['TILL_ERROR'], authorised: false }),
    ])
    expect(state.varianceMinor).toBe(-2000n)
    expect(state.reasonCodes).toEqual(['TILL_ERROR'])
    expect(state.authorised).toBe(false)
  })
})

describe('Z-seal: nothing folds after ShiftClosed', () => {
  const sealed: ShiftEvent[] = [
    opened(),
    declared('s-1', { purpose: 'COUNT', countSeq: 1n, countedMinor: 100n }),
    closed('s-2', { finalCountSeq: 1n }),
  ]

  it('rejects a second ShiftClosed (Z runs once)', () => {
    expect(() => reduceShift([...sealed, closed('s-3', { zNumber: 'device-A-2' })])).toThrowError(
      /SHIFT_CLOSED/,
    )
  })

  it('rejects a cash movement after close', () => {
    expect(() => reduceShift([...sealed, movement('s-3', 'PaidIn')])).toThrowError(/SHIFT_CLOSED/)
  })

  it('rejects a further count after close', () => {
    expect(() =>
      reduceShift([...sealed, declared('s-3', { purpose: 'COUNT', countSeq: 2n, countedMinor: 100n })]),
    ).toThrowError(/SHIFT_CLOSED/)
  })
})

describe('blind-count integrity (structural)', () => {
  it('CashDeclared payloads carry no expected* field — nothing to leak (runtime)', () => {
    const ev = declared('s-1', { purpose: 'COUNT', countSeq: 1n, countedMinor: 5000n })
    const keys = Object.keys(ev.payload)
    expect(keys.some((k) => k.toLowerCase().startsWith('expected'))).toBe(false)
    expect(keys.sort()).toEqual(['countSeq', 'countedMinor', 'denominations', 'purpose'])
  })

  it('CashDeclaredPayload has no expected* key (type level)', () => {
    // If a field named `expected…` were ever added to the payload, this line stops compiling.
    type NoExpected = Extract<keyof CashDeclaredPayload, `expected${string}`> extends never
      ? true
      : false
    const _noExpected: NoExpected = true
    expect(_noExpected).toBe(true)
  })
})

// --- Model-based property tests ---------------------------------------------------------------

type Action =
  | { t: 'float'; countedMinor: bigint }
  | { t: 'count'; countedMinor: bigint }
  | { t: 'move'; kind: 'PaidIn' | 'PaidOut' | 'Skim' | 'SafeDrop'; amountMinor: bigint }
  | { t: 'handover' }
  | { t: 'close' }

const ctx = (aggregateId: string, eventId: string): DecideContext => ({ eventId, aggregateId, occurredAt: OCC })

/** Turn random actions into a stream of only-ever-valid events by routing each through `decide`. */
function buildScenario(actions: Action[]): { events: ShiftEvent[]; final: ShiftState } {
  let n = 0
  const events: ShiftEvent[] = []
  // A holder object rather than a bare `let` — reassignment inside the `apply` closure otherwise
  // narrows the outer `state` to `never` (see the same pattern in order/reduce.test.ts).
  const box: { state: ShiftState | null } = { state: null }
  let staff = 1

  const apply = (command: ShiftCommand): void => {
    const result = decide(box.state, command, ctx(SID, `evt-${n++}`))
    if (!result.ok) return // skip commands invalid against the running state
    for (const ev of result.value) {
      box.state = reduce(box.state, ev)
      events.push(ev)
    }
  }

  apply({ type: 'OpenShift', deviceId: 'device-A', openedByStaffId: 'staff-1' })

  for (const a of actions) {
    const s = box.state
    if (s === null || s.status === 'CLOSED') break
    switch (a.t) {
      case 'float':
        if (!s.floatDeclared) apply({ type: 'DeclareFloat', denominations: [], countedMinor: a.countedMinor })
        break
      case 'count':
        apply({ type: 'RecordCount', denominations: [], countedMinor: a.countedMinor })
        break
      case 'move':
        apply({
          type: a.kind === 'PaidIn' ? 'PayIn' : a.kind === 'PaidOut' ? 'PayOut' : a.kind,
          movementId: `mv-${n}`,
          amountMinor: a.amountMinor,
          reason: 'reason',
          authStaffId: 'staff-1',
        })
        break
      case 'handover': {
        const to = `staff-${++staff}`
        apply({ type: 'HandOver', fromStaffId: s.currentStaffId, toStaffId: to })
        break
      }
      case 'close':
        if (s.counts.some((c) => c.purpose === 'COUNT')) {
          apply({
            type: 'CloseShift',
            zNumber: 'device-A-1',
            closedByStaffId: s.currentStaffId,
            finalCountSeq: s.maxCountSeq,
            varianceMinor: 0n,
            reasonCodes: [],
            authorised: true,
          })
        }
        break
    }
  }

  // state is non-null: the stream always opens with ShiftOpened.
  if (box.state === null) throw new Error('unreachable: shift never opened')
  return { events, final: box.state }
}

const amountArb = fc.bigInt({ min: 1n, max: 5000n })
const actionArb: fc.Arbitrary<Action> = fc.oneof(
  fc.record({ t: fc.constant('float' as const), countedMinor: fc.bigInt({ min: 0n, max: 30000n }) }),
  fc.record({ t: fc.constant('count' as const), countedMinor: fc.bigInt({ min: 0n, max: 30000n }) }),
  fc.record({
    t: fc.constant('move' as const),
    kind: fc.constantFrom('PaidIn' as const, 'PaidOut' as const, 'Skim' as const, 'SafeDrop' as const),
    amountMinor: amountArb,
  }),
  fc.record({ t: fc.constant('handover' as const) }),
  fc.record({ t: fc.constant('close' as const) }),
)

describe('invariants over random valid streams', () => {
  it('is a deterministic fold — incremental equals all-at-once (replay = projection)', () => {
    fc.assert(
      fc.property(fc.array(actionArb, { maxLength: 25 }), (actions) => {
        const { events } = buildScenario(actions)
        let state: ShiftState | null = null
        for (const e of events) state = reduce(state, e)
        expect(state).toEqual(reduceShift(events))
      }),
      { numRuns: 1000 },
    )
  })

  it('never produces a negative opening float or a corrupted movement fold', () => {
    fc.assert(
      fc.property(fc.array(actionArb, { maxLength: 25 }), (actions) => {
        const { final } = buildScenario(actions)
        expect(final.openingFloatMinor >= 0n).toBe(true)
        for (const m of final.movements) expect(m.amountMinor > 0n).toBe(true)
        expect(final.maxCountSeq >= 0n).toBe(true)
      }),
      { numRuns: 1000 },
    )
  })

  it('once closed, no further event folds', () => {
    fc.assert(
      fc.property(fc.array(actionArb, { maxLength: 25 }), (actions) => {
        const { events, final } = buildScenario(actions)
        if (final.status !== 'CLOSED') return
        const extra = movement('extra', 'PaidIn')
        expect(() => reduceShift([...events, extra])).toThrowError(/SHIFT_CLOSED|DUPLICATE_EVENT/)
      }),
      { numRuns: 1000 },
    )
  })
})

// --- Command/event split (ADR 0007) guarantee -------------------------------------------------

describe('decide (command → events)', () => {
  it('returns an error (never throws) for an invalid command', () => {
    const state = reduceShift([opened()])
    // A close with no committed count is invalid.
    const result = decide(
      state,
      {
        type: 'CloseShift',
        zNumber: 'device-A-1',
        closedByStaffId: 'staff-1',
        finalCountSeq: 0n,
        varianceMinor: 0n,
        reasonCodes: [],
        authorised: true,
      },
      ctx(SID, 'c-1'),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('NO_COUNT_BEFORE_CLOSE')
  })

  type CommandSpec =
    | { k: 'float' }
    | { k: 'count' }
    | { k: 'payIn' }
    | { k: 'payOut'; reason: string }
    | { k: 'close' }

  const commandArb: fc.Arbitrary<CommandSpec> = fc.oneof(
    fc.constant({ k: 'float' as const }),
    fc.constant({ k: 'count' as const }),
    fc.constant({ k: 'payIn' as const }),
    fc.record({ k: fc.constant('payOut' as const), reason: fc.string() }),
    fc.constant({ k: 'close' as const }),
  )

  function toCommand(spec: CommandSpec, state: ShiftState): ShiftCommand {
    switch (spec.k) {
      case 'float':
        return { type: 'DeclareFloat', denominations: [], countedMinor: 10000n }
      case 'count':
        return { type: 'RecordCount', denominations: [], countedMinor: 9000n }
      case 'payIn':
        return { type: 'PayIn', movementId: 'm', amountMinor: 500n, reason: 'r', authStaffId: 's' }
      case 'payOut':
        return { type: 'PayOut', movementId: 'm', amountMinor: 500n, reason: spec.reason, authStaffId: 's' }
      case 'close':
        return {
          type: 'CloseShift',
          zNumber: 'device-A-1',
          closedByStaffId: state.currentStaffId,
          finalCountSeq: state.maxCountSeq,
          varianceMinor: 0n,
          reasonCodes: [],
          authorised: true,
        }
    }
  }

  it('never emits an event that reduce throws on', () => {
    fc.assert(
      fc.property(fc.array(actionArb, { maxLength: 15 }), commandArb, (actions, spec) => {
        const { final } = buildScenario(actions)
        const command = toCommand(spec, final)
        const result = decide(final, command, ctx(SID, 'cmd-evt'))
        if (result.ok) {
          let s: ShiftState | null = final
          for (const ev of result.value) {
            expect(() => {
              s = reduce(s, ev)
            }).not.toThrow()
          }
        }
      }),
      { numRuns: 1000 },
    )
  })

  it('a rejected command carries a ShiftReductionError code', () => {
    const state = reduceShift([opened()])
    const result = decide(
      state,
      { type: 'PayOut', movementId: 'm', amountMinor: 0n, reason: 'x', authStaffId: 's' },
      ctx(SID, 'c-1'),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('BAD_AMOUNT')
    // Sanity: the same event thrown directly is a ShiftReductionError.
    expect(() => reduce(state, movement('c-1', 'PaidOut', { amountMinor: 0n }))).toThrow(ShiftReductionError)
  })
})
