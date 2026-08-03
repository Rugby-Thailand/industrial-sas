import fc from "fast-check";
import { describe, expect, it } from "vitest";

/**
 * SCAFFOLD TEST — placeholder only.
 *
 * `tests/properties/` would otherwise contain no files and the `test:property`
 * guard would fail with "no test files found". This asserts nothing about the
 * domain; it only proves fast-check is wired up and runs deterministically.
 *
 * Delete this file as soon as a real property suite (UoM conversion, ledger
 * balance invariants, GS1 parsing) lands.
 */
describe("scaffold: fast-check harness", () => {
  it("runs a deterministic property with a fixed seed", () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => {
        expect(a + b).toBe(b + a);
      }),
      { seed: 20260803, numRuns: 100 },
    );
  });
});
