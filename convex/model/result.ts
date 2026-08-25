export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> =>
  Object.freeze({ ok: true as const, value });

export const fail = <E>(error: E): Result<never, E> =>
  Object.freeze({ ok: false as const, error });
