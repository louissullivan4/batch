# Batch — First Implementation Steps

**Milestone 1: a till that can run a real shift offline.**

Everything in this document builds toward one thing: an iPad in a café that takes orders and cash with the wifi switched off, and syncs cleanly when it comes back. Not a product. A spine you can hang modules on.

---

## 0. What we're skipping, and the cheap insurance

You're going straight to code without sponsor users. That's a defensible call — you spent years behind a counter, so you're not guessing about the domain the way most founders are. But it does cost you two things:

1. **You'll build for the shop you worked in.** Your muscle memory for order entry is one shop's workflow, not the market's.
2. **You lose the free distribution.** Sponsor users become your first paying customers and your first referrals. Skipping them means a colder start later.

Neither is fatal, and neither needs solving now. The insurance is a single file:

**`docs/assumptions.md`** — every time you make a domain call from memory, log one line: the assumption, why you believe it, and what would disprove it.

```markdown
## A-014: Baristas want modifiers as a sheet, not a submenu
Basis: my experience — submenus cost a screen transition mid-rush.
Falsifier: watch 3 baristas use both. If sheet is slower for >1, revisit.
Status: unvalidated
```

Costs thirty seconds per entry. When you eventually put Batch in front of a real café, this file becomes your test script instead of a vague feeling that something's off. Write it as you go — retrofitting it is impossible.

---

## 1. Definition of done for Milestone 1

Not "it works on my machine." M1 is done when all of these are true:

- [ ] A real iPad in airplane mode can open a tab, add items with modifiers, void a line, split the bill, tender cash, and print/display a receipt.
- [ ] Force-quitting the app mid-shift loses nothing.
- [ ] Reconnecting syncs every event exactly once, verifiable in Postgres.
- [ ] A 50-order mock shift cashes up to the penny.
- [ ] Changing a price in the back office does not alter yesterday's receipts.
- [ ] You've restored the production database from a backup at least once.

If you can demo that, you have something a café owner can react to. Everything before that is scaffolding.

---

## 2. Time budgeting

Estimates below are in **focused hours**, not calendar weeks, because you have a day job. Rough translation:

| Pace | Hours/week | M1 lands in |
|---|---|---|
| Evenings only | ~6 | ~7 months |
| Evenings + one weekend morning | ~10 | ~4 months |
| Weekends heavy | ~16 | ~2.5 months |
| Full-time | 40 | ~5 weeks |

Total M1: **~170–200 focused hours.** Treat that as a floor. Halve your confidence in Sprint 3 specifically — UI always overruns.

---

## 3. Repo scaffold

```
batch/
├── apps/
│   ├── api/                 # Fastify + TypeScript
│   ├── till/                # Expo (dev build, not Expo Go)
│   └── admin/               # Vite + React
├── packages/
│   ├── domain/              # events, reducers, money — SHARED
│   ├── schemas/             # Zod → OpenAPI
│   └── config/              # tsconfig, eslint, prettier
├── infra/
│   ├── Dockerfile.api
│   └── migrations/          # plain SQL, dbmate
└── docs/
    ├── assumptions.md
    └── decisions/           # ADRs, one file per irreversible choice
```

**`packages/domain` is the load-bearing idea.** The order reducer — "what does this event do to an order" — is written once and imported by both the till and the API. The till computes a total; the server recomputes it with the identical code and rejects mismatches. No client/server drift in money maths, ever. This is the single biggest reason to accept TypeScript on the backend.

---

## Sprint 0 — Foundations
**~12–16h**

Boring, and the sprint people skip. Don't.

- pnpm workspaces + Turborepo, strict TS, ESLint, Prettier
- GitHub Actions: typecheck + test + build on push
- Railway project, Postgres in an **EU region**
- `dbmate` for migrations (plain SQL, zero lock-in, portable to anywhere)
- `/healthz` endpoint deployed and green
- **Nightly `pg_dump` → Cloudflare R2**, scheduled via `pg-boss`
- **Verify `wal_level`** — if you ever want PowerSync or Electric underneath, you need logical replication. Find out now.

**Exit criteria:** `git push` deploys. You have run one restore from an R2 dump into a scratch database and confirmed it works.

> That last one takes an hour and is the difference between a bad week and a dead company. Do it while the database is empty and the stakes are zero.

---

## Sprint 1 — The sync spine
**~20–30h — this is the spike, and it is the whole risk**

No UI. No menu. One button that emits a fake event. The goal is to prove exactly-once delivery under adversarial conditions.

