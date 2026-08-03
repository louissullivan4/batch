# DP-03 — Cash management & shift

**Gates Sprint 4.**
Paste into Claude Design. Output goes to `design/sprint-04-cash/`.

---

Continuing Batch, the POS for Irish coffee shops. Use the established design tokens
exactly. iPad landscape, 1194x834pt.

Design the cash and shift screens. The user here is a shift manager at 6pm, tired,
wanting to go home — but this is the screen where money goes missing, so it has to be
rigorous without being punishing.

SCREEN 1 — SHIFT OPEN
Float declaration by denomination. Staff selection. Clear confirmation of what's being
declared before commit.

SCREEN 2 — CASH MOVEMENTS
Paid in, paid out, skim, safe drop. Each needs an amount, a reason, and an
authorising staff member. Quick to reach mid-shift without leaving the order screen
for long.

SCREEN 3 — BLIND COUNT
Critical: the counter enters what they physically counted BEFORE seeing what the
system expects. The expected figure must not be visible, inferable, or reachable on
this screen. Design it so this is structurally true, not just a convention someone can
work around.

Count by denomination, with a running total the counter can check against their own
tally.

SCREEN 4 — VARIANCE RESULT
Shown after the blind count. Over, short, or exact.

Tone matters here. A variance is usually an honest mistake, and a screen that feels
accusatory makes staff hide discrepancies rather than report them. It should read as
factual. Reason codes offered, not demanded.

SCREEN 5 — X REPORT AND Z REPORT
X is mid-shift, non-destructive, repeatable. Z closes the shift, runs once, and is
immutable. The difference between them must be unmistakable — a manager must never
run Z thinking it's X. Design for that specific mistake.

FOR EVERY SCREEN, ALSO SPECIFY IN WRITING
- Every state including offline
- Confirmation and undo behaviour, and what is genuinely irreversible
- How the Z report visually signals its finality
- How blind count integrity is structurally enforced

DELIVERABLE
Annotated screens plus SPEC.md.
