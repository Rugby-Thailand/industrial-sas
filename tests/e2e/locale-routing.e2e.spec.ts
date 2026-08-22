import { expect, test } from "@playwright/test";

test.describe("locale routing", () => {
  test.use({ locale: "th-TH" });

  test("Thai browsers land on Thai sign-in", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/th\/sign-in$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "th");
  });

  test("English routes keep English", async ({ page }) => {
    await page.goto("/en/dashboard");
    await expect(page).toHaveURL(/\/en\/sign-in$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(
      page.getByRole("heading", { level: 1, name: "Sign in" }),
    ).toBeVisible();
  });

  test("unknown locale segments return 404", async ({ page }) => {
    const response = await page.goto("/xx/dashboard");
    expect(response?.status()).toBe(404);
  });

  test("known-locale typos keep a localized recovery page", async ({
    page,
  }) => {
    const response = await page.goto("/th/nonexistent");
    expect(response?.status()).toBe(404);
    await expect(page.locator("html")).toHaveAttribute("lang", "th");
    await expect(page.getByTestId("not-found")).toBeVisible();

    await page.getByRole("link", { name: "กลับไปแดชบอร์ด" }).click();
    await expect(page).toHaveURL(/\/th\/sign-in$/);
  });

  test("sign-in has one page heading", async ({ page }) => {
    await page.goto("/th/sign-in");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  });
});
