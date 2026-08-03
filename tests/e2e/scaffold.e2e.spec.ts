import { expect, test } from "@playwright/test";

/**
 * SCAFFOLD TEST — placeholder only.
 *
 * Proves the Playwright runner, the dev server, and the scaffold page agree.
 * Replace with real handheld/desktop journeys (receive, QC, pallet, print,
 * putaway) once those routes exist.
 */
test("scaffold page identifies itself as a scaffold", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { level: 1, name: "Industrial SSA" }),
  ).toBeVisible();
  await expect(
    page.getByText(/scaffold — not a working application/i),
  ).toBeVisible();
});
