import { describe, expect, it } from "vitest";

/**
 * SCAFFOLD TEST — placeholder only.
 *
 * `tests/isolation/` would otherwise contain no files and the `test:isolation`
 * guard would fail with "no test files found".
 *
 * This tier becomes the two-tenant isolation suite and a blocking CI gate in
 * Phase 1. It cannot assert anything today: there is no tenant model, no
 * organization schema, and no tenant-bound Convex wrapper yet.
 *
 * Delete this file as soon as the real isolation suite lands.
 */
describe("scaffold: tenant isolation harness", () => {
  it("is registered as a distinct guard so it cannot be silently skipped", () => {
    expect(true).toBe(true);
  });
});
