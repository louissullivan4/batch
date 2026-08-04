---
sprint: 4
name: cash-shift
title: Cash management & shift
requires_design: true
design_assets:
  - design/system/tokens.json
  - design/sprint-04-cash/SPEC.md
design_prompt: docs/design-prompts/DP-03-cash-shift.md
estimate_hours: 20
---

# Sprint 4 — Cash management & shift

**Goal:** a 50-order mock shift with deliberate paid-outs and a planted discrepancy reconciles to
the cent and reports the variance correctly.

**Prerequisite:** Sprint 3 exit criteria pass.

## Design gate — BLOCKING

Requires `design/sprint-04-cash/SPEC.md`. Run `/design-brief 4` if missing.

## Tasks

**1. Shift lifecycle** — open with float declaration, close with count. Events:
`ShiftOpened`, `CashDeclared`, `PaidIn`, `PaidOut`, `Skim`, `SafeDrop`, `ShiftClosed`.

**2. Blind count** — the counter enters what they counted *before* seeing what's expected.
Non-negotiable. A non-blind count is theatre; it just teaches staff to type the expected number.

**3. X report** — mid-shift, non-destructive, repeatable.

**4. Z report** — close, destructive, one per shift, sequentially numbered and immutable.

**5. Variance** — computed, with reason codes. Over and short both recorded.

**6. Staff PIN** — validated locally against a synced hash. Slow KDF, never plain SHA: the hash
lives on a device in a café, so offline brute-force is the realistic threat.

**7. Shift handover** — one staff member out, another in, without closing the shift.

**8. Printable Z report** (added mid-sprint) — when a Z is issued, the operator can **print it or save
it as a PDF** instead of writing the report out by hand, to file a physical copy at end of shift. Uses
the browser print dialog (`window.print()` over a print stylesheet) — zero new dependencies, works
offline, and on iPad gives both AirPrint and "Save to Files → PDF" from one button. The document is a
pure snapshot of the sealed shift (`buildZReceipt`), so it can never disagree with the event log.
X-report printing is deliberately not built (X is a throwaway peek); the printed *visual layout* is
functional/token-based and can be refined in Claude Design later if a formal document design is wanted.

## Exit criteria

- [ ] 50-order mock shift with 3 paid-outs and a planted €20 discrepancy reconciles exactly and
      reports the variance
- [ ] Blind count cannot be bypassed — the expected figure is not rendered before entry
- [ ] Z report cannot be run twice for one shift
- [ ] PIN validation works in airplane mode
- [ ] X report during an open shift does not mutate any state

## Do not

- Multi-drawer, cash office, banking runs, or till-to-safe reconciliation. Multi-site concerns.
