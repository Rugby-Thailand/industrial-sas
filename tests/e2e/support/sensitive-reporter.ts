import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type {
  FullResult,
  Reporter,
  TestCase,
  TestError,
  TestResult,
} from "@playwright/test/reporter";

/** No raw errors, URLs, stdout, stderr, steps, annotations or attachments. */
export default class SensitiveReporter implements Reporter {
  private readonly tests = new Map<string, TestCase>();
  private errors = 0;

  constructor(
    private readonly options: { outputFile: string; junitFile?: string },
  ) {}

  printsToStdio() {
    // Own the stdio surface without emitting raw output. Returning false makes
    // Playwright 1.62 add its default reporter, which prints unredacted errors.
    return true;
  }
  onStdOut(_chunk: string | Buffer) {}
  onStdErr(_chunk: string | Buffer) {}
  onError(_error: TestError) {
    this.errors += 1;
  }
  onTestEnd(test: TestCase, _result?: TestResult) {
    this.tests.set(test.id, test);
  }

  onEnd(result: FullResult) {
    const specs = [...this.tests.values()].map((test, index) => {
      const outcome = test.outcome();
      const status = test.expectedStatus === "failed" ? "unexpected" : outcome;
      return {
        title: `check-${index + 1}`,
        tests: [
          {
            status,
            expectedStatus:
              test.expectedStatus === "skipped" ? "skipped" : "passed",
            annotations: test.annotations.some(
              ({ type }) => type === "not-configured",
            )
              ? [{ type: "not-configured" }]
              : [],
          },
        ],
      };
    });
    const hasFailure = specs.some(
      ({ tests }) => !["expected", "skipped"].includes(tests[0]!.status),
    );
    const errors = Math.max(
      this.errors,
      result.status === "passed" || hasFailure ? 0 : 1,
    );
    const report = {
      suites: [{ title: "sensitive-smoke", specs }],
      errors: Array.from({ length: errors }, () => ({
        message: "SENSITIVE_SMOKE_FAILED",
      })),
    };
    mkdirSync(dirname(this.options.outputFile), { recursive: true });
    writeFileSync(this.options.outputFile, `${JSON.stringify(report)}\n`, {
      mode: 0o600,
    });
    if (this.options.junitFile) {
      const rows = specs.map(({ title, tests }) => {
        const status = tests[0]!.status;
        const detail =
          status === "skipped"
            ? "<skipped/>"
            : status === "expected"
              ? ""
              : '<failure message="SENSITIVE_SMOKE_FAILED"/>';
        return `<testcase name="${title}">${detail}</testcase>`;
      });
      const failures = specs.filter(
        ({ tests }) => !["expected", "skipped"].includes(tests[0]!.status),
      ).length;
      const skipped = specs.filter(
        ({ tests }) => tests[0]!.status === "skipped",
      ).length;
      mkdirSync(dirname(this.options.junitFile), { recursive: true });
      writeFileSync(
        this.options.junitFile,
        `<testsuites tests="${specs.length}" failures="${failures}" skipped="${skipped}" errors="${errors}"><testsuite name="sensitive-smoke">${rows.join("")}</testsuite></testsuites>\n`,
        { mode: 0o600 },
      );
    }
  }
}
