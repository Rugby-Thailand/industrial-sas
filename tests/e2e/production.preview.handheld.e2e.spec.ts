import { expect, test } from "@playwright/test";

import { chooseOption } from "./support/select";

test("handheld exposes the same guarded production flow in Thai", async ({
  page,
}) => {
  await page.goto("/th/handheld/production");
  await chooseOption(page, "คลังสินค้า", { value: "prv_wh_bangpoo" });
  await expect(
    page.getByRole("heading", { name: "งานผลิตสำหรับผู้ปฏิบัติงาน" }),
  ).toBeVisible();
  await expect(page.getByTestId("production-order-card")).toBeVisible();
  await expect(page.getByTestId("production-report-form")).toBeVisible();
  await expect(page.getByTestId("production-quality-form")).toBeVisible();
});
