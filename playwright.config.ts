import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env["PLAYWRIGHT_PORT"] ?? 3100);
const PREVIEW_PORT = PORT + 1;
// `localhost`, not `127.0.0.1`: the Next dev server treats a mismatched host as a
// cross-origin request and blocks its own HMR endpoint. Using the same host it
// binds avoids that without having to widen `allowedDevOrigins`.
const baseURL = `http://localhost:${PORT}`;
const previewBaseURL = `http://localhost:${PREVIEW_PORT}`;

/** Where `scripts/run-e2e.mjs` puts the preview server, for `globalSetup`. */
export const PREVIEW_BASE_URL = previewBaseURL;
const isCI = Boolean(process.env["CI"]);

/**
 * End-to-end configuration.
 *
 * Browsers are not installed by `pnpm install`; run `pnpm exec playwright
 * install --with-deps` before the first `pnpm test:e2e`.
 *
 * Handheld emulation is included from the start because the primary target is a
 * rugged scanner device, not a desktop browser.
 *
 * ### Two servers, on purpose
 *
 * The application has two honest states without vendor credentials, and both
 * are worth testing:
 *
 * - **Unconfigured** (port `PLAYWRIGHT_PORT`). No deployment URL and no
 *   publishable key, so every inventory screen shows its setup gate. The vendor
 *   variables are set to the empty string rather than left unset so the suite
 *   behaves identically on a developer machine with a populated `.env.local` and
 *   in CI, which has none. An empty value reads as absent
 *   (`resolveAppEnvironment`), and Next's `.env` loader does not overwrite a
 *   variable the process already has.
 * - **Local preview** (port `PLAYWRIGHT_PORT + 1`). Synthetic rows through the
 *   real screens, which is the only way to exercise the table, the paging, and
 *   the Thai layout end to end before Clerk exists. It builds into its own
 *   `distDir`, because Next.js 16 locks one dev server per build directory.
 *
 * ### This config starts no development server
 *
 * Only the unconfigured server is declared here, and it is a **production build
 * served by `next start`** — a process that reads a finished build and writes
 * nothing into the repository, so it cannot corrupt anything.
 *
 * The preview server is a `next dev`, and `scripts/run-e2e.mjs` owns it end to
 * end: it starts it once on an empty build directory, compiles every route
 * serially, verifies the resulting artifacts parse, and only then runs
 * Playwright. That ownership is the fix for a defect that presented as
 * flakiness, and both halves of it are load-bearing.
 *
 * Next rewrites `next-env.d.ts` — a tracked file in the repository root — to name
 * its own `distDir`, so two development servers rewrote it in turn and
 * retriggered each other's compilers. And `next dev` rewrites
 * `<distDir>/dev/prerender-manifest.json` without truncating, so a shorter write
 * over a longer file leaves the old tail behind: valid JSON followed by garbage,
 * which every later render fails to read. Two ways to trigger that were measured
 * — several workers compiling routes at once, and a *second* `next dev` starting
 * over a directory an earlier one had filled. Declaring the preview server here
 * would reintroduce the second, because Playwright would start its own.
 *
 * The preview server cannot be a production build: preview mode is gated on
 * `NODE_ENV !== "production"` on purpose (`src/lib/environment.ts`), so that no
 * runtime variable can turn synthetic data on in a deployed bundle. Measured, not
 * assumed — a production build carrying `NEXT_PUBLIC_LOCAL_PREVIEW=1` serves the
 * setup gate with no preview banner and no `prv_` row.
 *
 * `.next` belongs to whatever `pnpm dev` a developer is already running and
 * `.next-preview` to their preview server; neither is read or written here.
 * `reuseExistingServer` is `false`, because a server already listening on the
 * port is *not* known to be this configuration, and adopting it is how a suite
 * ends up asserting against somebody's own `pnpm dev`.
 *
 * Run it through `pnpm test:e2e`. A bare `playwright test` has no preview server
 * at all and no prepared build, so `globalSetup` refuses rather than testing a
 * stale bundle against a dead port.
 *
 * `*.preview.e2e.spec.ts` runs against the second; everything else against the
 * first. `*.preview.handheld.e2e.spec.ts` runs against the second as well, on an
 * emulated scanner: the maintenance screens live in the desktop shell by route
 * rather than by width, so a supervisor on a dock must still be able to finish
 * the journey on the device in their hand.
 */
const UNCONFIGURED_ENV = {
  NEXT_PUBLIC_CONVEX_URL: "",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "",
  NEXT_PUBLIC_LOCAL_PREVIEW: "",
} as const;

/**
 * The build directories the suite owns, named once.
 *
 * Exported so `tests/integration/e2e-server-isolation.integration.test.ts` can
 * assert the ownership rule against these values rather than against a copy of
 * them that could drift.
 */
export const APP_DIST = ".next-e2e";
export const PREVIEW_DIST = ".next-e2e-preview";

export default defineConfig({
  testDir: "./tests/e2e",
  /*
   * Refuses to run against a build nobody prepared. `pnpm test:e2e` builds
   * `APP_DIST` first; a bare `playwright test` does not, and `next start` would
   * then serve whatever an earlier run left behind.
   */
  globalSetup: "./tests/e2e/assert-prepared-build.ts",
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
      // Every preview spec is ignored here, including the handheld variant:
      // these servers differ by configuration, not by viewport.
      name: "desktop-chromium",
      testIgnore: /.*\.preview\..*e2e\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "handheld-chromium",
      testIgnore: /.*\.preview\..*e2e\.spec\.ts/,
      use: { ...devices["Pixel 5"] },
    },
    {
      name: "preview-chromium",
      testMatch: /.*\.preview\.e2e\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: previewBaseURL },
    },
    {
      name: "preview-handheld-chromium",
      testMatch: /.*\.preview\.handheld\.e2e\.spec\.ts/,
      use: { ...devices["Pixel 5"], baseURL: previewBaseURL },
    },
  ],
  webServer: [
    {
      // A finished build, served read-only. Prepared by `scripts/run-e2e.mjs`.
      command: `pnpm exec next start --port ${PORT}`,
      url: baseURL,
      // Never adopt a server this config did not start: see the header.
      reuseExistingServer: false,
      timeout: 120_000,
      env: { ...UNCONFIGURED_ENV, NEXT_DIST_DIR: APP_DIST },
    },
    // The preview server is deliberately absent: `scripts/run-e2e.mjs` starts,
    // warms, and stops it, so exactly one `next dev` exists for the whole run.
  ],
});
