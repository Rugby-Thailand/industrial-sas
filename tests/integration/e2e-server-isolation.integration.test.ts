/**
 * The end-to-end servers must not fight over a file.
 *
 * A regression guard for a defect that presented as flakiness. Two shared
 * mutable files were involved, and both produce the same symptom — `Unexpected
 * non-whitespace character after JSON` in a server log and `Internal Server
 * Error` on routes that worked a second earlier, with a different spec failing
 * each run. That is exactly the shape that invites a longer assertion timeout
 * instead of a fix.
 *
 * - `next-env.d.ts` lives in the repository root, is generated, and every `next
 *   dev` rewrites it to name its own `distDir`. Two of them rewrite it in turn
 *   and retrigger each other's compilers.
 * - `<distDir>/dev/prerender-manifest.json` is rewritten without truncating, so
 *   a shorter write over a longer file leaves the old tail behind. Two triggers
 *   were measured: several Playwright workers compiling routes at once, and a
 *   *second* `next dev` starting over a directory an earlier one had filled.
 *
 * The invariant is **one development server, owned by the runner, started once
 * on an empty directory and warmed serially**. Playwright therefore declares no
 * development server at all, and that is a property of the configuration, so it
 * is asserted against the configuration — a test that started servers would take
 * minutes to say what this says in milliseconds, and the failure it catches has
 * no runtime signature until the timing is unlucky.
 *
 * `scripts/run-e2e.mjs` carries the behavioural half: it refuses to start the
 * suite if the warmed directory holds an unparseable artifact, and fails the run
 * if one appears afterwards.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import config, { APP_DIST, PREVIEW_DIST } from "../../playwright.config";

/** The build directories that belong to a developer's own processes. */
const DEVELOPER_OWNED = [".next", ".next-preview"];

const RUNNER = join(process.cwd(), "scripts", "run-e2e.mjs");
const LIFECYCLE = join(process.cwd(), "scripts", "lib", "childLifecycle.mjs");

/**
 * A file's executable text, with comments removed.
 *
 * These scripts explain in prose what they must never do — "a `pkill next` would
 * kill a developer's own server" — and a guard that matched the explanation
 * would fail on the documentation rather than on the code.
 */
const codeOf = (path: string): string =>
  readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const servers = () => {
  const declared = config.webServer;
  return Array.isArray(declared)
    ? declared
    : declared === undefined
      ? []
      : [declared];
};

describe("the end-to-end web servers", () => {
  it("declares no development server, because the runner owns the only one", () => {
    /*
     * `next start` reads a finished build and writes nothing into the
     * repository. A `next dev` declared here would be a *second* one started
     * over the directory the runner just warmed, which is one of the two
     * measured ways to corrupt the manifest.
     */
    const developmentServers = servers().filter((server) =>
      /next dev\b/.test(server.command),
    );

    expect(developmentServers).toEqual([]);
  });

  it("leaves the preview server to the runner, started once and warmed", () => {
    const runner = readFileSync(RUNNER, "utf8");

    expect(runner).toContain("next");
    expect(runner).toContain("warmPreview");
    // Started before Playwright and stopped after it, by handle.
    expect(runner).toMatch(/startPreviewServer\(\)/);
    expect(runner).toMatch(/finally\s*\{\s*await stopChild\(preview\);/);
    // And the warmed directory is checked before a single test runs.
    expect(runner).toContain("corruptArtifacts");
  });

  it("gives every server its own build directory, and none a developer's", () => {
    const dists = servers().map(
      (server) => (server.env ?? {})["NEXT_DIST_DIR"] as string | undefined,
    );

    // Every server names one explicitly: an unset `NEXT_DIST_DIR` means `.next`,
    // which is the directory this rule exists to keep out of.
    expect(dists.every((dist) => dist !== undefined && dist !== "")).toBe(true);
    expect(new Set(dists).size).toBe(dists.length);
    for (const dist of dists) {
      expect(DEVELOPER_OWNED).not.toContain(dist);
    }
    expect(dists).toEqual([APP_DIST]);

    // The runner's server gets the other one, and it is equally not a
    // developer's.
    expect(DEVELOPER_OWNED).not.toContain(PREVIEW_DIST);
    expect(readFileSync(RUNNER, "utf8")).toContain(PREVIEW_DIST);
  });

  it("never adopts a server it did not start", () => {
    // A process already listening on the port is not known to be this
    // configuration; adopting it is how a suite asserts against `pnpm dev`.
    for (const server of servers()) {
      expect(server.reuseExistingServer).toBe(false);
    }
  });

  it("prepares the served build before Playwright, never during", () => {
    /*
     * The build rewrites `next-env.d.ts` too. Doing it inside `run-e2e.mjs`,
     * before either server exists, is what keeps that write away from a running
     * compiler — and the script restores the file immediately afterwards.
     */
    const runner = codeOf(RUNNER);

    expect(runner).toContain("restoreNextEnv");
    expect(runner).toContain("assertNoCorruption");
    // One teardown for the clean path and the interrupted one.
    expect(runner).toMatch(/finally\s*\{\s*await shutdown\(\);/);
    expect(runner).toContain("installShutdown");
  });

  it("cleans up before it exits, on both interrupt signals", () => {
    /*
     * The failure this catches is a signal handler that calls `process.exit`
     * straight away: the event loop ends, no `finally` runs, and the development
     * server it started outlives it still holding port 3101. Cleanup has to be
     * awaited *before* the exit, and the children have to be stopped before
     * `next-env.d.ts` is restored — a server that is still alive rewrites it.
     *
     * `tests/integration/e2e-runner-lifecycle.integration.test.ts` proves the
     * same properties against real processes; this states them where a reader of
     * the runner will look.
     */
    const lifecycle = codeOf(LIFECYCLE);

    expect(lifecycle).toContain("SIGINT");
    expect(lifecycle).toContain("SIGTERM");
    // Awaited, and in this order.
    expect(lifecycle).toMatch(
      /await registry\.stopAll\([\s\S]*?\);\s*await onCleanup\(\);/,
    );
    expect(lifecycle).toMatch(/void shutdown\(signal\)\.then\(/);
  });

  it("signals only what it started, never a name or a port", () => {
    for (const path of [RUNNER, LIFECYCLE]) {
      const code = codeOf(path);

      // A broad `pkill`, or a search by port, reaches into whatever else the
      // developer is running. Neither belongs in a test runner.
      expect(code).not.toMatch(/pkill|killall/);
      expect(code).not.toMatch(/lsof|fuser/);
      // Every kill goes through a `ChildProcess` handle.
      expect(code).not.toMatch(/process\.kill\(/);
    }

    // And the runner delegates its killing to the registry rather than rolling
    // its own, so there is one place where the rule can be broken.
    expect(codeOf(RUNNER)).toMatch(/stopChild\(|children\.stopAll\(/);
  });

  it("touches no build directory outside its own", () => {
    const runner = codeOf(RUNNER);

    for (const owned of DEVELOPER_OWNED) {
      expect(runner).not.toContain(`"${owned}"`);
    }
  });
});
