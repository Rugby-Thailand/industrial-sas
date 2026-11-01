import { readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";

/** Runs against real authenticated fixtures; no query mocks or static preview. */
export async function verifyBatchHistory(
  page: Page,
  fixture: {
    productId: string;
    productName: string;
    batchId: string;
    lot: string;
  },
  origin: string,
) {
  for (const locale of ["en", "th"]) {
    await page.setViewportSize(
      locale === "en"
        ? { width: 1440, height: 1000 }
        : { width: 390, height: 844 },
    );
    const listUrl = `${origin}/${locale}/finished-goods?acceptance=history#main-content`;
    await page.goto(listUrl);
    await page.getByRole("link", { name: fixture.productName }).click();
    await expect(page).toHaveURL(
      new RegExp(`/finished-goods/products/${fixture.productId}$`),
    );
    const article = page.locator("article").filter({ hasText: fixture.lot });
    const history = article.locator("details");
    await history.locator("summary").click();
    await expect(history.locator("li")).toHaveCount(20);
    const next = history.getByRole("button", {
      name: locale === "en" ? "Next page" : "หน้าถัดไป",
      exact: true,
    });
    await next.click();
    await expect(history.locator("li")).toHaveCount(2);
    await expect(next).toBeDisabled();

    // Paging is retained on remount, while disclosure opening stays local.
    await page.reload();
    await history.locator("summary").click();
    await expect(history.locator("li")).toHaveCount(2);
    await history
      .getByRole("button", {
        name: locale === "en" ? "Previous page" : "หน้าก่อนหน้า",
        exact: true,
      })
      .click();
    await expect(history.locator("li")).toHaveCount(20);
    const copy = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
      .FinishedGoods.copy;
    await article
      .getByRole("button", {
        name: `${copy["view-storage"]} ${fixture.batchId.slice(-8)}`,
        exact: true,
      })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText("10 pieces", { exact: false }).first(),
    ).toBeVisible();
    await dialog
      .getByRole("button", {
        name: locale === "en" ? "Close" : "ปิด",
        exact: true,
      })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(
      new RegExp(`/finished-goods/products/${fixture.productId}$`),
    );
    await page.goBack();
    await expect(page).toHaveURL(listUrl);
  }
}
