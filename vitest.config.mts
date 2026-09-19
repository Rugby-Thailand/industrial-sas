import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const resolve = { tsconfigPaths: true } as const;

const convexRuntimeTests = [
  "tests/integration/authorization-lookups-convex.integration.test.ts",
  "tests/integration/authorization-seed-convex.integration.test.ts",
  "tests/integration/dashboard-preferences.integration.test.ts",
  "tests/integration/idempotency-helper.integration.test.ts",
  "tests/integration/identity-mirror-convex.integration.test.ts",
  "tests/integration/annex-demo-seed.integration.test.ts",
  "tests/integration/tenant-actions.integration.test.ts",
  "tests/integration/tenant-context-lookups.integration.test.ts",
  "tests/integration/tenant-functions.integration.test.ts",
  "tests/integration/tenant-storage.integration.test.ts",
  "tests/isolation/authorization-enforcement.isolation.test.ts",
  "tests/isolation/tenant-storage.isolation.test.ts",
] as const;

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
