-- migrate:up

-- Tenants are an ordinary CRUD table (not event-sourced). event_log.tenant_id references it.
create table if not exists tenants (
  id          uuid        primary key,
  name        text        not null,
  created_at  timestamptz not null default now()
);

-- The application role. Created here so the schema is self-contained and portable across any
-- Postgres (the no-lock-in promise). Ops sets its password/auth out of band — never a secret in a
-- migration. It deliberately has neither table ownership nor BYPASSRLS: tenant isolation depends on
-- that being true.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'batch_app') then
    create role batch_app login;
  end if;
end
$$;

grant usage on schema public to batch_app;

-- --- event_log: the append-only spine ---------------------------------------------------------
-- `generated always as identity` (rather than bigserial) so the server always assigns `seq` and no
-- separate sequence grant is needed on the insert path.
create table event_log (
  seq             bigint      generated always as identity primary key,
  event_id        uuid        not null,                        -- client-generated UUIDv7
  tenant_id       uuid        not null references tenants (id),
  device_id       uuid        not null,
  -- Non-negotiable #7: event-source exactly two aggregates. Cash-drawer movements (Sprint 4) will
  -- be modelled as ledger events, or widened here by a forward migration + an ADR if they warrant a
  -- third aggregate.
  aggregate_type  text        not null check (aggregate_type in ('order', 'ledger')),
  aggregate_id    uuid        not null,
  event_type      text        not null,
  payload         jsonb       not null,
  occurred_at     timestamptz not null,                        -- device clock, shown on receipts
  recorded_at     timestamptz not null default now(),          -- server clock, used for ordering
  -- The entire exactly-once guarantee: a reconnecting till that replays its outbox hits this and
  -- no-ops. Never a SELECT-then-INSERT in application code — that is a race, not a guarantee.
  unique (tenant_id, event_id)
);

-- Replay a single aggregate's stream, in server order.
create index event_log_aggregate_idx on event_log (tenant_id, aggregate_type, aggregate_id, seq);

-- Sync cursor and recorded-order scans.
create index event_log_recorded_idx on event_log (tenant_id, recorded_at, seq);

-- --- Row-level security: the backstop for tenant isolation -------------------------------------
alter table event_log enable row level security;
alter table event_log force row level security;   -- applies even to the table owner

-- Every transaction must `set local app.tenant_id = <uuid>` first. If it is unset this errors,
-- which fails closed (no rows) rather than leaking across tenants.
create policy tenant_isolation on event_log
  using (tenant_id = current_setting('app.tenant_id')::uuid)
  with check (tenant_id = current_setting('app.tenant_id')::uuid);

-- --- Grants: append-only. No UPDATE, no DELETE, not ever. --------------------------------------
grant select, insert on event_log to batch_app;
revoke update, delete on event_log from batch_app;

-- --- tenants RLS: the app sees only its own tenant row. Provisioning is an admin (owner) op. ----
alter table tenants enable row level security;
alter table tenants force row level security;   -- hardened identically to event_log

create policy tenant_self_read on tenants
  for select
  using (id = current_setting('app.tenant_id')::uuid);

grant select on tenants to batch_app;

-- migrate:down

-- Local reset only. Production is forward-only: it never rolls back and never drops the app role.
drop table if exists event_log;
drop table if exists tenants;
-- Release the role's remaining privileges (schema usage) before dropping it, or DROP ROLE fails on
-- the dependency. `drop owned by` is a no-op if the role never existed.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'batch_app') then
    execute 'drop owned by batch_app';
  end if;
end
$$;
drop role if exists batch_app;
