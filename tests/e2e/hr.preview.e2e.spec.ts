import { expect, test } from "@playwright/test";

import { chooseOption } from "./support/select";

test("HR preview covers employee self-service and supervisor review", async ({
  page,
}) => {
  await page.goto("/en/hr");
  await chooseOption(page, "Warehouse", { value: "prv_wh_bangpoo" });
  await expect(
    page.getByRole("heading", { name: "Attendance and leave" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Employee → supervisor flow" }),
  ).toBeVisible();
  for (const testId of [
    "hr-clock-form",
    "hr-correction-form",
    "hr-leave-form",
    "hr-team-inbox",
  ]) {
    await expect(page.getByTestId(testId)).toBeVisible();
  }
  await expect(page.getByTestId("hr-team-inbox")).not.toContainText(
    "Family appointment",
  );
  await expect(page.getByText("Approved", { exact: true })).toBeVisible();
});
