import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

const WAREHOUSE_STORAGE_KEY = "industrial-sas.warehouse";
const BANG_PU = "prv_wh_bangpoo";

/** Select a populated warehouse before React reads the external store. */
export async function seedPreviewWarehouse(page: Page) {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key ?? "", value ?? ""),
    [WAREHOUSE_STORAGE_KEY, BANG_PU],
  );
}

/**
 * Run the standards the component tier claims, this time in a layout engine
 * that can compute color, geometry, focusability, and accessible names.
 */
export async function expectNoAccessibilityViolations(page: Page) {
  await expect(page.locator("body")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();

  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
    .analyze();

  expect(result.violations).toEqual([]);
}
