import { expect, test, type Page } from "@playwright/test";

async function openSpot(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/en/previous");
  await page.getByRole("link", { name: "Open storage workspace" }).click();
  await page
    .getByRole("button", { name: "Select location FG-D · Empty", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Location details", exact: true })
    .getByRole("button", { name: "Edit FG-D · Empty", exact: true })
    .click();
  const editor = page.getByRole("dialog", {
    name: "Edit storage spot",
    exact: true,
  });
  await expect(editor).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  // Overflow must not make mobile Chromium scale the synthetic document and
  // translate a physical tap into a different element's coordinates.
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(390);
  return editor;
}

async function expectClosedAndBack(page: Page) {
  await expect(page).toHaveURL(
    /\/en\/storage\?floor=1&view=storage&kept=yes#map$/,
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Select location FG-D · Empty",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  // A fresh document must not replay the dismissed editZone command.
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Storage editor fixture", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/en\/previous$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test("mobile spot Close stays closed after native history cleanup, refresh and the next Back", async ({
  page,
}) => {
  const editor = await openSpot(page);
  await editor
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await expectClosedAndBack(page);
});

test("mobile spot Cancel retains a dirty draft on Keep and consumes it on Discard before the next Back", async ({
  page,
}) => {
  const editor = await openSpot(page);
  await editor
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Unsaved spot");
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(
    editor.getByRole("textbox", { name: "Name", exact: true }),
  ).toHaveValue("Unsaved spot");
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await expectClosedAndBack(page);
});
