import { defineConfig, devices } from "@playwright/test";

import { runPolicy } from "./tests/e2e/support/policy";

/**
 * Production-safe candidate and live checks (T9/BD-14), run by
 * scripts/release/run.mjs against SMOKE_BASE_URL. Read-only: no seeds, no
 * business writes, no stored session. Nothing sensitive is recorded.
 */
const policy = runPolicy({ sensitive: true, outputName: "production" });

export default defineConfig({
  ...policy,
  testDir: "./tests/e2e/production",
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 15_000 },
  globalTimeout: 10 * 60_000,
  use: {
    ...policy.use,
    ...(process.env.SMOKE_BASE_URL
      ? { baseURL: process.env.SMOKE_BASE_URL }
      : {}),
    locale: "th-TH",
  },
  projects: [
    { name: "production-chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
