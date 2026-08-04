import { computeTotals, reduce, shift, type OrderEvent, type OrderState } from '@batch/domain'
import {
  SyncEventSchema,
  toWire,
  type SyncHighWaterResponse,
  type SyncPullResponse,
  type SyncPulledEvent,
  type SyncRequestInput,
  type SyncResponse,
  type SyncResult,
} from '@batch/schemas'
import type { AggregateType } from '@batch/schemas'
import type { DeviceIdentity, SyncTransport } from './types'

/**
 * An in-process stand-in for the sync server, used by the device-test proxies. It reproduces the
 * three server guarantees the till depends on — exactly-once by `(tenantId, eventId)`, a reducer-based
 * total check, and per-device high-water / down-pull — over the SAME `@batch/domain` reducer the real
 * server uses. It is NOT imported from `apps/api` (apps don't import each other); it re-derives the
 * contract, and the real server is verified separately (apps/api suite + the real-API integration).
 */

interface StoredEvent {
  readonly seq: bigint
  readonly tenantId: string
  readonly deviceId: string
  readonly eventId: string
  readonly aggregateType: AggregateType
  readonly aggregateId: string
  readonly event: OrderEvent | shift.ShiftEvent
}

export class FakeServer {
  private readonly log: StoredEvent[] = []
  private seq = 0n
  private readonly seen = new Map<string, bigint>() // `${tenantId}|${eventId}` -> seq

  private key(tenantId: string, eventId: string): string {
    return `${tenantId}|${eventId}`
  }

  private replayOrder(tenantId: string, aggregateId: string): OrderState | null {
    let state: OrderState | null = null
    for (const row of this.log) {
      if (row.tenantId === tenantId && row.aggregateId === aggregateId && row.aggregateType === 'order') {
        state = reduce(state, row.event as OrderEvent)
      }
    }
    return state
  }

  private replayShift(tenantId: string, aggregateId: string): shift.ShiftState | null {
    let state: shift.ShiftState | null = null
    for (const row of this.log) {
      if (row.tenantId === tenantId && row.aggregateId === aggregateId && row.aggregateType === 'shift') {
        state = shift.reduce(state, row.event as shift.ShiftEvent)
      }
    }
    return state
  }

  post(identity: DeviceIdentity, batch: SyncRequestInput): SyncResponse {
    const results: SyncResult[] = []
    for (const rawItem of batch.events) {
      const item = SyncEventSchema.parse(rawItem)
      const { event, aggregateType, expectedTotalMinor } = item
      const seenSeq = this.seen.get(this.key(identity.tenantId, event.eventId))
      if (seenSeq !== undefined) {
        results.push({ eventId: event.eventId, seq: seenSeq.toString(), status: 'duplicate' })
        continue
      }
      // Branch by aggregate exactly as the real server does (apps/api/src/sync/service.ts): orders are
      // reduced + total-checked; shifts are reduced for their lifecycle invariants but carry no total;
      // ledger has no reducer yet.
      if (aggregateType === 'order') {
        let next: OrderState
        try {
          next = reduce(this.replayOrder(identity.tenantId, event.aggregateId), event as OrderEvent)
        } catch {
          results.push({ eventId: event.eventId, seq: null, status: 'rejected', error: 'INVALID_EVENT' })
          continue
        }
        if (expectedTotalMinor !== undefined && computeTotals(next).totalMinor !== expectedTotalMinor) {
          results.push({ eventId: event.eventId, seq: null, status: 'rejected', error: 'TOTAL_MISMATCH' })
          continue
        }
      } else if (aggregateType === 'shift') {
        try {
          shift.reduce(this.replayShift(identity.tenantId, event.aggregateId), event as shift.ShiftEvent)
        } catch {
          results.push({ eventId: event.eventId, seq: null, status: 'rejected', error: 'INVALID_EVENT' })
          continue
        }
      } else {
        results.push({ eventId: event.eventId, seq: null, status: 'rejected', error: 'UNSUPPORTED_AGGREGATE' })
        continue
      }
      this.seq += 1n
      this.log.push({
        seq: this.seq,
        tenantId: identity.tenantId,
        deviceId: identity.deviceId,
        eventId: event.eventId,
        aggregateType,
        aggregateId: event.aggregateId,
        event,
      })
      this.seen.set(this.key(identity.tenantId, event.eventId), this.seq)
      results.push({ eventId: event.eventId, seq: this.seq.toString(), status: 'accepted' })
    }
    return { results }
  }

  highWater(identity: DeviceIdentity): SyncHighWaterResponse {
    const mine = this.log.filter(
      (r) => r.tenantId === identity.tenantId && r.deviceId === identity.deviceId,
    )
    const maxSeq = mine.reduce<bigint | null>((m, r) => (m === null || r.seq > m ? r.seq : m), null)
    return { maxSeq: maxSeq === null ? null : maxSeq.toString(), eventCount: mine.length }
  }

  pull(identity: DeviceIdentity, afterSeq: string, limit: number): SyncPullResponse {
    const after = BigInt(afterSeq)
    const mine = this.log
      .filter((r) => r.tenantId === identity.tenantId && r.deviceId === identity.deviceId && r.seq > after)
      .sort((a, b) => (a.seq < b.seq ? -1 : 1))
    const page = mine.slice(0, limit)
    const events: SyncPulledEvent[] = page.map((r) => ({
      seq: r.seq.toString(),
      aggregateType: r.aggregateType,
      event: toWire(r.event) as SyncPulledEvent['event'],
    }))
    const last = page.at(-1)
    const nextAfterSeq = last && mine.length > page.length ? last.seq.toString() : null
    return { events, nextAfterSeq }
  }

  /** Total rows stored — for asserting exactly-once across the whole log in tests. */
  get size(): number {
    return this.log.length
  }

  /** A transport bound to one device. `isOnline()` false makes every call throw, modelling airplane mode. */
  transportFor(identity: DeviceIdentity, isOnline: () => boolean = () => true): SyncTransport {
    const guard = () => {
      if (!isOnline()) throw new Error('offline')
    }
    return {
      postEvents: (batch) => {
        guard()
        return Promise.resolve(this.post(identity, batch))
      },
      getHighWater: () => {
        guard()
        return Promise.resolve(this.highWater(identity))
      },
      pullEvents: (afterSeq, limit = 500) => {
        guard()
        return Promise.resolve(this.pull(identity, afterSeq, limit))
      },
    }
  }
}
