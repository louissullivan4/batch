# Batch cash & shift — Sprint 4 spec

Screens: Shift open · Cash movements · Blind count · Variance result · X / Z reports.
iPad landscape 1194×834pt. All values from `design/system/tokens.json` — no new
colours or sizes. Global rules carry over from Sprint 3: no hover states; pressed =
tint + inner shadow; colour never encodes state alone; disabled = 45% opacity;
offline is normal (dashed warm-grey pill, never red, never a modal). The user is a
tired shift manager at 6pm: every flow below is rigorous about the record and
deliberately unpunishing in tone.

Access: all five screens sit behind staff PIN (4 digits, keypad identical to cash
tender keys, validated locally against a synced Argon2id hash — works in airplane
mode, always). PIN pad appears inline where authorisation is needed, never as a
separate trip.

---

## Screen 1 — Shift open

### Staff selection
- Pill chips, 56pt, one per rostered staff member, single-select (radio circle
  glyph, same grammar as the modifier sheet: joined = single-select is not used
  here because names vary in width; instead each chip carries the radio glyph).
- selected: accent tint + 2px accent border + filled radio. pressed: inner shadow.
- More than 8 staff: chips wrap; no scrolling hidden behind a dropdown.

### Denomination counter (shared component with blind count)
- Two columns: notes (€50 €20 €10 €5) and coins (€2 €1 50c 20c 10c 5c). 1c/2c
  omitted — Irish cash rounds to 5c. Owner can enable them in settings.
- Row, 56pt: denomination label (item 20/600, tabular) · [−] 56×56 · count (title
  28/600 tabular, min-width 72, centred) · [+] 56×56 · row subtotal (17/600
  tabular, text-muted, right).
- [−] disabled at 0 (45% opacity). Long-press [+]/[−] (500ms) repeats at 5/s.
- Tap the count itself → inline keypad popover to type a count directly (for
  "×47 five-cent coins" cases). CAFÉ: steppers beat typing for the common 0–9
  range with one hand holding coins.
- Empty state: all zeros, total €0.00 at 45% opacity, commit disabled.

### Summary pane (right, 384pt)
- "Float" caption + running total (display 40/700 tabular), live breakdown as
  caption lines ("3 × €20 · 5 × €10 …") — the confirmation of what's being
  declared is on screen the whole time, not a separate dialog.
- [Open shift — €150.00] primary 64pt. Tap → single inline confirm strip replaces
  the button for 5s: "Declare €150.00 float, opened by Orla?" [Declare] primary /
  [Back] secondary. No modal.
- Committed `ShiftOpened` + `CashDeclared` events are **irreversible** (the event
  log is append-only). A wrong float is corrected by a Paid in/out movement with
  reason "Float correction", not by editing — spec this in the confirm strip
  microcopy? No: keep the strip clean; the correction path lives in Cash
  movements.
- Offline: identical; events queue. disabled state: only when no staff selected
  or total is €0.00.

## Screen 2 — Cash movements

Presentation: sheet over the till (same scrim/geometry as the modifier sheet), so
a paid-out mid-rush costs seconds, not a navigation trip. Opened from a drawer
glyph button in the till header (48pt). Order in progress is untouched.

### Movement type — 4 tiles, single-select
- Paid in (arrow-down-to-drawer glyph) · Paid out (arrow-up) · Skim (banknote-out)
  · Safe drop (safe glyph). 2×2 grid, tiles ≥96pt tall, radio grammar.
- Skim and Safe drop reduce the drawer; the tile subcopy says what each does in
  one clause ("Cash out to the safe, counted later" etc.) — a tired manager
  should not have to remember the difference.

### Amount + reason + authorisation
- Amount: keypad (reuse cash-tender keypad, keys ≥120×64) + readout (display 40).
- Reason: chips (label 15/600, 48pt) from a per-type configurable list (Paid out:
  "Milk run", "Cleaning", "Window cleaner", "Courier"; Skim/Safe drop: "Over
  limit", "End of rush"; Paid in: "Change from safe", "Float correction") + a
  free-text chip [Other…] opening the iPad keyboard — the only keyboard use in
  the till, and it's optional. Reason **required** for movements (unlike variance
  codes): a movement without a reason is unreconcilable by definition.
- Authorisation: inline PIN pad (3×4, 4 dots above, dots fill on entry). The
  authorising staff member is whoever's PIN validates — no name picker to falsify.
  Wrong PIN: dots shake once (120ms), clear, caption "Try again" in ink — not
  red, not counted aggressively; 5 failures = 30s cooldown, caption states the
  time.
- Commit button: primary 64, verb + amount ("Pay out €12.50"). pressed/disabled
  as standard. Committed movements are **irreversible**; the undo is a reversing
  entry (a Paid in reversing a Paid out), one tap from the movement's row in the
  shift log: [Reverse…] pre-fills the opposite movement with reason "Reversal".
- Offline: identical, events queue. Error: none possible locally; full-storage
  toast as per Sprint 3.

## Screen 3 — Blind count

### Structural integrity — how blindness is enforced
1. **The expected figure does not exist on the client during the count.** The
   count screen renders from the denomination grid state only; the expected total
   is computed **after** `CashDeclared(count)` commits, from the event log. There
   is no property, cache, or hidden element to inspect — nothing to reveal via
   dev tools, screen readers, or a peek over the shoulder.
2. **X report is unreachable while a count is open.** Entering the count locks
   report generation for that drawer (X mid-count would print expected cash).
   The Reports screen shows the X panel disabled with caption "Locked during
   drawer count".
