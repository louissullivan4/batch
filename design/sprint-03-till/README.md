# Handoff: Batch till — order entry, modifiers, cash tender

## Overview
Three iPad point-of-sale screens for Batch (POS for independent Irish coffee shops): order entry, the modifier sheet, and cash tender. Target device: iPad landscape, 11", 1194×834pt. The product thesis is speed — a new barista takes a correct order within five minutes, unaided.

## About the Design Files
The files in `reference/` are **design references created in HTML** — prototypes showing intended look and behavior, not production code to copy. The task is to **recreate these designs in the target codebase's environment** (React Native, SwiftUI, web — whatever the till app uses; if none exists yet, choose the most appropriate iPad-first framework) using its established patterns.

## Fidelity
**High-fidelity.** Colors, type, spacing and sizes are final and token-driven. Recreate pixel-perfectly. `tokens.json` is the single source of truth — **hardcoded hex values are banned in component code**; if a value isn't in the JSON it can't be built.

## The authoritative spec
**`SPEC.md` is the implementation contract.** It is structured by screen → component → state and covers every state (default, pressed, disabled, loading, offline, error), tap/long-press/failure behavior, exact touch-target sizes, environment-driven decisions, and what is deliberately left undesigned. Implement from SPEC.md; use the images and HTML as visual reference only.

## Global rules (from the design system)
- Font: Spline Sans (Google Fonts), weights 400/500/600/700. Tabular numerals (`font-feature-settings: "tnum"`) on every price, quantity and time.
- Contrast floor 7:1 for anything meaning-carrying (bright cafés, glare).
- No hover states anywhere — touch-down (pressed = darker/tinted fill + inner shadow `inset 0 2px 4px rgba(28,25,23,0.18)`) is the only intermediate state.
- Colour never encodes state alone: always pair with a glyph, border weight or text.
- Touch targets: 48pt minimum, 64pt for primary actions. Grid gutters ≥12pt.
- Offline is normal operation: warm-grey dashed pill, never red, never a banner or modal.
- Accent tint used for selected/pressed fills: `#F7E8DF` (accent at ~8% over raised).
- Disabled = 45% opacity, non-interactive (except 86'd tiles, which toast on tap).
- Icons: Lucide (check, x, refresh-cw, chevron-left, dashed circle drawn with stroke-dasharray).

## Screens
1. **Order entry** — header (staff, shift pill, sync/offline pill), 5 category tabs (in-place swap, no transition), 4×5 menu grid (top 20 items, zero scrolling, tiles ~186×122, radius 14), persistent 384pt order pane (lines with qty badge / name / modifiers / price / always-visible 48pt void button, inline void-confirm strip), total on the 64pt Charge button.
2. **Modifier sheet** — 760pt sheet over 40% scrim, order pane stays visible. Single-select groups = joined segmented bars with radio circles; multi-select = separate pill chips with square checkboxes. Defaults pre-selected (zero-tap common order), price deltas per option, live price on the 64pt confirm, bottom-right one-handed cluster.
3. **Cash tender** — keypad (~178×72 keys), quick tenders Exact/€5/€10/€20/€50 (64pt, set-not-add, under-total notes disabled), change due at display size 40/700, Complete disabled until tendered ≥ total, Back to order always available top-left.

Exact per-component measurements, states and copy: see SPEC.md.

## State Management (minimum)
- Order: array of lines {itemId, qty, modifiers[], linePrice}; running total derived.
- Line void: transient per-line confirm state, auto-revert after 5s.
- Modifier sheet: draft selection state, committed only on confirm; cancel discards silently.
- Tender: tenderedAmount (quick-tender sets, keypad edits), changeDue derived.
- Sync: local-first writes always; queue with states synced / syncing / offline. Sales commit locally regardless of connectivity.

## Design Tokens
See `tokens.json` (colors incl. accent #943109 / accent-pressed #732708 / offline-neutral #57534E; type scale display 40/700/44 → caption 13/500/18; space 4–48; radius 6/10/14/pill; touch 48/64).

## Assets
No image assets. Wordmark is plain type ("Batch", 20/700). Icons from Lucide.

## Files
- `SPEC.md` — the implementation contract (authoritative).
- `tokens.json` — design tokens (single source of truth for values).
- `reference/Till Screens.dc.html` + `support.js` — HTML prototype, all three frames side by side (open in a browser).
- `reference/screen-1-order-entry.png`, `screen-2-modifier-sheet.png`, `screen-3-cash-tender.png` — reference captures.
