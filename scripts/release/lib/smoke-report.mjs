import { filterSmokeDiagnostics } from "./smoke-diagnostics.mjs";

// Turns a Playwright JSON report into the smoke result the release state
// machine consumes. Tests annotated `not-configured` (optional production
// identity checks) are listed separately and never counted as passed; any
// other skip is a required check that did not run.

export function summarizePlaywrightReport(report) {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let skippedRequired = 0;
  const notConfigured = [];

  const visit = (suite, titles) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const title = [...titles, spec.title].filter(Boolean).join(" › ");
        const status = test.status ?? test.results?.at(-1)?.status;
        const annotations = test.annotations ?? [];
        if (status === "skipped" || test.expectedStatus === "skipped") {
          skipped += 1;
          if (
            annotations.some(
              (annotation) => annotation.type === "not-configured",
            )
          ) {
            notConfigured.push(title);
          } else {
            skippedRequired += 1;
          }
        } else if (status === "expected") {
          passed += 1;
        } else {
          // unexpected, flaky (diagnostic retries fail on flakes) or interrupted
          failed += 1;
        }
      }
    }
    for (const child of suite.suites ?? [])
      visit(child, [...titles, child.title]);
  };
  for (const suite of report?.suites ?? []) visit(suite, [suite.title]);

  const errors = (report?.errors ?? []).length;
  return {
    ok: errors === 0 && failed === 0 && skippedRequired === 0 && passed > 0,
    passed,
    failed: failed + errors,
    skipped,
    skippedRequired,
    notConfigured,
    diagnostics: filterSmokeDiagnostics(report?.diagnostics),
    summary: `${passed} passed, ${failed + errors} failed, ${skipped} skipped`,
  };
}
