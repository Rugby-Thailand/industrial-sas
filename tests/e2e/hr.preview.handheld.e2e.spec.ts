import { expect, test } from "@playwright/test";

import { chooseOption } from "./support/select";

test("handheld attendance keeps every primary action glove-friendly", async ({
  page,
}) => {
  await page.goto("/th/handheld/attendance");
  await chooseOption(page, "คลังสินค้า", { value: "prv_wh_bangpoo" });
  await expect(
    page.getByRole("heading", { name: "เวลาทำงานของฉัน" }),
  ).toBeVisible();
  for (const testId of [
    "hr-clock-form",
    "hr-correction-form",
    "hr-leave-form",
  ]) {
    const form = page.getByTestId(testId);
    await expect(form).toBeVisible();
    const submit = form.getByRole("button");
    const box = await submit.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});
