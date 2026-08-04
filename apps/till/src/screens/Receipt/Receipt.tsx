/**
 * Screen 4 — Receipt (task 6, on-screen only). Rendered from the just-closed order's `totals`/`lines`
 * — the same numbers the till showed at tender, never recomputed. Physical printing is a later
 * sprint (SPEC "Deliberately left undesigned: receipt options"); this is on-screen only, noted below.
 */

import { useEffect, useState } from 'react'
import type { OrderTotals, VatRateBp } from '@batch/domain'
import type { OrderLineView } from '../../order-ops'
import { formatEuroMinor } from '../../format'
import { Header, type HeaderProps } from '../../components/Header'
import { CheckIcon } from '../../icons'
import './Receipt.css'

export interface ClosedOrderSnapshot {
  readonly lines: readonly OrderLineView[]
  readonly totals: OrderTotals
  readonly closedAt: Date
}

export interface ReceiptProps {
  readonly snapshot: ClosedOrderSnapshot
  readonly headerProps: HeaderProps
  readonly onNewSale: () => void
}

function formatVatRate(vatRateBp: VatRateBp): string {
  return `${(vatRateBp / 100).toFixed(1)}%`
}

export function Receipt({ snapshot, headerProps, onNewSale }: ReceiptProps): JSX.Element {
  const [showConfirmation, setShowConfirmation] = useState(true)

  useEffect(() => {
    const t = setTimeout(() => setShowConfirmation(false), 2000)
    return () => clearTimeout(t)
  }, [])

  const { lines, totals, closedAt } = snapshot

  return (
    <div className="receipt-screen">
      <Header {...headerProps} />
      {showConfirmation && (
        <div className="sale-recorded-pill" role="status">
          <CheckIcon size={16} />
          Sale recorded
        </div>
      )}
      <div className="receipt-body">
        <div className="receipt-card">
          <div className="receipt-lines">
            {lines.map((line) => (
              <div className="receipt-line" key={line.lineId}>
                <div className="receipt-line-main">
                  <span className="receipt-line-name">
                    {line.quantity.toString()}× {line.name}
                  </span>
                  {line.modifierSummary && <span className="receipt-line-mods">{line.modifierSummary}</span>}
                </div>
                <span className="receipt-line-price tnum">{formatEuroMinor(line.lineTotalMinor)}</span>
              </div>
            ))}
          </div>

          <div className="receipt-divider" />

          <div className="receipt-row">
            <span>Subtotal</span>
            <span className="tnum">{formatEuroMinor(totals.subtotalMinor)}</span>
          </div>
          <div className="receipt-row receipt-row--total">
            <span>Total</span>
            <span className="tnum">{formatEuroMinor(totals.totalMinor)}</span>
          </div>

          <div className="receipt-divider" />

          <div className="receipt-vat">
            <span className="receipt-vat-heading">VAT breakdown</span>
            {totals.vatByBand.map((band) => (
              <div className="receipt-row receipt-row--small" key={band.vatRateBp}>
                <span>
                  {formatVatRate(band.vatRateBp)} on {formatEuroMinor(band.netMinor)}
                </span>
                <span className="tnum">{formatEuroMinor(band.vatMinor)}</span>
              </div>
            ))}
          </div>

          <div className="receipt-divider" />

          <div className="receipt-row">
            <span>Cash tendered</span>
            <span className="tnum">{formatEuroMinor(totals.cashTenderedMinor)}</span>
          </div>
          <div className="receipt-row">
            <span>Change</span>
            <span className="tnum">{formatEuroMinor(totals.changeMinor)}</span>
          </div>

          <div className="receipt-meta">
            {closedAt.toLocaleString('en-IE', { dateStyle: 'medium', timeStyle: 'short' })}
          </div>
          <div className="receipt-print-note">Printing arrives in a later sprint — this receipt is on-screen only.</div>
        </div>

        <button type="button" className="new-sale" onClick={onNewSale}>
          New sale
        </button>
      </div>
    </div>
  )
}
