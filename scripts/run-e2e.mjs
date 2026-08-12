#!/usr/bin/env node
/**
 * The end-to-end runner, and the two ownership rules it enforces.
 *
 * ### The defect
 *
 * The suite failed differently on every run, and both servers logged
 * `Unexpected non-whitespace character after JSON` while routes answered
 * `Internal Server Error`. Two distinct causes were found, and only fixing both
 * makes the suite deterministic.
 *
 * **1. A shared source file.** Next regenerates `next-env.d.ts` — in the
 * repository root, shared by every Next command — to name its own `distDir`. Two development servers therefore
 * rewrote it in turn, each retriggering the other's compiler. Separate `distDir`
 * values removed the shared *output* and left the shared *input*.
 *
 * **2. A cold development server under parallel load.** `next dev` compiles a
 * route on demand and rewrites `<distDir>/dev/prerender-manifest.json` as it
 * goes. Five Playwright workers hitting five uncompiled routes at once produce
 * overlapping writes to that one file, and the writer does not truncate: a
 * shorter rewrite over a longer file leaves the old tail behind. The result is
 * valid JSON followed by garbage — position 1254 of 1306, in the run that was
 * captured — and every render that reads it fails from then on, because nothing
 * rewrites it afterwards.
 *
 * Measured rather than reasoned about. Same spec, same five workers: cold
 * directory → 150 corruption lines and 29 of 30 tests failed; the identical
 * command against the now-warm directory → 30 passed in 8.7 seconds.
 *
 * ### The rules
 *
 * **One writer.** The unconfigured server is a production build served by
 * `next start`, which reads a finished build and writes nothing into the
 * repository. The preview server is the only `next dev`, so `next-env.d.ts`
 * settles on one value and stays there.
 *
 * **Nothing is compiled under load, and no server inherits another's directory.**
 * The unconfigured build is produced here by `next build`. The preview server is
 * started here too — once, on an empty directory — every route is requested
 * **serially** until it has compiled, the resulting artifacts are checked, and
 * only then does Playwright run. The server stays up for the whole suite and is
 * stopped in a `finally`.
 *
 * Handing a warmed directory to a *second* `next dev` does not work and was
 * measured: the new server writes its own shorter manifest over the fuller one,
 * the tail survives, and every route 500s. So Playwright must not start this
 * server, and `playwright.config.ts` deliberately declares no development server
 * at all.
 *
 * The preview server cannot itself be a production build, and that is a safety
 * property rather than an oversight: `src/lib/environment.ts` gates preview mode
 * on `NODE_ENV !== "production"` so that no runtime variable can switch synthetic
 * data on in a deployed bundle, and Next replaces that comparison statically at
 * build time. Measured too — a production build carrying
 * `NEXT_PUBLIC_LOCAL_PREVIEW=1` and served by `next start` renders the setup
 * gate, with no preview banner and no `prv_` row in the HTML.
 *
 * ### Lifecycle: everything it starts, it stops
 *
 * Every child is spawned through a registry (`scripts/lib/childLifecycle.mjs`)
 * and signalled **only by handle** — never by name, never by port. A `pkill
 * next` would kill a developer's own server, and a port search would kill
 * whoever holds 3101, which may be the very process this suite refuses to adopt.
 *
 * The clean path and the interrupted path share one teardown. A signal handler
 * that called `process.exit` directly would end the event loop before any
 * `finally` ran, leaving the development server alive and the port held; and a
 * signal delivered to this process alone — `kill -INT <pid>`, or a supervisor
 * stopping a job — never reaches a child on its own, so it is forwarded to each
 * tracked child, escalated to `SIGKILL` after a grace period, and awaited.
 * Only then is `next-env.d.ts` restored, because a development server that is
 * still running would rewrite it again.
 *
 * ### `next-env.d.ts` is pinned for the length of the run
 *
 * The build rewrites it and so does the development server, and the two write
 * *different* contents — `next build` names `.next/types`, `next dev` names
 * `.next/dev/types`. It is snapshotted before anything runs and rewritten
 * byte-for-byte by the shared teardown, so the value stays put for the length of
 * the run and the development server never starts by arguing with what the build
 * left behind.
 *
 * That is a compiler concern, not a git one: the file is generated and ignored
 * (see `.gitignore`), precisely because no single committed value can be right
 * for both commands. A clean checkout therefore has no file to snapshot, which is
 * why the read is conditional and the restore is a no-op when there was nothing
 * to restore to.
 *
 * Nothing outside `.next-e2e*` is read or written, so a developer's own
 * `pnpm dev` and its `.next` are untouched.
 */
