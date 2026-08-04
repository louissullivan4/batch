-- migrate:up

-- ADR 0006: event-source three aggregates — order, shift, ledger. `shift` earns aggregate status
-- (real lifecycle: no double-close, no double-Z); `ledger` stays declared-but-unwritten until the
-- finance module. Done now, while event_log is empty, so Postgres does not have to revalidate any
-- historic row against the widened constraint.
--
-- The original migration (20260803120000) declared the CHECK inline and unnamed; Postgres named it
-- `event_log_aggregate_type_check` (single-column check → `<table>_<column>_check`). That migration
-- is applied and frozen (forward-only), so we drop the constraint by that name and re-add the widened
-- form rather than editing it. `if exists` keeps this replayable and safe against a fresh DB where the
-- name may differ only in edge cases.
alter table event_log drop constraint if exists event_log_aggregate_type_check;
alter table event_log
  add constraint event_log_aggregate_type_check
  check (aggregate_type in ('order', 'shift', 'ledger'));

-- migrate:down

-- Narrow back to the original two aggregates. Local reset only; production is forward-only.
alter table event_log drop constraint if exists event_log_aggregate_type_check;
alter table event_log
  add constraint event_log_aggregate_type_check
  check (aggregate_type in ('order', 'ledger'));
