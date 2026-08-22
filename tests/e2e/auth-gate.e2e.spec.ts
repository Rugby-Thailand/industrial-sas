import { expect, test } from "@playwright/test";

const PRIVATE_ROUTES = [
  "/dashboard",
  "/engineering/designs",
  "/inbound",
  "/inventory/balances",
  "/inventory/history",
  "/master-data/items",
  "/master-data/items/missing",
  "/master-data/label-templates",
  "/master-data/locations",
  "/master-data/storage-classes",
  "/master-data/suppliers",
  "/production/packets",
  "/purchasing/import",
  "/purchasing/orders",
  "/purchasing/orders/missing",
  "/putaway",
  "/quality",
  "/receiving",
  "/receiving/missing",
  "/reports",
  "/sales/orders",
  "/setup",
  "/handheld",
  "/handheld/inventory",
  "/handheld/putaway",
  "/handheld/quality",
  "/handheld/receive",
] as const;

test.describe("signed-out access", () => {
  for (const route of PRIVATE_ROUTES) {
    test(`${route} redirects to sign-in`, async ({ page }) => {
      await page.goto(`/th${route}`);

      await expect(page).toHaveURL(/\/th\/sign-in$/);
      await expect(
        page.getByRole("heading", { level: 1, name: "เข้าสู่ระบบ" }),
      ).toBeVisible();
      await expect(page.getByTestId("not-found")).toHaveCount(0);
    });
  }

  test("Clerk callback paths remain inside sign-in", async ({ page }) => {
    await page.goto(
      "/th/sign-in/create/sso-callback?sign_in_fallback_redirect_url=%2Fth%2Fdashboard",
    );

    await expect(page).toHaveURL(/\/th\/sign-in\/create\/sso-callback/);
    await expect(
      page.getByRole("heading", { level: 1, name: "เข้าสู่ระบบ" }),
    ).toBeVisible();
    await expect(page.getByTestId("not-found")).toHaveCount(0);
  });

  test("an unconfigured identity shows no local credential form", async ({
    page,
  }) => {
    await page.goto("/th/sign-in");

    await expect(page.getByRole("textbox")).toHaveCount(0);
    await expect(page.locator("input[type=password]")).toHaveCount(0);
    await expect(page.getByText("ยังเข้าสู่ระบบไม่ได้")).toBeVisible();
  });
});
