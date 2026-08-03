/**
 * Structural guards and runtime-immutable containers for the pure domain
 * modules.
 *
 * Status: **implemented.** Used by every module under `convex/model/**`.
 *
 * Why this file exists at all: a domain type here is a compile-time claim, and
 * every value these modules will eventually receive arrives from outside the type
 * checker — a Convex document, a scanner, an HTTP body, a `JSON.parse`. A
 * `readonly` field, a branded alias, and a `ReadonlyMap` are all erased at run
 * time, so `{ numerator: 1, denominator: 0 } as Ratio` and
 * `(scan.byAi as Map<string, string>).set("01", "…")` both compile and both do
 * exactly what they say. The guards below are how a module can re-check a value
 * it was handed, and `frozenRecord` is how it can return a collection that is
 * immutable in fact rather than in the signature.
 *
 * `Object.freeze` is shallow, so a frozen container is only as immutable as what
 * is put in it. Every domain value constructor in these modules therefore freezes
 * the record it hands back, and `ok`/`fail` freeze the `Result` wrapper. Two
 * things are deliberately outside that, so nothing here claims universal run-time
 * immutability: the `ScaledInteger` and `UomConversionOutcome` discriminated
 * envelopes, which are plain objects around already-frozen payloads, and the
 * structured error a failed `Result` carries.
 *
 * Pure module (plan §6.2): no Convex imports, and no imports at all.
 */

/** Narrows an `unknown` to a string, for a field a cast may have forged. */
export const isString = (value: unknown): value is string =>
  typeof value === "string";

/** Narrows to a boolean. A truthy string is not a boolean here. */
export const isBoolean = (value: unknown): value is boolean =>
  typeof value === "boolean";

/** Narrows to a callable, so a missing callback fails closed rather than throwing. */
export const isFunction = (
  value: unknown,
): value is (...args: never[]) => unknown => typeof value === "function";

/**
 * Narrows to an integer that is exactly representable. `Number.isSafeInteger`
 * already answers `false` for a string, `null`, `NaN`, and `Infinity`; this
 * wrapper adds the type narrowing so a validated field can be used as a number.
 */
export const isSafeInt = (value: unknown): value is number =>
  Number.isSafeInteger(value);

/** Narrows to a non-null object, so `value.field` cannot throw. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * Narrows to an array without widening its element type, which is what
 * `Array.isArray` does to a `readonly T[]`.
 */
export const isArray = (value: unknown): value is readonly unknown[] =>
  Array.isArray(value);

/** A frozen copy of an array. The copy is what makes it safe to hand out. */
export const frozenArray = <T>(items: Iterable<T>): readonly T[] =>
  Object.freeze([...items]);

/**
 * A frozen, null-prototype record: the runtime-immutable replacement for a
 * `ReadonlyMap` that a cast can reopen.
 *
 * The prototype is `null` on purpose. With `Object.prototype` in the chain,
 * `record["toString"]` answers a function while the type says `string`, so a
 * lookup keyed on scanned input could return something that was never put in.
 */
export const frozenRecord = <T>(
  entries: Iterable<readonly [string, T]>,
): Readonly<Record<string, T>> => {
  const record = Object.create(null) as Record<string, T>;
  for (const [key, value] of entries) record[key] = value;
  return Object.freeze(record);
};

/**
 * A record lookup that answers `null` rather than `undefined`, and only for a
 * key the record actually owns.
 */
export const recordValue = <T>(
  record: Readonly<Record<string, T>>,
  key: string,
): T | null =>
  isString(key) && Object.prototype.hasOwnProperty.call(record, key)
    ? ((record[key] ?? null) as T | null)
    : null;

/** The keys of a frozen record, sorted, as a frozen array. */
export const recordKeys = <T>(
  record: Readonly<Record<string, T>>,
): readonly string[] => Object.freeze(Object.keys(record).sort());
