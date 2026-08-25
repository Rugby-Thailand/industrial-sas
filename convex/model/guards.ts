export const isString = (value: unknown): value is string =>
  typeof value === "string";

export const isBoolean = (value: unknown): value is boolean =>
  typeof value === "boolean";

export const isFunction = (
  value: unknown,
): value is (...args: never[]) => unknown => typeof value === "function";

export const isSafeInt = (value: unknown): value is number =>
  Number.isSafeInteger(value);

/** Narrows to a non-null object, so `value.field` cannot throw. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const isArray = (value: unknown): value is readonly unknown[] =>
  Array.isArray(value);

export const frozenArray = <T>(items: Iterable<T>): readonly T[] =>
  Object.freeze([...items]);

export const frozenRecord = <T>(
  entries: Iterable<readonly [string, T]>,
): Readonly<Record<string, T>> => {
  const record = Object.create(null) as Record<string, T>;
  for (const [key, value] of entries) record[key] = value;
  return Object.freeze(record);
};

export const recordValue = <T>(
  record: Readonly<Record<string, T>>,
  key: string,
): T | null =>
  isString(key) && Object.prototype.hasOwnProperty.call(record, key)
    ? ((record[key] ?? null) as T | null)
    : null;

export const recordKeys = <T>(
  record: Readonly<Record<string, T>>,
): readonly string[] => Object.freeze(Object.keys(record).sort());
