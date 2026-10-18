import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Kiro UX-flow probes (2026-10-15, storage + shell). Deliberately outside the
// normal test suite: each probe asserts the EXPECTED behaviour, so a failure on
// current source is evidence of the reported defect, never a fix.
// Run from the repository root:
//   pnpm exec vitest run --config docs/reviews/ux-flow-kiro-2026-10-15/storage-shell/probes/vitest.config.mts --reporter=verbose
export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: [
      "docs/reviews/ux-flow-kiro-2026-10-15/storage-shell/probes/*.probe.{ts,tsx}",
    ],
  },
});
