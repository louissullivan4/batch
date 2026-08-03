# DP-04 — Card payment states

**Gates Sprint 5.**
Paste into Claude Design. Output goes to `design/sprint-05-payments/`.

---

Continuing Batch, the POS for Irish coffee shops. Established tokens. iPad landscape.

Design the card payment flow. Payments are semi-integrated: the till sends an amount
to a separate card terminal, the terminal handles the card, a result comes back. The
till never sees card data.

This is where POS systems most visibly fail, and the failure is always public — a
queue is watching. Design the unhappy paths with as much care as the happy one.

HAPPY PATH
- Amount sent, waiting for terminal
- Customer presenting card
- Approved
- Receipt options: print, email, none

FAILURE AND EDGE STATES — the real work
- Declined. What does the barista say next? The screen should suggest the recovery,
  not just report the failure.
- Terminal unreachable or unpaired
- Timeout with the terminal in an unknown state — this is the dangerous one. The
  order must never be stranded between tendered and closed, and the barista needs a
  clear, safe next action.
- Customer cancels at the terminal
- Partial approval
- Refund flow, role-gated, reason-coded
- Split tender: part cash, part card, with a clear running remainder

TIPPING
Irish tipping is not a mandatory US-style prompt. Design it as available but not
coercive — no guilt-inducing preset percentages, and a straightforward way to skip.
Tips are captured on the terminal in most flows; the till shows the outcome.

FOR EVERY STATE, ALSO SPECIFY IN WRITING
- What the barista is expected to do next, in words
- Whether the state is recoverable and how
- What the customer-facing side shows, if anything
- Timeout durations before a state transitions

DELIVERABLE
A state diagram of the payment flow, annotated screens for each state, plus SPEC.md.

The state diagram matters as much as the screens — my engineering setup implements the
state machine from it.
