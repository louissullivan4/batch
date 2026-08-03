# DP-01 — Design system

**Run during Sprint 2. Gates Sprint 3.**
Paste into Claude Design. Output goes to `design/system/`.

---

I'm designing Batch — a point-of-sale system for independent coffee shops and small
retailers in Ireland. I need a design system before any screens.

CONTEXT
The name works three ways: settlement batch, batch brew, batch of stock. Users are
baristas aged roughly 20-35 during a morning rush, and owner-operators doing cash-up
at 6pm. The product's whole thesis is that existing POS systems are slow, ugly, and
take days to learn. Target: a new barista takes a correct order within five minutes
of first use, unaided.

ENVIRONMENT — these drive the visual decisions, not taste
- iPad landscape, 11-inch, 1194x834pt. Design at that size.
- Bright cafés with windows and glare. Contrast must be aggressive: 7:1 on anything
  carrying meaning, not the 4.5:1 minimum.
- Wet and gloved hands are the normal case, not an edge case.
- No cursor, so no hover state may carry information.
- Light mode primary, dark mode secondary.

CONSTRAINTS
- Minimum touch target 48pt. Primary actions 64pt.
- Legible at arm's length on a counter-mounted tablet.
- Colour alone never encodes state — pair it with shape or text.
- Offline is normal operation, not an error. It needs an indicator that reads as
  neutral. Never red, never a warning.

BRAND DIRECTION — override me if you have something stronger
Warm but precise. Not another blue SaaS product, and not coffee-shop twee: no brown,
no kraft paper, no hand-drawn cups. It should feel like a well-made tool. Warm
off-white base, near-black text, one confident saturated accent for primary actions.

DELIVERABLE — design system only, no screens yet

1. Colour palette, hex values, with measured contrast ratios against the surface
   colour. Semantic roles: surface, raised, text, text-muted, accent, accent-pressed,
   success, warning, destructive, offline-neutral, border.
2. Type scale — sizes, weights, line heights, annotated with where each is used.
3. Spacing scale and radius scale.
4. Component specimens at real size:
   - primary and secondary buttons, default and pressed
   - a menu item tile as it appears in the order grid
   - an order line: quantity, name, modifiers, price
   - a modifier chip, selected and unselected
   - a numeric keypad key
   - a status pill: syncing, offline, synced
   - the offline indicator

5. REQUIRED — a machine-readable token block I can save as tokens.json:

```json
{
  "color": { "surface": "#......", "...": "..." },
  "type":  { "display": { "size": 32, "weight": 700, "lineHeight": 38 } },
  "space": { "xs": 4, "sm": 8, "...": 0 },
  "radius":{ "sm": 4, "...": 0 },
  "touch": { "min": 48, "primary": 64 }
}
```

Emit this as literal JSON in a code block. My engineering setup consumes it directly
and hardcoded hex values are banned in component code, so if it isn't in the JSON it
can't be built.

Annotate anything where the café environment drove the decision rather than
aesthetics. I'll ask for screens once this is settled.
