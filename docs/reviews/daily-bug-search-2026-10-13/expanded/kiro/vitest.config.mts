import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Kiro diagnostic probes: deliberately outside the normal test suite.
export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: [
      "docs/reviews/daily-bug-search-2026-10-13/expanded/kiro/*.probe.{ts,tsx}",
    ],
  },
});
