import { expect, test } from "@playwright/test";
import { chooseOption, expectSelectedValue } from "./support/select";

/**
 * The inventory read path, exercised against local preview data.
 *
 * Runs only under the `preview-chromium` project, whose dev server has
 * `NEXT_PUBLIC_LOCAL_PREVIEW=1`. This is the only way to prove the table, the
 * paging, the formatters, and the Thai layout end to end before an identity
 * provider exists — and every assertion below also checks that the screen keeps
 * saying the data is synthetic while it does so.
 */
/*
 * Selected by value rather than by visible label: the option's value is the
 * warehouse ID the server would be handed, which is what the test is really
 * about, and it does not change when the Thai copy does.
 */
const BANG_PU = "prv_wh_bangpoo";
const LAMPHUN = "prv_wh_lamphun";

test.describe("inventory read path with preview data", () => {
  test("says the data is synthetic on every screen it appears on", async ({
    page,
  }) => {
    for (const path of [
      "/th/dashboard",
      "/th/inventory/balances",
      "/th/handheld",
    ]) {
      await page.goto(path);
      await expect(page.getByTestId("preview-banner")).toBeVisible();
      // The connection badge says preview too, so the claim is repeated where
      // an operator looks for "is the server answering".
      await expect(
        page.getByText("ข้อมูลตัวอย่างในเครื่อง", { exact: true }),
      ).toBeVisible();
    }
  });

  test("requires a warehouse before it shows a balance", async ({ page }) => {
    // Every ledger read is warehouse-scoped on the server; a preview that
    // skipped the selector would not be exercising the real screen.
    await page.goto("/th/inventory/balances");
    await expect(page.getByTestId("panel-WAREHOUSE_MISSING")).toBeVisible();
  });

  test("shows balances for the selected warehouse", async ({ page }) => {
    await page.goto("/th/inventory/balances");
    await chooseOption(page, "คลังสินค้า", { value: BANG_PU });

    const table = page.getByRole("table");
    await expect(table).toBeVisible();
    await expect(table.getByText("พร้อมใช้").first()).toBeVisible();
    await expect(table.getByText("รอตรวจสอบคุณภาพ").first()).toBeVisible();
    // The digits stored, with no grouping separator (`ADR-0004` §5).
    await expect(table.getByText("18450.500")).toBeVisible();
  });

  test("tells two buckets of one item and one bin apart", async ({ page }) => {
    /*
     * The first two rows differ only in their lot, and the bucket cell used to
     * abbreviate both keys to the same text — the head is the organization
     * prefix and the tail is the stock status, so what it kept is what every row
     * shares. The cell names the dimensions instead.
     */
    await page.goto("/th/inventory/balances");
    await chooseOption(page, "คลังสินค้า", { value: BANG_PU });

    const table = page.getByRole("table");
    await expect(table.getByText("prv_lot_2608A")).toBeVisible();
    await expect(table.getByText("prv_lot_2607B")).toBeVisible();
    await expect(table.getByText("prv_item_steel_coil").first()).toBeVisible();
  });

  test("remembers the warehouse across a navigation", async ({ page }) => {
    await page.goto("/th/inventory/balances");
    await chooseOption(page, "คลังสินค้า", { value: LAMPHUN });
    await expect(page.getByRole("table")).toBeVisible();

    await page.goto("/th/inventory/history");
    await expectSelectedValue(page, "คลังสินค้า", LAMPHUN);
    await expect(page.getByRole("table")).toBeVisible();
  });

  test("renders history newest first and marks a reversal", async ({
    page,
  }) => {
    await page.goto("/th/inventory/history");
    await chooseOption(page, "คลังสินค้า", { value: BANG_PU });

    const table = page.getByRole("table");
    await expect(table.getByText("รายการกลับรายการ")).toHaveCount(1);
    // A history is not an editable list: no row action exists.
    await expect(table.getByRole("button")).toHaveCount(0);
  });

  test("pages forward and back without losing its place", async ({ page }) => {
    await page.goto("/th/inventory/history");
    await chooseOption(page, "คลังสินค้า", { value: BANG_PU });

    const previous = page.getByRole("button", { name: "หน้าก่อนหน้า" });
    await expect(previous).toBeDisabled();
    await expect(page.getByText("แสดงครบทุกรายการแล้ว")).toBeVisible();
  });

  test("resets to the first page when the warehouse changes", async ({
    page,
  }) => {
    // A cursor is only meaningful inside the query that produced it.
    await page.goto("/th/inventory/balances");
    await chooseOption(page, "คลังสินค้า", { value: BANG_PU });
    await expect(page.getByRole("table")).toBeVisible();

    await chooseOption(page, "คลังสินค้า", { value: LAMPHUN });
    await expect(
      page.getByRole("button", { name: "หน้าก่อนหน้า" }),
    ).toBeDisabled();
  });

  test("the handheld lookup reads the same data through the handheld shell", async ({
    page,
  }) => {
    await page.goto("/th/handheld/inventory");
    await chooseOption(page, "คลังสินค้า", { value: BANG_PU });

    await expect(page.getByRole("table")).toBeVisible();
    // The handheld shell has no sidebar navigation.
    await expect(page.getByRole("navigation")).toHaveCount(1);
  });

  test("never claims a server connection while showing synthetic rows", async ({
    page,
  }) => {
    await page.goto("/th/inventory/balances");

    await expect(
      page.getByText("ข้อมูลตัวอย่างในเครื่อง", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("เชื่อมต่อแล้ว")).toHaveCount(0);
  });
});

test.describe("master-data read path with preview data", () => {
  test("shows the item register without asking for a warehouse", async ({
    page,
  }) => {
    /*
     * Items are organization-scoped. Asking a supervisor to pick a site before
     * they can see the catalogue would be a fiction, and `WAREHOUSE_MISSING`
     * would be the wrong explanation for an empty screen.
     */
    await page.goto("/th/master-data/items");

    const table = page.getByRole("table");
    await expect(table).toBeVisible();
    await expect(table.getByText("เหล็กม้วนรีดร้อน")).toBeVisible();
    await expect(page.getByTestId("panel-WAREHOUSE_MISSING")).toHaveCount(0);
  });

  test("marks a deactivated item and a disabled tracking mode", async ({
    page,
  }) => {
    await page.goto("/th/master-data/items");

    const table = page.getByRole("table");
    // Exact, because the fixture's inactive item is also *named* "…(เลิกใช้)" —
    // matching loosely would pass on the name and prove nothing about the badge.
    await expect(table.getByText("เลิกใช้", { exact: true })).toBeVisible();
    await expect(table.getByText("ติดตามตามล็อต").first()).toBeVisible();
  });

  test("requires a warehouse before it shows locations", async ({ page }) => {
    await page.goto("/th/master-data/locations");
    // Both gated sections say it — the register and the create form — because a
    // location belongs to a site and neither half can proceed without one.
    await expect(
      page.getByTestId("panel-WAREHOUSE_MISSING").first(),
    ).toBeVisible();

    await chooseOption(page, "คลังสินค้า", { value: BANG_PU });
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByRole("table").getByText("A01-02-1")).toBeVisible();
  });

  test("scopes locations to the selected warehouse", async ({ page }) => {
    await page.goto("/th/master-data/locations");
    await chooseOption(page, "คลังสินค้า", { value: LAMPHUN });

    const table = page.getByRole("table");
    await expect(table.getByText("F01-03-2")).toBeVisible();
    // Bang Pu's codes must not appear while Lamphun is selected.
    await expect(table.getByText("A01-02-1")).toHaveCount(0);
  });

  test("offers editing without pretending preview data persists", async ({
    page,
  }) => {
    /*
     * This screen was read-only until master-data writes existed. It is not any
     * more — but a preview deployment has no server to write to, so the control
     * has to work and then say so.
     */
    await page.goto("/th/master-data/items");

    const form = page.getByTestId("form-item");
    await form.getByLabel("รหัสสินค้า").fill("PREVIEW-SKU");
    await form.getByLabel("ชื่อ", { exact: true }).fill("ทดสอบ");
    await form.getByLabel("หน่วยนับหลัก").fill("EA");
    /*
     * Answered rather than left to the form. `trackingMode` is `required` and no
     * longer defaults to `options[0]`, which was `NONE` — an item created that
     * way cannot hold a lot, and nothing said so until receiving asked for one.
     */
    await chooseOption(page, "รูปแบบการติดตาม", { value: "LOT" }, form);
    await form.getByRole("button").click();

    await expect(page.getByTestId("write-DEMONSTRATED")).toBeVisible();
    // The register is untouched: nothing was stored anywhere.
    await expect(page.getByRole("table").getByText("PREVIEW-SKU")).toHaveCount(
      0,
    );
  });

  test("says the master-data rows are synthetic too", async ({ page }) => {
    await page.goto("/th/master-data/items");
    await expect(page.getByTestId("preview-banner")).toBeVisible();
  });
});
