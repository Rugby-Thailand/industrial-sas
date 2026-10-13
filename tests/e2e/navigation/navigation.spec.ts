import { expect, test, type Page, type Route } from "@playwright/test";

async function openEditor(page: Page) {
  await page.goto("/en/previous");
  await page.getByRole("link", { name: "Open editor" }).click();
  await expect(
    page.getByRole("heading", { name: "editor", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("hr-query")).toHaveText("initial");
  await expect
    .poll(() => page.evaluate(() => Boolean(history.state?.__NA)))
    .toBe(true);
}
async function dirtyA(page: Page) {
  await page.getByLabel("Draft A").fill("Unsaved A contents");
  await expect
    .poll(() =>
      page.evaluate(() => typeof history.state?.__storageWorkspaceGuard),
    )
    .toBe("string");
}
async function holdSave(page: Page) {
  let complete!: (route: Route) => void;
  const request = new Promise<Route>((resolve) => {
    complete = resolve;
  });
  await page.route("**/fixture-save", (route) => {
    complete(route);
  });
  return { request };
}

const pageErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  pageErrors.set(page, errors);
  // Each fresh document starts a count; client router transitions retain it.
  await page.addInitScript(() =>
    sessionStorage.removeItem("navigation-executions"),
  );
});

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page)).toEqual([]);
});

