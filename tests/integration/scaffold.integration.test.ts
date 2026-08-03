import { describe, expect, it } from "vitest";

/**
 * SCAFFOLD TEST — placeholder only.
 *
 * `tests/integration/` would otherwise contain no files and the
 * `test:integration` guard would fail with "no test files found".
 *
 * Real integration tests arrive with the Convex schema and will use
 * `convex-test` against `convex/_generated/api`. Nothing is imported from
 * `convex` here because no Convex functions exist yet.
 *
 * Delete this file as soon as a real integration suite lands.
 */
describe("scaffold: integration harness", () => {
  it("runs in a Node environment without vendor configuration", () => {
    expect(typeof process.versions.node).toBe("string");
  });
});