import { spawn } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import {
  createChildRegistry,
  installShutdown,
  stopChild,
} from "./lib/childLifecycle.mjs";
import { waitForServer } from "./lib/serverReadiness.mjs";

/**
 * The CLI entry points, executed directly.
 *
 * The `node_modules/.bin` shims rather than `pnpm exec`: a `pnpm` wrapper is an
 * extra process between this script and the server, and a signal delivered to
 * the wrapper is not guaranteed to reach what it launched — which is precisely
 * how a "stopped" development server keeps holding port 3101. Each shim ends in
 * `exec node …`, so the process this script spawns *becomes* the CLI rather than
 * fathering it: one pid, addressable by the handle `spawn` returned.
 *
 * The shims are used rather than the resolved JavaScript because pnpm's nested
 * layout needs the `NODE_PATH` they export. They are POSIX shell scripts, which
 * matches every platform this suite runs on (developer macOS, Ubuntu in CI).
 */
const ROOT = process.cwd();
const bin = (name) => join(ROOT, "node_modules", ".bin", name);
const NEXT_CLI = bin("next");
const PLAYWRIGHT_CLI = bin("playwright");
const NEXT_ENV = join(ROOT, "next-env.d.ts");
const APP_DIST = ".next-e2e";
const PREVIEW_DIST = ".next-e2e-preview";
/** The port `playwright.config.ts` points the preview projects at. */
const PREVIEW_PORT = Number(process.env["PLAYWRIGHT_PORT"] ?? 3100) + 1;

/** The corruption this runner exists to prevent, as it appears in a dev log. */
const CORRUPTION = "Unexpected non-whitespace character after JSON";

/**
 * The vendor variables, emptied.
 *
 * Empty rather than unset so the suite behaves identically on a machine with a
 * populated `.env.local` and in CI, which has none. An empty value reads as
 * absent (`resolveAppEnvironment`), and Next's `.env` loader does not overwrite
 * a variable the process already carries.
 */
const UNCONFIGURED = {
  NEXT_PUBLIC_CONVEX_URL: "",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "",
  NEXT_PUBLIC_LOCAL_PREVIEW: "",
};

/**
 * The contents of `next-env.d.ts` before anything ran, or `null` if it was absent.
 *
 * Absent is the ordinary case on a clean checkout: the file is generated and
 * git-ignored (see `.gitignore`), because Next writes a different `routes.d.ts`
 * path from `dev` than from `build`. So this is no longer about leaving the
 * *working tree* as it was found — git does not care about this file any more.
 *
 * It is about the compiler. The restore below still runs between the production
 * build and the development server, because the two write different contents and
 * a `next dev` that starts on the value `next build` left will rewrite it and
 * retrigger its own compile. Pinning it to one value for the length of the run
 * is what keeps that from happening; whether git tracks it is beside the point.
 */
const snapshot = existsSync(NEXT_ENV) ? readFileSync(NEXT_ENV, "utf8") : null;

function restoreNextEnv() {
  // Nothing to restore to. The file did not exist when this started, and a
  // generated, ignored file that stays generated is not a leak.
  if (snapshot === null) return;
  if (readFileSync(NEXT_ENV, "utf8") === snapshot) return;
  writeFileSync(NEXT_ENV, snapshot);
  if (readFileSync(NEXT_ENV, "utf8") !== snapshot) {
    throw new Error(
      "next-env.d.ts could not be restored to the contents this run found",
    );
  }
}

