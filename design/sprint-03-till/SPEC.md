# Batch till — Sprint 3 spec

Screens: Order entry · Modifier sheet · Cash tender. iPad landscape 1194×834pt.
All values reference `design/system/tokens.json`. No colour or size outside it.
Global rules: no hover states exist; touch-down (pressed) is the only intermediate
state. Colour never encodes state alone — always paired with a glyph, border weight,
or text. Offline is normal operation and never produces red, a banner, or a modal.

---

## Screen 1 — Order entry

### Header (height 64, surface, border-bottom 1px border)
- Left: wordmark "Batch" (item 20/700), staff name (body 17), shift pill.
- Shift pill: check glyph + "Shift open" (label 15/600, success, 1.5px success
  border, pill radius, height 36). Closed shift: "Shift closed", offline-neutral,
  no check. Tapping the pill opens shift actions; it is a 48pt target (36pt visual
  inside a 48pt hit area).
- Right: sync status pill + clock (caption 13, text-muted).
- Sync pill states (all 36pt visual / 48pt hit, pill radius, 1.5px border, raised bg):
  - synced: solid border success, check glyph, "Synced".
  - syncing: solid border offline-neutral, rotating refresh glyph (1 rev / 1.2s,
    linear), "Syncing". Never blocks anything.
  - offline: **dashed** border offline-neutral, dashed-ring glyph, "Offline".
    CAFÉ: dashed = texture, not alarm; shares no hue with warning/destructive.
    Tap → popover "Orders are saved on this iPad and will sync automatically."
    No action required, no retry button.
- Header never shows errors. Failed syncs stay in "syncing" and are surfaced at
  cash-up, not mid-rush.

### Category tabs (row height 48, above grid)
- 5 tabs max, equal width, each ≥48pt tall and ≥120pt wide.
- Switching swaps the grid content **in place, no transition or animation**.
  CAFÉ: a 200ms slide ×300 orders/day is minutes of waiting; also motion draws the
  eye away from the order pane.
- default: raised bg, 1.5px border border, label 15/600 text.
- selected: accent text, 2px accent bottom border, tint fill (#F7E8DF is
  accent-tinted raised: implement as accent at 8% over raised), plus 600 weight —
  three signals.
- pressed: inner shadow + tint.
- disabled: does not occur (empty categories are hidden, not disabled).

### Menu tile (grid 4×5, tile ~186×122, gap 12, radius lg 14)
- Top 20 items of the selected category always visible, zero scrolling. Item 21+
  requires the owner to re-order the grid in settings — scrolling is deliberately
  not provided on this screen. (Left undesigned: grid editing UI — back-office
  scope, not till scope.)
- Contents: name (item 20/600, max 2 lines, ellipsis), price (label 15–17/600,
  text-muted, tabular).
- default: raised, 1.5px border border, shadow (0 1 2 rgba(28,25,23,.06)).
- pressed: bg accent-tint, inner shadow (inset 0 2 4 rgba(28,25,23,.18)).
- in-order: accent-tint fill + 2px accent border + count badge (28pt pill, accent
  fill, white, label 15/600, tabular). Three redundant signals.
