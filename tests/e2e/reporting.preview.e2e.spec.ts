import { expect, test, type Page } from "@playwright/test";

/**
 * The Phase 4 reporting surfaces, against synthetic data.
 *
 * Three claims worth exercising in a browser rather than in a component test:
 * the dashboard renders both new sections without a warehouse being chosen
 * twice, the occupancy map stays readable at handheld width, and the export
 * register never lets a stopped job look like a finished one.
 */
const BANG_PU = "prv_wh_bangpoo";

async function selectWarehouse(page: Page) {
  await page.getByLabel("คลังสินค้า").selectOption(BANG_PU);
}

test.describe("the dashboard", () => {
  test("shows the waiting-work counters with a label a person reads", async ({
    page,
  }) => {
    await page.goto("/th/dashboard");
    await selectWarehouse(page);

    await expect(page.getByTestId("dashboard-tiles")).toBeVisible();
    await expect(page.getByTestId("tile-QC_PENDING")).toContainText(
      "รายการรอตรวจสอบคุณภาพ",
    );
    // A code identifier never reaches the screen.
    await expect(page.getByTestId("tile-QC_PENDING")).not.toContainText(
      "QC_PENDING",
    );
  });

  test("marks a counter that a correction made suspect", async ({ page }) => {
    /*
     * The state a real deployment reaches after a miscounted transition. It has
     * to be visible and understandable *before* anybody meets it on a live site,
     * which is why the fixture carries one.
     */
    await page.goto("/th/dashboard");
    await selectWarehouse(page);

    await expect(page.getByTestId("tile-suspect-QC_PARKED")).toBeVisible();
  });

  test("says when each counter was last true", async ({ page }) => {
    await page.goto("/th/dashboard");
    await selectWarehouse(page);

    await expect(
      page.getByTestId("tile-RECEIPTS_OPENED").getByText(/ข้อมูล ณ/),
    ).toBeVisible();
  });
});

test.describe("the occupancy map", () => {
  test("draws every location with its band written out", async ({ page }) => {
    await page.goto("/th/dashboard");
    await selectWarehouse(page);

    const dock = page.getByTestId("occupancy-DOCK-IN-1");
    await expect(dock).toContainText("DOCK-IN-1");
    // Colour is never the only channel (`WCAG 2.2` 1.4.1).
    await expect(dock).toContainText("ใช้พื้นที่มาก");
  });

  test("is a table, so it can be walked rather than looked at", async ({
    page,
  }) => {
    await page.goto("/th/dashboard");
    await selectWarehouse(page);

    await expect(
      page.getByTestId("occupancy-map").getByRole("table"),
    ).toBeVisible();
  });

  test("does not claim to be partial when it is whole", async ({ page }) => {
    await page.goto("/th/dashboard");
    await selectWarehouse(page);

    await expect(page.getByTestId("occupancy-partial")).toHaveCount(0);
  });
});

test.describe("exports", () => {
  test("states where download delivery actually stops", async ({ page }) => {
    /*
     * "Downloaded from this session" and "delivered through a signed URL" are
     * different security claims, and the screen makes the one that is true.
     */
    await page.goto("/th/reports");
    await selectWarehouse(page);

    await expect(page.getByTestId("reports-delivery-boundary")).toBeVisible();
  });

  test("demonstrates a request without pretending to store one", async ({
    page,
  }) => {
    await page.goto("/th/reports");
    await selectWarehouse(page);

    const form = page.getByTestId("form-request-export");
    await form.getByLabel("ข้อมูลที่ต้องการส่งออก").selectOption({ index: 0 });
    await form.getByRole("button", { name: "ขอส่งออก" }).click();

    await expect(page.getByTestId("write-DEMONSTRATED").first()).toBeVisible();
  });

  test("shows a stopped export as stopped, with its reason", async ({
    page,
  }) => {
    await page.goto("/th/reports");
    await selectWarehouse(page);

    const failure = page.getByTestId("report-job-failure-prv_rpt_7003");
    await expect(failure).toContainText("ARTIFACT_LIMIT_REACHED");
    // And offers no download, because the file would have been incomplete.
    await expect(page.getByTestId("report-download-prv_rpt_7003")).toHaveCount(
      0,
    );
  });

  test("offers the file only for a job that finished", async ({ page }) => {
    await page.goto("/th/reports");
    await selectWarehouse(page);

    await expect(
      page.getByTestId("report-download-prv_rpt_7001"),
    ).toBeVisible();
  });
});
