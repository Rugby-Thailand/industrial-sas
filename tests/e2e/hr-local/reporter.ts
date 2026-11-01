import type {
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";

/** SDK diagnostics can contain one-time token URLs. Keep them off stdout. */
export default class HrLocalReporter implements Reporter {
  private passed = 0;
  private failed = 0;
  private skipped = 0;

  printsToStdio() {
    return true;
  }
  onStdOut() {}
  onStdErr() {}
  onError() {
    process.stderr.write(
      "[hr-e2e] Runner error; inspect the private report.\n",
    );
  }
  onTestBegin(test: TestCase) {
    process.stdout.write(
      `[hr-e2e] ${test.parent.project()?.name}: ${test.title}: started\n`,
    );
  }
  onTestEnd(test: TestCase, result: TestResult) {
    if (result.status === "passed") this.passed += 1;
    else if (result.status === "skipped") this.skipped += 1;
    else this.failed += 1;
    // Titles are static source literals; never echo errors, steps or URLs.
    process.stdout.write(
      `[hr-e2e] ${test.parent.project()?.name}: ${test.title}: ${result.status}\n`,
    );
  }
  onEnd(result: FullResult) {
    process.stdout.write(
      `[hr-e2e] ${result.status}: ${this.passed} passed, ${this.failed} failed, ${this.skipped} skipped\n`,
    );
  }
}
