/**
 * The serialization boundary. Every `bigint` in the domain becomes a decimal string on the wire,
 * matching `MoneyMinorSchema` / `CountSchema` on the way back in. This is the only place that
 * conversion is allowed to happen, so money never touches a float or a JSON number.
 */

export function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value
}

/** Stringify a value with every bigint rendered as a decimal string. */
export function toJson(value: unknown): string {
  return JSON.stringify(value, bigintReplacer)
}

/** A JSON-safe structure (bigints as strings) without stringifying — for building request bodies. */
export function toWire<T>(value: T): unknown {
  return JSON.parse(toJson(value)) as unknown
}
