import { expect, test } from "@playwright/test";
import { chooseOption } from "./support/select";

/**
 * The Phase 2 master-data screens, against local preview data.
 *
 * The point of these tests is not that a table renders. It is that the write
 * controls behave the way the design claims they do *before* anyone has a
 * deployment: the form validates, the button submits, and the outcome says in
 * so many words that nothing was stored. A preview that quietly appended a row
 * to a local array would demonstrate a system this repository does not have.
 *
 * Every assertion that matters therefore checks two things at once — that the
 * flow completed, and that the screen still says the data is synthetic.
 */
const SCREENS = [
  ["/th/master-data/suppliers", "ผู้จัดจำหน่าย"],
  ["/th/master-data/storage-classes", "ชั้นการจัดเก็บ"],
  ["/th/master-data/label-templates", "แม่แบบป้าย"],
] as const;

test.describe("the new master-data screens", () => {
  for (const [path, heading] of SCREENS) {
    test(`${path} renders its register and says the data is synthetic`, async ({
      page,
    }) => {
      await page.goto(path);

      await expect(
        page.getByRole("heading", { level: 1, name: heading }),
      ).toBeVisible();
      await expect(page.getByRole("table")).toBeVisible();
      await expect(page.getByTestId("preview-banner")).toBeVisible();
    });
  }

  test("reaches each one from the navigation", async ({ page }) => {
    await page.goto("/th/dashboard");

    const menu = page.getByRole("button", { name: "เปิดเมนู" });
    if (await menu.isVisible()) await menu.click();

    await page
      .getByRole("navigation")
      .getByRole("link", { name: "ผู้จัดจำหน่าย" })
      .click();

    await expect(page).toHaveURL(/\/th\/master-data\/suppliers$/);
  });
});

test.describe("suppliers", () => {
  test("lists an inactive supplier rather than hiding it", async ({ page }) => {
    // "No longer bought from" and "never existed" are different facts.
    await page.goto("/th/master-data/suppliers");

    await expect(page.getByText("OLD-FASTENER")).toBeVisible();
    // Exact, because the fixture's inactive supplier is also *named*
    // "…(เลิกใช้)" — matching loosely would pass on the name and prove nothing
    // about the status badge.
    await expect(page.getByText("เลิกใช้", { exact: true })).toBeVisible();
  });

  test("demonstrates a create without pretending to persist it", async ({
    page,
  }) => {
    await page.goto("/th/master-data/suppliers");

    const before = await page
      .getByTestId("table-suppliers")
      .getByRole("row")
      .count();

    const form = page.getByTestId("form-supplier");
    await form.getByLabel("รหัส").fill("NEW-MILL");
    await form.getByLabel("ชื่อ").fill("โรงงานใหม่");
    await form.getByRole("button").click();

    await expect(page.getByTestId("write-DEMONSTRATED")).toBeVisible();
    await expect(page.getByTestId("write-DEMONSTRATED")).toContainText(
      "ไม่ได้บันทึกข้อมูล",
    );
    // The register is unchanged, because nothing was written anywhere.
    await expect(
      page.getByTestId("table-suppliers").getByRole("row"),
    ).toHaveCount(before);
  });

  test("names a blank required field instead of submitting", async ({
    page,
  }) => {
    await page.goto("/th/master-data/suppliers");

    await page.getByTestId("form-supplier").getByRole("button").click();

    await expect(page.getByTestId("write-DEMONSTRATED")).toHaveCount(0);
    await expect(
      page.getByTestId("form-supplier").getByText("ต้องกรอกช่องนี้").first(),
    ).toBeVisible();
  });

  test("demonstrates a row control", async ({ page }) => {
    await page.goto("/th/master-data/suppliers");

    await page.getByTestId("supplier-toggle-SIAM-STEEL").click();

    await expect(page.getByTestId("write-DEMONSTRATED")).toBeVisible();
    // Still active: the control demonstrated, it did not act.
    await expect(page.getByTestId("supplier-toggle-SIAM-STEEL")).toHaveText(
      "ปิดใช้งาน",
    );
  });
});

