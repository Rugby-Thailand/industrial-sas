import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * `@/*` path aliases are resolved by Vite's built-in `resolve.tsconfigPaths`
 * rather than the `vite-tsconfig-paths` plugin, which Vite 8 supersedes.
 */
const resolve = { tsconfigPaths: true } as const;

/**
 * Tests that execute application Convex modules through `convex-test` and can
 * therefore run under the runtime Vitest documents for that library.
 *
 * This is intentionally not every file in `tests/integration` or
 * `tests/isolation`: those directories also contain repository guards, process
 * lifecycle checks, filesystem checks, and webhook-fixture construction that
 * are Node programs by design.
 */
const convexRuntimeTests = [
  "tests/integration/authorization-lookups-convex.integration.test.ts",
  "tests/integration/authorization-seed-convex.integration.test.ts",
  "tests/integration/idempotency-helper.integration.test.ts",
  "tests/integration/identity-mirror-convex.integration.test.ts",
  "tests/integration/tenant-actions.integration.test.ts",
  "tests/integration/tenant-context-lookups.integration.test.ts",
  "tests/integration/tenant-functions.integration.test.ts",
  "tests/integration/tenant-storage.integration.test.ts",
  "tests/isolation/authorization-enforcement.isolation.test.ts",
  "tests/isolation/tenant-storage.isolation.test.ts",
] as const;

/**
 * Test tiers are separate Vitest projects so each guard can run in isolation:
 *
 * - `unit`        colocated module tests: components in `src/`, pure domain
 *                 modules in `convex/model/` (plan §6.2 — no Convex imports, so
 *                 they need no `convex-test` world)
 * - `a11y`        axe-core accessibility assertions (`*.a11y.test.tsx`)
 * - `property`    fast-check property-based tests (`tests/properties/`)
 * - `convex-runtime` application Convex modules under the edge-like runtime
 * - `integration` Node cross-module and repository-tooling tests
 * - `isolation`   Node multi-tenant guards and filesystem checks
 *
 * Playwright owns `tests/e2e/` and is intentionally excluded here.
 */
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [react()],
        resolve,
        test: {
          name: "unit",
          environment: "jsdom",
          setupFiles: ["./vitest.setup.ts"],
          include: ["src/**/*.test.{ts,tsx}", "convex/model/**/*.test.ts"],
          exclude: ["src/**/*.a11y.test.{ts,tsx}"],
        },
      },
      {
        plugins: [react()],
        resolve,
        test: {
          name: "a11y",
          environment: "jsdom",
          setupFiles: ["./vitest.setup.ts"],
          include: ["src/**/*.a11y.test.{ts,tsx}"],
        },
      },
      {
        resolve,
        test: {
          name: "property",
          environment: "node",
          include: ["tests/properties/**/*.test.ts"],
        },
      },
      {
        resolve,
        test: {
          name: "convex-runtime",
          environment: "edge-runtime",
          include: [...convexRuntimeTests],
        },
      },
      {
        resolve,
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          exclude: [...convexRuntimeTests],
        },
      },
      {
        resolve,
        test: {
          name: "isolation",
          environment: "node",
          include: ["tests/isolation/**/*.test.ts"],
          exclude: [...convexRuntimeTests],
        },
      },
    ],
  },
});
