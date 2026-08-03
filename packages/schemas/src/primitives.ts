import { z } from 'zod'

/**
 * Wire primitives.
 *
 * The one rule that matters: **a `bigint` in the domain crosses the wire as a decimal string**, so
 * JSON never rounds a cent. `MoneyMinorSchema` and `CountSchema` parse those strings back to
 * `bigint`; `serialize.ts` does the reverse. Rates stay integers (basis points), which JSON carries
 * losslessly.
 */

/**
 * A UUID of any version. Deliberately not `z.string().uuid()`, whose regex only accepts versions
 * 1–5 and would reject our client-generated **UUIDv7** event ids outright.
 */
export const UuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'must be a UUID')

export const IsoDateTimeSchema = z.string().datetime({ offset: true })

/** Minor units (cents) as a signed decimal string, parsed to `bigint`. "450" -> 450n. */
export const MoneyMinorSchema = z
  .string()
  .regex(/^-?\d+$/, 'money must be an integer number of minor units, as a string')
  .transform((s) => BigInt(s))

/** A non-negative count (e.g. line quantity) as a decimal string, parsed to `bigint`. */
export const CountSchema = z
  .string()
  .regex(/^\d+$/, 'count must be a non-negative integer, as a string')
  .transform((s) => BigInt(s))

/** VAT rate or percentage discount in basis points. 13.5% is 1350. */
export const VatRateBpSchema = z.number().int().min(0)

export const CurrencySchema = z.literal('EUR')

export const FulfilmentSchema = z.enum(['EAT_IN', 'TAKEAWAY'])
