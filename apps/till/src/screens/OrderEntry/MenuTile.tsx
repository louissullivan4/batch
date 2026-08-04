/**
 * SPEC "Menu tile". Three redundant signals for "in order" (tint fill + accent border + count
 * badge) and for "86'd" (dimmed opacity + "86'd" caption replacing the price + still-tappable
 * toast) — colour never carries state alone (README global rule).
 *
 * Instruments tap→visual-response here (perf.ts `recordLatency('tapResponse', …)`, budget <100ms):
 * timed from the pointer-down that starts the gesture to the next painted frame after the tap's
 * state update lands, via `requestAnimationFrame`.
 */

import { memo, useCallback } from 'react'
import type { MenuItem } from '../../menu/menu'
import { formatEuroMinor } from '../../format'
import { useTileGesture } from '../../gestures'
import { recordLatency } from '../../perf'
import './MenuTile.css'

export interface MenuTileProps {
  readonly item: MenuItem
  readonly quantityInOrder: number
  readonly onAdd: (item: MenuItem) => void
  readonly onAddDefaults: (item: MenuItem) => void
  readonly onOutOfStock: (item: MenuItem) => void
}

function MenuTileImpl({ item, quantityInOrder, onAdd, onAddDefaults, onOutOfStock }: MenuTileProps): JSX.Element {
  const handleTap = useCallback(() => {
    const start = performance.now()
    if (item.outOfStock) onOutOfStock(item)
    else onAdd(item)
    requestAnimationFrame(() => recordLatency('tapResponse', performance.now() - start))
  }, [item, onAdd, onOutOfStock])

  const handleLongPress = useCallback(() => {
    if (item.outOfStock) {
      onOutOfStock(item)
      return
    }
    onAddDefaults(item)
  }, [item, onAddDefaults, onOutOfStock])

  const gesture = useTileGesture(handleTap, handleLongPress)
  const inOrder = quantityInOrder > 0

  return (
    <button
      type="button"
      className="menu-tile no-select"
      data-in-order={inOrder}
      data-out-of-stock={Boolean(item.outOfStock)}
      {...gesture}
    >
      <span className="menu-tile-name">{item.name}</span>
      {item.outOfStock ? (
        <span className="menu-tile-oos">86&apos;d</span>
      ) : (
        <span className="menu-tile-price tnum">{formatEuroMinor(item.priceMinor)}</span>
      )}
      {inOrder && <span className="menu-tile-badge tnum">{quantityInOrder}×</span>}
    </button>
  )
}

export const MenuTile = memo(MenuTileImpl)
