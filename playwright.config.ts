import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env["PLAYWRIGHT_PORT"] ?? 3100);
const baseURL = `http://localhost:${port}`;
const isCI = Boolean(process.env["CI"]);

export const APP_DIST = ".next-e2e";

const TEST_ENV = {
  NEXT_PUBLIC_CONVEX_URL: "",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "",
  CLERK_SECRET_KEY: "",
  NEXT_DIST_DIR: APP_DIST,
} as const;

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/assert-prepared-build.ts",
  testMatch: /.*\.e2e\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  ...(isCI ? { workers: 1 } : {}),
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "handheld-chromium", use: { ...devices["Pixel 5"] } },
  ],
  webServer: {
    command: `pnpm exec next start --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: TEST_ENV,
  },
});
