import { appendFileSync, readFileSync } from "node:fs";

import { junitSummary } from "./lib.mjs";
import {
  COVERAGE_UNAVAILABLE,
  coverageMarkdown,
  junitProblems,
} from "./report-lib.mjs";

const problems = [];
const outcome = process.env.VITEST_OUTCOME;
if (outcome !== undefined && outcome !== "success")
  problems.push("The Vitest step did not succeed.");

function verifyReport(path, verify) {
  try {
    return verify(readFileSync(path, "utf8"));
  } catch (error) {
    problems.push(`${path}: ${error.message}`);
  }
}

const coverage = verifyReport("coverage/coverage-summary.json", (json) => {
  const markdown = coverageMarkdown(JSON.parse(json));
  if (markdown === COVERAGE_UNAVAILABLE) throw new Error(markdown);
  return markdown;
});
verifyReport("coverage/lcov.info", (lcov) => {
  if (!/^SF:.+$/m.test(lcov) || !lcov.trimEnd().endsWith("\nend_of_record"))
    throw new Error("LCOV report is empty or incomplete");
});
const junit = verifyReport("test-results/vitest-junit.xml", (xml) => {
  if (!xml.trimEnd().endsWith("</testsuites>"))
    throw new Error("JUnit report is incomplete");
  const totals = junitSummary(xml);
  if (junitProblems(totals).length > 0)
    throw new Error(
      "JUnit must report at least one test and no failures or errors",
    );
  if (totals.skipped >= totals.tests)
    throw new Error("JUnit contains only skipped tests");
  return totals;
});
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
const { tests, failures, errors, skipped } = junit;

const summary = [
  "### Full-suite coverage",
  "",
  `JUnit recorded ${tests} tests, ${skipped} skipped, ${failures} failures and ${errors} errors.`,
  "",
  coverage,
  "",
].join("\n");
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
