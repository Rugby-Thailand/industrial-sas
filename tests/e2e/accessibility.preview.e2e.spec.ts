import { test } from "@playwright/test";

import {
  expectNoAccessibilityViolations,
  seedPreviewWarehouse,
} from "./support/accessibility";

const ROUTES = [
  "/th/dashboard",
  "/th/inventory/balances",
  "/th/master-data/items",
  "/th/receiving",
  "/th/reports",
  "/th/sales/orders",
  "/th/engineering/designs",
  "/th/production/packets",
  "/en/sales/orders",
  "/en/engineering/designs",
  "/en/production/packets",
  "/en/production/orders",
  "/th/handheld/production",
  "/th/devices",
  "/en/devices",
] as const;

const COLOR_SCHEMES = ["light", "dark"] as const;

test.describe("desktop preview accessibility", () => {
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
