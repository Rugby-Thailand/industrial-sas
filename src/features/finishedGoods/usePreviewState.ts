"use client";
import { useState, type SetStateAction } from "react";

/** Session-only presentation state. Never stores occupancy, permissions or locks. */
export function usePreviewState<
  T extends Record<string, string | number | boolean>,
>(key: string | undefined, initial: T) {
  const [value, setValue] = useState<T>(() => {
    if (!key) return initial;
    try {
      const saved: unknown = JSON.parse(sessionStorage.getItem(key) ?? "null");
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
    } catch {
      return initial;
    }
  });
  function update(next: SetStateAction<T>) {
    setValue((previous) => {
      const result = typeof next === "function" ? next(previous) : next;
      if (key) {
        try {
          sessionStorage.setItem(key, JSON.stringify(result));
        } catch {
          /* Editing still works without browser storage. */
        }
      }
      return result;
    });
  }
  function clear() {
    if (key) {
      try {
        sessionStorage.removeItem(key);
      } catch {}
    }
  }
  return [value, update, clear] as const;
}
