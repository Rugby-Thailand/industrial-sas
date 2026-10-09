import { defineConfig, devices } from "@playwright/test";

import { runPolicy } from "./tests/e2e/support/policy";

/**
 * Deterministic storage-workspace harness (T5/T14). Serves the real FloorMap,
 * table and floor selector with isolated fixtures through the Vite preview in
 * scripts/storage-workspace-preview (no Convex, no auth, no inventory writes).
 *
 * PRs run Thai/English on desktop and mobile in the dark theme. The scheduled
 * workflow sets WORKSPACE_FULL_MATRIX=1 for the 16-combination width × locale
 * × theme matrix the manual responsive script used to cover.
 */
const port = Number(process.env.WORKSPACE_PORT ?? 3190);
const baseURL = `http://127.0.0.1:${port}`;
const policy = runPolicy({ sensitive: false, outputName: "workspace" });
const fullMatrix = process.env.WORKSPACE_FULL_MATRIX === "1";
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("WORKSPACE_PORT must be a valid port");

export default defineConfig({
  ...policy,
  testDir: "./tests/e2e/workspace",
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: true,
  ...(process.env.CI ? { workers: 2 } : {}),
  timeout: 60_000,
  expect: { timeout: 10_000 },
  globalTimeout: 15 * 60_000,
  use: { ...policy.use, baseURL },
  projects: fullMatrix
    ? [320, 768, 1024, 1440].map((width) => ({
        name: `workspace-${width}`,
        use: {
          ...devices[width < 640 ? "Pixel 7" : "Desktop Chrome"],
          viewport: { width, height: 900 },
        },
      }))
    : [
        {
          name: "workspace-desktop",
          use: {
            ...devices["Desktop Chrome"],
            viewport: { width: 1440, height: 900 },
          },
        },
        {
          name: "workspace-mobile",
          use: { ...devices["Pixel 7"] },
        },
      ],
  webServer: {
    // Override the Vite config's default port together with readiness/baseURL.
    command: `pnpm exec vite --config scripts/storage-workspace-preview/vite.config.mjs --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
