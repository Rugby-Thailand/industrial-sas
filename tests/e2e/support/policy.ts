import type {
  PlaywrightTestConfig,
  ReporterDescription,
} from "@playwright/test";

/**
 * Shared Playwright policy (T4/T10/T13).
 *
 * - Required runs start with zero retries. `PLAYWRIGHT_DIAGNOSTIC_RETRIES`
 *   enables retries for diagnosis only, and `failOnFlakyTests` then turns a
 *   pass-on-retry into a failure so a flake can never read as green.
 * - Credential-free suites may keep failure-only traces/screenshots of
 *   synthetic fixtures. Credentialed suites (`sensitive`) record nothing that
 *   could contain a session, cookie, token or business data.
 */
export function runPolicy(options: {
  readonly sensitive: boolean;
  readonly outputName: string;
}): Pick<
  PlaywrightTestConfig,
  | "retries"
  | "failOnFlakyTests"
  | "forbidOnly"
  | "reporter"
  | "outputDir"
  | "preserveOutput"
> & { readonly use: NonNullable<PlaywrightTestConfig["use"]> } {
  if (options.sensitive) {
    if (process.env.PW_TEST_REPORTER)
      throw new Error("SENSITIVE_SMOKE_REPORTER_OVERRIDE_REFUSED");
    // Pinned Playwright 1.62 consults this before automatic DOM snapshots.
    // preserveOutput also deletes failure context/attachments after the test;
    // only our sanitized reports outside the per-test output survive.
    process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";
  }
  const ci = Boolean(process.env.CI);
  const diagnosticRetries = Number(
    process.env.PLAYWRIGHT_DIAGNOSTIC_RETRIES ?? 0,
  );
  const retries =
    Number.isSafeInteger(diagnosticRetries) && diagnosticRetries > 0
      ? Math.min(diagnosticRetries, 2)
      : 0;

  const reporter: ReporterDescription[] = options.sensitive
    ? [
        [
          "./tests/e2e/support/sensitive-reporter.ts",
          {
            outputFile:
              process.env.PLAYWRIGHT_JSON_OUTPUT_FILE ??
              `test-results/${options.outputName}-safe.json`,
            junitFile: `test-results/${options.outputName}-junit.xml`,
          },
        ],
      ]
    : [
        [ci ? "github" : "list"],
        [
          "junit",
          { outputFile: `test-results/${options.outputName}-junit.xml` },
        ],
      ];
  if (!options.sensitive && process.env.PLAYWRIGHT_JSON_OUTPUT_FILE) {
    reporter.push([
      "json",
      { outputFile: process.env.PLAYWRIGHT_JSON_OUTPUT_FILE },
    ]);
  }
  if (!options.sensitive) {
    reporter.push([
      "html",
      {
        open: "never",
        outputFolder: `playwright-report/${options.outputName}`,
      },
    ]);
  }

  return {
    forbidOnly: ci,
    retries,
    failOnFlakyTests: retries > 0,
    reporter,
    outputDir: `test-results/${options.outputName}`,
    preserveOutput: options.sensitive ? "never" : "failures-only",
    use: options.sensitive
      ? {
          trace: "off",
          screenshot: "off",
          video: "off",
          serviceWorkers: "block",
        }
      : {
          trace: "retain-on-failure",
          screenshot: "only-on-failure",
          video: "off",
        },
  };
}
