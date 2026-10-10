import { existsSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

import { runPolicy } from "./tests/e2e/support/policy";

/**
 * Credential-free browser smoke for every PR (T4). It serves the production
 * build already produced by `pnpm build` (`.next`) with identity and backend
 * deliberately unconfigured, so it needs no secrets and is safe for forks.
 * It proves routing, locale redirects, public/not-found pages, headers,
 * hydration without page errors, and axe on desktop and mobile Chromium.
 * Authentication is proved separately by the trusted staging suite.
 */
const port = Number(process.env.PLAYWRIGHT_PORT ?? 3200);
const baseURL = `http://127.0.0.1:${port}`;
const policy = runPolicy({ sensitive: false, outputName: "smoke" });

if (
  process.env.PLAYWRIGHT_REQUIRE_BUILD === "1" &&
  !existsSync(".next/BUILD_ID")
) {
  throw new Error("Run `pnpm build` before the browser smoke suite.");
}

export default defineConfig({
  ...policy,
  testDir: "./tests/e2e/smoke",
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: true,
  ...(process.env.CI ? { workers: 2 } : {}),
  timeout: 30_000,
  expect: { timeout: 10_000 },
  // Leave room for report upload inside the job timeout.
  globalTimeout: 10 * 60_000,
  use: { ...policy.use, baseURL, locale: "th-TH", timezoneId: "Asia/Bangkok" },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `pnpm exec next start --hostname 127.0.0.1 --port ${port}`,
    url: `${baseURL}/th/sign-in`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // Explicitly empty: the smoke suite must never inherit service credentials.
    env: {
      NEXT_PUBLIC_CONVEX_URL: "",
      NEXT_PUBLIC_CONVEX_SITE_URL: "",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "",
      CLERK_SECRET_KEY: "",
      CONVEX_DEPLOY_KEY: "",
      UPLOADTHING_TOKEN: "",
    },
  },
});
