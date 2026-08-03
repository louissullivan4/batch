# 0001 — Money is bigint minor units, string on the wire

Date: 2026-08-03
Status: accepted

## Context

A POS performs millions of additions per shift. IEEE-754 floats cannot represent `0.10 + 0.20`
exactly, and `NUMERIC` pushes rounding into the database where it is invisible and inconsistent
across languages. Money errors are the most expensive class of bug in this system and the hardest to
unwind once real receipts exist. JSON, meanwhile, has no integer type that safely exceeds 2^53 and
no bigint literal, so the in-memory representation and the wire representation cannot be the same.

## Decision

- In TypeScript, money is `bigint` counting **minor units** (euro cents). Every identifier ends in
  `Minor`. Only `packages/domain/money.ts` constructs the `Money` type; callers use `euro()`,
  `minor()`, `zero()`.
- In Postgres, money columns are `BIGINT` named `*_minor`. Never `NUMERIC`, `DECIMAL`, `REAL`,
  `MONEY`.
- On the wire, a `bigint` is a **decimal string** (`"450"`), converted at exactly one boundary:
  `@batch/schemas` parses string→bigint on the way in (`MoneyMinorSchema`), and `serialize.ts`
  renders bigint→string on the way out (`bigintReplacer`).
- Rates (VAT, percentage discounts) are integers in **basis points** (13.5% is `1350`).
- Every function that divides money states its rounding policy in a comment and asserts it in a
  test. Division rounds **half away from zero** so refunds reverse sales to the cent.

## Consequences

Makes easy: exact arithmetic, deterministic and testable rounding, identical results on the till and
the server (same `packages/domain`), no float ever near an amount.

Makes hard: a small amount of ceremony — money can't be dropped into JSON directly, and display
formatting must go through `formatMoney` rather than `toFixed`. A `money-guard` hook enforces this
because a single `number` leak spreads before review catches it.

To reverse: every event payload, every column, and every wire contract carries minor-unit integers.
Changing the representation after real orders exist means rewriting stored data and every historic
projection. Effectively irreversible — which is the point of deciding it on day one.

## Alternatives rejected

- **`number` (float):** the rounding argument never ends and month-end never reconciles.
- **`NUMERIC` in Postgres / a decimal library:** moves rounding somewhere invisible and makes the
  till and server disagree unless they share the exact same decimal implementation.
- **JSON number for cents on the wire:** loses the "no float near money" guarantee and caps at 2^53;
  a string is unambiguous and costs one conversion at the boundary.
