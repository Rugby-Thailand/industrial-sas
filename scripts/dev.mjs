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

function start(name, command, args) {
  console.log(`[dev] Starting ${name}…`);
  const child = children.track(
    spawn(command, args, {
      cwd: root,
      env: process.env,
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

const backend = start("Convex backend", bin("convex"), ["dev"]);
const web = start("Next.js web", bin("next"), [
  "dev",
  "--webpack",
  "--port",
  process.env.PORT ?? "3100",
]);
const firstExit = await Promise.race([backend.finished, web.finished]);

await stopAll();

if (!interrupted) {
  if (firstExit.error !== null) {
    console.error(`[dev] ${firstExit.name} failed to start:`, firstExit.error);
  } else {
    const reason =
      firstExit.signal === null
        ? `code ${firstExit.code}`
        : `signal ${firstExit.signal}`;
    console.error(`[dev] ${firstExit.name} stopped (${reason}); stopped both.`);
  }
  process.exitCode = firstExit.code === 0 ? 1 : firstExit.code;
}
