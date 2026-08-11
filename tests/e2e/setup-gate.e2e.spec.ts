import { expect, test } from "@playwright/test";

/**
 * What the application says when its dependencies are not configured.
 *
 * This is the state a fresh clone is in, and it is the state CI runs in, so it
 * is worth asserting precisely rather than treating as "the tests can't run
 * here". The contract is that every screen explains *which* dependency is
 * missing and never pretends to be loading something.
 *
 * The assertions use `data-testid="panel-<STATE>"` rather than the visible
 * prose so a copy edit does not fail the suite while a behaviour change does.
 */
test.describe("setup gate", () => {
  test("balances names the missing backend instead of spinning", async ({
    page,
  }) => {
    await page.goto("/th/inventory/balances");

    await expect(page.getByTestId("panel-BACKEND_MISSING")).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
  });

  test("history behaves the same way, from the same decision", async ({
    page,
  }) => {
    await page.goto("/th/inventory/history");
    await expect(page.getByTestId("panel-BACKEND_MISSING")).toBeVisible();
  });

  test("master data names the missing backend, on both its scopes", async ({
    page,
  }) => {
    /*
     * The organization-scoped screen and the warehouse-scoped one must give the
     * same reason: the backend, not a missing warehouse.
     *
     * Each screen now has two independently gated sections — the register and
     * the create form — and both must name the same cause. A page that said
     * "backend not configured" above the table and "no warehouse selected"
     * above the form would be two answers to one question.
     */
    for (const path of ["/th/master-data/items", "/th/master-data/locations"]) {
      await page.goto(path);

      const gates = page.getByTestId("panel-BACKEND_MISSING");
      await expect(gates.first()).toBeVisible();
      expect(await gates.count()).toBe(2);

      await expect(page.getByTestId("panel-WAREHOUSE_MISSING")).toHaveCount(0);
      await expect(page.getByRole("table")).toHaveCount(0);
      // No control is offered either: there is nothing for one to send to.
      await expect(page.getByRole("button", { name: /บันทึก/ })).toHaveCount(0);
    }
  });

  test("the dashboard lists each dependency and its state", async ({
    page,
  }) => {
    await page.goto("/th/dashboard");

    await expect(
      page.getByText("ยังไม่ได้ตั้งค่าแบ็กเอนด์ Convex"),
    ).toBeVisible();
    await expect(
      page.getByText("ยังไม่ได้ตั้งค่าผู้ให้บริการตัวตน"),
    ).toBeVisible();
  });

  test("sign-in offers no credential form", async ({ page }) => {
    // Clerk owns credentials (`ADR-0001` §2). A second credential surface in
    // this repository would be the mistake, not the missing feature.
    await page.goto("/th/sign-in");

    await expect(page.getByRole("textbox")).toHaveCount(0);
    await expect(page.locator("input[type=password]")).toHaveCount(0);
    await expect(page.getByText("ยังเข้าสู่ระบบไม่ได้")).toBeVisible();
  });

  test("no preview banner appears when preview mode is off", async ({
    page,
  }) => {
    await page.goto("/th/dashboard");
    await expect(page.getByTestId("preview-banner")).toHaveCount(0);
  });

  test("the workspace bar explains why no warehouse can be chosen", async ({
    page,
  }) => {
    await page.goto("/th/dashboard");

    await expect(page.getByText("ไม่มีบริบทองค์กร")).toBeVisible();
    await expect(page.getByLabel("คลังสินค้า")).toHaveCount(0);
  });
});
