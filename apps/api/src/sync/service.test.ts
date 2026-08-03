import { describe, it, expect } from 'vitest'
import type { OrderEvent } from '@batch/domain'
import type { SyncRequest } from '@batch/schemas'
import { processSyncBatch, type AppendResult, type SyncStore } from './service'

const OID = '0190b4c2-1e3a-7c8d-8f2a-1b2c3d4e5f60'
const OCC = '2026-08-03T10:00:00.000Z'
const DEVICE = '0190b4c2-1e3a-7000-8000-0000000000de'

// In-memory store that mimics the unique (tenant_id, event_id) constraint for a single tenant.
class FakeStore implements SyncStore {
  private seq = 0n
  private byEventId = new Map<string, { seq: bigint; event: OrderEvent; aggregateType: string }>()
  private order: { seq: bigint; event: OrderEvent; type: string; id: string }[] = []

  async loadAggregateEvents(aggregateType: string, aggregateId: string): Promise<OrderEvent[]> {
    return this.order
      .filter((r) => r.type === aggregateType && r.id === aggregateId)
      .map((r) => r.event)
  }

  async findSeq(eventId: string): Promise<bigint | null> {
    return this.byEventId.get(eventId)?.seq ?? null
  }

  async append(
    event: OrderEvent,
    meta: { aggregateType: string; deviceId: string },
  ): Promise<AppendResult> {
    const existing = this.byEventId.get(event.eventId)
    if (existing) return { inserted: false, seq: existing.seq }
    this.seq += 1n
    const seq = this.seq
    this.byEventId.set(event.eventId, { seq, event, aggregateType: meta.aggregateType })
    this.order.push({ seq, event, type: meta.aggregateType, id: event.aggregateId })
    return { inserted: true, seq }
  }
}

function open(eventId: string): OrderEvent {
  return {
    eventId,
    aggregateId: OID,
    occurredAt: OCC,
    eventType: 'OrderOpened',
    payload: { currency: 'EUR', fulfilment: 'EAT_IN' },
  }
}

function line(eventId: string, unitPriceMinor: bigint): OrderEvent {
  return {
    eventId,
    aggregateId: OID,
    occurredAt: OCC,
    eventType: 'LineAdded',
    payload: {
      productId: 'flat-white',
      name: 'Flat White',
      quantity: 1n,
      unitPriceMinor,
      vatRateBp: 1350,
      fulfilment: 'EAT_IN',
    },
  }
}

function tender(eventId: string, amountMinor: bigint): OrderEvent {
  return {
    eventId,
    aggregateId: OID,
    occurredAt: OCC,
    eventType: 'OrderTendered',
    payload: {
      tenderId: 't',
      method: 'CASH',
      amountMinor,
      tenderedMinor: amountMinor,
      changeMinor: 0n,
    },
  }
}

function close(eventId: string): OrderEvent {
  return { eventId, aggregateId: OID, occurredAt: OCC, eventType: 'OrderClosed', payload: {} }
}

const order = (event: OrderEvent, expectedTotalMinor?: bigint) => ({
  aggregateType: 'order' as const,
  ...(expectedTotalMinor === undefined ? {} : { expectedTotalMinor }),
  event,
})

const req = (...events: SyncRequest['events']): SyncRequest => ({ events })

describe('processSyncBatch', () => {
  it('accepts a fresh order and assigns increasing seqs', async () => {
    const store = new FakeStore()
    const res = await processSyncBatch(
      store,
      DEVICE,
      req(
        order(open('e0')),
        order(line('e1', 500n)),
        order(tender('e2', 500n), 500n),
        order(close('e3')),
      ),
    )
    expect(res.results.map((r) => r.status)).toEqual([
      'accepted',
      'accepted',
      'accepted',
      'accepted',
    ])
    expect(res.results.map((r) => r.seq)).toEqual(['1', '2', '3', '4'])
  })

  it('is exactly-once: replaying the whole batch returns duplicates with the same seqs', async () => {
    const store = new FakeStore()
    const batch = req(
      order(open('e0')),
      order(line('e1', 500n)),
      order(tender('e2', 500n), 500n),
      order(close('e3')),
    )
    await processSyncBatch(store, DEVICE, batch)
    const res = await processSyncBatch(store, DEVICE, batch)
    expect(res.results.map((r) => r.status)).toEqual([
      'duplicate',
      'duplicate',
      'duplicate',
      'duplicate',
    ])
    expect(res.results.map((r) => r.seq)).toEqual(['1', '2', '3', '4'])
  })

  it('de-duplicates a repeat within a single batch', async () => {
    const store = new FakeStore()
    const res = await processSyncBatch(
      store,
      DEVICE,
      req(order(open('e0')), order(line('e1', 500n)), order(line('e1', 500n))),
    )
    expect(res.results.map((r) => r.status)).toEqual(['accepted', 'accepted', 'duplicate'])
    expect(res.results[2]!.seq).toBe('2')
  })

  it('rejects a client total that does not match the reducer', async () => {
    const store = new FakeStore()
    const res = await processSyncBatch(
      store,
      DEVICE,
      req(order(open('e0')), order(line('e1', 500n)), order(tender('e2', 500n), 999n)),
    )
    expect(res.results[2]!.status).toBe('rejected')
    expect(res.results[2]!.error).toContain('TOTAL_MISMATCH')
    expect(await store.findSeq('e2')).toBeNull() // not persisted
  })

  it('rejects an invalid event with its reducer code', async () => {
    const store = new FakeStore()
    const badModifier: OrderEvent = {
      eventId: 'e1',
      aggregateId: OID,
      occurredAt: OCC,
      eventType: 'ModifierApplied',
      payload: {
        lineId: 'missing',
        modifierId: 'm',
        name: 'Extra',
        unitPriceMinor: 50n,
        vatRateBp: 2300,
      },
    }
    const res = await processSyncBatch(store, DEVICE, req(order(open('e0')), order(badModifier)))
    expect(res.results[0]!.status).toBe('accepted')
    expect(res.results[1]!.status).toBe('rejected')
    expect(res.results[1]!.error).toBe('LINE_NOT_FOUND')
  })

  it('accepts events across batches by replaying prior state', async () => {
    const store = new FakeStore()
    await processSyncBatch(store, DEVICE, req(order(open('e0')), order(line('e1', 500n))))
    const res = await processSyncBatch(
      store,
      DEVICE,
      req(order(tender('e2', 500n), 500n), order(close('e3'))),
    )
    expect(res.results.map((r) => r.status)).toEqual(['accepted', 'accepted'])
    expect(res.results.map((r) => r.seq)).toEqual(['3', '4'])
  })

  it('rejects an unsupported aggregate type', async () => {
    const store = new FakeStore()
    const item = { aggregateType: 'ledger' as const, event: open('e0') }
    const res = await processSyncBatch(store, DEVICE, { events: [item] })
    expect(res.results[0]!.status).toBe('rejected')
    expect(res.results[0]!.error).toBe('UNSUPPORTED_AGGREGATE')
  })
})
