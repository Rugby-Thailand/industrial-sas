import { defineConfig, devices } from "@playwright/test";

import { runPolicy } from "./tests/e2e/support/policy";

/**
 * Trusted staging suite (T6/T7/T8), run by scripts/release/run.mjs in the
 * `staging` GitHub environment after the exact main SHA deployed to staging.
 * It also runs the @prod-safe checks with SMOKE_TARGET=staging.
 *
 * Sensitive: no traces, videos, screenshots, HTML report or stored auth state
 * leave the runner. Serial, one worker, zero retries.
 */
const policy = runPolicy({ sensitive: true, outputName: "staging" });

export default defineConfig({
  ...policy,
  testDir: "./tests/e2e",
  testMatch: ["**/e2e/staging/*.spec.ts", "**/e2e/production/*.spec.ts"],
  globalSetup: "./tests/e2e/staging/global-setup.ts",
  globalTeardown: "./tests/e2e/staging/global-teardown.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  globalTimeout: 20 * 60_000,
  use: {
    ...policy.use,
    ...(process.env.SMOKE_BASE_URL
      ? { baseURL: process.env.SMOKE_BASE_URL }
      : {}),
    locale: "th-TH",
    timezoneId: "Asia/Bangkok",
  },
  projects: [
    { name: "staging-chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
