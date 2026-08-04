/**
 * Minimal hand-rolled icon set matching the design system's Lucide references (check, x, refresh-cw,
 * chevron-left, dashed-ring, alert-triangle) plus the modifier-sheet glyphs (radio, checkbox). Lucide
 * itself isn't a dependency — these are ~15-line stroke-based SVGs, well under the "don't add a
 * dependency for under ~50 lines" bar (root CLAUDE.md). Every icon paints with `currentColor` so its
 * colour is set by the surrounding element's CSS `color`, which is always a `var(--color-*)` token —
 * no hex literal here (Sprint 3 task 1).
 */

interface IconProps {
  readonly size?: number
  readonly className?: string
}

export function CheckIcon({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M4 12.5l5 5L20 6.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function XIcon({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M5 5l14 14M19 5L5 19" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

export function RefreshIcon({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path
        d="M20 11a8 8 0 10-1.3 5.1M20 5v6h-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function DashedRingIcon({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="2" strokeDasharray="3 3.2" />
    </svg>
  )
}

export function ChevronLeftIcon({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function AlertTriangleIcon({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path
        d="M12 4l9.2 16H2.8L12 4z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M12 10v4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="17.5" r="1.1" fill="currentColor" />
    </svg>
  )
}

/** Single-select option glyph: ring, filled disc when selected (SPEC "radio circle"). */
export function RadioGlyph({ selected, size = 20, className }: IconProps & { readonly selected: boolean }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" />
      {selected && <circle cx="10" cy="10" r="4.5" fill="currentColor" />}
    </svg>
  )
}

/** Cash-drawer glyph for the header's "Cash movements" entry point (SPEC Screen 2 "drawer glyph"). */
export function DrawerIcon({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <rect x="3" y="7" width="18" height="13" rx="1.5" stroke="currentColor" strokeWidth="2" />
      <path d="M3 7l3-4h12l3 4" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M10 13.5h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

/** Variance direction glyphs — word + triangle, never colour alone (SPEC Screen 4). */
export function TriangleUpIcon({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M12 4l9 16H3l9-16z" fill="currentColor" />
    </svg>
  )
}

export function TriangleDownIcon({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M12 20L3 4h18l-9 16z" fill="currentColor" />
    </svg>
  )
}

/**
 * Multi-select option glyph: empty square, square-with-check when selected (SPEC "square
 * checkbox"). The check itself renders in `--color-raised` — against the accent-filled square that
 * reads as the app's "white ink on accent fill" pairing used throughout (Charge / Complete / badges).
 */
export function CheckboxGlyph({ selected, size = 20, className }: IconProps & { readonly selected: boolean }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <rect
        x="2"
        y="2"
        width="16"
        height="16"
        rx="4"
        fill={selected ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.5"
      />
      {selected && (
        <path
          d="M5.5 10.2l2.8 2.8L14.5 6.8"
          stroke="var(--color-raised)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      )}
    </svg>
  )
}
