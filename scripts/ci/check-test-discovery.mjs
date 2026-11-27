#!/usr/bin/env node
// Every tracked *.test.* / *.spec.* file must be collected by exactly one
// runner project (T11). Catches a file silently excluded by a glob change.
import { execFileSync } from "node:child_process";
import { relative, resolve } from "node:path";
import { createVitest } from "vitest/node";

import { testDiscoveryProblems } from "./lib.mjs";
import { TEST_SHARDS, uncoveredNavigationProjects } from "./workflow-lib.mjs";

const root = process.cwd();
const run = (command, args) =>
  execFileSync(command, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"],
  });

const tracked = run("git", ["ls-files", "-z"]).split("\0").filter(Boolean);

// Use the configured sequencer, as the CI run does. Vitest's files-only
// listing does not apply --shard, so it cannot detect omissions or overlaps.
const context = await createVitest("test", { run: true });
const vitest = [];
try {
  const discovered = await context.getRelevantTestSpecifications();
  const sequencer = new context.config.sequence.sequencer(context);
  for (let index = 1; index <= TEST_SHARDS; index += 1) {
    context.config.shard = { index, count: TEST_SHARDS };
    const files = await sequencer.shard(discovered);
    if (files.length === 0) throw new Error(`Vitest shard ${index} is empty`);
    for (const file of files) {
      vitest.push({
        file: relative(root, file.moduleId),
        projectName: file.project.name,
      });
    }
  }
} finally {
  await context.close();
}

const playwright = [];
const navigationProblems = [];
for (const config of [
  "playwright.config.ts",
  "playwright.workspace.config.ts",
  "playwright.navigation.config.ts",
  "playwright.staging.config.ts",
  "playwright.production.config.ts",
  "playwright.hr-local.config.ts",
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
  if (config === "playwright.navigation.config.ts") {
    const projects = report.config.projects.map(({ name }) => name);
    for (const name of uncoveredNavigationProjects(projects))
      navigationProblems.push(
        `${name}: no navigation CI leg selects this project`,
      );
  }
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

const problems = [
  ...navigationProblems,
  ...testDiscoveryProblems({ tracked, vitest, playwright }),
];
if (problems.length > 0) {
  console.error("Test discovery mismatch:");
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(
  `Test discovery OK: ${vitest.length} Vitest files across ${TEST_SHARDS} shards, ` +
    `${new Set(playwright).size} Playwright spec files.`,
);
