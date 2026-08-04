# Handoff: Batch cash management & shift (Sprint 4)

## Overview
Five iPad screens for Batch's cash and shift lifecycle: shift open (float declaration), cash movements (paid in/out, skim, safe drop), blind drawer count, variance result, and the X/Z report pair. Target: iPad landscape 11", 1194×834pt. The user is a tired shift manager at 6pm; the design is rigorous about the record and deliberately unpunishing in tone.

## About the Design Files
Files in `reference/` are **design references created in HTML** — prototypes showing intended look and behavior, not production code. Recreate them in the till app's existing environment using its established patterns (same codebase as the Sprint 3 till screens).

## Fidelity
**High-fidelity.** Token-driven throughout. `tokens.json` is the single source of truth — hardcoded hex values are banned in component code; if a value isn't in the JSON it can't be built.

## The authoritative spec
**`SPEC.md` is the implementation contract** — screen → component → state, including offline behavior, confirmation/undo semantics and what is genuinely irreversible, blind-count structural enforcement, the close-with-escalation path, and Z-report finality. Implement from SPEC.md; images and HTML are visual reference only.

## Non-negotiables engineering must preserve (from SPEC.md)
- **Blind count integrity is structural, not conventional**: the expected total must not exist on the client until the count commits (computed from the event log after commit); X reports locked while a count is open; commit is atomic with no editable back-path; every count attempt logged.
- **Close is never blocked**: variance over threshold (default €10, configurable) asks for a manager PIN, but "No manager here — close and flag" always closes normally and records an unauthorised variance for back-office review.
- **Z runs once**: hold-to-confirm 1.5s (the only hold interaction in the product), disabled until count + variance committed, sequentially numbered per device + shift id, immutable after issue. X is non-destructive and repeatable.
- **Append-only events**: ShiftOpened, CashDeclared, PaidIn, PaidOut, Skim, SafeDrop, ShiftClosed, ShiftHandover. No edits — corrections are reversing entries.
- **PIN**: 4-digit, validated locally against a synced memory-hard hash (Argon2id), works in airplane mode; authoriser = whoever's PIN validates.
- Offline is normal operation everywhere: no red, no banners, no blocking.

## Global visual rules
Spline Sans, tabular numerals on all money/counts. 7:1 contrast floor. No hover states; pressed = tint #F7E8DF + inner shadow. Colour never encodes state alone. Targets ≥48pt, primary 64pt, steppers/keys 56pt+. Disabled = 45% opacity. Variance amounts always in ink (#1C1917) with word + triangle glyph — never red/amber. The Z panel is the only #1C1917-dark surface in the product.

## Screens
1. **Shift open** — staff radio chips, denomination stepper grid (€50–€5 notes, €2–5c coins; 1c/2c omitted, Irish 5c rounding), live float total + breakdown as the confirmation, inline confirm strip on commit.
2. **Cash movements** — sheet over the till; 2×2 type tiles with one-clause subcopy, required reason chips + optional free text, amount keypad, inline PIN authorisation, commit disabled until 4th digit.
3. **Blind count** — full-screen takeover, same denomination component, running total only, quiet single-total fallback ("Commit total — no breakdown"), Cancel records nothing.
4. **Variance result** — counted/expected revealed together, verdict at display size in ink, optional reason chips incl. "Not sure yet", manager-PIN close + close-and-flag path.
5. **X / Z reports** — light outlined X card (one tap, repeatable, run counter) vs dark Z panel (precondition checklist, hold-to-run with progress ring, receipt state after issue).

## State Management (minimum)
- Shift aggregate from append-only events; expected cash derived log-side only after count commit.
- Count draft (per-denomination map) local until atomic commit; recounts as new events.
- Movement draft {type, amount, reasonCode|text, authorisedBy} committed on PIN validation.
- Z sequence: per-device counter + shift id; shift sealed after Z.

## Design Tokens
See `tokens.json` (same file as Sprints 1–3; unchanged).

## Assets
No image assets. Icons from Lucide (check, x, chevron-left; dashed ring drawn with stroke-dasharray).

## Files
- `SPEC.md` — implementation contract (authoritative)
- `tokens.json` — design tokens
- `reference/Cash and Shift Screens.dc.html` + `support.js` — HTML prototype, five frames (open in a browser)
- `reference/screen-1-shift-open.png` … `screen-5-x-z-reports.png` — reference captures
