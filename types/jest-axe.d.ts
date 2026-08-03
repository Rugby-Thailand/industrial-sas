/**
 * Ambient type declarations for `jest-axe`, which ships no bundled types.
 *
 * `@types/jest-axe` is deliberately not installed: it depends on `@types/jest`,
 * whose global `expect`/`describe` declarations collide with Vitest's.
 *
 * This file must stay a global script — no top-level `import` or `export` —
 * otherwise `declare module "jest-axe"` would be read as an augmentation of an
 * already-typed module instead of a declaration for an untyped one. The Vitest
 * matcher augmentation therefore lives in `types/vitest.d.ts`.
 */
declare module "jest-axe" {
  import type { AxeResults, ElementContext, RunOptions, Spec } from "axe-core";

  export function axe(
    html: ElementContext | string,
    options?: RunOptions,
  ): Promise<AxeResults>;

  export function configureAxe(options?: RunOptions & Spec): typeof axe;

  export const toHaveNoViolations: {
    toHaveNoViolations(results: AxeResults): {
      pass: boolean;
      actual: AxeResults["violations"];
      message(): string;
    };
  };
}
