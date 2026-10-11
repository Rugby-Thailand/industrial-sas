#!/usr/bin/env node

import { spawn } from "node:child_process";
import { join } from "node:path";
import { readFileSync } from "node:fs";

import { createChildRegistry } from "./lib/childLifecycle.mjs";

const root = process.cwd();
const localEnvironment = readFileSync(join(root, ".env.local"), "utf8");
const deployment = /^CONVEX_DEPLOYMENT=(.+)$/m
  .exec(localEnvironment)?.[1]
  ?.trim();
if (
  !deployment?.startsWith("anonymous:") &&
  !deployment?.startsWith("local:")
) {
  throw new Error(
    "The planner dev runner requires its own local Convex deployment. See README.md.",
  );
}
const bin = (name) => join(root, "node_modules", ".bin", name);
const children = createChildRegistry();

let interrupted = false;
let cleanup;

function stopAll(signal) {
  cleanup ??= children.stopAll(signal === undefined ? {} : { signal });
  return cleanup;
}

function start(name, command, args, env = process.env) {
  console.log(`[dev] Starting ${name}…`);
  const child = children.track(
    spawn(command, args, {
      cwd: root,
      env,
      stdio: "inherit",
    }),
  );

  const finished = new Promise((resolve) => {
    child.once("error", (error) => {
      resolve({ code: 1, error, name, signal: null });
    });
    child.once("close", (code, signal) => {
      resolve({ code: code ?? 1, error: null, name, signal });
    });
  });

  return { child, finished };
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    interrupted = true;
    void stopAll(signal);
  });
}

console.log("[dev] Convex and Next.js share this terminal. Ctrl+C stops both.");

// Convex stays on its Node CLI. Next runs under Bun (docs/operations/
// bun-runtime.md): its JS entry directly, so this child is the Next process
// itself and stopAll() signals it as before. --no-env-file stops Bun preloading
// .env files before Next selects its own; BUN_OPTIONS carries the flag to the
// dev server Next forks with its own execArgv. `pnpm dev:web:node` is the
// Node fallback.
const backend = start("Convex backend", bin("convex"), ["dev"]);
const web = start(
  "Next.js web (Bun)",
  "bun",
  [
    "--bun",
    "--no-env-file",
    join(root, "node_modules", "next", "dist", "bin", "next"),
    "dev",
    "--webpack",
    "--port",
    process.env.PORT ?? "3100",
  ],
  { ...process.env, BUN_OPTIONS: "--no-env-file" },
);
const firstExit = await Promise.race([backend.finished, web.finished]);

await stopAll();

if (!interrupted) {
  if (firstExit.error !== null) {
    console.error(`[dev] ${firstExit.name} failed to start:`, firstExit.error);
    if (firstExit.error.code === "ENOENT" && firstExit.name.includes("Bun"))
      console.error(
        "[dev] Put the pinned Bun on PATH (node scripts/ci/install-bun-checker.mjs).",
      );
  } else {
    const reason =
      firstExit.signal === null
        ? `code ${firstExit.code}`
        : `signal ${firstExit.signal}`;
    console.error(`[dev] ${firstExit.name} stopped (${reason}); stopped both.`);
  }
  process.exitCode = firstExit.code === 0 ? 1 : firstExit.code;
}
