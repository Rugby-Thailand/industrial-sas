import { expect, test, type Page, type Route } from "@playwright/test";

async function retainedPredecessor(page: Page) {
  await page.goto("/en/previous?caller=workflow#origin");
  await page.getByRole("link", { name: "Open retained workflow" }).click();
  await page.getByRole("button", { name: "Open tickets", exact: true }).click();
  await page.getByLabel("Ticket", { exact: true }).fill("FO99990001");
  await page.goBack();
  await expect(page.getByTestId("workflow-step")).toHaveText(
    "Location question",
  );
  await expect(page).toHaveURL(/\/en\/workflow\?qa=draft#tickets$/);
  await expect(page.getByLabel("Ticket", { exact: true })).toHaveValue(
    "FO99990001",
  );
}

test("retained workflow Forward survives repeated Back and keeps exact-origin departure guarded", async ({
  page,
}) => {
  await retainedPredecessor(page);
  for (let cycle = 0; cycle < 2; cycle++) {
    await page.goForward();
    await expect(page.getByTestId("workflow-step")).toHaveText("Tickets");
    await expect(page.getByTestId("next-query")).toContainText("ticketStep=1");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.goBack();
    await expect(page.getByTestId("workflow-step")).toHaveText(
      "Location question",
    );
  }
  await page.goBack();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page).toHaveURL(/\/en\/workflow\?qa=draft#tickets$/);
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await page.goForward();
  await expect(page.getByTestId("workflow-step")).toHaveText("Tickets");
  await page
    .getByRole("button", { name: "Workflow Back", exact: true })
    .click();
  await expect(page.getByTestId("workflow-step")).toHaveText(
    "Location question",
  );
  await page.goBack();
  await page
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await expect(page).toHaveURL(/\/en\/previous\?caller=workflow#origin$/);
});

test("a pending retained write blocks Forward and completion restores the existing ticket entry", async ({
  page,
}) => {
  await retainedPredecessor(page);
  let release!: (route: Route) => void;
  const request = new Promise<Route>((resolve) => {
    release = resolve;
  });
  await page.route("**/fixture-save", (route) => release(route));
  await page.getByRole("button", { name: "Hold ticket write" }).click();
  const held = await request;
  try {
    await expect(page.getByTestId("workflow-write")).toHaveText("Pending");
    await page.goForward();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page).toHaveURL(/\/en\/workflow\?qa=draft#tickets$/);
    await expect(
      page.getByRole("button", { name: "Discard changes", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Keep editing", exact: true })
      .click();
  } finally {
    await held.fulfill({ status: 200, body: "ok" });
  }
  await expect(page.getByTestId("workflow-write")).toHaveText("Idle");
  await page.goForward();
  await expect(page.getByTestId("workflow-step")).toHaveText("Tickets");
  await expect(page.getByLabel("Ticket", { exact: true })).toHaveValue(
    "FO99990001",
  );
});
