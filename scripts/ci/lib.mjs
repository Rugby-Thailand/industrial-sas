// Pure helpers shared by the CI guard scripts. Kept dependency-free so they
// run before (or without) the application toolchain and are unit-testable.

/** Parse `git status --porcelain=v1 -z` output into `{ status, path }` rows. */
export function parsePorcelainZ(output) {
  const rows = [];
  const parts = output.split("\0");
  for (let index = 0; index < parts.length; index += 1) {
    const entry = parts[index];
    if (!entry) continue;
    const status = entry.slice(0, 2);
    const path = entry.slice(3);
    rows.push({ status, path });
    // Renames/copies carry the original path as the next NUL field.
    if (status.includes("R") || status.includes("C")) index += 1;
  }
  return rows;
}

// Mirrors Vitest's **/*.{test,spec}.?(c|m)[jt]s?(x) default include, even when
// this repo's narrower project globs do not yet collect a supported extension.
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

/**
 * Compare tracked test files with what each runner actually collected.
 * Every tracked test must be collected exactly once (Vitest project or
 * Playwright project); anything else is a silent coverage hole.
 */
export function testDiscoveryProblems({ tracked, vitest, playwright }) {
  const problems = [];
  const counts = new Map();
  for (const { file, projectName } of vitest) {
    const list = counts.get(file) ?? [];
    list.push(`vitest:${projectName}`);
    counts.set(file, list);
  }
  for (const file of new Set(playwright)) {
    const list = counts.get(file) ?? [];
    list.push("playwright");
    counts.set(file, list);
  }
  for (const file of tracked.filter((path) => TEST_FILE.test(path))) {
    const owners = counts.get(file) ?? [];
    if (owners.length === 0)
      problems.push(`${file}: not collected by any runner`);
    if (owners.length > 1)
      problems.push(`${file}: collected more than once (${owners.join(", ")})`);
  }
  for (const file of counts.keys()) {
    if (!tracked.includes(file))
      problems.push(`${file}: collected but not tracked by git`);
  }
  return problems.sort();
}

/**
 * Validate merged JUnit report counts so a missing shard or an empty report
 * can never read as success.
 */
export function junitSummary(xml) {
  const suites = xml.match(/<testsuites\b[^>]*>/);
  if (!suites) throw new Error("JUnit report has no <testsuites> element");
  const attribute = (name) => {
    const match = suites[0].match(new RegExp(`\\b${name}="(\\d+)"`));
    return match ? Number(match[1]) : 0;
  };
  return {
    tests: attribute("tests"),
    failures: attribute("failures"),
    errors: attribute("errors"),
    skipped: attribute("skipped"),
  };
}

/** Names and values must never be echoed for secrets; names only. */
export function presentSecretNames(env, names) {
  return names.filter((name) => (env[name] ?? "").trim().length > 0);
}

// Events that may produce the stable `check`. A PR-only job may be skipped
// only on the two trusted non-PR events; any other event fails closed until
// it is reviewed here (for example `merge_group` before a merge queue).
const AGGREGATE_EVENTS = new Set(["pull_request", "push", "workflow_dispatch"]);

/**
 * The stable `check` gate (CI-01/S10). Every mandatory job must succeed.
 * Jobs listed in `pullRequestOnly` must succeed on pull_request events and
 * must be skipped (by their own `if`) on push/workflow_dispatch; any other
 * state — failure, cancellation, an unexpected skip or an unexpected run —
 * fails. When `required` is given, a required job absent from `needs` and a
 * reported job that is not declared required both fail (configuration drift).
 *
 * @param {{
 *   event: string | undefined,
 *   results: Record<string, string | undefined>,
 *   required?: readonly string[],
 *   pullRequestOnly?: readonly string[],
 * }} input
 * @returns {string[]}
 */
export function aggregateProblems({
  event,
  results,
  required,
  pullRequestOnly = [],
}) {
  const problems = [];
  if (!AGGREGATE_EVENTS.has(event)) {
    problems.push(`event ${event || "missing"}: not an aggregate event`);
  }
  const declared = required ?? Object.keys(results);
  for (const job of pullRequestOnly) {
    if (!declared.includes(job))
      problems.push(`${job}: PR-only job is not a required job`);
  }
  if (required) {
    for (const job of Object.keys(results).sort()) {
      if (!required.includes(job))
        problems.push(`${job}: reported but not declared required`);
    }
  }
  for (const job of [...declared].sort()) {
    const result = results[job];
    const expected =
      pullRequestOnly.includes(job) && event !== "pull_request"
        ? "skipped"
        : "success";
    if (result !== expected) {
      problems.push(`${job}: ${result || "missing"} (expected ${expected})`);
    }
  }
  if (declared.length === 0) problems.push("no jobs reported");
  return problems;
}
