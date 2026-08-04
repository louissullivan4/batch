/**
 * Screen 1 — Order entry (SPEC "Screen 1"). Header + category tabs + 4×5 menu grid (zero scroll,
 * top 20 items) + persistent order pane, with the modifier sheet opening as an overlay above the
 * tabs/grid only — the order pane stays visible at all times (SPEC Screen 2: "the running total is
 * never hidden"). That's a deliberate reading of the reference PNG: the screenshot's sheet also
 * covers most of the pane's width, leaving only a sliver visible; SPEC.md is the authoritative
 * contract ("the order pane remains visible at the right edge") and is implemented here literally —
 * the pane column sits outside the scrimmed region entirely rather than peeking through it.
 */

import { memo, useCallback, useMemo, useState } from 'react'
import type { UseOrder } from '../../useOrder'
import type { OrderLineView } from '../../order-ops'
import { MENU, defaultSelection, hasOptions, type MenuItem, type ModifierSelection } from '../../menu/menu'
import { findMenuItem, selectionFromModifiers } from '../../menu/lineToSelection'
import { formatEuroMinor } from '../../format'
import { recordLatency } from '../../perf'
import { Header, type HeaderProps } from '../../components/Header'
import { CategoryTabs } from './CategoryTabs'
import { MenuTile } from './MenuTile'
import { OrderLineRow } from './OrderLineRow'
import { ModifierSheet, type SheetState } from '../ModifierSheet/ModifierSheet'
import './OrderEntry.css'

// Cold-start → first-tap (apps/till/CLAUDE.md budget <3s) is recorded exactly once, at the first
// tile tap this session — `performance.now()` is already relative to `performance.timeOrigin`
// (module evaluation / navigation start), so this captures launch-to-first-successful-action.
let coldStartRecorded = false
function markFirstInteraction(): void {
  if (coldStartRecorded) return
  coldStartRecorded = true
  recordLatency('coldStart', performance.now())
}

export interface OrderEntryProps {
  readonly order: UseOrder
  readonly headerProps: HeaderProps
  readonly onCharge: () => void
  readonly onToast: (message: string) => void
}

function quantityByProduct(lines: readonly OrderLineView[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const line of lines) {
    map.set(line.productId, (map.get(line.productId) ?? 0) + Number(line.quantity))
  }
  return map
}

function OrderEntryImpl({ order, headerProps, onCharge, onToast }: OrderEntryProps): JSX.Element {
  const [selectedCategoryId, setSelectedCategoryId] = useState(MENU.categories[0]?.id ?? '')
  const [sheet, setSheet] = useState<SheetState | null>(null)

  const category = MENU.categories.find((c) => c.id === selectedCategoryId) ?? MENU.categories[0]
  const tiles = useMemo(() => (category ? category.items.slice(0, 20) : []), [category])
  const quantities = useMemo(() => quantityByProduct(order.lines), [order.lines])

  const handleAdd = useCallback(
    (item: MenuItem) => {
      markFirstInteraction()
      if (hasOptions(MENU, item)) {
        setSheet({ mode: 'add', item, selection: defaultSelection(MENU, item) })
      } else {
        order.addItem(item)
      }
    },
    [order],
  )

  const handleAddDefaults = useCallback(
    (item: MenuItem) => {
      markFirstInteraction()
      order.addItem(item, defaultSelection(MENU, item))
    },
    [order],
  )

  const handleOutOfStock = useCallback(
    (item: MenuItem) => {
      markFirstInteraction()
      onToast(`${item.name} is marked out of stock`)
    },
    [onToast],
  )

  const handleLineTap = useCallback(
    (line: OrderLineView) => {
      const item = findMenuItem(MENU, line.productId)
      if (!item) return
      setSheet({ mode: 'edit', item, lineId: line.lineId, selection: selectionFromModifiers(MENU, item, line.modifiers) })
    },
    [],
  )

  const closeSheet = useCallback(() => setSheet(null), [])

  const handleSheetConfirm = useCallback(
    (item: MenuItem, selection: ModifierSelection) => {
      if (sheet?.mode === 'edit') {
        order.replaceLine(sheet.lineId, item, selection)
      } else {
        order.addItem(item, selection)
      }
      setSheet(null)
    },
    [order, sheet],
  )

  const handleRemoveLine = useCallback(() => {
    if (sheet?.mode === 'edit') order.voidLine(sheet.lineId)
    setSheet(null)
  }, [order, sheet])

  const totalMinor = order.totals?.totalMinor ?? 0n
  const chargeDisabled = order.isEmpty

  return (
    <div className="order-entry">
      <Header {...headerProps} />
      <div className="order-entry-body">
        <div className="order-entry-menu">
          {category && (
            <CategoryTabs categories={MENU.categories} selectedId={category.id} onSelect={setSelectedCategoryId} />
          )}
          <div className="menu-grid">
            {tiles.map((item) => (
              <MenuTile
                key={item.productId}
                item={item}
                quantityInOrder={quantities.get(item.productId) ?? 0}
                onAdd={handleAdd}
                onAddDefaults={handleAddDefaults}
                onOutOfStock={handleOutOfStock}
              />
            ))}
          </div>

          {sheet && (
            <div className="sheet-scrim" onClick={closeSheet}>
              <div onClick={(e) => e.stopPropagation()}>
                <ModifierSheet state={sheet} onCancel={closeSheet} onConfirm={handleSheetConfirm} onRemoveLine={handleRemoveLine} onToast={onToast} />
              </div>
            </div>
          )}
        </div>

        <div className="order-pane">
          <div className="order-pane-lines">
            {order.isEmpty ? (
              <p className="order-pane-empty">Tap an item to start an order.</p>
            ) : (
              order.lines.map((line) => <OrderLineRow key={line.lineId} line={line} onTapBody={handleLineTap} onVoid={order.voidLine} />)
            )}
          </div>
          <div className="order-pane-footer">
            <div className="order-pane-total">
              <span>Total</span>
              <span className="tnum">{formatEuroMinor(totalMinor)}</span>
            </div>
            <button
              type="button"
              className="order-pane-charge"
              disabled={chargeDisabled}
              onClick={() => {
                markFirstInteraction()
                onCharge()
              }}
            >
              Charge {formatEuroMinor(totalMinor)}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export const OrderEntry = memo(OrderEntryImpl)
