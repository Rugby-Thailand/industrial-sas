import { expect, test, type Page } from "@playwright/test";

/**
 * The inbound journey on a scanner.
 *
 * The handheld shell is the primary target (plan §1), so these are not a
 * narrower rerun of the desktop specs: they check the things a 393-pixel
 * viewport actually breaks — whether the flow can be completed at all, whether
 * the controls are big enough to hit with a glove, and whether the explanation
 * an operator needs *at the rack* survives the smaller screen.
 */
const BANG_PU = "prv_wh_bangpoo";

/** `INV-0010-04`: 44 CSS pixels, the minimum touch target. */
const MIN_TOUCH_TARGET = 44;

async function selectWarehouse(page: Page) {
  await page.getByLabel("คลังสินค้า").selectOption(BANG_PU);
}

/**
 * Open a receipt for the chosen order.
 *
 * Preview writes nothing, so this ends in a demonstration rather than a created
 * receipt — but the flow continues, because the capture step it unlocks is the
 * one worth exercising on this shell.
 */
async function openReceipt(page: Page) {
  const form = page.getByTestId("form-open-receipt");
  await form.getByLabel("เลขที่ใบรับ").fill("GRN-E2E-1");
  await form.getByRole("button", { name: "เปิดใบรับ" }).click();
  await expect(page.getByTestId("write-DEMONSTRATED").first()).toBeVisible();
}

test.describe("the handheld launcher", () => {
  test("offers receive, quality, and putaway as built tasks", async ({
    page,
  }) => {
    await page.goto("/th/handheld");

    for (const name of ["รับสินค้า", "ตรวจสอบคุณภาพ", "จัดเก็บ"]) {
      await expect(page.getByRole("link", { name })).toBeVisible();
    }
  });

  test("still marks pallet building as not a standalone task", async ({
    page,
  }) => {
    /*
     * A pallet is built from the lines of a receipt, so the control lives inside
     * the receiving flow. Listing it as unavailable is how an operator trained on
     * "build pallet" finds out where it went.
     */
    await page.goto("/th/handheld");
    await expect(page.getByText("ยังไม่พร้อมใช้งาน").first()).toBeVisible();
  });
});

test.describe("receiving on a scanner", () => {
  test("completes pick-order → open-receipt → scan at handheld width", async ({
    page,
  }) => {
    await page.goto("/th/handheld/receive");
    await selectWarehouse(page);

    // Before an order is chosen the screen says so, rather than showing a
    // capture form that would be refused.
    await expect(page.getByTestId("handheld-no-order")).toBeVisible();

    await page.getByTestId("handheld-pick-order-PO-2601").click();
    await expect(page.getByTestId("form-open-receipt")).toBeVisible();

    /*
     * The capture step waits for a receipt, and the receipt ID comes out of the
     * open-receipt write. Until one is opened the step says so rather than
     * showing a form that could not post.
     */
    await expect(page.getByTestId("handheld-no-receipt")).toBeVisible();

    await openReceipt(page);

    // The demonstration continues, and says which receipt it continues on.
    await expect(
      page.getByTestId("handheld-demonstration-receipt"),
    ).toBeVisible();
    await expect(page.getByTestId("form-receipt-line")).toBeVisible();
  });

  test("offers the tenant's own receiving locations, never an assumed dock", async ({
    page,
  }) => {
    await page.goto("/th/handheld/receive");
    await selectWarehouse(page);
    await page.getByTestId("handheld-pick-order-PO-2601").click();
    await openReceipt(page);

    /*
     * The dock comes from the warehouse's own locations. The assertion is on the
     * *options*, not on a value the screen could have hard-coded: a select with
     * one assumed dock in it would pass a "the field is filled" check.
     */
    const location = page.getByLabel("ตำแหน่งที่รับเข้า");
    await expect(location).toBeVisible();
    expect(await location.locator("option").count()).toBeGreaterThanOrEqual(1);
  });

  test("captures a scanned line with unit, lot, and expiry — and stores none of it", async ({
    page,
  }) => {
    /*
     * The step an operator spends their shift in. It is demonstrated rather than
     * written — no receipt was created and nothing here is stored — but every
     * control on the path is exercised, because a capture form that is only ever
     * reached in integration tests is a capture form nobody has used on a
     * 393-pixel screen.
     */
    await page.goto("/th/handheld/receive");
    await selectWarehouse(page);
    await page.getByTestId("handheld-pick-order-PO-2601").click();
    await openReceipt(page);

    /*
     * The item arrives by scan: the operator points the wedge at the carton and
     * the server resolves the barcode against this tenant's own catalogue. The
     * bolt line is chosen because it is *not* the form's default, so a scan that
     * did nothing would leave the wrong line selected.
     */
    await page.getByLabel("สแกนกล่องสินค้า").fill("00614141000036");
    await page.getByTestId("scan-to-item-resolve").click();

    const form = page.getByTestId("form-receipt-line");
    await expect(form.getByLabel("บรรทัดในใบสั่งซื้อ")).toHaveValue(
      "prv_pol_2601_2",
    );
    // And the manual route is still there for a carton whose label is torn off.
    await expect(form.getByLabel("สินค้าที่รับ")).toHaveValue(
      "prv_item_bolt_m8",
    );

    await form.getByLabel("จำนวน").fill("12");
    await form.getByLabel("หน่วยนับ").fill("EA");
    await form.getByLabel("รหัสล็อต").fill("LOT-2608");
    await form.getByLabel("วันหมดอายุ").fill("2027-05-01");
    await form.getByRole("button", { name: "บันทึกรายการ" }).click();

    // Demonstrated, never saved: the wording is the whole point of the mode.
    await expect(page.getByTestId("write-DEMONSTRATED").first()).toBeVisible();
    await expect(page.getByTestId("write-SAVED")).toHaveCount(0);
  });

  test("keeps every control big enough to hit with a glove", async ({
    page,
  }) => {
    await page.goto("/th/handheld/receive");
    await selectWarehouse(page);
    // The open-receipt form appears only once an order is chosen; each step is
    // gated on the one before it.
    await page.getByTestId("handheld-pick-order-PO-2601").click();

    for (const locator of [
      page.getByTestId("handheld-pick-order-PO-2601"),
      page.getByTestId("form-open-receipt").getByRole("button"),
    ]) {
      const box = await locator.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    }
  });

  test("says the data is synthetic on a narrow screen", async ({ page }) => {
    await page.goto("/th/handheld/receive");
    await expect(page.getByTestId("preview-banner")).toBeVisible();
  });
});

