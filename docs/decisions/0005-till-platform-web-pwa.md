# 0005 — The till is a web app (PWA-first), Capacitor-wrappable, not React Native

Date: 2026-08-04
Status: accepted
Supersedes: the Expo/React Native assumption in the original layout and in `apps/till`.

## Context

The till has to open tabs, take cash and validate PINs with the wifi off (non-negotiable #5), drive a
card reader, and print to a receipt printer. The earlier plan assumed those peripherals forced a
native runtime (Expo dev build, `op-sqlite`). Re-checking the actual integration surfaces, they do
not:

- **Card payments.** Stripe Terminal's **JS SDK** drives its networked/Bluetooth readers (WisePOS E,
  BBPOS) straight from a browser. A native SDK buys nothing for the reader models we target.
- **Receipt printing.** Epson TM and Star LAN printers expose **ePOS over HTTP** on the local
  network. A browser `fetch` to the printer's IP prints. No native bridge required.

So peripherals do not force native. A web app removes the Expo build/EAS/native-module tax, gives us
one codebase for iPad and Android tablet, and lets `apps/admin` and `apps/till` share the same React
toolchain.

The one thing that genuinely threatens a web till is **storage durability**: if the browser evicts
OPFS/IndexedDB, a till holding *unsynced* orders and cash events loses **money that never reached the
server** — not a cache miss. But the popular framing of that risk (the "iOS deletes your data after
7 days" line) is **the wrong failure mode**, and getting it wrong would make us test the wrong thing:

- **The ITP 7-day window is not 7 calendar days.** WebKit's `ResourceLoadStatisticsStore` counts
  *operating days* — days the browser actually ran — with **no user interaction on your origin**, and
  expires against `operatingDatesWindowShort { 7 }`. A till someone taps every morning **never
  accrues a single qualifying day**, so the window never elapses.
- **Home-screen web apps are further exempt.** An installed (Add to Home Screen) app is not part of
  Safari, keeps its own days-of-use counter, and — per Apple's March 2020 WebKit post — its
  first-party data is not expected to be deleted. *(That last point is recalled, not cited here;
  treat it as a claim to verify — the source-code mechanic above independently gets us to the same
  conclusion. Logged with a falsifier in `docs/assumptions.md`.)*

So ITP eviction is close to a **non-issue** for a daily-used, home-screen-installed till. The risks
that are actually real are none of them time-based and none fixed by waiting:

1. **Storage pressure** as the iPad fills — non-deterministic, no warning.
2. **"Clear History and Website Data"** — a plausible barista/owner action.
3. **Quota exceeded** mid-write.
4. **OPFS / SQLite-wasm bugs on iOS** — the least mature part of the stack.
5. **Device restore or migration.**

And the key reframe: **eviction risk and unsynced-data risk are anti-correlated.** Eviction targets
*idle* apps; unsynced events accumulate in *actively used, offline* apps. The dangerous overlap — a
till in heavy use, offline for days, that also gets wiped — is a narrow window, and it shrinks
further if we **sync per event** rather than on a timer. So the correct engineering response is not to
*prevent* eviction (we largely can't, and mostly don't need to) but to **detect it and never lose
silently**, backed by the Capacitor escape hatch when detection shows real, repeated loss.

## Decision

- **`apps/till` is a web app: Vite + React + TypeScript, PWA-first.** `vite-plugin-pwa` (Workbox)
  generates a service worker that **precaches the app shell**, so the till loads with **no network at
  all** — not merely "works offline once it has been loaded in a good-wifi session". Cold-loading on a
  dead network is a first-class requirement, verified in Sprint 1.
- **We build for Capacitor from day one as the escape hatch, without adopting it yet.** The whole
  point of the risk above is that we must be able to move to a **native SQLite store** (durable,
  never evicted) by shipping *one new file*, not by rewriting the app. That requirement is encoded as
  a hard architectural constraint, not a good intention:
  - All local persistence goes through the **`LocalStore` interface in `packages/storage`** (a
    SQL-shaped, backend-agnostic contract). See its `CLAUDE.md`.
  - Sprint 1 implements **exactly one** adapter: **OPFS + SQLite-wasm**.
  - A **Capacitor SQLite** adapter must later be addable as a **single new file with zero changes to
    calling code**. If adding it forces edits anywhere but that file, the abstraction has leaked and
    the decision has failed.
- **Detection is the primary durability control; the Capacitor swap is the fallback.** Because the
  real risks (pressure, clear-data, quota, wasm bugs, restore) can't be reliably *prevented* in the
  browser, Sprint 1 makes silent loss impossible instead:
  - request `navigator.storage.persist()` on first launch and record what it returns;
  - **sync per event** when online, so the unsynced window is as small as connectivity allows;
  - the server tracks a **per-device high-water mark**; on startup the till reconciles its local max
    against it — server ahead means the local store was wiped, and those events are safe on the
    server, so the till **alarms and resyncs down** rather than starting silently empty;
  - a **canary** in a *different* store (device token in `localStorage`, events in OPFS) distinguishes
    eviction (token present, event store empty) from a genuine first run;
  - unsynced **count and age** are visible in the UI, with an operator warning past a threshold.
  The Capacitor/native-SQLite adapter is what we reach for **if** detection shows real, repeated loss
  on real hardware — not something we pay for pre-emptively.
- Peripheral access stays on web APIs: **Stripe Terminal JS** for card, **ePOS-over-HTTP** for
  printing. Both are deferred to their sprints (5 and 3/4); we only avoid designing anything that
  assumes a native bridge.

## Consequences

Makes easy: one React toolchain across till and admin; instant deploys with no app-store review; the
same reducer imported by `apps/till` and `apps/api` (non-negotiable #6) with no RN packaging seam.

Makes hard: we now **own** the storage-durability problem. It is not hand-waved — Sprint 1 gains an
exit criterion that a home-screen-installed iPad, after `persist()` returns true, retains 20 unsynced
events across a force-quit and reboot, **and** that clearing website data is *detected* (canary +
server high-water) and resynced rather than silently starting empty. If OPFS proves unreliable on
real hardware, the Capacitor adapter is the pre-built answer, and the `LocalStore` seam is what makes
swapping it cheap. Web also means no native module for a card reader
that only ships an SDK for one — a constraint we accept by choosing reader hardware with a JS SDK.

To reverse: if the web sandbox proves untenable even with Capacitor, moving to native RN is a real
rewrite of the shell — but **not** of the domain (`packages/domain`), the sync client, or storage
callers, all of which are UI- and backend-agnostic by construction. The blast radius is the shell,
which is the point of keeping the seams where they are.

## Alternatives rejected

- **React Native / Expo (the original plan):** native build tax, EAS, two packaging targets, and a
  native-module bridge — all to solve a peripheral problem that Stripe Terminal JS and ePOS-over-HTTP
  already solve in the browser. Its one real advantage (durable native storage) we keep on the shelf
  as the Capacitor escape hatch.
- **Web with no Capacitor plan:** ignores the iOS eviction risk until it eats a café's unsynced
  takings. Unacceptable for money data.
- **Capacitor from day one (native SQLite now):** adds a native build target before we know we need
  it, giving up instant web deploys. We defer the cost until the durability test tells us to pay it —
  the `LocalStore` seam keeps that option a one-file change.
