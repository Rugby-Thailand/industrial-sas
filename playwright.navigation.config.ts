import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
import { runPolicy } from "./tests/e2e/support/policy";

const port = 3265;
const baseURL = `http://127.0.0.1:${port}`;
const policy = runPolicy({ sensitive: false, outputName: "navigation" });
if (
  process.env.PLAYWRIGHT_REQUIRE_BUILD === "1" &&
  !existsSync("scripts/navigation-guard-preview/.next/BUILD_ID")
) {
  throw new Error("Run pnpm build:navigation before the navigation suite.");
}
export default defineConfig({
  ...policy,
  testDir: "./tests/e2e/navigation",
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  globalTimeout: 10 * 60_000,
  use: { ...policy.use, baseURL, locale: "en-GB", timezoneId: "Asia/Bangkok" },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
    { name: "desktop-firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "desktop-webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: `bun run --bun --no-env-file next start scripts/navigation-guard-preview --hostname 127.0.0.1 --port ${port}`,
    url: `${baseURL}/en/previous`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      BUN_OPTIONS: "--no-env-file",
      NEXT_PUBLIC_CONVEX_URL: "",
      NEXT_PUBLIC_CONVEX_SITE_URL: "",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "",
      CLERK_SECRET_KEY: "",
      CONVEX_DEPLOY_KEY: "",
      UPLOADTHING_TOKEN: "",
    },
  },
});
