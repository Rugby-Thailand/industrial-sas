import "vitest";

/**
 * Registers the `jest-axe` matcher that `vitest.setup.ts` installs via
 * `expect.extend(toHaveNoViolations)`.
 *
 * The type parameter default must match Vitest's own `Matchers<T = any>`
 * declaration exactly, or interface merging fails with TS2428.
 */
declare module "vitest" {
  interface Matchers<T = any> {
    toHaveNoViolations(): T;
  }
}
