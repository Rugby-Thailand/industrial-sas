#!/usr/bin/env node
// Quality-only: join the anonymous build and locked browser installation.
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function prepareBrowserSuite({
  suite,
  env = process.env,
  spawnImpl = spawn,
  killImpl = process.kill,
  signalSource = process,
  exit = (code) => process.exit(code),
}) {
  if (!["smoke", "navigation"].includes(suite))
    throw new Error("Browser preparation requires smoke or navigation.");
  const environment = Object.fromEntries(
    ["PATH", "HOME", "TMPDIR"]
      .filter((name) => env[name])
      .map((name) => [name, env[name]]),
  );
  if (!environment.PATH || !environment.HOME)
    throw new Error("Browser preparation requires runner PATH and HOME.");
  environment.CI = "1";
  environment.NEXT_TELEMETRY_DISABLED = "1";
  const buildArgs = [suite === "smoke" ? "build" : "build:navigation"];
  const installArgs = [
    "exec",
    "playwright",
    "install",
    "--with-deps",
    "--only-shell",
    "chromium",
    ...(suite === "navigation" ? ["firefox", "webkit"] : []),
  ];
  const owned = new Set();
  let canceled = false;
  const kill = (child) => {
    if (!child.pid) return;
    try {
      killImpl(-child.pid, "SIGKILL");
    } catch {
      try {
        child.kill("SIGKILL");
      } catch {
        /* Already gone. */
      }
    }
  };
  const terminate = (code) => {
    canceled = true;
    console.log(
      `[browser-preparation] canceled (${code === 143 ? "SIGTERM" : "SIGINT"})`,
    );
    // Synchronous cancellation cannot race a later successful join. Signal
    // only our freshly-created Unix groups, including their descendants.
    for (const child of owned) kill(child);
    exit(code);
  };
  const onTerm = () => terminate(143);
  const onInterrupt = () => terminate(130);
  signalSource.once("SIGTERM", onTerm);
  signalSource.once("SIGINT", onInterrupt);
  function start(args, build = false) {
    return new Promise((resolveResult) => {
      let child;
      try {
        child = spawnImpl("pnpm", args, {
          detached: true,
          stdio: "inherit",
          env: {
            ...environment,
            ...(build && suite === "smoke"
              ? { CI_EXTERNAL_TYPECHECK: "1" }
              : {}),
          },
        });
        owned.add(child);
      } catch {
        console.log(
          `[browser-preparation] ${build ? "build" : "install"}: spawn-failed`,
        );
        resolveResult(false);
        return;
      }
      let settled = false;
      const finish = (ok, reason, status = null) => {
        if (settled) return;
        settled = true;
        // pnpm exit status defines command success. Its process group can
        // still contain reaping zombies or nonblocking compiler workers;
        // clean those up without overriding a well-formed successful exit.
        let descendants = false;
        if (child.pid) {
          try {
            killImpl(-child.pid, 0);
            descendants = true;
          } catch (error) {
            descendants = error?.code !== "ESRCH";
          }
        }
        if (descendants) kill(child);
        owned.delete(child);
        const result = canceled ? "canceled" : reason;
        console.log(
          `[browser-preparation] ${build ? "build" : "install"}: ${result}; cleanup=${descendants ? "residual-group" : "not-needed"}; status=${status === null ? "none" : status}`,
        );
        resolveResult(ok && !canceled);
      };
      child.once("error", () => finish(false, "spawn-failed"));
      child.once("close", (code) =>
        finish(code === 0, code === 0 ? "success" : "exit-failed", code),
      );
    });
  }
  try {
    // Do not short-circuit either child failure: both independent outcomes
    // finish before clean-tree checks or browser tests can start.
    const results = await Promise.all([
      start(buildArgs, true),
      start(installArgs),
    ]);
    return !canceled && results.every(Boolean);
  } finally {
    for (const child of owned) kill(child);
    signalSource.removeListener("SIGTERM", onTerm);
    signalSource.removeListener("SIGINT", onInterrupt);
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (
    process.argv.length !== 3 ||
    !/^--suite=(smoke|navigation)$/.test(process.argv[2])
  ) {
    console.error(
      "Usage: node scripts/ci/prepare-browser-suite.mjs --suite=smoke|navigation",
    );
    process.exit(1);
  }
  const ok = await prepareBrowserSuite({
    suite: process.argv[2]?.replace(/^--suite=/, ""),
  });
  process.exit(ok ? 0 : 1);
}
