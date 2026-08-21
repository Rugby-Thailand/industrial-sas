import { expect, test } from "@playwright/test";

import { chooseOption } from "./support/select";

const BANG_PU = "prv_wh_bangpoo";

test("shows one-location pick evidence before submission", async ({ page }) => {
  await page.goto("/th/handheld/pick");
  await chooseOption(page, "คลังสินค้า", { value: BANG_PU });
  await chooseOption(page, "งานหยิบ", { index: 0 });
  await page.getByRole("button", { name: "เริ่มงาน" }).click();
  await expect(page.getByText("A-01-02", { exact: true })).toBeVisible();
  await expect(page.getByText("เหลือ 8 PCS", { exact: true })).toBeVisible();
});

test("shows expected versus loaded and blocks completion behind seal", async ({
  page,
}) => {
  await page.goto("/th/handheld/load");
  await chooseOption(page, "คลังสินค้า", { value: BANG_PU });
  await expect(page.getByText("2 / 4", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "ปิดซีลเมื่อโหลดครบ" }),
  ).toBeVisible();
});

test("labels POD as private evidence and pending independent review", async ({
  page,
}) => {
  await page.goto("/th/handheld/delivery");
  await chooseOption(page, "คลังสินค้า", { value: BANG_PU });
  await expect(page.getByText("ตัวอย่างการเก็บ POD")).toBeVisible();
  await expect(page.getByText(/ภาพส่วนตัว/)).toBeVisible();
});
