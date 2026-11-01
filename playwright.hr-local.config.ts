import { mkdirSync, chmodSync } from "node:fs";
import { execFileSync } from "node:child_process";

import { defineConfig, devices } from "@playwright/test";

import { loadHrEnvironment } from "./scripts/lib/hr-e2e-env.mjs";

// CI discovery has no credentials and never executes setup or a server.
// Every executable run still validates before any service/authentication.
if (!process.argv.includes("--list")) loadHrEnvironment();
const baseURL = "http://localhost:3100";
mkdirSync("test-results/hr-local", { recursive: true, mode: 0o700 });
chmodSync("test-results/hr-local", 0o700);

/** Opt-in real Clerk + loopback Convex suite; never selected by smoke/release. */
export default defineConfig({
  metadata: {
    sourceHead: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    // HEAD alone is not exact provenance when tracked/untracked files differ.
    sourceDirty:
      execFileSync(
        "git",
        ["status", "--porcelain", "--untracked-files=normal"],
        {
          encoding: "utf8",
        },
      ).trim() !== "",
    backend: "worktree-owned anonymous Convex on loopback:3320",
  },
  testDir: "./tests/e2e/hr-local",
  testMatch: "*.spec.ts",
  globalSetup: "./tests/e2e/hr-local/setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 120_000,
  globalTimeout: 15 * 60_000,
  expect: { timeout: 30_000 },
  reporter: [
    ["./tests/e2e/hr-local/reporter.ts"],
    ["json", { outputFile: "test-results/hr-local/report.json" }],
  ],
  outputDir: "test-results/hr-local/artifacts",
  use: {
    baseURL,
    locale: "en-US",
    timezoneId: "Asia/Bangkok",
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
    serviceWorkers: "block",
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },
  projects: [
    { name: "hr-desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "hr-mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "pnpm exec next dev --webpack --hostname localhost --port 3100",
    url: `${baseURL}/en/sign-in`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { NEXT_DIST_DIR: ".next-e2e", NEXT_TELEMETRY_DISABLED: "1" },
  },
});
