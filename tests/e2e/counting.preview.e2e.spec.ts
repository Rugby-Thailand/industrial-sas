import { expect, test } from "@playwright/test";

import { chooseOption } from "./support/select";

const BANG_PU = "prv_wh_bangpoo";

test.describe("counting control in preview", () => {
  test("builds and releases a blind count plan from a physical bucket", async ({
    page,
  }) => {
    await page.goto("/th/inventory/counts");
    await chooseOption(page, "คลังสินค้า", { value: BANG_PU });

    const form = page.getByTestId("count-plan-form");
    await chooseOption(page, "ถังสต็อกจริง", { index: 0 }, form);
    await form.getByRole("button", { name: "สร้างแผน" }).click();

    await expect(page.getByTestId("write-DEMONSTRATED").first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: "ปล่อยงานนับ" }),
    ).toBeVisible();
  });

  test("walks opening stock from batch creation into row validation", async ({
    page,
  }) => {
    await page.goto("/th/inventory/opening-stock");
    await chooseOption(page, "คลังสินค้า", { value: BANG_PU });

    const form = page.getByTestId("opening-stock-create");
    await form.getByLabel("ค่า SHA-256 ของไฟล์ต้นทาง").fill("a".repeat(64));
    await form.getByLabel("รหัสเหตุผลการปรับสต็อก").fill("reason-preview");
    await form.getByRole("button", { name: "สร้างและตรวจสอบข้อมูล" }).click();

    await expect(page.getByText("ตรวจสอบและเพิ่มรายการ").first()).toBeVisible();
    await expect(
      page.getByText("โหมดตัวอย่างแสดงขั้นตอนเท่านั้น"),
    ).toBeVisible();
  });
});
