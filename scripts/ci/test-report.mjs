#!/usr/bin/env node
// Verifies the merged Vitest report in the `test-report` job (T11/T12).
//
//   SHARD_RESULT=<needs.test.result> node scripts/ci/test-report.mjs \
//     --blobs=<dir> --shards=2 --junit=<file> --coverage=<json-summary>
//
// Fails when a shard did not succeed, a shard blob is missing or unexpected,
// the merged JUnit file is missing/empty, or it records failures or errors.
// Coverage is reported for information only.
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";

import { junitSummary } from "./lib.mjs";
import {
  blobInventoryProblems,
  coverageMarkdown,
  junitProblems,
} from "./report-lib.mjs";

const options = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const match = /^--([a-z]+)=(.+)$/.exec(arg);
    if (!match) {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
    return [match[1], match[2]];
  }),
);
for (const name of ["blobs", "shards", "junit", "coverage"]) {
  if (!options[name]) {
    console.error(`--${name} is required`);
    process.exit(2);
  }
}

const problems = [];
const shardResult = process.env.SHARD_RESULT;
if (shardResult !== undefined && shardResult !== "success")
  problems.push(`test shards finished with result ${shardResult || "missing"}`);

const blobs = existsSync(options.blobs)
  ? readdirSync(options.blobs).filter((name) => name.endsWith(".json"))
  : [];
problems.push(...blobInventoryProblems(blobs, Number(options.shards)));

let totals;
try {
  totals = junitSummary(readFileSync(options.junit, "utf8"));
  problems.push(...junitProblems(totals));
} catch (error) {
  problems.push(
    `merged JUnit report unreadable: ${error instanceof Error ? error.message : String(error)}`,
  );
}

let coverage = "Combined coverage summary unavailable.";
try {
  coverage = coverageMarkdown(
    JSON.parse(readFileSync(options.coverage, "utf8")),
  );
} catch {
  console.log("::warning::Combined coverage summary was not produced.");
}

const lines = [
  "### Vitest (merged shards)",
  "",
  totals
    ? `Tests ${totals.tests}, failures ${totals.failures}, errors ${totals.errors}, skipped ${totals.skipped}; shard reports ${blobs.length}/${options.shards}.`
    : `Merged JUnit report unavailable; shard reports ${blobs.length}/${options.shards}.`,
  "",
  coverage,
  "",
  ...problems.map((problem) => `- ❌ ${problem}`),
  "",
];
console.log(lines.join("\n"));
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"));
process.exit(problems.length > 0 ? 1 : 0);
