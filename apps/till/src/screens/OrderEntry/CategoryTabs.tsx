/**
 * SPEC "Category tabs": 5 tabs, equal width, switching swaps the grid in place with **no
 * transition** — a 200ms slide × 300 orders/day is minutes of waiting, and motion pulls the eye off
 * the order pane. So this is a plain state swap, no CSS transition on the grid at all.
 */

import type { MenuCategory } from '../../menu/menu'
import './CategoryTabs.css'

export interface CategoryTabsProps {
  readonly categories: readonly MenuCategory[]
  readonly selectedId: string
  readonly onSelect: (id: string) => void
}

export function CategoryTabs({ categories, selectedId, onSelect }: CategoryTabsProps): JSX.Element {
  return (
    <div className="category-tabs" role="tablist">
      {categories.map((cat) => (
        <button
          key={cat.id}
          type="button"
          role="tab"
          aria-selected={cat.id === selectedId}
          className="category-tab"
          data-selected={cat.id === selectedId}
          onClick={() => onSelect(cat.id)}
        >
          {cat.name}
        </button>
      ))}
    </div>
  )
}
