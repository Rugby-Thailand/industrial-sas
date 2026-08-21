import { expect, test } from "@playwright/test";

import { chooseOption } from "./support/select";

test("shows both legs and discrepancy-safe destination receipt", async ({
  page,
}) => {
  await page.goto("/th/transfers");
  await chooseOption(page, "คลังสินค้า", { value: "prv_wh_bangpoo" });
  await expect(page.getByText("ควบคุมการโอนย้ายสองขา")).toBeVisible();
  await expect(page.getByText("รายการออกจากคลังนี้")).toBeVisible();
  await expect(page.getByText("รายการเข้าคลังนี้")).toBeVisible();
  await expect(page.getByTestId("transfer-dispatch-form")).toBeVisible();
  await expect(page.getByTestId("transfer-receive-form")).toBeVisible();
  await expect(
    page.getByTestId("transfer-resolve-discrepancy-form"),
  ).toBeVisible();
});