const children = createChildRegistry();

/**
 * Run a command to completion, inheriting stdio, and answer its exit code.
 *
 * Tracked like every other child, so an interrupt reaches the build or the
 * Playwright run that is in flight rather than only the servers. A signalled
 * child answers a non-zero code: it did not finish, and treating a terminated
 * build as a passing one would be the worst possible reading.
 */
function run(cliPath, args, env) {
  return new Promise((resolve, reject) => {
    const child = children.track(
      spawn(cliPath, args, {
        stdio: "inherit",
        env: { ...process.env, ...env },
      }),
    );
    child.on("error", reject);
    child.on("close", (code, signal) =>
      resolve(signal === null ? (code ?? 1) : 1),
    );
  });
}

/**
 * Every route the application serves, with a sample value per dynamic segment.
 *
 * Read from the router rather than listed by hand, so a route added later is
 * warmed rather than silently left to compile under load — which is the exact
 * condition that corrupts the manifest.
 */
function routes() {
  const base = join(ROOT, "src", "app", "[locale]");
  const found = [];

  const walk = (directory, segments) => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (entry === "page.tsx") {
        found.push(segments.join(""));
        continue;
      }
      if (!statSync(path).isDirectory()) continue;
      // A route group `(desktop)` is a folder, not a URL segment.
      const segment = /^\(.*\)$/.test(entry)
        ? ""
        : `/${entry.startsWith("[") ? "warm" : entry}`;
      walk(path, [...segments, segment]);
    }
  };

  walk(base, []);
  // Thai is the default locale and the one the preview specs use; English is
  // warmed too because the locale-routing specs cross into it.
  return found.flatMap((route) => [`/th${route}`, `/en${route}`]);
}

/**
 * Start the preview development server, and keep it for the whole run.
 *
 * Started here rather than by Playwright, because a `next dev` that starts over a
 * build directory an earlier one filled rewrites
 * `<distDir>/dev/prerender-manifest.json` with a shorter document and does not
 * truncate — leaving the old tail behind, which every render then fails to parse.
 * Warming a directory and handing it to a *second* server reproduces that
 * reliably. One server, started once on an empty directory, cannot.
 *
 * Routes are then compiled **one at a time**. Several workers compiling at once
 * race on the same manifest and corrupt it the same way; by the time Playwright
 * starts, there is nothing left to compile.
 */
function startPreviewServer() {
  return children.track(
    spawn(NEXT_CLI, ["dev", "--port", String(PREVIEW_PORT)], {
      stdio: ["ignore", "ignore", "inherit"],
      env: {
        ...process.env,
        ...UNCONFIGURED,
        NEXT_PUBLIC_LOCAL_PREVIEW: "1",
        NEXT_DIST_DIR: PREVIEW_DIST,
      },
    }),
  );
}

/** How long the preview server gets to accept its first request. */
const READY_ATTEMPTS = 120;

const url = (path) => `http://localhost:${PREVIEW_PORT}${path}`;

/**
 * Wait for the preview server, then compile every route one at a time.
 *
 * A readiness loop that runs out of attempts **throws**. Falling through to the
 * warm-up would leave every request failing to connect, every route uncompiled,
 * and Playwright starting against a server that is not there — reported as 123
 * failing specs rather than as one server that never listened.
 */
async function warmPreview(server) {
  await waitForServer({
    probe: () => fetch(url("/th"), { signal: AbortSignal.timeout(5_000) }),
    isAlive: () => server.exitCode === null && server.signalCode === null,
    attempts: READY_ATTEMPTS,
    describe: `the preview server on port ${PREVIEW_PORT}`,
  });

  for (const route of routes()) {
    // A route that answers 404 or 500 has still been compiled, which is all this
    // loop is for; the assertions belong to the specs.
    await fetch(url(route), { signal: AbortSignal.timeout(120_000) }).catch(
      () => undefined,
    );
  }
}

