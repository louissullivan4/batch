# 0004 — VAT is extracted once per rate band

Date: 2026-08-03
Status: accepted

## Context

Irish menu prices are VAT-inclusive and a single ticket routinely mixes rates (a hot coffee eat-in at
13.5%, a chocolate bar at 23%, a cold takeaway sandwich at 0%). VAT therefore has to be *extracted*
from a gross amount, per rate, and the arithmetic has to be reproducible on both the till and the
server. The `irish-vat` skill describes one method (compute per line, sum, then reconcile the largest
line); this ADR pins the exact variant so the till and server never disagree by a cent.

## Context that makes this low-risk

`vatRateBp` is snapshotted onto every line event. The VAT breakdown is a **projection** recomputable
from stored events at any time; the amount a customer pays (the gross total) is rate-independent. So
the VAT method affects a report, not stored money — it is far less irreversible than money
representation, and can be refined without rewriting history.

## Decision

- Group active gross amounts (lines and modifiers) **by `vatRateBp`**. For each band, extract VAT
  **once** from the band's gross subtotal: `vat = gross * rateBp / (10000 + rateBp)`, rounded half
  away from zero. Order VAT is the sum across bands.
- When an order-level discount applies, allocate the post-discount total across bands by their
  pre-discount gross weight (largest-remainder), then extract per band — so the parts still sum to
  the total exactly.
- Do **not** compute VAT at the order level with a single rate and apportion it, and do not sum
  per-line roundings.

## Consequences

Makes easy: one rounding per rate (matches how a VAT return is filed), no per-line drift, exact
reconstruction from snapshotted events.

Makes hard: if a receipt must show VAT **per line** with the line figures summing to a per-line
rounding, that needs an extra step — allocate each band's VAT down to its lines by largest remainder.
Not built yet (see assumption A-002).

## Alternatives rejected

- **Order-level single-rate extraction:** wrong for mixed-rate tickets, which are the normal case.
- **Per-line extraction then sum:** accumulates rounding drift across a long ticket and complicates
  reconciliation; per-band is the reconciled form.
