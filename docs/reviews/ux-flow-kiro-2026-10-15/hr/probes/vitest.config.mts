import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Kiro HR UX-flow probes (2026-10-15). Deliberately outside the normal test
// suite: each probe asserts the EXPECTED behaviour, so a failure on current
// source is evidence of the reported defect. Control cases pass by design.
// Run from the repository root.
export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: [
      "docs/reviews/ux-flow-kiro-2026-10-15/hr/probes/*.probe.{ts,tsx}",
    ],
  },
});
