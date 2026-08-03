import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env["PLAYWRIGHT_PORT"] ?? 3100);
// `localhost`, not `127.0.0.1`: the Next dev server treats a mismatched host as a
// cross-origin request and blocks its own HMR endpoint. Using the same host it
// binds avoids that without having to widen `allowedDevOrigins`.
const baseURL = `http://localhost:${PORT}`;
const isCI = Boolean(process.env["CI"]);

/**
 * End-to-end configuration.
 *
 * Browsers are not installed by `pnpm install`; run `pnpm exec playwright
 * install --with-deps` before the first `pnpm test:e2e`.
 *
 * Handheld emulation is included from the start because the primary target is a
 * rugged scanner device, not a desktop browser.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.e2e\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  // Spread rather than `workers: isCI ? 1 : undefined`: `exactOptionalPropertyTypes`
  // forbids assigning `undefined` to an optional property, so the key is omitted
  // entirely when we want Playwright's own default (one worker per core).
  ...(isCI ? { workers: 1 } : {}),
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "handheld-chromium",
      use: { ...devices["Pixel 5"] },
    },
  ],
  webServer: {
    command: `pnpm exec next dev --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
