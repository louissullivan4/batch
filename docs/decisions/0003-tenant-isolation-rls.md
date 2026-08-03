# 0003 — Tenant isolation via RLS and a per-transaction app.tenant_id

Date: 2026-08-03
Status: accepted

## Context

Batch is multi-tenant from day one (the data model supports multi-site even though the UI waits). A
single cross-tenant leak — one café seeing another's sales — is a trust-ending, possibly reportable
event. Application-level `WHERE tenant_id = ?` filters are one forgotten clause away from a leak, and
connection pooling means any session-level state bleeds across tenants.

## Decision

- Every tenant-scoped table enables **row-level security** with a `tenant_isolation` policy:
  `tenant_id = current_setting('app.tenant_id')::uuid`, plus a matching `WITH CHECK` so a row cannot
  be inserted for another tenant. `event_log` additionally uses `FORCE ROW LEVEL SECURITY` so even
  the table owner is subject to it.
- The tenant is set **per transaction**, never per session:
  `select set_config('app.tenant_id', $1, true)` — the parameterised, transaction-local form of
  `SET LOCAL`. (`SET LOCAL app.tenant_id = $1` cannot bind a parameter, so the literal from the
  design docs would not work; `set_config(..., true)` does and is injection-safe.)
- The application connects as **`batch_app`**, which is deliberately not a superuser and has no
  `BYPASSRLS`. RLS is the backstop; the `set_config` in `withTenantTx` is the primary control. Both
  must be present.
- Query bodies do **not** repeat `tenant_id = …`; the policy adds it. A missing predicate then fails
  closed (no rows) instead of leaking.

## Consequences

Makes easy: a forgotten filter can't leak — the database enforces isolation regardless of
application bugs; the app role literally cannot rewrite `event_log` (update/delete revoked).

Makes hard: every DB access must go through `withTenantTx`; a stray query on a raw pooled connection
without the GUC set will see nothing (fail-closed) — surprising until you know the rule. Admin/ops
work that spans tenants needs a separate, deliberate role.

To reverse: isolation is wired into every table policy, the connection role, and the transaction
helper. Loosening it is easy and dangerous; tightening it later (retrofitting RLS onto tables that
launched without it) means re-checking every historic access path. Decide it now, once.

## Alternatives rejected

- **Application-only `WHERE tenant_id`:** one forgotten clause is a leak; no backstop.
- **Schema- or database-per-tenant:** heavy to provision and migrate at this scale, and cross-tenant
  reporting later becomes painful. Revisit only if a tenant needs physical data residency.
- **Session-level `SET app.tenant_id`:** pooled connections carry it across tenants — the exact leak
  we are preventing.
