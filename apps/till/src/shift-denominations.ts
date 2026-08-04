/**
 * The Euro cash drawer's denomination grid (SPEC Screens 1 & 3): notes €50/€20/€10/€5, coins
 * €2/€1/50c/20c/10c/5c. 1c and 2c are omitted — Irish cash rounds to 5c at the till; the owner can
 * enable them in (future) settings. Values are `bigint` minor units (root CLAUDE.md non-negotiable
 * #1) — this module constructs no money, it only labels fixed face values.
 */

export interface DenominationRow {
  readonly denominationMinor: bigint
  readonly label: string
}

export const NOTE_DENOMINATIONS: readonly DenominationRow[] = [
  { denominationMinor: 5000n, label: '€50' },
  { denominationMinor: 2000n, label: '€20' },
  { denominationMinor: 1000n, label: '€10' },
  { denominationMinor: 500n, label: '€5' },
]

export const COIN_DENOMINATIONS: readonly DenominationRow[] = [
  { denominationMinor: 200n, label: '€2' },
  { denominationMinor: 100n, label: '€1' },
  { denominationMinor: 50n, label: '50c' },
  { denominationMinor: 20n, label: '20c' },
  { denominationMinor: 10n, label: '10c' },
  { denominationMinor: 5n, label: '5c' },
]

export const ALL_DENOMINATIONS: readonly DenominationRow[] = [...NOTE_DENOMINATIONS, ...COIN_DENOMINATIONS]
