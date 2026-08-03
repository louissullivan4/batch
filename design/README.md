# design/

Where Claude Design output lands so Claude Code can consume it.

```
design/
├── MANIFEST.md              what exists, which sprint needs it
├── system/
│   ├── tokens.json          ← REQUIRED. machine-readable. the important one.
│   ├── tokens.md            human-readable with contrast ratios
│   └── components.png       visual reference
├── sprint-03-till/
│   ├── SPEC.md              ← REQUIRED. annotations, states, measurements
│   ├── order-entry.png
│   ├── modifier-sheet.png
│   └── cash-tender.png
├── sprint-04-cash/
├── sprint-05-payments/
└── sprint-06-admin/
```

## Why tokens.json is mandatory and PNGs are not

Claude Code can read images, but eyeballing a hex value off a screenshot is guesswork and it will
sometimes be wrong by a few points. Colours, spacing, radii and type sizes must arrive as text.

Every design prompt in `docs/design-prompts/` asks Claude Design to emit a JSON token block
alongside the visuals for exactly this reason. If the output doesn't include one, ask for it before
you drop the folder in.

## SPEC.md is where the real information lives

A PNG shows what a screen looks like in one state. `SPEC.md` carries everything the image can't:

- every state each component has (default, pressed, disabled, loading, **offline**, error)
- what happens on tap, on long-press, on a failed action
- exact measurements where they matter (touch target sizes, safe areas)
- which decisions were driven by the café environment rather than aesthetics
- anything deliberately left undesigned, and why

Claude Code implements from `SPEC.md` and uses the images as reference. A folder with beautiful
PNGs and no SPEC will produce a beautiful screen that does nothing sensible when the network drops.

## Dropping designs in

1. Create the folder for the sprint (`design/sprint-03-till/`)
2. Save the PNGs and write `SPEC.md`
3. Update `design/MANIFEST.md`
4. Run `/sprint 3` again — the gate should now pass
