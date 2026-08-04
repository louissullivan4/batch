# Sprint 3 — on-device verification checklist

The Sprint 3 exit criteria that a build machine cannot prove. Run these on a **real iPad**
(landscape, 11", the target device) with the PWA installed to the home screen. Software is complete
and instrumented; these confirm it on the hardware the barista actually uses.

## Setup
1. `pnpm --filter @batch/till build && pnpm --filter @batch/till preview` (or deploy the built
   `dist/` to the test host). Serve over HTTPS — OPFS + service worker require a secure context.
2. On the iPad, open the URL in Safari, **Share → Add to Home Screen**. Launch from the home-screen
   icon (not the Safari tab) — that is the ITP-exempt, installed context (assumption A-015).
3. First launch online: enter the tenant id + API base URL, Connect. Confirm the reconcile lands
   and the order screen shows.
4. Open the diagnostics drawer once; note the device id and that "unsynced" reads 0.

## Criterion 1 — full mock shift, wifi off, no debugger
Turn on **Airplane mode** (or disable wifi) BEFORE taking any order. With no debugger attached:
- [ ] Cold-launch the installed app on the dead network — the shell loads and the order screen is
      usable (this proves the Workbox precache: shell + sqlite-wasm + worker + fonts).
- [ ] Take ≥10 orders end to end: tap items, open the modifier sheet, change milk/size/shots/syrups,
      Confirm, void a line (× → Remove), long-press a tile to add with defaults, Charge, tender cash
      (keypad + quick tenders), Complete, read the receipt, New sale.
- [ ] Include a "2× same drink" order (repeat tap merges to one `2×` line) and an edit (tap a line →
      Update line).
- [ ] The diagnostics drawer's unsynced count climbs as you sell and the age is shown.
- [ ] Re-enable wifi: the outbox drains automatically (unsynced → 0), no user action needed.
- [ ] Force-quit mid-order (swipe up) and relaunch: the app reopens cleanly; committed events are
      still present (open orders in progress are in-memory only and are expected to reset — only
      *committed* events must survive).

## Criteria 2–4 — latency budgets (instrumented; read the console once, on-device)
The app already records these to the console in dev via `src/perf.ts` (a red line prints on any
breach). Run a dev build once on the iPad (Safari Web Inspector attached from a Mac is fine here —
this is the measurement pass, not criterion 1's no-debugger run) and confirm:
- [ ] **Tap → visual response < 100 ms** — `[perf] tapResponse …` on every tile tap, never a breach.
- [ ] **Local order commit < 200 ms** — `[perf] localCommit …` on every add/void/tender.
- [ ] **Cold start → first tap < 3 s** — `[perf] coldStart …` once, on the first tap after a
      cold launch, under budget.
If any path breaches on the real device, that is a real regression — do not wave it through.

## Criterion 7 — screenshots vs the design PNGs
- [ ] Screenshot each of order entry, modifier sheet, cash tender, receipt on the iPad.
- [ ] Compare against `design/sprint-03-till/reference/screen-{1,2,3}-*.png`.
- [ ] Any deviation must be *explained* (a documented reading of `SPEC.md`), not accidental. Known
      explained deviation: the modifier sheet sits beside the order pane rather than floating over it,
      so the running total is never hidden (SPEC Screen 2: "the order pane remains visible at the
      right edge"; see the note in `apps/till/src/screens/OrderEntry/OrderEntry.tsx`).

## Also still open from earlier sprints (unchanged by Sprint 3)
- Sprint 1: the 7-day storage-durability run and the two-physical-device / eviction-recover runs.
- Sprint 0: Railway + Postgres (EU), nightly pg_dump → R2, restore drill, `wal_level` check.
