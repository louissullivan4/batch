# Assumptions

Domain calls made from general retail knowledge rather than something in this repo. Each one is a
line the product bets on; each has a falsifier so it becomes a test script the day Batch is in front
of a real café. Costs thirty seconds to add. Retrofitting is impossible.

Format: `A-NNN: <claim>` · Basis · Falsifier · Status (`unvalidated` | `validated` | `revised`).

---

## A-001: Even bill splits give the remainder cents to the earliest payers
Basis: someone has to absorb the odd cent; doing it first-come is deterministic and explains itself
at the counter ("you got the extra cent"). €10.00 across 3 → 334, 333, 333.
Falsifier: a merchant expects the remainder on the *last* payer, or split evenly by rounding each up.
Status: unvalidated

## A-002: VAT is extracted once per rate band, not per line
Basis: a VAT return is filed by rate, and one rounding per band avoids per-line drift. The
`irish-vat` skill suggests per-line-then-reconcile; per-band is the reconciled form and, because
`vatRateBp` is snapshotted on every line, the breakdown is always recomputable — so this is not
irreversible. See [ADR 004](decisions/0004-vat-extraction-per-band.md).
Falsifier: a receipt or accountant needs VAT shown per line and the per-line figures must sum to a
per-line (not per-band) rounding. Then allocate band VAT down to lines by largest remainder.
Status: unvalidated

## A-003: Half of a cent rounds away from zero (so refunds reverse sales exactly)
Basis: making the rounding odd means `vat(-x) == -vat(x)`, so a refund event exactly reverses the
sale in an append-only ledger. Half-up would leave a stray cent on refunds.
Falsifier: Irish Revenue guidance mandates half-up (toward positive) even on credit notes.
Status: unvalidated

## A-004: Modifiers are priced per unit and scale with line quantity
Basis: "2 lattes, oat milk" charges the oat-milk surcharge twice. A modifier is part of each unit,
not a one-off line fee.
Falsifier: a shop wants a per-line modifier (e.g. a single "make it a meal" fee regardless of qty).
Status: unvalidated

## A-005: A modifier can carry a different VAT rate than its line
Basis: an add-on (a bottled soft drink alongside a coffee) can sit in a different band. Snapshotting
the modifier's own `vatRateBp` keeps that correct rather than inheriting the line's rate.
Falsifier: in practice modifiers always inherit the line's rate and the extra field is dead weight.
Status: unvalidated

## A-006: Discounts stack in event order, each applied to the running total, clamped at zero
Basis: two 10% discounts compose to 19%, not 20%; a discount can never drive a total negative.
Falsifier: a promotion must apply all percentage discounts against the *original* subtotal, or a
discount is allowed to create account credit (negative total).
Status: unvalidated

## A-007: An order can only be closed once its balance is fully covered
Basis: a till shouldn't "close" a ticket the customer hasn't paid; overpayment (change due) is fine.
Falsifier: café workflow closes tabs with an outstanding balance (e.g. staff comps, later billing).
Status: unvalidated

## A-008: A refund only applies to an already-closed order
Basis: you refund a completed sale; an open ticket is edited with a void, not refunded.
Falsifier: partial refunds are needed against an open tab, or refunds must reference the original
tender/settlement rather than the order.
Status: unvalidated

## A-009: Menu prices are VAT-inclusive and the order total is rate-independent
Basis: Irish menu prices include VAT, so the gross the customer pays is the sum of line prices minus
discounts — independent of how VAT decomposes. The server verifies that gross.
Falsifier: a B2B/wholesale mode prices ex-VAT and adds tax on top.
Status: unvalidated

## A-011: The till is the pricing authority; the server verifies arithmetic, not price authenticity
Basis: the till works offline and snapshots `unitPriceMinor` / `vatRateBp` onto each line at sale
time (non-negotiables #2, #5). The server re-derives the order total from those snapshotted values
with the shared reducer and rejects an internally-inconsistent client total — but it trusts the line
prices the (authenticated, post-Sprint-4) device sent. It is not an independent price oracle.
Falsifier: a requirement to reject a device that charged a price not matching the server's current
menu (e.g. anti-fraud / franchise price control). Then the server must look prices up, not just
recompute — a real change to the offline-first model, and an ADR.
Status: unvalidated

## A-014: Baristas want modifiers as a sheet, not a submenu (from the plan)
Basis: my time behind the counter — a submenu costs a screen transition mid-rush.
Falsifier: watch 3 baristas use both; if the sheet is slower for more than one, revisit. (Sprint 3.)
Status: unvalidated

## A-015: A daily-used, home-screen-installed PWA is effectively exempt from ITP 7-day eviction
Basis: WebKit's `ResourceLoadStatisticsStore` expires against `operatingDatesWindowShort { 7 }` counted
in *operating days with no user interaction on the origin*, not calendar days — a till tapped every
morning never accrues a qualifying day. Apple's March 2020 WebKit post additionally stated home-screen
web-app first-party data is not expected to be deleted (recalled, not cited). So the real durability
risks are storage pressure, manual "Clear Website Data", quota-exceeded, OPFS/SQLite-wasm iOS bugs,
and device restore — not the 7-day timer. Drives [ADR 0005](decisions/0005-till-platform-web-pwa.md):
the mitigation is eviction *detection* (canary + server high-water reconciliation), not prevention.
Falsifier: the Sprint 1 durability test loses events on a home-screen-installed, daily-opened iPad
without website data being manually cleared; or WebKit source/Apple guidance contradicts the
home-screen exemption. Then persistence can't be assumed and the Capacitor native-SQLite adapter
becomes required, not optional.
Status: unvalidated