### Server schema

```sql
create table event_log (
  seq             bigserial primary key,
  event_id        uuid        not null,   -- client-generated UUIDv7
  tenant_id       uuid        not null,
  device_id       uuid        not null,
  aggregate_type  text        not null,   -- 'order' | 'cash_drawer' | 'ledger'
  aggregate_id    uuid        not null,
  event_type      text        not null,
  payload         jsonb       not null,
  occurred_at     timestamptz not null,   -- device clock, for receipts
  recorded_at     timestamptz not null default now(),  -- server clock, for ordering
  unique (tenant_id, event_id)
);

alter table event_log enable row level security;

create policy tenant_isolation on event_log
  using (tenant_id = current_setting('app.tenant_id')::uuid);

revoke update, delete on event_log from batch_app;
```

Three things doing real work here:

- **`unique (tenant_id, event_id)`** is your idempotency. A till that reconnects and replays its outbox hits the constraint and no-ops. This is the entire exactly-once guarantee — everything else is plumbing.
- **`occurred_at` vs `recorded_at`.** Device clocks drift, especially on tablets that sleep. The receipt shows the device time; the ledger orders by server time. Conflating them will bite you at month-end.
- **`revoke update, delete`.** The audit trail is only worth something if the application literally cannot rewrite history. Enforce it in the database, not in code review.

Set the tenant per transaction with `set local app.tenant_id = $1` — never as a session default, or connection pooling will leak data across tenants.

### Till outbox (SQLite)

```sql
create table outbox (
  event_id     text primary key,
  aggregate_id text not null,
  event_type   text not null,
  payload      text not null,
  occurred_at  text not null,
  attempts     integer not null default 0,
  synced_at    text
);
```

Write the event and its outbox row **in one SQLite transaction**. If they can diverge, they will.

### Sync endpoint

`POST /v1/sync/events` — accepts a batch, returns per-event `{event_id, seq, status}`. Client marks `synced_at` only on acknowledgement. Never delete outbox rows; mark them.

### Exit criteria — run these literally

1. Airplane mode. Tap the button 20 times. Force-quit. Relaunch. Reconnect. → **exactly 20 rows.**
2. Sync again. → **still 20 rows.**
3. Kill the app *mid-sync*. Relaunch. → **still 20 rows, none missing.**
4. Two devices, same tenant, offline simultaneously. → **40 rows, no collisions.**

If all four pass, the hard part is behind you. If any fail, stop and fix it — building UI on a broken sync spine is how projects die at month five.

---

## Sprint 2 — Domain model
**~20–25h**

`packages/domain`, pure functions, no I/O, exhaustively tested.

### Money

`amount_minor: bigint` + `currency: 'EUR'`. Never floats. Never `NUMERIC`. Cents as integers ends the rounding argument permanently, and every rounding decision becomes explicit and testable.

### Order events

```
OrderOpened · LineAdded · ModifierApplied · LineVoided
DiscountApplied · OrderTendered · OrderClosed · OrderRefunded
```

### The snapshot rule

**Prices and VAT rates are frozen into the event at the moment of sale.** Store `unit_price_minor` and `vat_rate_bp` (basis points) on the line event itself — never a foreign key to the current product row.

Tomorrow's price change must not alter yesterday's receipt. Recomputing historic tax from current configuration is both a common bug and an audit failure, and it is very hard to unwind once you have real data. Get this right on day one.

### Server-side verification

The till sends its computed total. The server replays the same reducer from `packages/domain` and rejects on mismatch. Catches client bugs, version skew, and tampering in one move.

**Exit criteria:** property tests prove replay-equals-projection for random event sequences; totals are never negative; the identical reducer is imported by both apps.

---

## Sprint 3 — Till UI, cash only
**~40–50h — halve your confidence here**

- Fixed-grid menu, no scrolling for the top 20 items
- Modifier sheet on tap (per assumption A-014)
- Persistent order pane, one-tap void
- Split by item / evenly / by amount
- Cash tender with change calculation
- Receipt render

**Performance budgets, enforced in code:**

| Metric | Budget |
|---|---|
| Tap → visual response | <100 ms |
| Local order commit | <200 ms |
| Cold start → first tap | <3 s |

Instrument these from the first screen. Retrofitting performance into a React Native app is miserable; catching a regression the day it lands is trivial.

**Exit criteria:** you run a full mock shift on a real iPad, wifi off, start to finish, without touching a debugger.

