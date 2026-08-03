# DP-02 — Order entry, modifiers, cash tender

**Gates Sprint 3.** Requires DP-01 output first.
Paste into Claude Design. Output goes to `design/sprint-03-till/`.

---

Continuing Batch, the POS for Irish coffee shops. The design system is settled — use
the tokens from the previous step exactly, no new colours or sizes.

Design three screens for the till. iPad landscape, 1194x834pt.

SCREEN 1 — ORDER ENTRY
The screen that carries the entire speed thesis. A barista uses it a few hundred
times a day and must never hunt.

- Fixed grid of menu items. The top 20 items must be reachable with no scrolling.
- Category switching that doesn't cost a screen transition.
- Persistent order pane showing lines, quantities, modifiers, running total.
- Void a line in one tap plus confirm.
- Prominent tender button with the total on it.
- Header: staff member, shift state, sync/offline indicator.

SCREEN 2 — MODIFIER SHEET
Appears on tapping an item that has options. This is where competing POS systems fail
worst — buried submenus that cost seconds during a rush.

- Milk, size, shots, syrups, temperature. Multiple groups.
- Sensible defaults pre-selected, so the common order needs zero taps here.
- Single-select and multi-select groups must be visually distinct without relying on
  colour.
- Price deltas visible per option.
- Confirm and cancel, both reachable one-handed.

SCREEN 3 — CASH TENDER
- Numeric keypad, large keys.
- Quick-tender denominations: exact, €5, €10, €20, €50.
- Change due, unmissably large — this is what the barista reads while counting.
- Confirm, and a clear path back if the customer changes their mind.

FOR EVERY SCREEN, ALSO SPECIFY IN WRITING
This matters more than the visuals. My engineering setup implements from the written
spec and uses images as reference only.

- Every state: default, pressed, disabled, loading, offline, error.
- What happens on tap, long-press, and failed action.
- Exact touch-target sizes where they differ from the 48pt minimum.
- Which decisions came from the café environment rather than aesthetics.
- Anything you deliberately left undesigned, and why.

DELIVERABLE
Three annotated screens plus a written SPEC.md I can save alongside them. Structure
the spec by screen, then by component, then by state.

Reminder on offline: it is normal operation, not an error. No red banners, no retry
dialogs, no modal that traps a barista mid-order.
