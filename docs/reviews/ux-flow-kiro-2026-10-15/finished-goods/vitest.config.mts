import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Kiro finished-goods UX flow probes (2026-10-15). Deliberately outside the
// normal test suite. Cases named "DESIRED" assert the expected user outcome,
// so a failure on current source is evidence of the reported defect. Cases
// named "OBSERVED" or "CONTROL" assert current facts and are expected to pass.
// Run from the repository root.
export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: [
      "docs/reviews/ux-flow-kiro-2026-10-15/finished-goods/probes/*.probe.{ts,tsx}",
    ],
  },
});
