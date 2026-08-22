#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const appDist = ".next-e2e";
const nextEnvPath = join(root, "next-env.d.ts");
const nextEnv = existsSync(nextEnvPath)
  ? readFileSync(nextEnvPath, "utf8")
  : undefined;
const testEnv = {
  ...process.env,
  NEXT_PUBLIC_CONVEX_URL: "",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "",
  CLERK_SECRET_KEY: "",
  NEXT_DIST_DIR: appDist,
};

const run = (command, args, env = process.env) =>
  spawnSync(command, args, { cwd: root, env, stdio: "inherit" }).status ?? 1;

try {
  rmSync(join(root, appDist), { recursive: true, force: true });
  const built = run("pnpm", ["exec", "next", "build"], testEnv);
  process.exitCode =
    built === 0
      ? run("pnpm", ["exec", "playwright", "test", ...process.argv.slice(2)])
      : built;
} finally {
  if (nextEnv !== undefined) writeFileSync(nextEnvPath, nextEnv);
}
