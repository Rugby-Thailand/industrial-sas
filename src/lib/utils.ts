import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Join class names, letting a later Tailwind utility beat an earlier one.
 *
 * The convention every vendored shadcn primitive is written against. `clsx`
 * flattens conditionals and arrays; `twMerge` then resolves conflicts within a
 * utility group, so a caller passing `min-h-touch` to a component whose base
 * class already says `h-8` gets the caller's height rather than whichever
 * happens to appear later in the generated stylesheet.
 *
 * That last part is the reason this exists rather than a template string: class
 * order in the markup does not decide the cascade, so without a merge step an
 * override silently does nothing.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