---

## Sprint 4 — Shift & cash management
**~20h**

- Float declaration, paid in / paid out, skims, safe drops
- **Blind count** — the counter enters what they counted before seeing what's expected. Non-negotiable; a non-blind count is theatre.
- X report (mid-shift, non-destructive) and Z report (close, destructive)
- Variance with reason codes
- Staff PIN **validated locally** against a synced hash

That last point deserves emphasis: a PIN that needs a network round-trip is a till that stops working when the wifi does. Auth must be offline-first or the whole architecture is pointless.

**Exit criteria:** a 50-order mock shift with deliberate paid-outs and a planted £20 discrepancy reconciles to the penny and reports the variance correctly.

---

## Sprint 5 — Card payments
**~25–35h**

Semi-integrated only. Card data never touches your device, which keeps you out of PCI scope.

```ts
interface PaymentProvider {
  authorize(amountMinor: bigint, currency: string, ref: string): Promise<Result>
  capture(txId: string): Promise<Result>
  refund(txId: string, amountMinor: bigint): Promise<Result>
  void(txId: string): Promise<Result>
  adjustTip(txId: string, tipMinor: bigint): Promise<Result>
  fetchSettlements(from: Date, to: Date): Promise<Settlement[]>
}
```

Start with **Stripe Terminal** — best docs, sandbox readers, Irish company. Write a `StubProvider` first and build the entire tender flow against it, so the real integration is a swap rather than a rewrite.

**Exit criteria:** swapping `StubProvider` → `StripeTerminalProvider` requires zero changes outside `adapters/`.

---

## Sprint 6 — Back office, thin slice
**~25h**

- Session auth (Better Auth or hand-rolled — not Auth0, not at this stage)
- Menu and price editor
- **Config publish with a monotonic version number**
- Read-only sales list

**Exit criteria — the one that validates Sprint 2:** change a price in admin → the till picks it up on the next config sync → **yesterday's receipts are byte-identical.** If they changed, your snapshot rule is broken and you must fix it before any real money flows through the system.

---

## 4. Deliberately not building yet

Write these on a sticky note. Every hour spent here before M1 is an hour stolen from the thing that actually proves the product.

| Not yet | Why |
|---|---|
| KDS / order queue | Needs a working till first |
| Inventory depletion | Log the events now, project later |
| Double-entry ledger | Events are being recorded; build the ledger on top when finance lands |
| Loyalty, gift cards | Post-M1 |
| Social / marketing | Phase 4 in the design doc |
| Payroll | Integrate, never build |
| Multi-site | Data model supports it; UI can wait |
| Accounting exports | Sprint 7 — and it's your no-lock-in promise, so don't leave it too long |

The events you record from Sprint 1 onward mean none of this is blocked later. You're deferring the projections, not the data.

---

## 5. Guardrails

1. **Money is `bigint` minor units.** Add a lint rule banning `number` in money positions.
2. **Event-source exactly two aggregates** — orders and the ledger. Products, staff, settings, suppliers are boring CRUD tables. Event-sourcing everything is how solo founders vanish for six months.
3. **Project read models synchronously**, in the same transaction as the event append. Async projections at this scale buy you nothing and cost you weeks of consistency ghosts.
4. **One ADR per irreversible decision** in `docs/decisions/`. Sync strategy, money representation, tenancy model. Future-you and your first hire will both need the reasoning, not just the outcome.
5. **No Railway-specific primitives.** Everything in a Dockerfile. Given you already run Docker Compose on the pi fleet, Hetzner + Kamal is your natural graduation and roughly a tenth the cost at scale.
6. **Keep the till dumb about history.** It gets today's orders and the menu. The ledger stays server-side — it's slow to sync, and a device in a café is the wrong place for a merchant's financial history.

---

## 6. Day one

```bash
mkdir batch && cd batch && git init
pnpm init && pnpm add -D turbo typescript @types/node
mkdir -p apps/{api,till,admin} packages/{domain,schemas,config} infra/migrations docs/decisions
```

Then, in order:

1. `docs/assumptions.md` — log the first five things you know from behind the counter
2. `packages/domain/src/money.ts` — Money type and its tests, before anything else
3. Railway project, Postgres, EU region
4. `infra/migrations/001_event_log.sql`
5. `apps/api` — Fastify, `/healthz`, deployed

Sprint 1 starts when `/healthz` returns 200 from Railway and you've restored a backup once.