- disabled (86'd item): 45% opacity + "86'd" caption replacing price. Still
  tappable → toast "Marked out of stock" (body 17, raised, 3s), no modal.
- loading: does not occur; the menu is local. Cold start shows skeleton tiles
  (border only, no shimmer) for <1s.
- Tap: item with no options → appended to order immediately (or +1 to an existing
  identical line). Item with options → modifier sheet (Screen 2).
- Long-press (500ms): adds one with **default modifiers**, skipping the sheet.
  CAFÉ: wet fingers double-fire taps; the 500ms threshold plus a 80ms tap debounce
  per tile prevents accidental duplicates.
- Failed action: cannot fail; writes are local-first. Full storage (pathological)
  → toast, order preserved in memory.

### Order pane (width 384, raised, 1px border-left)
- Order line (min height 64, full row is a tap target):
  - qty badge (36×36, radius sm-adjacent 8, tint fill, 17/600 tabular, "2×")
  - name (item 20/600), modifiers on their own line (label 15/400, text-muted,
    " · " separated). Modifiers never inline with the name.
  - line price (17/600 tabular, right-aligned)
  - void button: 48×48, ghost, × glyph in destructive + 1.5px border. Always
    visible — no swipe-to-reveal. CAFÉ: swipe gestures fail with wet/gloved hands.
- Void flow (one tap + confirm): tap × → the row itself transforms into a confirm
  strip: "Remove Flat white?" + [Remove] (destructive fill, white text, 48pt) +
  [Keep] (secondary, 48pt). Auto-reverts to normal after 5s of no input. No modal,
  nothing else on screen is blocked.
- Tap on line body: reopens modifier sheet pre-filled for editing.
- Line pressed: row bg tint.
- Empty state: text-muted body 17 "Tap an item to start an order." — nothing else.
- Overflow: pane scrolls; total + tender button are fixed at the bottom, never
  scroll away.

### Total + tender
- Total row: "Total" (title 28/600) + amount (title 28/600 tabular).
- Tender button: full-width, **64pt**, accent fill, white, item 20/600:
  "Charge €16.20" — the total lives on the button. CAFÉ: the barista's eye is on
  the customer; total and action are one target.
- pressed: accent-pressed fill + inner shadow.
- disabled (empty order): 45% opacity, non-interactive.
- Tap: opens tender screen (card default in a later sprint; this sprint: cash →
  Screen 3).
- Offline: button unchanged. Cash tender works fully offline. (Card tender offline
  behaviour: left undesigned — depends on the acquirer's offline policy; flagged
  for Sprint 4.)

---

## Screen 2 — Modifier sheet

Presentation: sheet (760 wide, radius lg 14, raised, shadow) over a scrim
(text at 40% opacity). The order pane remains visible at the right edge so the
running total is never hidden. Opens in ≤100ms, no slide-up animation.
Scrim tap = cancel (identical to Cancel button). Nothing traps the barista.

### Sheet header
- Item name (title 28/600) + base price (body 17, text-muted, tabular).

### Groups — single vs multi, shape-encoded (never colour)
- **Single-select** = segmented control: options are **joined** into one bar
  (shared borders), each option carries a **radio circle** glyph (ring; filled
  disc when selected). Exactly one always selected.
- **Multi-select** = **separate pill chips** with a **square checkbox** glyph
  (empty square; square with check when selected). Zero or more selected.
- CAFÉ: joined-bar+circle vs separate-pill+square reads at arm's length in glare
  where a colour difference wouldn't.
- Option sizing: 56pt tall (≥48 min). Price delta rendered inside the option:
  "+€0.40" (label 15/600, tabular; text-muted when unselected).
- Option states:
  - default: raised, 1.5px border border, text ink.
  - selected: accent-tint fill + 2px accent border + filled glyph (disc/check).
  - pressed: inner shadow + tint.
  - disabled (out of stock, e.g. oat milk 86'd): 45% opacity + "86'd" caption;
    tap → toast, no modal.
- Defaults: every group has a sensible default pre-selected (Regular, whole milk,
  standard shots, no syrup, hot). **The common order costs zero taps here** —
  Confirm is pressable immediately.
- Shots = stepper: [−] 56×56, count readout ("2 shots", item 20/600, tabular,
  min-width 120), [+] 56×56. − disabled at the drink's minimum, + disabled at 6.
  Caption under: "+€0.60 per extra shot".

### Footer (fixed, right-aligned cluster)
- [Cancel] secondary 48pt, then [Add to order — €4.20] primary **64pt**, price
  updates live with each selection.
- CAFÉ: both actions bottom-right, within right-thumb reach on a counter-mounted
  landscape iPad held/steadied one-handed. Sheet is right-of-centre for the same
  reason. (Left undesigned: a left-handed mirror setting — worth a toggle in
  settings, not per-sheet.)
- Editing an existing line: primary reads "Update line — €4.20"; a third ghost
  action [Remove line] (destructive text + × glyph, 48pt) sits far left,
  physically separated from Confirm.
- Failed action: cannot fail (local). Cancel discards silently — no "are you
  sure" (recreating a modifier set is cheaper than reading a dialog).

---

## Screen 3 — Cash tender

Header: identical to Screen 1 (staff, shift, sync). Back is always available:
[‹ Back to order] secondary 48pt, top-left, returns with the order intact —
also the "customer changed their mind" path at any point before Complete sale.

### Left column — amount + keypad
- Order total: caption label "Total" + title 28/600 tabular "€16.20".
- Tendered readout: display 40/700 tabular in a raised, 2px ink-bordered box,
  right-aligned digits. Empty state shows "€0.00" at 45% opacity.
- Keypad: 3×4 (1–9, ".", 0, ⌫), keys ~150×72 (well over 48pt; CAFÉ: cash-up and
  tendering are one-handed while the other hand holds coins), gap 12, radius md
  10, digits title 28/600 tabular.
  - default: raised, 1.5px border. pressed: tint + inner shadow (no colour-only
    feedback). ⌫ clears one digit; long-press ⌫ (500ms) clears all.
  - No sound dependency: visual press state is sufficient on a loud bar.
- Overpay is normal; underpay leaves Complete sale disabled (see below). Absurd
  entries (>€500) show caption warning-colour text "Check amount" + warning
  triangle under the readout — text+glyph, not a dialog.

### Right column — quick tenders + change
- Quick-tender buttons: [Exact] [€5] [€10] [€20] [€50], full-width, **64pt**,
  secondary style, label item 20/600 tabular. Tap **sets** (not adds) the
  tendered amount and computes change instantly. Second tap on another note
  replaces. CAFÉ: the five buttons cover ~95% of Irish cash handovers; typing is
  the fallback, not the default.
  - Denominations smaller than the total are disabled (45% opacity) — €5 greys
    out on a €16.20 order.
- Change due card: raised, 2px ink border, radius lg. "Change due" (label 15/600)
  + amount (display 40/700 tabular — the largest size in the system). CAFÉ: this
  is what the barista reads while counting coins at arm's length; it out-weighs
  everything else on screen. Shows "—" until tendered ≥ total.
- [Complete sale] primary **64pt**, full-width: "Complete — change €3.80" (change
  repeated on the button).
  - disabled until tendered ≥ total (45% opacity).
  - pressed: accent-pressed + inner shadow.
  - Tap: commits the sale locally, drawer-kick if configured, returns to a fresh
    Screen 1 with a 2s non-blocking confirmation pill (check + "Sale recorded",
    success) in the header area.
  - Offline: identical flow — the sale queues for sync. No extra confirmation
    step, no warning. The only difference on screen is the header pill already
    reading "Offline".
  - Failed action: local write cannot fail in normal operation; if the drawer
    doesn't kick, that's hardware — no software error state is shown.

---

## Deliberately left undesigned
- Card tender + offline card policy (acquirer-dependent) — Sprint 4.
- Menu grid editing / item ordering (back office, not till).
- Left-handed mirror layout (settings toggle, needs user testing first).
- Receipt options (print/email/none) — needs a decision on default receipt
  behaviour before designing.
- Dark mode variants of all three screens — after light mode is validated
  on-site.
