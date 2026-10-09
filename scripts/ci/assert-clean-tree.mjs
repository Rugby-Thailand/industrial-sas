#!/usr/bin/env node
// Fails when generators or the build rewrote a tracked file or produced an
// untracked, unignored file (CI-06). Ignored outputs (.next, coverage, reports)
// pass. Run it after `next typegen`, Convex codegen, and `next build`.
import { execFileSync } from "node:child_process";

import { parsePorcelainZ } from "./lib.mjs";

const output = execFileSync(
  "git",
  ["status", "--porcelain=v1", "--untracked-files=all", "-z"],
  { encoding: "utf8" },
);
const rows = parsePorcelainZ(output);
if (rows.length > 0) {
  console.error(
    "The working tree changed during this job. Commit generated output or " +
      "add a reviewed ignore rule:",
  );
  for (const { status, path } of rows) console.error(`  ${status} ${path}`);
  process.exit(1);
}
console.log("Working tree is clean.");