test("a sole Floor-style save continues once after its React clean report", async ({
  page,
}) => {
  await openEditor(page);
  await dirtyA(page);
  const held = await holdSave(page);
  await page.getByRole("button", { name: "Leave editor", exact: true }).click();
  await page
    .getByRole("button", { name: "Save and continue", exact: true })
    .click();
  const route = await held.request;
  await expect(
    page.getByRole("button", { name: "Saving…", exact: true }),
  ).toBeDisabled();
  await expect(page.getByTestId("saves")).toHaveText("1");
  await expect(page.getByTestId("discards")).toHaveText("0");
  await route.fulfill({ json: { saved: true } });
  await expect(page).toHaveURL(/\/en\/target\?kept=1#arrival$/);
  await expect(
    page.getByRole("heading", { name: "target", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    await page.evaluate(() => sessionStorage.getItem("navigation-executions")),
  ).toBe("1");
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
});

test("B becoming pending during A save preserves the prompt and requires a later decision", async ({
  page,
}) => {
  await openEditor(page);
  await page.getByLabel("Save scenario").selectOption("pending");
  await dirtyA(page);
  const held = await holdSave(page);
  await page.getByRole("button", { name: "Leave editor", exact: true }).click();
  await page
    .getByRole("button", { name: "Save and continue", exact: true })
    .click();
  const route = await held.request;
  await expect(page.getByTestId("navigation-guard-pending")).toBeVisible();
  await route.fulfill({ json: { saved: true } });
  await expect(
    page.getByRole("button", { name: "Keep editing", exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Discard changes", exact: true }),
  ).toBeDisabled();
  await expect(page.getByTestId("draft-b")).toHaveText("Pending B contents");
  await expect(page.getByTestId("discards")).toHaveText("0");
  expect(
    await page.evaluate(() => sessionStorage.getItem("navigation-executions")),
  ).toBeNull();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page.getByLabel("Draft A")).toHaveValue("Unsaved A contents");
  await page
    .getByRole("button", { name: "Finish B write", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "editor", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Leave editor", exact: true }).click();
  await page
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await expect(page).toHaveURL(/\/en\/target\?kept=1#arrival$/);
  expect(
    await page.evaluate(() => sessionStorage.getItem("navigation-executions")),
  ).toBe("1");
});

test("new work protects the queued native buffer-removal boundary", async ({
  page,
}) => {
  await openEditor(page);
  await dirtyA(page);
  await page
    .getByRole("button", { name: "Finish A with queued B", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByTestId("navigation-guard-pending")).toBeVisible();
  await expect(page.getByTestId("draft-b")).toHaveText("Queued B contents");
  await expect(page.getByTestId("discards")).toHaveText("0");
  expect(
    await page.evaluate(() => sessionStorage.getItem("navigation-executions")),
  ).toBeNull();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page.getByLabel("Draft A")).toHaveValue("Unsaved A contents");
  await expect(
    page.getByRole("heading", { name: "editor", exact: true }),
  ).toBeVisible();
});

for (const queryMode of ["push", "replace"] as const) {
  test(`pending B stays guarded after a same-task ${queryMode} supersedes native removal`, async ({
    page,
    browserName,
  }) => {
    // Observe native delivery before the guard's consuming listener. No event,
    // traversal method or queue is replaced; this counter only waits for delivery.
    await page.addInitScript(() => {
      sessionStorage.setItem("native-traversals", "0");
      window.addEventListener(
        "popstate",
        () => {
          sessionStorage.setItem(
            "native-traversals",
            String(Number(sessionStorage.getItem("native-traversals")) + 1),
          );
        },
        true,
      );
    });
    await openEditor(page);
    await dirtyA(page);
    const before = await page.evaluate(() =>
      Number(sessionStorage.getItem("native-traversals")),
    );
    await page
      .getByRole("button", {
        name: `Finish A with queued B and ${queryMode}`,
        exact: true,
      })
      .click();
    // Firefox may cancel the queued traversal when pushState overtakes it.
    // Its query, B registration and fresh Back must still satisfy every gate.
    if (queryMode === "replace" || browserName !== "firefox")
      await expect
        .poll(() =>
          page.evaluate(() =>
            Number(sessionStorage.getItem("native-traversals")),
          ),
        )
        .toBeGreaterThan(before);
    await expect(page).toHaveURL(
      /floor=1&view=storage&q=initial&panel=list#section$/,
    );
    await expect(page.getByTestId("floor-view")).toHaveText("list");
    await expect
      .poll(() =>
        page.evaluate(() => typeof history.state?.__storageWorkspaceGuard),
      )
      .toBe("string");
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem("navigation-executions"),
      ),
    ).toBeNull();
    // The overtaken removal may itself prompt. A fresh ordinary Back must still
    // protect B after that prompt is dismissed, rather than spend a dead buffer.
    if (await page.getByRole("dialog").isVisible())
      await page
        .getByRole("button", { name: "Keep editing", exact: true })
        .click();
    await page.evaluate(() => history.back());
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByTestId("navigation-guard-pending")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Discard changes", exact: true }),
    ).toBeDisabled();
    await expect(page.getByTestId("draft-b")).toHaveText("Queued B contents");
    await expect(page.getByTestId("discards")).toHaveText("0");
    await expect(page.getByTestId("floor-view")).toHaveText("list");
    await expect(page.getByTestId("next-query")).toContainText("panel=list");
    await expect(page.getByTestId("hr-query")).toHaveText("initial");
    await expect(page).toHaveURL(
      /floor=1&view=storage&q=initial&panel=list#section$/,
    );
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem("navigation-executions"),
      ),
    ).toBeNull();
    await page
      .getByRole("button", { name: "Keep editing", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "editor", exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("draft-b")).toHaveText("Queued B contents");
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  });
}

test("reload then Floor query replacement preserves the first native Back", async ({
  page,
}) => {
  await openEditor(page);
  await dirtyA(page);
  page.once("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByLabel("Draft A")).toHaveValue("");
  await page
    .getByRole("button", { name: "Floor list view", exact: true })
    .click();
  await expect(page.getByTestId("floor-view")).toHaveText("list");
  await expect(page).toHaveURL(
    /floor=1&view=storage&q=initial&panel=list#section$/,
  );
  await page.evaluate(() => history.back());
  await expect(
    page.getByRole("heading", { name: "previous", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
});

test("active HR query push stays guarded and Keep preserves committed criteria", async ({
  page,
}) => {
  await openEditor(page);
  await dirtyA(page);
  await page
    .getByRole("button", { name: "HR query push", exact: true })
    .click();
  await expect(page.getByTestId("hr-query")).toHaveText("updated");
  await expect(page.getByTestId("next-query")).toContainText("q=updated");
  await page.evaluate(() => history.back());
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page.getByLabel("Draft A")).toHaveValue("Unsaved A contents");
  await expect(page.getByTestId("hr-query")).toHaveText("updated");
  await expect(page).toHaveURL(/q=updated.*#section$/);
  await page.evaluate(() => history.back());
  await page
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await expect(page.getByTestId("hr-query")).toHaveText("initial");
  await expect(page.getByLabel("Draft A")).toHaveValue("");
  await expect(page.getByTestId("discards")).toHaveText("1");
});

test("clean locale navigation and native Back complete without a prompt or stuck progress", async ({
  page,
}) => {
  await openEditor(page);
  await page.getByRole("button", { name: "Leave editor", exact: true }).click();
  await expect(page).toHaveURL(/\/en\/target\?kept=1#arrival$/);
  await expect(
    page.getByRole("heading", { name: "target", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => history.back());
  await expect(
    page.getByRole("heading", { name: "editor", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
});
