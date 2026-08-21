import { expect, test } from "@playwright/test";

import { chooseOption } from "./support/select";

const BANG_PU = "prv_wh_bangpoo";

test("completes the blind handheld capture path without exposing a system count", async ({
  page,
}) => {
  await page.goto("/th/handheld/count");
  await chooseOption(page, "คลังสินค้า", { value: BANG_PU });
  await chooseOption(
    page,
    "งานนับที่พร้อมรับ",
    { index: 0 },
    page.getByRole("group", { name: "งานนับที่พร้อมรับ" }),
  );
  await page.getByRole("button", { name: "เริ่มนับ" }).click();

  await expect(
    page.getByText(
      "งานนับแบบปิดยอด: ระบบตั้งใจซ่อนยอด ledger และผลของผู้นับคนก่อน",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByText("5000", { exact: true })).toHaveCount(0);

  await page.getByLabel("จำนวนที่นับได้จริง").fill("5000");
  await page.getByRole("button", { name: "บันทึกจำนวน" }).click();
  await expect(page.getByRole("button", { name: "ส่งผลการนับ" })).toBeVisible();
});
