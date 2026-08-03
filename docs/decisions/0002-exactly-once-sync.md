# 0002 — Exactly-once sync via a unique (tenant_id, event_id) constraint

Date: 2026-08-03
Status: accepted

## Context

The till must take orders and cash with the wifi off and sync cleanly when it returns. A café's
network drops mid-batch, tablets sleep and replay their outbox, and two devices run the same tenant
offline at once. The one property the whole product sits on: every event lands **exactly once**, and
that must survive force-quits, mid-sync kills, and duplicate replays.

## Decision

- The client generates a **UUIDv7** `event_id` and reuses it on every retry — it is the idempotency
  key, stable across retries. Regenerating on retry defeats the entire mechanism.
- `event_log` has `unique (tenant_id, event_id)`. Append is `INSERT … ON CONFLICT (tenant_id,
  event_id) DO NOTHING RETURNING seq`. A duplicate hits the constraint and no-ops; the server
  returns the existing `seq` with `status: "duplicate"`. **Never** a `SELECT`-then-`INSERT` — that is
  a race, not a guarantee.
- Two uni-directional flows, never merged: transactions flow till→server (append-only, till wins);
  config flows server→till (server wins, read-only replica). Most conflicts vanish by construction.
- The till writes the domain event and its outbox row in **one SQLite transaction**; outbox rows are
  marked `synced_at`, never deleted.
- The server re-derives each order total from the shared `packages/domain` reducer and rejects a
  client/server mismatch, catching client bugs, version skew, and tampering in one move.

## Consequences

Makes easy: reconnect-and-replay is safe by default; partial batch success is normal and reported
per event; adding a second till needs no coordination.

Makes hard: nothing may depend on a client-assigned ordering (`seq` is server-assigned; `recorded_at`
orders, `occurred_at` only displays). Event ids must be genuinely stable on the client across process
death — the outbox, not a fresh UUID per attempt, is the source of truth.

To reverse: the idempotency contract is baked into the table constraint, the endpoint, and every
client outbox. Changing it after devices are in the field is a coordinated client+server migration.
Irreversible in practice.

## Alternatives rejected

- **Server-generated ids / dedup by content hash:** the client can't safely retry without risking a
  double-apply, and content hashes collide across legitimately identical events (two identical
  coffees).
- **A message broker / queue (Kafka, SQS):** operational weight this modular monolith explicitly
  rejects; the DB constraint already gives exactly-once.
- **Bidirectional sync with conflict resolution:** reintroduces the whole conflict problem on a flow
  that is uncontested by design.
