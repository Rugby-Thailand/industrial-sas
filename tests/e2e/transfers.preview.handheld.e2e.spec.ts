import { expect, test } from "@playwright/test";

import { chooseOption } from "./support/select";

test("keeps transfer dispatch and receipt operable on a handheld viewport", async ({
  page,
}) => {
  await page.goto("/th/handheld/transfers");
  await chooseOption(page, "คลังสินค้า", { value: "prv_wh_bangpoo" });
  await expect(
    page.getByRole("heading", { name: "โอนย้ายสินค้า" }),
  ).toBeVisible();
  await expect(page.getByTestId("transfer-dispatch-form")).toBeVisible();
  await expect(page.getByTestId("transfer-receive-form")).toBeVisible();
});