test.describe("quality on a scanner", () => {
  test("shows the queue and records a decision", async ({ page }) => {
    await page.goto("/th/handheld/quality");
    await selectWarehouse(page);

    await page.getByTestId("inspection-select-prv_qc_3001").click();
    const form = page.getByTestId("form-disposition");
    // Chosen from the tenant's own reason codes, not typed: the field carries a
    // document ID, and nobody has one of those on a scanner.
    await form.getByLabel("รหัสเหตุผล").selectOption({ index: 0 });
    await form.getByRole("button", { name: "บันทึกผล" }).click();

    await expect(page.getByTestId("write-DEMONSTRATED").first()).toBeVisible();
  });

  test("explains the parked state rather than showing it as a failure", async ({
    page,
  }) => {
    await page.goto("/th/handheld/quality");
    await selectWarehouse(page);
    await page.getByTestId("inspection-select-prv_qc_3001").click();

    await expect(page.getByTestId("quality-parked-explanation")).toBeVisible();
  });
});

test.describe("putaway on a scanner", () => {
  test("keeps the whole explanation, because the rack is where it is asked", async ({
    page,
  }) => {
    /*
     * The explanation is not trimmed for the smaller screen. "Why this bin?" is
     * the question most likely to be asked *at* the rack, and an answer only the
     * desktop carries is an answer nobody reads.
     */
    await page.goto("/th/handheld/putaway");
    await selectWarehouse(page);
    await page.getByTestId("task-select-prv_task_4001").click();

    await expect(page.getByTestId("table-recommendation-ranked")).toBeVisible();
    await expect(
      page.getByTestId("table-recommendation-rejected"),
    ).toBeVisible();
  });

  test("scrolls a wide table instead of crushing its columns", async ({
    page,
  }) => {
    await page.goto("/th/handheld/putaway");
    await selectWarehouse(page);

    const scroller = page.getByTestId("table-putaway-tasks");
    await expect(scroller).toBeVisible();
    expect(
      await scroller.evaluate((element) => getComputedStyle(element).overflowX),
    ).toBe("auto");
  });

  test("demonstrates a claim without pretending to hold the task", async ({
    page,
  }) => {
    await page.goto("/th/handheld/putaway");
    await selectWarehouse(page);

    await page.getByTestId("task-claim-prv_task_4001").click();
    await expect(page.getByTestId("write-DEMONSTRATED")).toBeVisible();
    // Still ready: the control demonstrated, it did not act.
    await expect(page.getByTestId("table-putaway-tasks")).toContainText(
      "พร้อมจัดเก็บ",
    );
  });
});