3. **The count commits atomically.** Commit → variance screen. There is no
   "preview variance" and no back-navigation from variance to an editable count;
   a recount is a new `CashDeclared` event, and every count attempt is logged
   (count 1, count 2 …) with both figures. Typing the expected number after
   seeing it is possible on a recount — but it is visible as a recount in the
   back office, which is the honest deterrent.
4. Cancel (before commit) records nothing and returns to the till.

### Layout & components
- Full-screen takeover, minimal header: "Count the drawer" (title 28) + counter's
  name + sync pill. No other navigation. Caption under the title: "Blind count —
  the expected amount is shown after you commit." Factual, not warning-toned.
- Denomination counter: identical component to shift open (same grid, same
  omitted 1c/2c).
- Running total pane (right): "You've counted" caption + display 40/700 total —
  this is for the counter to check against their own paper tally, and it is the
  only total on screen.
- [Commit count — €412.35] primary 64. One tap, no confirm strip — committing a
  count is safe (recounts exist); friction here would be punishment, not rigour.
- **Single-total fallback**: a ghost text button (label 15/600, text-muted,
  48pt hit) under the pane: "Enter one total instead". Deliberately quiet — if it
  were a peer button it would become the default and the denomination breakdown
  would be lost. It swaps the grid for the keypad; the commit button then reads
  "Commit total — no breakdown" so the loss is explicit.
- Offline: fully functional. disabled: commit at €0.00 requires the confirm strip
  ("Commit an empty drawer?") — an empty drawer is legal but usually a mistake.

## Screen 4 — Variance result

Tone: factual, symmetric, unpunishing. Over and short are typographically
identical — same size, same ink colour. Never destructive-red, never warning-
amber for the amount itself: a variance is a fact, not an offence. Direction is
encoded by word + triangle glyph (▲ over / ▼ short), not colour.

- Result card, centred: "Counted €412.35" and "Expected €432.35" as equal rows
  (title 28, tabular) — the expected figure appears here for the first time —
  then a rule, then the verdict: "Short €20.00" (display 40/700 + ▼). Exact
  count: "Exact — €432.35" with a check glyph in success (the one place colour
  is added, and it's paired with the glyph and word).
- Caption: "Recorded against shift #142 · second count available" — the recount
  path is offered right there, without implying the counter erred.
- Reason codes: chips, **offered, not demanded** — "Change given wrong",
  "Paid-out not recorded", "Note counted twice", "Not sure yet". "Not sure yet"
  is a first-class, storable answer; back office can chase it later. Multi-select
  allowed. Skipping entirely is allowed.
- Close actions, over the €10 threshold (configurable, default €10):
  - [Manager PIN — close shift] primary 64 → inline PIN pad → Z flow.
  - [No manager here — close and flag] secondary 48, always visible below. Reads
    as logistics, not confession: caption beneath it says "Closes normally.
    The variance is marked unauthorised and appears in the back-office review."
    **The close is never blocked.** A blocked close at 6pm teaches staff to
    fudge counts; an escalation path keeps the record honest.
- Under threshold: single [Close shift] primary; the manager row simply isn't
  rendered.
- Undo: none — the count is committed. A recount before Z supersedes (both kept).
- Offline: identical; the flag syncs later.

## Screen 5 — X and Z reports

Designed against one specific mistake: running Z when you meant X. Five separate
differences — geometry, colour, interaction, precondition, and copy — make the
two unconfusable:

1. **Different surfaces.** X is a light raised card. Z is the only ink-dark
   (#1C1917) panel in the entire product; white text, on the right. If the screen
   looks dark, you are in Z territory.
2. **Different verbs.** X: [Print X report] — secondary outline, one tap,
   repeatable ("Run as often as you like. Changes nothing." + "Last X 14:02 ·
   #3 this shift"). Z: [Hold to run Z #142] — primary, **press-and-hold 1.5s**
   with a filling progress ring on the button; releasing early cancels with no
   effect. Nothing else in Batch uses hold-to-confirm; the muscle memory of a
   tap cannot fire it.
3. **Precondition.** Z is disabled (45% + caption "Complete the drawer count
   first") until the blind count and variance steps are committed. X has no
   precondition except no-count-in-progress (see blind count lock).
4. **Copy states finality in the body, not a dialog**: "Runs once. Locks shift
   #142 and issues Z #142, sequentially numbered. This cannot be undone." No
   confirmation modal after the hold — the hold **is** the confirmation.
5. **After Z**: the panel becomes a receipt state — "Z #142 issued 18:04" with
   a check, button gone, shift returns to the closed state. Attempting any
   mutation after Z fails structurally (the shift aggregate is sealed); the UI
   simply has nothing left to press.
- Offline: X prints from local state; Z runs fully offline (numbering is
  per-device-sequence + shift id, so sequence integrity survives sync).
- Genuinely irreversible: Z, and every committed event above. Everything else is
  correctable by reversing entries.

---

## Decided but not framed this sprint
- **PIN entry**: shown inline (cash movements); the same 3×4 pad gates shift
  open/close. Argon2id (memory-hard KDF) against offline brute force; hash
  synced per staff member; 5-failure 30s cooldown.
- **Handover**: PIN swap only — outgoing taps [Hand over], incoming enters PIN,
  `ShiftHandover` event, drawer stays open, no count. An **optional quick count**
  at handover is specced as a future state (same blind-count component, variance
  recorded informationally, no authorisation gate) but is not part of the flow
  and has no entry point in this sprint's UI.
- Variance threshold (€10) and denomination grid contents are back-office
  configuration, not till UI.

## Left undesigned
- Back-office review of flagged/unauthorised variances and recount history.
- Printed layout of X/Z receipts (needs printer hardware decision).
- Multi-drawer, safe reconciliation, banking runs — out of scope per sprint doc.
