import { expect, test } from "@playwright/test";

test("integration preview exposes delivery health, recovery, and manual fallback", async ({
  page,
}) => {
  await page.goto("/en/integrations");
  await expect(
    page.getByRole("heading", { name: "Integration health and recovery" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Business commit → verified external delivery",
    }),
  ).toBeVisible();
  await expect(page.getByTestId("integration-health-register")).toContainText(
    "PROVIDER_TIMEOUT",
  );
  const register = page.getByTestId("integration-health-register");
  await expect(register.getByText("Degraded")).toBeVisible();
  await expect(register.getByText("Disabled")).toBeVisible();
  await expect(
    page.getByText("First-party work remains authoritative"),
  ).toBeVisible();
  await expect(page.getByTestId("integration-register-form")).toBeVisible();
  await expect(page.getByTestId("integration-status-form")).toBeVisible();
});
