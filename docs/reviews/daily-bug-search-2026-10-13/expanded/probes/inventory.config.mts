import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Isolated research diagnostics; these are outside the normal test discovery.
export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: [
      "docs/reviews/daily-bug-search-2026-10-13/expanded/probes/inventory-*.probe.{ts,tsx}",
    ],
  },
});
