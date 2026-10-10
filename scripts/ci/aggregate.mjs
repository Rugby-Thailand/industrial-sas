#!/usr/bin/env node
// Evaluates `toJSON(needs)` for the stable `check` job.
// Usage:
//   NEEDS_JSON='${{ toJSON(needs) }}' EVENT_NAME=... \
//   REQUIRED_JOBS=validate,test,... PULL_REQUEST_ONLY=dependency-review \
//   node scripts/ci/aggregate.mjs
// REQUIRED_JOBS is mandatory: a job dropped from `needs` (or a new job added
// to `needs` without being declared) fails instead of silently passing.
import { aggregateProblems } from "./lib.mjs";

const list = (value) =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

let needs;
try {
  needs = JSON.parse(process.env.NEEDS_JSON ?? "");
} catch {
  console.error("Quality gate failed: NEEDS_JSON is not valid JSON.");
  process.exit(1);
}
if (needs === null || typeof needs !== "object" || Array.isArray(needs)) {
  console.error("Quality gate failed: NEEDS_JSON must be an object.");
  process.exit(1);
}
const required = list(process.env.REQUIRED_JOBS);
if (required.length === 0) {
  console.error("Quality gate failed: REQUIRED_JOBS is not set.");
  process.exit(1);
}
const results = Object.fromEntries(
  Object.entries(needs).map(([job, value]) => [job, value?.result]),
);
const problems = aggregateProblems({
  event: process.env.EVENT_NAME,
  results,
  required,
  pullRequestOnly: list(process.env.PULL_REQUEST_ONLY),
});
for (const job of [...new Set([...required, ...Object.keys(results)])].sort())
  console.log(`${job}: ${results[job] ?? "missing"}`);
if (problems.length > 0) {
  console.error("Quality gate failed:");
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log("All required quality jobs passed.");
