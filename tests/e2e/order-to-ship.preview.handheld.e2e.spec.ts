import { expect, test } from "@playwright/test";

import { seedPreviewWarehouse } from "./support/accessibility";

test("order-to-ship remains operable at handheld width", async ({ page }) => {
  await seedPreviewWarehouse(page);
  await page.goto("/th/production/packets");
  await expect(page.getByText("SO-26018-1")).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await page.getByText("ดำเนินการใบงานโรงงานนี้").click();
  await expect(page.getByText("รับทราบใบงานโรงงาน")).toBeVisible();
});
