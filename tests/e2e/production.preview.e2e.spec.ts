import { expect, test } from "@playwright/test";

import { chooseOption } from "./support/select";

test.describe("production preview flow", () => {
  test("desktop shows revision, quantity reconciliation, and all execution phases", async ({
    page,
  }) => {
    await page.goto("/en/production/orders");
    await chooseOption(page, "Warehouse", { value: "prv_wh_bangpoo" });
    await expect(
      page.getByRole("heading", { name: "Production execution" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "MO-26018", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Released revision R4")).toBeVisible();
    await expect(
      page.getByText("Target linked to routed fulfillment shortage"),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "New-revision impact queue" }),
    ).toBeVisible();
    await expect(page.getByText("Production-affecting change")).toBeVisible();
    for (const testId of [
      "production-create-form",
      "production-release-form",
      "production-issue-form",
      "production-report-form",
      "production-receive-form",
      "production-quality-form",
    ]) {
      await expect(page.getByTestId(testId)).toBeVisible();
    }
  });
});
