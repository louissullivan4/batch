import { STAFF_FIXTURE, type StaffFixtureEntry } from './staff-fixture'

/**
 * The staff roster the till authorises PINs against.
 *
 * Until back-office staff sync ships (Sprint 6), the only source is the seed fixture — whose dev PINs
 * are recoverable from the git-tracked generator (`scripts/gen-staff-fixture.mjs`), including a
 * MANAGER PIN. That is fine for development but must never gate a real merchant drawer (Sprint 4
 * security review, Finding 1). So the fixture is exposed in **DEV builds only**: a production build
 * gets an empty roster, and because `import.meta.env.DEV` is a compile-time constant, Vite folds the
 * branch to `[]` and tree-shakes the fixture (and every PHC hash) out of the shipped bundle entirely.
 *
 * The honest consequence: a production build has no one to authorise against, so the shift screens'
 * PIN gates cannot be opened until real staff sync exists. That is correct — a till with no synced
 * staff has no staff — and it is strictly safer than shipping known seed credentials.
 */
export const STAFF_ROSTER: readonly StaffFixtureEntry[] = import.meta.env.DEV ? STAFF_FIXTURE : []

/** Look up a roster entry by id (e.g. to name the staff member who opened the shift). */
export function findStaff(id: string | undefined | null): StaffFixtureEntry | undefined {
  if (id === undefined || id === null) return undefined
  return STAFF_ROSTER.find((s) => s.id === id)
}
