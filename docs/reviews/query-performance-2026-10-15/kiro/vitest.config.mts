import { defineConfig } from "vitest/config";

// Kiro query/performance audit probes (2026-10-15). Deliberately outside the
// default suites: files use the `.probe.ts` suffix and are only included here.
// Each probe asserts the EXPECTED behaviour, so a failure on the current
// working tree is the evidence of the reported defect. Run from repo root:
//   pnpm exec vitest run --config docs/reviews/query-performance-2026-10-15/kiro/vitest.config.mts
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["docs/reviews/query-performance-2026-10-15/kiro/*.probe.ts"],
    testTimeout: 120_000,
  },
});
