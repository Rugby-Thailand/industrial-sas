import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Kiro audit probes (2026-10-14). Deliberately outside the normal test suite:
// each probe asserts the EXPECTED behaviour, so a failure on current source is
// evidence of the reported defect. Run from the repository root.
export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["docs/reviews/system-audit-2026-10-14/kiro/*.probe.{ts,tsx}"],
  },
});
