/** The projected state of an order, folded from its events. All money is `bigint` minor units. */

import type { Currency } from '../money'
import type { FulfilmentMode, VatRateBp } from '../vat'
import type { DiscountKind, TenderMethod } from './events'

export type OrderStatus = 'OPEN' | 'CLOSED' | 'REFUNDED'

export interface OrderModifier {
  readonly modifierId: string
  readonly name: string
  readonly unitPriceMinor: bigint
  readonly vatRateBp: VatRateBp
}

export interface OrderLine {
  /** Equal to the `LineAdded` event's id. */
  readonly lineId: string
  readonly productId: string
  readonly name: string
  readonly quantity: bigint
  readonly unitPriceMinor: bigint
  readonly vatRateBp: VatRateBp
  readonly fulfilment: FulfilmentMode
  readonly modifiers: readonly OrderModifier[]
  /** Units voided so far (ADR 0008). The active quantity is `quantity - voidedQuantity`. */
  readonly voidedQuantity: bigint
}

export interface OrderDiscount {
  readonly discountId: string
  readonly name: string
  readonly kind: DiscountKind
  readonly rateBp?: number
  readonly amountMinor?: bigint
}

export interface OrderTender {
  readonly tenderId: string
  readonly method: TenderMethod
  readonly amountMinor: bigint
  readonly tenderedMinor?: bigint
  readonly changeMinor?: bigint
}

export interface OrderRefund {
  readonly refundId: string
  readonly amountMinor: bigint
  readonly reason?: string
}

export interface OrderState {
  readonly orderId: string
  readonly status: OrderStatus
  readonly currency: Currency
  readonly fulfilment: FulfilmentMode
  readonly openedAt: string
  readonly staffId?: string
  readonly lines: readonly OrderLine[]
  readonly discounts: readonly OrderDiscount[]
  readonly tenders: readonly OrderTender[]
  readonly refunds: readonly OrderRefund[]
  /** Every event id folded so far — the reducer rejects a replay of any of them. */
  readonly appliedEventIds: ReadonlySet<string>
}
