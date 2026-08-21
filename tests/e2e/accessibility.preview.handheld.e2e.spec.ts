import { test } from "@playwright/test";

import {
  expectNoAccessibilityViolations,
  seedPreviewWarehouse,
} from "./support/accessibility";

const ROUTES = [
  "/th/handheld",
  "/th/handheld/inventory",
  "/th/handheld/receive",
  "/th/handheld/quality",
  "/th/handheld/putaway",
  "/th/handheld/work",
  "/en/handheld/work",
] as const;

const COLOR_SCHEMES = ["light", "dark"] as const;

test.describe("handheld preview accessibility", () => {
  test.beforeEach(async ({ page }) => {
    await seedPreviewWarehouse(page);
  });

  for (const route of ROUTES) {
    for (const colorScheme of COLOR_SCHEMES) {
      test(`${route} has no automated ${colorScheme} WCAG A/AA violations`, async ({
        page,
      }) => {
        await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
        await page.goto(route);
        await expectNoAccessibilityViolations(page);
      });
    }
  }
});
