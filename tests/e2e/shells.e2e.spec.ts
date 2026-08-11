import { expect, test } from "@playwright/test";

/**
 * The two shells, on the two viewports the project targets.
 *
 * Both Playwright projects run this file — `desktop-chromium` at 1280 and
 * `handheld-chromium` emulating a Pixel 5 — so the same journey is proved at
 * both widths without the test knowing which one it is on. That is deliberate:
 * the shells are chosen by route, not by viewport (UX plan §7), so a narrow
 * screen must still be able to complete a supervisor journey.
 */
test.describe("desktop shell", () => {
  test("navigates between the ledger read screens", async ({ page }) => {
    await page.goto("/th/dashboard");

    // On a narrow viewport the navigation is behind a disclosure; open it if the
    // control is showing. Nothing here branches on the *device* — only on
    // whether the button this layout renders is currently visible.
    const menu = page.getByRole("button", { name: "เปิดเมนู" });
    if (await menu.isVisible()) await menu.click();

    // Scoped to the navigation landmark: the dashboard also links to balances
    // from a card, and an unscoped query would match both.
    await page
      .getByRole("navigation")
      .getByRole("link", { name: "ยอดคงเหลือ" })
      .click();
    await expect(page).toHaveURL(/\/th\/inventory\/balances$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "ยอดคงเหลือ" }),
    ).toBeVisible();
  });

  test("marks the current page for assistive technology", async ({ page }) => {
    await page.goto("/th/inventory/history");

    const menu = page.getByRole("button", { name: "เปิดเมนู" });
    if (await menu.isVisible()) await menu.click();

    await expect(
      page
        .getByRole("navigation")
        .getByRole("link", { name: "ประวัติการเคลื่อนไหว" }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("navigates to the master-data section", async ({ page }) => {
    await page.goto("/th/dashboard");

    const menu = page.getByRole("button", { name: "เปิดเมนู" });
    if (await menu.isVisible()) await menu.click();

    await page
      .getByRole("navigation")
      .getByRole("link", { name: "รายการสินค้า" })
      .click();

    await expect(page).toHaveURL(/\/th\/master-data\/items$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "รายการสินค้า" }),
    ).toBeVisible();
  });

  test("puts a working skip link ahead of the navigation", async ({ page }) => {
    await page.goto("/th/dashboard");
    await page.keyboard.press("Tab");

    const focused = page.locator(":focus");
    await expect(focused).toHaveText("ข้ามไปยังเนื้อหาหลัก");
    await expect(focused).toHaveAttribute("href", "#main-content");
  });

  test("reports the connection state it actually has", async ({ page }) => {
    // This server runs with no deployment URL, so the honest badge is "not
    // configured" — never "connecting" forever at a host that does not exist.
    await page.goto("/th/dashboard");

    await expect(page.getByText("ยังไม่ได้ตั้งค่า").first()).toBeVisible();
  });
});

test.describe("handheld shell", () => {
  test("lists operator tasks and marks the ones that are not built", async ({
    page,
  }) => {
    await page.goto("/th/handheld");

    await expect(page.getByRole("link", { name: "ค้นหาสต็อก" })).toBeVisible();
    /*
     * Receive, quality, and putaway are built and are links. Pallet building is
     * not a standalone task — it happens inside the receiving flow — and stays
     * listed and visibly marked rather than hidden: an operator has to be able
     * to tell "not built" from "not permitted".
     */
    await expect(page.getByRole("link", { name: "รับสินค้า" })).toBeVisible();
    await expect(page.getByText("ยังไม่พร้อมใช้งาน")).toHaveCount(1);
  });

  test("opens stock lookup and offers a way back to the desktop shell", async ({
    page,
  }) => {
    await page.goto("/th/handheld");
    await page.getByRole("link", { name: "ค้นหาสต็อก" }).click();

    await expect(page).toHaveURL(/\/th\/handheld\/inventory$/);
    await expect(
      page.getByRole("link", { name: "กลับไปหน้าจอเดสก์ท็อป" }),
    ).toBeVisible();
  });

  test("has no sidebar navigation competing with the task", async ({
    page,
  }) => {
    await page.goto("/th/handheld");
    await expect(page.getByRole("navigation")).toHaveCount(0);
  });
});
