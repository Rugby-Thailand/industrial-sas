import { expect, test } from "@playwright/test";

/**
 * The master-data maintenance screens on a handheld viewport.
 *
 * These are supervisor screens and they live in the desktop shell, which is a
 * decision about *routes*, not about screen size (UX plan §7). A supervisor
 * standing on a dock holding a scanner still has to be able to correct a
 * barcode, so the same journey has to complete at 393 CSS pixels.
 *
 * What is checked here is what a narrow viewport actually breaks: whether the
 * controls are still reachable and large enough to hit, and whether a table
 * that does not fit scrolls instead of crushing its columns.
 */

/** `INV-0010-04`: 44 CSS pixels, the minimum touch target. */
const MIN_TOUCH_TARGET = 44;

test.describe("master data on a handheld", () => {
  test("completes the supplier journey at handheld width", async ({ page }) => {
    await page.goto("/th/master-data/suppliers");

    await expect(
      page.getByRole("heading", { level: 1, name: "ผู้จัดจำหน่าย" }),
    ).toBeVisible();

    const form = page.getByTestId("form-supplier");
    await form.getByLabel("รหัส").fill("HANDHELD-1");
    await form.getByLabel("ชื่อ").fill("ผู้ขายจากหน้างาน");
    await form.getByRole("button").click();

    await expect(page.getByTestId("write-DEMONSTRATED")).toBeVisible();
  });

  test("keeps every control big enough to hit", async ({ page }) => {
    await page.goto("/th/master-data/suppliers");

    const submit = page.getByTestId("form-supplier").getByRole("button");
    const submitBox = await submit.boundingBox();
    expect(submitBox?.height ?? 0).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);

    const rowControl = page.getByTestId("supplier-toggle-SIAM-STEEL");
    const rowBox = await rowControl.boundingBox();
    expect(rowBox?.height ?? 0).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);

    // The text input too: a 30px field is a field a gloved hand misses.
    const input = page.getByTestId("form-supplier").getByLabel("รหัส");
    const inputBox = await input.boundingBox();
    expect(inputBox?.height ?? 0).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
  });

  test("scrolls a wide table instead of crushing its columns", async ({
    page,
  }) => {
    /*
     * A code squeezed to two characters is worse than one an operator has to
     * scroll to (`UX §3`). The item-detail tables are the widest in the
     * application, so they are the ones that would collapse first.
     */
    await page.goto("/th/master-data/items/prv_item_bolt_m8");

    const table = page.getByTestId("table-barcodes");
    await expect(table).toBeVisible();

    // The scroller is the named region inside the frame; the frame itself clips
    // so the rounded border survives (`TableScroller`).
    const scroller = table.getByRole("region");
    const overflows = await scroller.evaluate(
      (element) => getComputedStyle(element).overflowX,
    );
    expect(overflows).toBe("auto");
    await expect(scroller).toHaveAttribute("tabindex", "0");

    // And the value itself is still intact rather than truncated away.
    await expect(scroller.getByText("00614141000036")).toBeVisible();
  });

  test("still says the data is synthetic on a narrow screen", async ({
    page,
  }) => {
    // The banner is the one thing that must survive every layout change: it is
    // what stops a stakeholder mistaking preview data for a working deployment.
    await page.goto("/th/master-data/label-templates");
    await expect(page.getByTestId("preview-banner")).toBeVisible();
  });
});
