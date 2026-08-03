---
sprint: 6
name: back-office
title: Back office — thin slice
requires_design: true
design_assets:
  - design/system/tokens.json
  - design/sprint-06-admin/SPEC.md
design_prompt: docs/design-prompts/DP-05-back-office.md
estimate_hours: 25
---

# Sprint 6 — Back office, thin slice

**Goal:** change a price in admin, watch the till pick it up, and confirm yesterday's receipts are
byte-identical.

**Prerequisite:** Sprint 5 exit criteria pass.

## Design gate — BLOCKING

Requires `design/sprint-06-admin/SPEC.md`. Desktop web, not tablet — different constraints entirely
from the till. Run `/design-brief 6`.

## Tasks

**1. Auth** — session-based. Better Auth or hand-rolled. Not Auth0, not at this stage.

**2. Menu editor** — products, prices, modifiers, VAT rate per product **and fulfilment mode**.

**3. Config publish** — monotonic version. The till applies a config atomically or not at all; a
half-applied menu is worse than a stale one.

**4. Sales list** — read-only, projected from events. No editing. Ever.

**5. Device management** — register, name, revoke a till.

**6. Staff** — add, set PIN, assign role.

## Exit criteria — the one that validates Sprint 2

- [ ] Change a price in admin → till picks it up on next config sync → **yesterday's receipts are
      byte-identical**

If they changed, the snapshot rule is broken. Stop and fix it before any real money moves through
the system — this is the last cheap moment to catch it.

- [ ] Config applies atomically; a killed sync leaves the previous version intact
- [ ] A revoked device cannot sync
- [ ] No admin screen can mutate a historic order

## Do not

- Reporting dashboards, the finance module, stock, or multi-site. M2 and beyond.
