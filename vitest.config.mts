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