/**
 * Fail the run if a build directory holds a corrupted artifact or logged one.
 *
 * The behavioural half of the guard.
 * `tests/integration/e2e-server-isolation.integration.test.ts` asserts the
 * *configuration* can never put two writers in one place; this asserts the
 * symptom never appeared even so. A suite that passed while logging this got
 * lucky, and the next run would not.
 */
function assertNoCorruption() {
  const offenders = [];

  for (const dist of [APP_DIST, PREVIEW_DIST]) {
    const log = join(ROOT, dist, "dev", "logs", "next-development.log");
    if (existsSync(log)) {
      const count = readFileSync(log, "utf8").split(CORRUPTION).length - 1;
      if (count > 0) offenders.push(`${dist}/dev/logs: ${count} occurrence(s)`);
    }
    offenders.push(
      ...corruptArtifacts(dist).map((path) => `${path}: unparseable`),
    );
  }

  if (offenders.length > 0) {
    throw new Error(
      `Corrupted build artifacts during the run:\n  ${offenders.join("\n  ")}\n` +
        "Something wrote a build directory concurrently.",
    );
  }
}

/** Every unparseable JSON artifact under a build directory. */
function corruptArtifacts(dist) {
  const found = [];
  const walk = (directory) => {
    let entries;
    try {
      entries = readdirSync(directory);
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
      } else if (entry.endsWith(".json")) {
        try {
          JSON.parse(readFileSync(path, "utf8"));
        } catch {
          // The manifest race leaves valid JSON with a stale tail, so a parse
          // failure is the detector rather than a size check.
          found.push(path.slice(ROOT.length + 1));
        }
      }
    }
  };
  walk(join(ROOT, dist));
  return found;
}

async function main() {
  /*
   * Start from nothing. A directory left by an interrupted run may already hold
   * a corrupt manifest, and a development server does not rewrite one it can
   * read. Only the suite's own directories are removed; `.next` and
   * `.next-preview` belong to whatever the developer is running and are never
   * touched.
   */
  rmSync(join(ROOT, APP_DIST), { recursive: true, force: true });
  rmSync(join(ROOT, PREVIEW_DIST), { recursive: true, force: true });

  const built = await run(NEXT_CLI, ["build"], {
    ...UNCONFIGURED,
    NEXT_DIST_DIR: APP_DIST,
  });
  // Restored immediately: the build rewrote it, and the server that starts next
  // must not find a value it has to argue with.
  restoreNextEnv();
  if (built !== 0) return built;

  const preview = startPreviewServer();
  try {
    await warmPreview(preview);
    restoreNextEnv();

    // Checked before a single test runs. A corrupt manifest here would make
    // every render fail for a reason no spec could explain.
    const corrupt = corruptArtifacts(PREVIEW_DIST);
    if (corrupt.length > 0) {
      throw new Error(
        `The preview build directory is corrupt after warm-up:\n  ${corrupt.join("\n  ")}`,
      );
    }

    const tested = await run(PLAYWRIGHT_CLI, [
      "test",
      ...process.argv.slice(2),
    ]);
    restoreNextEnv();
    assertNoCorruption();
    return tested;
  } finally {
    await stopChild(preview);
  }
}

/**
 * One teardown, shared by the clean path and the interrupted one.
 *
 * Children first, `next-env.d.ts` afterwards: a development server that is still
 * alive rewrites that file, so restoring it while one is running restores it to
 * the wrong thing. Installed before `main` runs, because a Ctrl-C during the
 * production build has exactly the same obligation as one during the suite.
 */
const shutdown = installShutdown({
  registry: children,
  onCleanup: restoreNextEnv,
});

try {
  process.exitCode = await main();
} finally {
  await shutdown();
}
