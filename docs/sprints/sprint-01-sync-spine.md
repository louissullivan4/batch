---
sprint: 1
name: sync-spine
title: Sync spine
requires_design: false
design_assets: []
design_prompt: null
estimate_hours: 20-30
---

# Sprint 1 — Sync spine

**Goal:** close the offline→server loop. The server half already exists and is verified against real
Postgres (`event_log`, `POST /v1/sync/events`, exactly-once via `unique (tenant_id, event_id)`, RLS,
append-only). This sprint builds the **till half** — a local outbox that survives force-quits and bad
wifi and delivers every event **exactly once** — so the sync spine is whole.

**Why now, not Sprint 3:** the till half was always Sprint 1. It also unblocks Sprint 2, whose exit
criterion requires the reducer to be imported by *both* `apps/till` and `apps/api` — which needs a
till to exist. This sprint stands up the **minimum till** that exercises the spine, **not** the
barista UI (that is Sprint 3, gated on DP-01/DP-02). Build a plain dev harness screen, not screens.

## Design gate

None. Do **not** build the designed till UI here — a harness sufficient to generate and sync events is
the deliverable. Polished screens are Sprint 3.

## Decisions — ADRs

Both already written; read them before coding, don't re-open them:

- [ADR 0005](../decisions/0005-till-platform-web-pwa.md) — the till is a web app (Vite + React PWA),
  Capacitor-wrappable; all local persistence goes through the `@batch/storage` `LocalStore` seam;
  storage durability is handled by **detection**, not eviction prevention.
- [ADR 0002](../decisions/0002-exactly-once-sync.md) — exactly-once via the DB constraint; the till
  writes event + outbox row in one transaction; ids are client UUIDv7, stable across retries.

A new ADR is required only if something here forces an irreversible choice not already covered.

## Tasks

**1. Scaffold the web till — Vite + React + TypeScript, PWA-first**
- `vite-plugin-pwa` (Workbox), service worker **precaches the app shell** so the till **cold-loads
  with no network at all**. This is a first-class requirement, verified in exit criterion 4.
- No `fetch` on any order / cash / PIN path (non-negotiable #5).

**2. OPFS + SQLite-wasm adapter for `@batch/storage`**
- Implement the `LocalStore` interface (execute / select / transaction / close) over OPFS
  SQLite-wasm. This is the **one** adapter this sprint ships; a Capacitor adapter must remain a
  future single-file addition with zero caller changes.
- Local schema: an `events` table and an `outbox` table. **Money and any 64-bit value are TEXT**, not
  INTEGER (see `packages/storage/CLAUDE.md`).
- Run the contract test (`packages/storage/src/index.test.ts`) against this adapter too — it must pass
  unchanged.

**3. Outbox write path**
- The domain event and its outbox row are written in **one `LocalStore.transaction`**.
- Event ids are **client-generated UUIDv7**, reused verbatim on every retry (the idempotency key).
- Outbox rows carry a device-local monotonic sequence and are marked `synced_at`; **never deleted**.

**4. Sync client**
- Drains the outbox to `POST /v1/sync/events` **per event when online**, not on a timer.
- Handles `accepted` / `duplicate` / `rejected` per event; a `duplicate` is success (marks
  `synced_at`), a `rejected` surfaces loudly. Never deletes an unsynced row.
- Reconnect replays the outbox; the server dedups — the client must tolerate the same event returning
  `duplicate` without creating a second row or losing the row.

**5. Storage durability & eviction detection** (ADR 0005; the mitigation is *never lose silently*)
- Request `navigator.storage.persist()` on first launch; record the result.
- **Canary:** device-registration token in `localStorage`, events in OPFS. Token present + empty event
  store ⇒ eviction, not first run.
- **Server high-water reconciliation on startup:** the server exposes the max sequence it holds for
  the authenticated device; if it is ahead of the local store, alarm and resync down. *(Small
  server-side read; the only server work this sprint.)*
- Surface **unsynced count and age** in the harness UI with a threshold warning.

**6. Import the shared reducer in the till**
- `apps/till` imports order logic from `@batch/domain` — the same module `apps/api` imports. Verified
  by grep. (This is what makes Sprint 2's cross-import criterion satisfiable.)

## Exit criteria

Criteria 1–4 are the sync properties and **gate Sprint 2**. Criterion 5 is runnable in about an hour
and should be, but its hardware confirmation can proceed in parallel. All five are ultimately verified
on a real home-screen-installed iPad; the automated proxies below (a dead endpoint for "offline", a
re-opened store over the same OPFS file for "force-quit", two store instances against one server for
"two devices") are the CI-level stand-ins, not a substitute for the device run.

1. **Airplane mode.** With the network off: a full order is taken, cash tendered, and a staff PIN
   validated locally; every event queues in the outbox; nothing is lost.
2. **Force-quit.** Killing the app mid-order and mid-sync loses and duplicates nothing on relaunch —
   the outbox is the source of truth and UUIDv7 ids are stable across process death.
3. **Two devices, one tenant, offline then reconnect.** All events from both land **exactly once**;
   the server dedups via `unique (tenant_id, event_id)` — no coordination between devices.
4. **Reconnect-replay & cold-load.** Replaying the outbox returns `duplicate` (existing `seq`), never
   a second row; and the installed app **cold-loads with no network** and reaches first tap.
5. **Storage durability and eviction detection.** Install to home screen; confirm `persist()` returns
   true. Write 20 unsynced events, force-quit, reboot the iPad, reopen — all 20 present. Then clear
   website data and confirm the **canary + server high-water** detect the eviction and resync from the
   server rather than starting silently empty.

## Do not

- Build the Sprint 3 barista UI, modifier sheets, or any designed screen. A dev harness that generates
  and syncs events is enough.
- Pull in Sprint 4 cash/shift reducers or Sprint 5 card flows. Stub what the harness needs.
- Add a second `LocalStore` adapter, or reach past the interface to the OPFS engine from calling code.
- Sync anything server→till beyond the device high-water read (config pull is its own later work).
