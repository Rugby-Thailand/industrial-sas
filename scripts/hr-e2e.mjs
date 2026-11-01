#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  chmodSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  appendFileSync,
  rmSync,
} from "node:fs";
import { once } from "node:events";

import { loadHrEnvironment } from "./lib/hr-e2e-env.mjs";
import { requireHrPortFree } from "./lib/hr-e2e-ports.mjs";

process.umask(0o077);
const env = loadHrEnvironment();
const directory = ".cache/hr-browser";
mkdirSync(directory, { recursive: true, mode: 0o700 });
chmodSync(directory, 0o700);
const owned = new Set();
const journal = `${directory}/processes.jsonl`;
const lockPath = `${directory}/run.lock`;
let ownsLock = false;
const log = (event) =>
  appendFileSync(
    journal,
    `${JSON.stringify({ at: new Date().toISOString(), cwd: process.cwd(), ...event })}\n`,
    { mode: 0o600 },
  );

function start(label, entry, args, output) {
  const child = spawn(process.execPath, [entry, ...args], {
    env: {
      ...env,
      CONVEX_AGENT_MODE: "anonymous",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    detached: true,
    stdio: ["ignore", output, output],
  });
  owned.add(child);
  log({ event: "start", label, pid: child.pid });
  child.once("close", (code, signal) => {
    log({ event: "exit", label, pid: child.pid, code, signal });
  });
  return child;
}

async function stop(child) {
  // Each child starts its own process group; signal only groups we created,
  // including a CLI's backend, dashboard, web server and browser children.
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    /* already stopped */
  }
  const timer = setTimeout(() => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      /* already stopped */
    }
  }, 5_000);
  if (child.exitCode === null && child.signalCode === null)
    await once(child, "close");
  clearTimeout(timer);
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    /* no surviving group */
  }
  owned.delete(child);
  log({ event: "cleanup", pid: child.pid });
}

let cleanup;
function stopAll() {
  cleanup ??= Promise.all([...owned].reverse().map(stop)).finally(() => {
    if (ownsLock) rmSync(lockPath, { force: true });
  });
  return cleanup;
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => void stopAll().then(() => process.exit(1)));
}
const deadline = setTimeout(() => {
  console.error("HR_E2E_RUN_TIMEOUT");
  void stopAll().then(() => process.exit(1));
}, 20 * 60_000);

async function command(args) {
  const output = openSync(`${directory}/commands.log`, "a", 0o600);
  const child = start(
    "convex-command",
    "node_modules/convex/bin/main.js",
    args,
    output,
  );
  closeSync(output);
  const [code] = await once(child, "close");
  await stop(child);
  if (code !== 0) throw new Error("HR_E2E_LOCAL_BACKEND_COMMAND_FAILED");
}

try {
  try {
    const lock = openSync(lockPath, "wx", 0o600);
    closeSync(lock);
    ownsLock = true;
  } catch {
    throw new Error(
      "HR_E2E_RUN_LOCKED; another run or an unreviewed stale lock exists",
    );
  }
  for (const port of [3100, 3320, 3321]) await requireHrPortFree(port);
  const backendLog = `${directory}/backend.log`;
  const output = openSync(backendLog, "w", 0o600);
  const backend = start(
    "convex",
    "node_modules/convex/bin/main.js",
    [
      "dev",
      "--local-cloud-port",
      "3320",
      "--local-site-port",
      "3321",
      "--local-backend-version",
      "precompiled-2026-10-06-a3538c6",
      "--typecheck",
      "disable",
      "--codegen",
      "disable",
      "--tail-logs",
      "disable",
    ],
    output,
  );
  closeSync(output);
  const waitUntil = async (predicate) => {
    const until = Date.now() + 120_000;
    while (!(await predicate())) {
      if (
        backend.exitCode !== null ||
        backend.signalCode !== null ||
        Date.now() > until
      )
        throw new Error("HR_E2E_LOCAL_BACKEND_NOT_READY");
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  };
  await waitUntil(async () => {
    try {
      const config = JSON.parse(
        readFileSync(".convex/local/default/config.json", "utf8"),
      );
      if (
        env.CONVEX_DEPLOYMENT !== `anonymous:${config.deploymentName}` ||
        config.ports.cloud !== 3320 ||
        config.ports.site !== 3321
      )
        return false;
      const response = await fetch(
        `${env.NEXT_PUBLIC_CONVEX_URL}/instance_name`,
        { signal: AbortSignal.timeout(2_000) },
      );
      return response.ok && (await response.text()) === config.deploymentName;
    } catch {
      return false;
    }
  });
  await command([
    "env",
    "set",
    "CLERK_JWT_ISSUER_DOMAIN",
    env.CLERK_JWT_ISSUER_DOMAIN,
  ]);
  await command(["env", "set", "ALLOW_LOCAL_TEST_SEED", "true"]);
  await waitUntil(async () =>
    readFileSync(backendLog, "utf8").includes("Convex functions ready"),
  );
  const tests = start(
    "playwright",
    "node_modules/@playwright/test/cli.js",
    [
      "test",
      "--config",
      "playwright.hr-local.config.ts",
      ...process.argv.slice(2),
    ],
    "inherit",
  );
  const [code] = await once(tests, "close");
  process.exitCode = code ?? 1;
} catch (error) {
  // Only our fixed diagnostics reach the console; SDK/CLI output stays private.
  console.error(
    error instanceof Error && error.message.startsWith("HR_E2E_")
      ? error.message
      : "HR_E2E_RUN_FAILED",
  );
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  await stopAll();
}
