import AxeBuilder from "@axe-core/playwright";
import { expect, test as base, type Page } from "@playwright/test";

/**
 * Every page in a browser suite fails on an uncaught page error or a console
 * error, so a hydration crash cannot pass behind a correct heading.
 */
export const test = base.extend<{
  /** Console errors a test deliberately provokes, e.g. a 404 document. */
  expectedConsoleErrors: RegExp[];
  pageErrors: string[];
}>({
  expectedConsoleErrors: [[], { option: true }],
  pageErrors: [
    async ({ page, expectedConsoleErrors }, use) => {
      const errors: string[] = [];
      page.on("pageerror", (error) =>
        errors.push(`pageerror: ${error.message}`),
      );
      page.on("console", (message) => {
        if (message.type() !== "error") return;
        const text = message.text();
        if (expectedConsoleErrors.some((pattern) => pattern.test(text))) return;
        errors.push(`console: ${text}`);
      });
      await use(errors);
      expect(errors, "page errors").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export async function expectNoAxeViolations(page: Page, include = "body") {
  const results = await new AxeBuilder({ page })
    .include(include)
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    results.violations.map(
      (violation) => `${violation.id}: ${violation.nodes.length}`,
    ),
  ).toEqual([]);
}
