import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * `@/*` path aliases are resolved by Vite's built-in `resolve.tsconfigPaths`
 * rather than the `vite-tsconfig-paths` plugin, which Vite 8 supersedes.
 */
const resolve = { tsconfigPaths: true } as const;

/**
 * Test tiers are separate Vitest projects so each guard can run in isolation:
 *
 * - `unit`        colocated component/module tests in `src/`
 * - `a11y`        axe-core accessibility assertions (`*.a11y.test.tsx`)
 * - `property`    fast-check property-based tests (`tests/properties/`)
 * - `integration` cross-module tests, later backed by `convex-test`
 * - `isolation`   multi-tenant isolation suite (blocking CI gate in Phase 1)
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
          include: ["src/**/*.test.{ts,tsx}"],
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
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
        },
      },
      {
        resolve,
        test: {
          name: "isolation",
          environment: "node",
          include: ["tests/isolation/**/*.test.ts"],
        },
      },
    ],
  },
});