test.describe("label templates", () => {
  test("offers publishing on a draft and nowhere else", async ({ page }) => {
    /*
     * Publishing requires a second person (`INV-0006-05`), and the button is
     * still shown to the drafter: the denial explains the rule, while a hidden
     * control would read as a missing feature.
     */
    await page.goto("/th/master-data/label-templates");

    await expect(page.getByTestId("template-publish-LOT-2X1-1")).toBeVisible();
    await expect(page.getByTestId("template-publish-LPN-4X6-2")).toHaveCount(0);
  });

  test("says on the page that nothing is printed", async ({ page }) => {
    // There is no printer transport (`INT-04`) and no print verification
    // (`RG-004`). The screen must not imply either.
    await page.goto("/th/master-data/label-templates");

    await expect(page.getByText("ไม่ได้เชื่อมต่อเครื่องพิมพ์")).toBeVisible();
    await expect(
      page
        .getByTestId("form-label-template")
        .getByText(/ไม่ส่งไปยังเครื่องพิมพ์/),
    ).toBeVisible();
  });

  test("shows all three lifecycle states in words", async ({ page }) => {
    await page.goto("/th/master-data/label-templates");

    const table = page.getByTestId("table-label-templates");
    await expect(table.getByText("ฉบับร่าง")).toBeVisible();
    await expect(table.getByText("ใช้งานอยู่")).toBeVisible();
    await expect(table.getByText("เลิกใช้แล้ว")).toBeVisible();
  });
});

test.describe("item detail", () => {
  test("opens from the item register", async ({ page }) => {
    await page.goto("/th/master-data/items");

    await page.getByTestId("item-open-BOLT-M8-30").click();

    await expect(page).toHaveURL(/\/master-data\/items\/prv_item_bolt_m8$/);
    await expect(page.getByTestId("item-detail")).toBeVisible();
  });

  test("shows the barcodes, units, and lots that hang off the item", async ({
    page,
  }) => {
    await page.goto("/th/master-data/items/prv_item_bolt_m8");

    // The padded GTIN, exactly as a scan normalizes to.
    await expect(
      page.getByTestId("table-barcodes").getByText("00614141000036"),
    ).toBeVisible();
    await expect(
      page.getByTestId("table-item-uoms").getByText("CASE"),
    ).toBeVisible();
    await expect(
      page.getByTestId("table-lots").getByText("L2601-A"),
    ).toBeVisible();
  });

  test("renders an exact fraction rather than a rounded decimal", async ({
    page,
  }) => {
    // `200/3` litres per third-drum has no decimal expansion. Rounding it for
    // display would show a number the ledger will never agree with.
    await page.goto("/th/master-data/items/prv_item_resin_hd");

    await expect(
      page.getByTestId("table-item-uoms").getByText("200/3"),
    ).toBeVisible();
  });

  test("answers an unknown identifier the same way it answers a foreign one", async ({
    page,
  }) => {
    /*
     * The server cannot distinguish them either: `tenantDb.get` refuses another
     * tenant's document exactly as it refuses a nonexistent one
     * (`INV-0002-03`). The screen says one thing for both.
     */
    await page.goto("/th/master-data/items/prv_item_does_not_exist");

    await expect(page.getByTestId("item-not-found")).toBeVisible();
    await expect(page.getByTestId("item-detail")).toHaveCount(0);
  });

  test("demonstrates adding a barcode without storing it", async ({ page }) => {
    await page.goto("/th/master-data/items/prv_item_bolt_m8");

    const form = page.getByTestId("form-barcode");
    // Exact: the kind selector is labelled "ชนิดบาร์โค้ด", which contains this.
    await form.getByLabel("บาร์โค้ด", { exact: true }).fill("NEW-ALIAS-1");
    await form.getByRole("button").click();

    await expect(page.getByTestId("write-DEMONSTRATED").first()).toBeVisible();
    await expect(
      page.getByTestId("table-barcodes").getByText("NEW-ALIAS-1"),
    ).toHaveCount(0);
  });
});

test.describe("items and locations gained their write controls", () => {
  test("the item register offers a create form", async ({ page }) => {
    await page.goto("/th/master-data/items");

    const form = page.getByTestId("form-item");
    await form.getByLabel("รหัสสินค้า").fill("NEW-SKU-1");
    await form.getByLabel("ชื่อ", { exact: true }).fill("สินค้าใหม่");
    await form.getByLabel("หน่วยนับหลัก").fill("EA");
    await form.getByRole("button").click();

    await expect(page.getByTestId("write-DEMONSTRATED")).toBeVisible();
  });

  test("the location form waits for a warehouse before offering itself", async ({
    page,
  }) => {
    // A location belongs to a site. Defaulting to the first warehouse is how a
    // bin gets created at the wrong plant.
    await page.goto("/th/master-data/locations");

    await expect(
      page.getByTestId("panel-WAREHOUSE_MISSING").first(),
    ).toBeVisible();
    await expect(page.getByTestId("form-location")).toHaveCount(0);

    await chooseOption(page, "คลังสินค้า", { value: "prv_wh_bangpoo" });
    await expect(page.getByTestId("form-location")).toBeVisible();
  });
});
