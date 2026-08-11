import { expect, test } from "@playwright/test";

/**
 * Thai-first locale routing, end to end (`INV-0010-05`, `D-06`).
 *
 * The assertions are on `lang` and on the URL rather than only on visible text,
 * because those are what a screen reader and a shared link depend on. A page
 * that rendered Thai under `lang="en"` would read correctly on screen and
 * incorrectly out loud.
 */
test.describe("locale routing", () => {
  test.describe("a browser advertising Thai", () => {
    test.use({ locale: "th-TH" });

    test("is sent to the Thai tree, and never to an unprefixed page", async ({
      page,
    }) => {
      await page.goto("/");

      await expect(page).toHaveURL(/\/th\/dashboard$/);
      await expect(page.locator("html")).toHaveAttribute("lang", "th");
    });
  });

  test.describe("a browser advertising English", () => {
    test.use({ locale: "en-US" });

    test("is sent to the English tree, which is the fallback", async ({
      page,
    }) => {
      // Negotiation only ever picks a locale this application serves; an
      // unrecognised `Accept-Language` falls back to Thai, never to English.
      await page.goto("/");

      await expect(page).toHaveURL(/\/en\/dashboard$/);
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
    });
  });

  test.describe("a browser advertising a locale this product does not serve", () => {
    test.use({ locale: "ja-JP" });

    test("falls back to Thai, the product default", async ({ page }) => {
      await page.goto("/");
      await expect(page).toHaveURL(/\/th\/dashboard$/);
    });
  });

  test("the English tree renders in English under lang=en", async ({
    page,
  }) => {
    await page.goto("/en/dashboard");

    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(
      page.getByRole("heading", { level: 1, name: "Dashboard" }),
    ).toBeVisible();
  });

  test("the language control switches without leaving the screen", async ({
    page,
  }) => {
    await page.goto("/th/inventory/balances");
    await expect(
      page.getByRole("heading", { level: 1, name: "ยอดคงเหลือ" }),
    ).toBeVisible();

    await page.getByLabel("ภาษา").selectOption("en");

    await expect(page).toHaveURL(/\/en\/inventory\/balances$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Balances" }),
    ).toBeVisible();
  });

  test("an unknown locale segment is a 404, not a silent fallback", async ({
    page,
  }) => {
    // Quietly serving Thai for `/xx/dashboard` would make every typo look like a
    // working page.
    const response = await page.goto("/xx/dashboard");
    expect(response?.status()).toBe(404);
  });

  test("the first heading is the only h1 on the page", async ({ page }) => {
    await page.goto("/th/dashboard");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  });
});
