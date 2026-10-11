import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const resolve = { tsconfigPaths: true } as const;

const convexRuntimeTests = [
  "tests/integration/annex-demo-seed.integration.test.ts",
] as const;

const a11yTests = "src/**/*.a11y.test.{ts,tsx}";

// Non-JSX unit tests that drive browser history, Web Storage, or a React hook.
// Every other `.test.ts` under `src/` and `convex/model/` is pure and runs in
// Node without the DOM setup; one that reaches for `window` fails loudly there.
const domUnitTests = [
  "src/features/storageLayouts/useFloorSelection.test.ts",
  "src/lib/browser/history.test.ts",
  "src/lib/browser/storage.test.ts",
] as const;

export default defineConfig({
  test: {
    // Informational combined coverage runs across the full suite in the
    // scheduled/manual Workspace matrix workflow. PR and push checks run
    // every test in shards with native JUnit reports, without instrumentation.
    // No thresholds yet: floors follow a measured critical-path baseline.
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage",
      reporter: ["text-summary", "json-summary", "lcov"],
      // Listed explicitly so untested critical modules appear at 0% instead
      // of disappearing from the report.
      include: [
        "convex/**/*.ts",
        "src/lib/**/*.ts",
        "src/proxy.ts",
        "scripts/ci/**/*.mjs",
        "scripts/release/**/*.mjs",
      ],
      exclude: ["convex/_generated/**", "**/*.test.ts", "**/*.d.ts"],
    },
    projects: [
      {
        plugins: [react()],
        resolve,
        test: {
          name: "unit",
          environment: "jsdom",
          setupFiles: ["./vitest.setup.ts"],
          include: ["src/**/*.test.tsx", ...domUnitTests],
          exclude: [a11yTests],
        },
      },
      {
        resolve,
        test: {
          name: "unit-node",
          environment: "node",
          include: ["src/**/*.test.ts", "convex/model/**/*.test.ts"],
          exclude: [a11yTests, ...domUnitTests],
        },
      },
      {
        plugins: [react()],
        resolve,
        test: {
          name: "a11y",
          environment: "jsdom",
          setupFiles: ["./vitest.setup.ts"],
          include: [a11yTests],
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
        },
      },
    ],
  },
});
