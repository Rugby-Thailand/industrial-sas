import { expect, test } from "@playwright/test";

import { chooseOption } from "./support/select";

const BANG_PU = "prv_wh_bangpoo";

test.describe("Path A desktop control in preview", () => {
  test("shows allocation, wave, shipment, and independent execution", async ({
    page,
  }) => {
    await page.goto("/th/fulfillment");
    await chooseOption(page, "คลังสินค้า", { value: BANG_PU });
    await expect(
      page.getByRole("heading", { name: "FF-2608-001", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("1. กำหนดเส้นทางความต้องการจากลูกค้า"),
    ).toBeVisible();
    await expect(page.getByText("เส้นทางผลิต")).toBeVisible();
    await expect(page.getByText("ต้องผลิตก่อนจึงจะจัดสรรได้ครบ")).toBeVisible();
    await expect(page.getByText("3. จองสต็อกพร้อมใช้")).toBeVisible();
    await expect(page.getByText("ตรวจอิสระและตัดจ่ายขาออก")).toBeVisible();
    await expect(
      page.getByText("ย้อนรายการตัดจ่ายที่ยังไม่จัดส่ง"),
    ).toBeVisible();
  });

  test("plans a vehicle and exposes POD review separately", async ({
    page,
  }) => {
    await page.goto("/th/transport");
    await chooseOption(page, "คลังสินค้า", { value: BANG_PU });
    await expect(
      page.locator("span.font-mono").filter({ hasText: /^SHP-2608-001$/ }),
    ).toBeVisible();
    await expect(page.getByText("ตรวจหลักฐานส่งมอบ")).toBeVisible();
  });
});
