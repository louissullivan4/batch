#!/usr/bin/env node
/**
 * Design gate check.
 *
 * Usage: node scripts/check-design-gate.mjs <sprintNumber>
 *
 * Exit 0 = gate passes (or sprint needs no design), safe to write code.
 * Exit 1 = gate fails. Claude Code must stop and not invent designs.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const n = process.argv[2]
if (!n) {
  console.error('usage: node scripts/check-design-gate.mjs <sprintNumber>')
  process.exit(1)
}

const pad = String(n).padStart(2, '0')
const dir = 'docs/sprints'

let file
try {
  file = readdirSync(dir).find((f) => f.startsWith(`sprint-${pad}-`))
} catch {
  console.error(`No ${dir}/ directory found. Run from the repo root.`)
  process.exit(1)
}

if (!file) {
  console.error(`No sprint file matching sprint-${pad}-* in ${dir}/`)
  process.exit(1)
}

const src = readFileSync(join(dir, file), 'utf8')
const fm = src.match(/^---\n([\s\S]*?)\n---/)
if (!fm) {
  console.error(`${file} has no frontmatter.`)
  process.exit(1)
}

const block = fm[1]
const title = (block.match(/^title:\s*(.+)$/m) || [, `Sprint ${n}`])[1].trim()
const needs = /^requires_design:\s*true\s*$/m.test(block)
const promptPath = (block.match(/^design_prompt:\s*(.+)$/m) || [, 'null'])[1].trim()

if (!needs) {
  console.log(`Sprint ${n} — ${title}`)
  console.log('No design gate. Safe to proceed.')
  process.exit(0)
}

const assetsRaw = block.match(/^design_assets:\n((?:\s*-\s*.+\n?)*)/m)
const assets = assetsRaw
  ? assetsRaw[1]
      .split('\n')
      .map((l) => l.replace(/^\s*-\s*/, '').trim())
      .filter(Boolean)
  : []

const missing = assets.filter((a) => !existsSync(a))

console.log(`Sprint ${n} — ${title}`)
console.log(`Design gate: ${assets.length - missing.length}/${assets.length} assets present\n`)

for (const a of assets) {
  console.log(`  ${existsSync(a) ? 'OK     ' : 'MISSING'}  ${a}`)
}

if (!missing.length) {
  console.log('\nGate passes. Read the design assets before writing any component code.')
  process.exit(0)
}

console.error(`
────────────────────────────────────────────────────────────────
DESIGN GATE FAILED — STOP. Do not write code for this sprint.
Do not invent screens, colours, spacing, or component sizes.
────────────────────────────────────────────────────────────────

Missing ${missing.length} required asset(s).

To unblock:

  1. Open the design prompt:   ${promptPath}
  2. Paste it into Claude Design
  3. Save the output to the paths listed above
     (tokens.json must be literal JSON, SPEC.md must cover every state)
  4. Update design/MANIFEST.md
  5. Re-run: node scripts/check-design-gate.mjs ${n}

Tell the user this is what's needed, then stop. Work on an
ungated sprint instead if they'd prefer to keep moving.
`)
process.exit(1)
