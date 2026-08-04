import type { LocalStore } from '@batch/storage'

/**
 * The till's on-device schema. Three tables:
 *
 * - `events`   — the local event log, the source of truth for order state. Money lives in `payload`
 *                as JSON with amounts as decimal strings (never a JSON number), and never in an
 *                INTEGER column — see `packages/storage/CLAUDE.md`.
 * - `outbox`   — one row per event, tracking sync status. `synced_at` is set on acknowledgement and
 *                the row is NEVER deleted (ADR 0002 / apps/till write path).
 * - `device_meta` — small key/value: the device's own id and bookkeeping.
 *
 * `device_seq` is a device-local monotonic counter assigned inside the same transaction as the
 * insert, giving a stable local order for draining the outbox oldest-first.
 */
export const LOCAL_SCHEMA_STATEMENTS: readonly string[] = [
  `create table if not exists events (
     event_id             text    primary key,
     aggregate_type       text    not null,
     aggregate_id         text    not null,
     event_type           text    not null,
     payload              text    not null,
     occurred_at          text    not null,
     expected_total_minor text,
     device_seq           integer not null unique,
     created_at           text    not null
   )`,
  `create table if not exists outbox (
     event_id   text    primary key references events (event_id),
     synced_at  text,
     server_seq text,
     attempts   integer not null default 0,
     last_error text
   )`,
  `create index if not exists outbox_unsynced_idx on outbox (synced_at)`,
  `create table if not exists device_meta (
     key   text primary key,
     value text not null
   )`,
]

/** Apply the local schema. One statement per execute — the portable floor across adapters. */
export async function migrateLocal(store: LocalStore): Promise<void> {
  for (const stmt of LOCAL_SCHEMA_STATEMENTS) {
    await store.execute(stmt)
  }
}
