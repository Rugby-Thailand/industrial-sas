#!/usr/bin/env node
// Every tracked *.test.* / *.spec.* file must be collected by exactly one
// runner project (T11). Catches a file silently excluded by a glob change.
import { execFileSync } from "node:child_process";
import { relative, resolve } from "node:path";

import { testDiscoveryProblems } from "./lib.mjs";

const root = process.cwd();
const run = (command, args) =>
  execFileSync(command, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"],
  });

const tracked = run("git", ["ls-files", "-z"]).split("\0").filter(Boolean);

const vitest = JSON.parse(
  run("pnpm", ["exec", "vitest", "list", "--filesOnly", "--json"]),
).map(({ file, projectName }) => ({
  file: relative(root, resolve(root, file)),
  projectName,
}));

const playwright = [];
for (const config of [
  "playwright.config.ts",
  "playwright.workspace.config.ts",
  "playwright.staging.config.ts",
  "playwright.production.config.ts",
]) {
  const report = JSON.parse(
    run("pnpm", [
      "exec",
      "playwright",
      "test",
      "--config",
      config,
      "--list",
      "--reporter=json",
    ]),
  );
  const visit = (suite) => {
    if (suite.file && (suite.specs?.length ?? 0) > 0) {
      playwright.push(
        relative(root, resolve(report.config.rootDir, suite.file)),
      );
    }
    for (const child of suite.suites ?? []) visit(child);
  };
  for (const suite of report.suites ?? []) visit(suite);
}

const problems = testDiscoveryProblems({ tracked, vitest, playwright });
if (problems.length > 0) {
  console.error("Test discovery mismatch:");
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(
  `Test discovery OK: ${vitest.length} Vitest files, ` +
    `${new Set(playwright).size} Playwright spec files.`,
);
