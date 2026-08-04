#!/usr/bin/env node
/**
 * Generate the till's theme from the design tokens — the single source of truth.
 *
 *   design/system/tokens.json  ──►  src/theme/tokens.css   (CSS custom properties)
 *                              └──►  src/theme/tokens.ts    (numeric tokens for TS logic)
 *
 * Sprint 3 task 1: "Tokens are the single source; no hardcoded hex values anywhere in apps/till."
 * The generated `tokens.css` is the ONLY file in the app that may contain a colour literal — the
 * ESLint rule in the repo root bans hex in every other component file, and CSS reads `var(--color-*)`.
 *
 * Re-run after any design change:  pnpm --filter @batch/till tokens:gen
 * The output is committed so the build never depends on the design/ tree.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../../..')
const SRC = join(repoRoot, 'design/system/tokens.json')
const OUT_CSS = join(here, '../src/theme/tokens.css')
const OUT_TS = join(here, '../src/theme/tokens.ts')

const tokens = JSON.parse(readFileSync(SRC, 'utf8'))
mkdirSync(dirname(OUT_CSS), { recursive: true })

const BANNER = `/* GENERATED from design/system/tokens.json — do not edit by hand.\n   Regenerate: pnpm --filter @batch/till tokens:gen */\n`

// ---- CSS custom properties ---------------------------------------------------------------------
const lines = [':root {']
lines.push(`  color-scheme: light;`)
for (const [name, value] of Object.entries(tokens.color)) {
  lines.push(`  --color-${name}: ${value};`)
}
lines.push(`  --font-family: '${tokens.type.family}', system-ui, -apple-system, 'Segoe UI', sans-serif;`)
for (const [name, t] of Object.entries(tokens.type)) {
  if (name === 'family') continue
  lines.push(`  --type-${name}-size: ${t.size}px;`)
  lines.push(`  --type-${name}-weight: ${t.weight};`)
  lines.push(`  --type-${name}-line: ${t.lineHeight}px;`)
}
for (const [name, value] of Object.entries(tokens.space)) {
  lines.push(`  --space-${name}: ${value}px;`)
}
for (const [name, value] of Object.entries(tokens.radius)) {
  lines.push(`  --radius-${name}: ${name === 'pill' ? '999px' : `${value}px`};`)
}
for (const [name, value] of Object.entries(tokens.touch)) {
  lines.push(`  --touch-${name}: ${value}px;`)
}
lines.push('}')
writeFileSync(OUT_CSS, BANNER + lines.join('\n') + '\n')

// ---- TS numeric tokens (for logic that needs px numbers, not CSS vars) ------------------------
const ts = `${BANNER.replace(/\/\*|\*\//g, (m) => (m === '/*' ? '/**' : '*/'))}
/** Touch-target sizes in px (SPEC minimums: 48 min, 64 primary). */
export const TOUCH = ${JSON.stringify(tokens.touch)} as const

/** Spacing scale in px. */
export const SPACE = ${JSON.stringify(tokens.space)} as const

/** Corner radii in px (pill is rendered as 999). */
export const RADIUS = ${JSON.stringify(tokens.radius)} as const
`
writeFileSync(OUT_TS, ts)

console.log(`tokens: wrote ${OUT_CSS} and ${OUT_TS}`)
