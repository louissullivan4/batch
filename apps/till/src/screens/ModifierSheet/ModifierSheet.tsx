/**
 * Screen 2 — Modifier sheet (SPEC "Screen 2"). Draft selection lives entirely in local component
 * state and is only handed to `order.addItem` / `order.replaceLine` on Confirm — Cancel (or a scrim
 * tap, which is identical to Cancel) discards it silently, no confirmation dialog, because
 * recreating a modifier set is cheaper than reading one (SPEC).
 *
 * Groups are shape-encoded, never colour-encoded: single-select renders as a joined segmented bar
 * with a radio-circle glyph; multi-select as separate pill chips with a square-checkbox glyph.
 */

import { useState } from 'react'
import { itemGroups, linePreviewMinor, MENU, type MenuItem, type ModifierSelection } from '../../menu/menu'
import { formatDeltaMinor, formatEuroMinor } from '../../format'
import { CheckboxGlyph, RadioGlyph, XIcon } from '../../icons'
import './ModifierSheet.css'

export type SheetState =
  | { readonly mode: 'add'; readonly item: MenuItem; readonly selection: ModifierSelection }
  | { readonly mode: 'edit'; readonly item: MenuItem; readonly lineId: string; readonly selection: ModifierSelection }

export interface ModifierSheetProps {
  readonly state: SheetState
  readonly onCancel: () => void
  readonly onConfirm: (item: MenuItem, selection: ModifierSelection) => void
  readonly onRemoveLine: () => void
  readonly onToast: (message: string) => void
}

export function ModifierSheet({ state, onCancel, onConfirm, onRemoveLine, onToast }: ModifierSheetProps): JSX.Element {
  const { item } = state
  const [selection, setSelection] = useState<ModifierSelection>(state.selection)
  const groups = itemGroups(MENU, item)

  const setSingle = (groupId: string, optionId: string): void =>
    setSelection((prev) => ({ ...prev, single: { ...prev.single, [groupId]: optionId } }))

  const toggleMulti = (groupId: string, optionId: string): void =>
    setSelection((prev) => {
      const current = prev.multi[groupId] ?? []
      const next = current.includes(optionId) ? current.filter((id) => id !== optionId) : [...current, optionId]
      return { ...prev, multi: { ...prev.multi, [groupId]: next } }
    })

  const setStepper = (groupId: string, count: number): void =>
    setSelection((prev) => ({ ...prev, steppers: { ...prev.steppers, [groupId]: count } }))

  const previewMinor = linePreviewMinor(MENU, item, selection)
  const confirmLabel = state.mode === 'edit' ? `Update line — ${formatEuroMinor(previewMinor)}` : `Add to order — ${formatEuroMinor(previewMinor)}`

  return (
    <div className="modifier-sheet">
      <div className="modifier-sheet-header">
        <h2>{item.name}</h2>
        <span className="modifier-sheet-base-price tnum">{formatEuroMinor(item.priceMinor)}</span>
      </div>

      <div className="modifier-sheet-groups">
        {groups.map((group) => {
          if (group.kind === 'single') {
            const chosen = selection.single[group.id] ?? group.defaultOptionId
            return (
              <div className="modifier-group" key={group.id}>
                <div className="modifier-group-label">
                  <span>{group.name}</span>
                  <span className="modifier-group-hint">choose one</span>
                </div>
                <div className="segmented-bar">
                  {group.options.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      className="segmented-option"
                      data-selected={opt.id === chosen}
                      disabled={opt.outOfStock}
                      onClick={() => (opt.outOfStock ? onToast(`${opt.name} is marked out of stock`) : setSingle(group.id, opt.id))}
                    >
                      <RadioGlyph selected={opt.id === chosen} />
                      <span className="option-name">{opt.name}</span>
                      {opt.priceDeltaMinor !== 0n && (
                        <span className="option-delta tnum">{formatDeltaMinor(opt.priceDeltaMinor)}</span>
                      )}
                      {opt.outOfStock && <span className="option-oos">86&apos;d</span>}
                    </button>
                  ))}
                </div>
              </div>
            )
          }

          if (group.kind === 'multi') {
            const chosenIds = selection.multi[group.id] ?? []
            return (
              <div className="modifier-group" key={group.id}>
                <div className="modifier-group-label">
                  <span>{group.name}</span>
                  <span className="modifier-group-hint">choose any</span>
                </div>
                <div className="pill-row">
                  {group.options.map((opt) => {
                    const selected = chosenIds.includes(opt.id)
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        className="pill-option"
                        data-selected={selected}
                        disabled={opt.outOfStock}
                        onClick={() => (opt.outOfStock ? onToast(`${opt.name} is marked out of stock`) : toggleMulti(group.id, opt.id))}
                      >
                        <CheckboxGlyph selected={selected} />
                        <span className="option-name">{opt.name}</span>
                        {opt.priceDeltaMinor !== 0n && (
                          <span className="option-delta tnum">{formatDeltaMinor(opt.priceDeltaMinor)}</span>
                        )}
                        {opt.outOfStock && <span className="option-oos">86&apos;d</span>}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          }

          // stepper
          const count = selection.steppers[group.id] ?? group.defaultCount
          return (
            <div className="modifier-group" key={group.id}>
              <div className="modifier-group-label">
                <span>{group.name}</span>
                <span className="modifier-group-hint">{formatDeltaMinor(group.extraPriceMinor)} per extra {group.unitName}</span>
              </div>
              <div className="stepper">
                <button
                  type="button"
                  className="stepper-btn"
                  disabled={count <= group.min}
                  onClick={() => setStepper(group.id, Math.max(group.min, count - 1))}
                  aria-label={`Fewer ${group.unitName}s`}
                >
                  −
                </button>
                <span className="stepper-readout tnum">
                  {count} {group.unitName}
                  {count === 1 ? '' : 's'}
                </span>
                <button
                  type="button"
                  className="stepper-btn"
                  disabled={count >= group.max}
                  onClick={() => setStepper(group.id, Math.min(group.max, count + 1))}
                  aria-label={`More ${group.unitName}s`}
                >
                  +
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <div className="modifier-sheet-footer">
        {state.mode === 'edit' && (
          <button type="button" className="btn-remove-line" onClick={onRemoveLine}>
            <XIcon size={16} />
            Remove line
          </button>
        )}
        <div className="modifier-sheet-footer-right">
          <button type="button" className="btn-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn-confirm" onClick={() => onConfirm(item, selection)}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
