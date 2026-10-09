import { expect, expectNoAxeViolations, test } from "../support/fixtures";

/**
 * Signed-out routing on the unconfigured production build. Messages come from
 * messages/{th,en}.json; the private routes are current planner routes.
 */

const PRIVATE_ROUTES = [
  "/master-data/storage-layouts",
  "/master-data/storage-layouts/new",
  "/finished-goods",
  "/finished-goods/scan",
  "/setup",
] as const;

/** The browser logs the intentionally missing document itself. */
const DOCUMENT_404 = [/Failed to load resource: .*status of 404/];

const SIGN_IN = {
  th: { heading: "เข้าสู่ระบบ", unavailable: "ยังเข้าสู่ระบบไม่ได้" },
  en: { heading: "Sign in", unavailable: "Sign-in unavailable" },
} as const;

test.describe("locale routing", () => {
  test("the root redirects Thai browsers to Thai sign-in", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/th\/sign-in$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "th");
  });

  for (const locale of ["th", "en"] as const) {
    test(`/${locale} lands on its own sign-in page`, async ({ page }) => {
      await page.goto(`/${locale}`);
      await expect(page).toHaveURL(new RegExp(`/${locale}/sign-in$`));
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(
        page.getByRole("heading", { level: 1, name: SIGN_IN[locale].heading }),
      ).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    });

    for (const route of PRIVATE_ROUTES) {
      test(`/${locale}${route} requires sign-in and keeps the return path`, async ({
        page,
      }) => {
        await page.goto(`/${locale}${route}`);
        const url = new URL(page.url());
        expect(url.pathname).toBe(`/${locale}/sign-in`);
        expect(url.searchParams.get("returnTo")).toBe(`/${locale}${route}`);
        await expect(page.getByTestId("not-found")).toHaveCount(0);
      });
    }
  }

  test("an unconfigured identity shows no credential form", async ({
    page,
  }) => {
    await page.goto("/th/sign-in");
    await expect(page.getByText(SIGN_IN.th.unavailable)).toBeVisible();
    await expect(page.locator("input[type=password]")).toHaveCount(0);
    await expect(page.getByRole("textbox")).toHaveCount(0);
  });

  test("an open redirect cannot be smuggled through returnTo", async ({
    page,
    baseURL,
  }) => {
    await page.goto(
      "/th/master-data/storage-layouts?next=https://evil.example",
    );
    const url = new URL(page.url());
    expect(url.origin).toBe(new URL(baseURL!).origin);
    expect(url.searchParams.get("returnTo") ?? "").toMatch(/^\/th\//);
  });
});

test.describe("public and not-found pages", () => {
  for (const [path, heading] of [
    ["/en/about", "Warehouse and storage planning"],
    ["/th/privacy", null],
    ["/en/terms", null],
  ] as const) {
    test(`${path} renders without sign-in`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      if (heading) {
        await expect(
          page.getByRole("heading", { level: 1, name: heading }),
        ).toBeVisible();
      }
    });
  }

  test.describe("missing pages", () => {
    test.use({ expectedConsoleErrors: DOCUMENT_404 });

    test("a mistyped page keeps a localized recovery page with a 404", async ({
      page,
    }) => {
      const response = await page.goto("/th/no-such-page");
      expect(response?.status()).toBe(404);
      await expect(page.locator("html")).toHaveAttribute("lang", "th");
      await expect(page.getByTestId("not-found")).toBeVisible();
      await expect(
        page.getByRole("heading", { level: 1, name: "ไม่พบหน้าที่ต้องการ" }),
      ).toBeVisible();
      await page.getByRole("link", { name: "กลับไปแดชบอร์ด" }).click();
      await expect(page).toHaveURL(/\/th\/sign-in/);
    });

    test("English not-found copy is English", async ({ page }) => {
      const response = await page.goto("/en/no-such-page");
      expect(response?.status()).toBe(404);
      await expect(
        page.getByRole("heading", { level: 1, name: "Page not found" }),
      ).toBeVisible();
    });
  });
});

test.describe("accessibility", () => {
  for (const path of ["/th/sign-in", "/en/sign-in", "/en/about"]) {
    test(`${path} has no WCAG A/AA violations`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoAxeViolations(page);
    });
  }

  test.describe("missing page", () => {
    test.use({ expectedConsoleErrors: DOCUMENT_404 });
    test("/th/no-such-page has no WCAG A/AA violations", async ({ page }) => {
      await page.goto("/th/no-such-page");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoAxeViolations(page);
    });
  });

  test("sign-in has no horizontal overflow", async ({ page }) => {
    await page.goto("/th/sign-in");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(0);
  });
});
