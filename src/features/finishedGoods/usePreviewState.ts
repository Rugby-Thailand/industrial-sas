"use client";
import { sessionPreferences } from "@/lib/browser/storage";
import { useState, type SetStateAction } from "react";

function readPreview<T extends Record<string, string | number | boolean>>(
  key: string | undefined,
  initial: T,
): T {
  if (!key) return initial;
  return sessionPreferences.read(
    key,
    (saved) => {
      if (!saved || typeof saved !== "object") return initial;
      const result = { ...initial };
      for (const field of Object.keys(initial) as (keyof T)[]) {
        const candidate = (saved as Record<keyof T, unknown>)[field];
        if (
          typeof candidate === typeof initial[field] &&
          (typeof candidate !== "number" || Number.isFinite(candidate))
        )
          result[field] = candidate as T[keyof T];
      }
      return result;
    },
    initial,
  );
}

/** Session-only presentation state. Never stores occupancy, permissions or locks. */
export function usePreviewState<
  T extends Record<string, string | number | boolean>,
>(key: string | undefined, initial: T) {
  const [stored, setStored] = useState(() => ({
    key,
    value: readPreview(key, initial),
  }));
  let value = stored.value;
  if (stored.key !== key) {
    value = readPreview(key, initial);
    setStored({ key, value });
  }
  function update(next: SetStateAction<T>) {
    setStored((previous) => {
      const current =
        previous.key === key ? previous.value : readPreview(key, initial);
      const result = typeof next === "function" ? next(current) : next;
      if (key) sessionPreferences.write(key, result);
      return { key, value: result };
    });
  }
  function clear() {
    if (key) sessionPreferences.remove(key);
  }
  return [value, update, clear] as const;
}
