---
sprint: 3
name: till-ui
title: Till UI — cash only
requires_design: true
design_assets:
  - design/system/tokens.json
  - design/sprint-03-till/SPEC.md
  - design/sprint-03-till/reference/screen-1-order-entry.png
  - design/sprint-03-till/reference/screen-2-modifier-sheet.png
  - design/sprint-03-till/reference/screen-3-cash-tender.png
design_prompt: docs/design-prompts/DP-02-order-entry.md
estimate_hours: 40-50
---

# Sprint 3 — Till UI, cash only

**Goal:** run a full mock shift on a real iPad with wifi off, start to finish, without a debugger.

**Prerequisite:** Sprint 2 exit criteria pass.

## Design gate — BLOCKING

This sprint does not start without `design/system/tokens.json` and `design/sprint-03-till/SPEC.md`.

If they're missing: run `/design-brief 3`, paste DP-01 then DP-02 into Claude Design, drop the
output into `design/`, update `design/MANIFEST.md`, and re-run.

**Claude Code must not invent screens, colours, or spacing to unblock itself.** An improvised till
screen is worse than no screen — it looks finished, so it never gets revisited.

## Tasks

**1. Design tokens → code**
Generate the theme from `design/system/tokens.json`. Tokens are the single source; no hardcoded hex
values anywhere in `apps/till`. Add a lint rule banning colour literals in component files.

**2. Component primitives**
Build what `SPEC.md` specifies, at the sizes it specifies. Minimum touch target 48pt, primary
actions 64pt.

**3. Order entry screen**
Fixed grid, no scrolling for the top 20 items. Persistent order pane. Tap to add.

**4. Modifier sheet**
Per `SPEC.md`. Sensible defaults pre-selected so the common order is fewer taps.

**5. Cash tender**
Keypad, quick-tender denominations, change calculation via `packages/domain`.

**6. Receipt render**
On-screen for this sprint. Physical printing is Sprint 5 hardening.

**7. Offline states**
Every screen. Offline is normal operation — a neutral indicator, never a red banner, never a
blocking dialog.

**8. Performance instrumentation**
Log tap-to-render and local-commit latency in dev builds. Fail loudly on budget breach.

## Exit criteria

- [ ] Full mock shift on a real iPad, wifi off, no debugger
- [ ] Tap → visual response under 100ms
- [ ] Local order commit under 200ms
- [ ] Cold start to first tap under 3s
- [ ] Zero hardcoded colours outside the token file
- [ ] Every interactive component matches the touch-target minimum in `SPEC.md`
- [ ] A reviewer comparing screenshots to the design PNGs finds no unexplained deviation

## Do not

- Card payments, split bills, tabs, table service, KDS, loyalty. Later sprints.
- Reimplement order maths. Import from `packages/domain`.
- Put a `fetch` on the order, tender or PIN path.
