// Pure helpers for scripts/ci/test-report.mjs (T11/T12).

/** Every shard must deliver exactly one blob named by Vitest's convention. */
export function blobInventoryProblems(files, shards) {
  if (!Number.isInteger(shards) || shards < 1)
    return ["shard count must be a positive integer"];
  const expected = Array.from(
    { length: shards },
    (_, index) => `blob-${index + 1}-${shards}.json`,
  );
  const problems = [];
  for (const name of expected)
    if (!files.includes(name)) problems.push(`${name}: shard report missing`);
  for (const name of files)
    if (!expected.includes(name)) problems.push(`${name}: unexpected report`);
  return problems.sort();
}

/** A merged report must be non-empty and free of failures and errors. */
export function junitProblems(summary) {
  const problems = [];
  if (summary.tests === 0) problems.push("merged JUnit report has no tests");
  if (summary.failures > 0)
    problems.push(`${summary.failures} failed test(s) in the merged report`);
  if (summary.errors > 0)
    problems.push(`${summary.errors} errored test(s) in the merged report`);
  return problems;
}

const METRICS = ["lines", "statements", "functions", "branches"];

/**
 * Informational combined-coverage table from Istanbul's json-summary. No
 * thresholds are applied: floors follow a measured baseline (T12).
 */
export function coverageMarkdown(summary) {
  const total = summary?.total;
  if (!total || !METRICS.every((metric) => total[metric]))
    return "Combined coverage summary unavailable.";
  const rows = METRICS.map((metric) => {
    const { covered, total: count, pct } = total[metric];
    return `| ${metric} | ${pct}% | ${covered}/${count} |`;
  });
  return [
    "Combined coverage (informational, no thresholds):",
    "",
    "| Metric | Covered | Count |",
    "| --- | ---: | ---: |",
    ...rows,
  ].join("\n");
}

const SEVERITIES = ["critical", "high", "moderate", "low", "info"];

/**
 * Informative all-severity view of `pnpm audit --json` (S12). Returns public
 * advisory identifiers only. A malformed or error report throws: an outage
 * is never read as "no advisories".
 */
export function auditSummary(report) {
  const counts = report?.metadata?.vulnerabilities;
  if (
    report === null ||
    typeof report !== "object" ||
    report.error !== undefined ||
    report.advisories === null ||
    typeof report.advisories !== "object" ||
    Array.isArray(report.advisories) ||
    counts === null ||
    typeof counts !== "object" ||
    !SEVERITIES.every(
      (severity) =>
        Number.isSafeInteger(counts[severity]) && counts[severity] >= 0,
    )
  )
    throw new Error("pnpm audit did not return a valid advisory report");
  const advisories = Object.values(report.advisories).map((advisory) => {
    if (!SEVERITIES.includes(advisory?.severity))
      throw new Error("pnpm audit returned an unknown severity");
    return {
      ghsa: String(advisory.github_advisory_id ?? "unknown"),
      package: String(advisory.module_name ?? "unknown"),
      severity: advisory.severity,
      versions: [
        ...new Set(
          (advisory.findings ?? []).map(({ version }) => String(version)),
        ),
      ].sort(),
    };
  });
  advisories.sort(
    (a, b) =>
      SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) ||
      a.package.localeCompare(b.package) ||
      a.ghsa.localeCompare(b.ghsa),
  );
  return {
    counts: Object.fromEntries(SEVERITIES.map((s) => [s, counts[s]])),
    advisories,
  };
}
