export * from './result'
export * from './money'
export * from './vat'
export * from './order'
// The shift aggregate is namespaced rather than flat-exported: its `reduce`, `decide` and
// `DecideContext` share names with the order aggregate's, and `@batch/domain`'s top-level `reduce`
// must stay the order reducer that `apps/till` and `apps/api` already import. Consumers reach shift
// as `shift.reduceShift`, `shift.decide`, `shift.ShiftEvent`, etc. (or import `@batch/domain/shift`).
export * as shift from './shift'
