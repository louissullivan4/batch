/**
 * SPEC "Order pane" line row + void flow. Void is always a visible 48×48 button (never
 * swipe-to-reveal — wet/gloved hands fail swipe gestures). Tapping it turns the row itself into an
 * inline confirm strip that auto-reverts after 5s of no input; nothing else on screen is blocked
 * while it's showing (it's row-local state, not a modal).
 */

import { memo, useEffect, useState } from 'react'
import { formatEuroMinor } from '../../format'
import type { OrderLineView } from '../../order-ops'
import './OrderLineRow.css'

const CONFIRM_TIMEOUT_MS = 5000

export interface OrderLineRowProps {
  readonly line: OrderLineView
  readonly onTapBody: (line: OrderLineView) => void
  readonly onVoid: (lineId: string) => void
}

function OrderLineRowImpl({ line, onTapBody, onVoid }: OrderLineRowProps): JSX.Element {
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (!confirming) return
    const t = setTimeout(() => setConfirming(false), CONFIRM_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [confirming])

  if (confirming) {
    return (
      <div className="order-line order-line--confirm">
        <span className="order-line-confirm-text">Remove {line.name}?</span>
        <div className="order-line-confirm-actions">
          <button type="button" className="btn-destructive" onClick={() => onVoid(line.lineId)}>
            Remove
          </button>
          <button type="button" className="btn-keep" onClick={() => setConfirming(false)}>
            Keep
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="order-line" onClick={() => onTapBody(line)}>
      <span className="order-line-qty tnum">{line.quantity.toString()}×</span>
      <div className="order-line-main">
        <span className="order-line-name">{line.name}</span>
        {line.modifierSummary && <span className="order-line-mods">{line.modifierSummary}</span>}
      </div>
      <span className="order-line-price tnum">{formatEuroMinor(line.lineTotalMinor)}</span>
      <button
        type="button"
        className="order-line-void"
        aria-label={`Remove ${line.name}`}
        onClick={(e) => {
          e.stopPropagation()
          setConfirming(true)
        }}
      >
        ×
      </button>
    </div>
  )
}

export const OrderLineRow = memo(OrderLineRowImpl)
