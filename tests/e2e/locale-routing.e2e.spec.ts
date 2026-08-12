import { expect, test } from "@playwright/test";
import { chooseOption } from "./support/select";

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

    await chooseOption(page, "ภาษา", { value: "en" });

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

  /**
   * A mistyped path inside a known locale.
   *
   * This used to fall past every route in `src/app`, so Next answered it with
   * its own 404 — outside `[locale]/layout.tsx`, and therefore with no
   * stylesheet, no `lang`, and no link: a black screen on a dark handheld
   * panel. `[locale]/[...rest]/page.tsx` moves the miss inside the segment.
   *
   * Both Playwright projects run this file, so the assertions hold on a desktop
   * browser and on an emulated scanner.
   */
  const MISTYPED = [
    { locale: "th", heading: "ไม่พบหน้าที่ต้องการ", back: "กลับไปแดชบอร์ด" },
    { locale: "en", heading: "Page not found", back: "Back to the dashboard" },
  ] as const;

  for (const { locale, heading, back } of MISTYPED) {
    test(`answers /${locale}/nonexistent in ${locale}, with the way back`, async ({
      page,
    }) => {
      const response = await page.goto(`/${locale}/nonexistent`);

      expect(response?.status()).toBe(404);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.getByTestId("not-found")).toBeVisible();
      await expect(
        page.getByRole("heading", { level: 1, name: heading }),
      ).toBeVisible();

      // A dead end on a handheld means restarting the browser, so the recovery
      // link is asserted by following it rather than by its presence.
      await page.getByRole("link", { name: back }).click();
      await expect(page).toHaveURL(new RegExp(`/${locale}/dashboard$`));
    });
  }

  test("the first heading is the only h1 on the page", async ({ page }) => {
    await page.goto("/th/dashboard");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  });
});
