# infra

Deployment and database operations for Batch. Everything here is portable — the API runs from
`Dockerfile.api`, migrations are plain SQL via dbmate. No Railway-specific primitives.

## Environment

Create a local `.env` (gitignored — never commit real credentials). The API reads:

| Var | Required | Purpose |
|---|---|---|
| `NODE_ENV` | no (default `development`) | `development` \| `test` \| `production` |
| `HOST` | no (default `0.0.0.0`) | bind address |
| `PORT` | no (default `3000`) | listen port |
| `DATABASE_URL` | no locally, **yes** in prod | app connection. Without it, only `/healthz` + `/readyz` come up and `/v1/sync/events` is disabled |

The app connects as the **`batch_app`** role — deliberately not a superuser and without `BYPASSRLS`,
because tenant isolation depends on that. Provision its password out of band; never in a migration.

For migrations and the read-only MCP inspector, also set (in your shell, not in a committed file):

- `DATABASE_URL` for dbmate — **point at a local database only, never production**.
- `BATCH_DB_READONLY_URL` for the MCP postgres server (see `docs/setup.md`).

## Migrations (dbmate, forward-only)

```bash
dbmate new <name>     # create infra/migrations/<timestamp>_<name>.sql
dbmate up             # apply — LOCAL ONLY
dbmate status
```

Rules (enforced by `infra/migrations/CLAUDE.md` and the `protect-migrations` hook):

- Forward-only. Never edit a migration that has been applied anywhere — write a new one.
- Every tenant-scoped table gets RLS + a `tenant_isolation` policy.
- Append-only tables (`event_log`) `revoke update, delete` from `batch_app`.
- Money columns are `BIGINT` named `*_minor`.

`20260803120000_create_event_log.sql` creates `tenants`, the append-only `event_log`, RLS on both,
and the `batch_app` role. It has **not** been applied in this environment (no live database here) —
run `dbmate up` against a local Postgres to apply it.

## Running the API

```bash
pnpm --filter @batch/api dev      # tsx watch, local
docker build -f infra/Dockerfile.api -t batch-api .
docker run --rm -p 3000:3000 -e DATABASE_URL=... batch-api
```

## Sprint 0 items still owned by you (need the Railway/Postgres environment)

- [ ] Railway project + Postgres in an **EU region**; `git push` deploys.
- [ ] Nightly `pg_dump` → Cloudflare R2 (scheduled via `pg-boss`).
- [ ] **Restore one R2 dump into a scratch database and confirm it works** — do this while the DB is
      empty and the stakes are zero.
- [ ] Verify `wal_level` (logical) if you want PowerSync/Electric underneath later.
