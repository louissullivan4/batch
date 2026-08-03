# DP-05 — Back office

**Gates Sprint 6.**
Paste into Claude Design. Output goes to `design/sprint-06-admin/`.

---

Continuing Batch, the POS for Irish coffee shops. Established tokens, but this is
**desktop web at 1440x900**, not tablet — different constraints entirely. Mouse and
keyboard, no glare problem, no gloved hands. Density is now an asset rather than a
liability, and touch targets can drop to normal web sizing.

The user is an owner-operator, not technical, doing this in an office or at home after
close. They are comparing this to a spreadsheet, and the spreadsheet is winning on
familiarity.

SCREEN 1 — MENU EDITOR
Products, prices, modifier groups. The awkward part: VAT rate depends on both the
product AND whether it's eaten in or taken away, so a single coffee can carry two
different rates. Make that comprehensible to someone who has never thought about VAT
bands. This is the hardest information design problem in the set.

SCREEN 2 — CONFIG PUBLISH
Changes are staged, then published to the tills as a versioned set. Show what's
changed since the last publish, and make it obvious that tills won't see edits until
publish happens. An owner who changes a price and doesn't understand why the till
still shows the old one will lose trust in the whole system.

SCREEN 3 — SALES LIST
Read-only, projected from events. Filterable by date, staff, tender type. Drill into
an order to see its lines.

Nothing here is editable — ever — and the design should make that feel like integrity
rather than a limitation.

SCREEN 4 — DEVICES
Register, name, revoke a till. Show last-sync time and current config version, so an
owner can tell at a glance whether a till is up to date.

SCREEN 5 — STAFF
Add, set PIN, assign role.

FOR EVERY SCREEN, ALSO SPECIFY IN WRITING
- Empty, loading, and error states
- Destructive action confirmations, especially device revocation
- How a stale till is surfaced
- Navigation structure across the whole back office

DELIVERABLE
Annotated screens, a navigation map, plus SPEC.md.
