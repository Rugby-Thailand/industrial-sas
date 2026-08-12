import { expect, test, type Page } from "@playwright/test";
import { chooseOption } from "./support/select";

/**
 * Reporting on a scanner.
 *
 * The dashboard is a desktop screen by route, but a supervisor carries the
 * handheld onto the floor and the map is exactly what they want there — so it
 * has to survive 393 pixels rather than merely exist at that width.
 */
const BANG_PU = "prv_wh_bangpoo";

/** `INV-0010-04`: the minimum touch target. */
const MIN_TOUCH_TARGET = 44;

async function selectWarehouse(page: Page) {
  await chooseOption(page, "คลังสินค้า", { value: BANG_PU });
}

test.describe("reporting at handheld width", () => {
  test("keeps the occupancy map legible instead of crushing it", async ({
    page,
  }) => {
    await page.goto("/th/dashboard");
    await selectWarehouse(page);

    const dock = page.getByTestId("occupancy-DOCK-IN-1");
    await expect(dock).toBeVisible();
    // The code, the band, and the count all survive the narrow viewport.
    await expect(dock).toContainText("DOCK-IN-1");
    await expect(dock).toContainText("ใช้พื้นที่มาก");
  });

  test("scrolls the map rather than shrinking a cell out of readability", async ({
    page,
  }) => {
    await page.goto("/th/dashboard");
    await selectWarehouse(page);

    const scroller = page
      .getByTestId("occupancy-map")
      .locator("div")
      .filter({ has: page.getByRole("table") })
      .first();

    expect(
      await scroller.evaluate((element) => getComputedStyle(element).overflowX),
    ).toBe("auto");
  });

  test("keeps the export controls big enough to hit with a glove", async ({
    page,
  }) => {
    await page.goto("/th/reports");
    await selectWarehouse(page);

    const box = await page
      .getByTestId("report-advance-prv_rpt_7002")
      .boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
  });

  test("still says the data is synthetic", async ({ page }) => {
    await page.goto("/th/reports");
    await expect(page.getByTestId("preview-banner")).toBeVisible();
  });
});
