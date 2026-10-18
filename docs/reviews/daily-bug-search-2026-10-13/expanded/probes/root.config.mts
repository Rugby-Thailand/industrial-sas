import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [react()],
        resolve: { tsconfigPaths: true },
        test: {
          name: "root-dom",
          environment: "jsdom",
          setupFiles: ["./vitest.setup.ts"],
          include: [
            "docs/reviews/daily-bug-search-2026-10-13/expanded/probes/root-*.probe.tsx",
          ],
        },
      },
      {
        resolve: { tsconfigPaths: true },
        test: {
          name: "root-node",
          environment: "node",
          include: [
            "docs/reviews/daily-bug-search-2026-10-13/expanded/probes/root-*.probe.ts",
          ],
        },
      },
    ],
  },
});
