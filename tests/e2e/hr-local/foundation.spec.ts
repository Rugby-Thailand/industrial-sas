import { randomUUID } from "node:crypto";

import type { Locator, Page } from "@playwright/test";

import { test, expect, convexAs, expectEmployeeList } from "./fixtures";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOQi5r2HwADtgIOas69kQAAAABJRU5ErkJggg==",
  "base64",
);

async function address(form: Locator) {
  for (const [label, value] of [
    [/^Address( \*)?$/, "123 Local test road"],
    [/^Province( \*)?$/, "Bangkok"],
    [/^District( \*)?$/, "Pathum Wan"],
    [/^Sub-district( \*)?$/, "Lumphini"],
    [/^Postcode( \*)?$/, "10330"],
  ] as const)
    await form.getByLabel(label).fill(value);
}

async function choose(
  page: Page,
  form: Locator,
  label: RegExp,
  option: string,
) {
  await form.getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function openSettingsLink(page: Page) {
  const menu = page.getByRole("button", { name: "Open menu", exact: true });
  if ((page.viewportSize()?.width ?? 1280) < 1024) await menu.click();
  const administration = page.getByRole("button", {
    name: "HR administration",
    exact: true,
  });
  if ((await administration.getAttribute("aria-expanded")) !== "true")
    await administration.click();
  await page.getByRole("link", { name: "HR settings", exact: true }).click();
  await expect(page.getByTestId("hr-company-form")).toBeVisible();
}

test("Phase1 company profile and bank accounts persist and dirty header Back protects origin", async ({
  page,
}, info) => {
  const name = `Local company ${randomUUID().slice(0, 8)}`;
  await page.goto("/en/hr/today?origin=company-e2e#origin");
  await page.getByRole("heading", { name: "My day", exact: true }).waitFor();
  // A real app link records header-Back provenance. page.goto is a direct
  // entry with no referrer, so a hub correctly has no synthetic Back button.
  await openSettingsLink(page);
  const form = page.getByTestId("hr-company-form");
  await form.getByLabel(/^Company name( \*)?$/).fill(name);
  await form
    .getByLabel("Company name (English)", { exact: true })
    .fill(`${name} EN`);
  await form.getByLabel(/^Tax ID/).fill("0105500000001");
  await address(form);
  const accounts = form.getByRole("group", {
    name: "Bank accounts",
    exact: true,
  });
  while (
    await accounts.getByRole("button", { name: /^Remove account/ }).count()
  )
    await accounts
      .getByRole("button", { name: /^Remove account/ })
      .last()
      .click();
  await accounts
    .getByRole("button", { name: "Add account", exact: true })
    .click();
  await accounts.getByLabel(/^Bank( \*)?$/).fill("Local test bank");
  await accounts.getByLabel(/^Account number/).fill("1234567890");
  await accounts
    .getByLabel("Account name", { exact: true })
    .fill("Local fixture company");
  await form.getByLabel("Phone", { exact: true }).fill("020000000");
  await form
    .getByRole("button", { name: "Save company profile", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await (await convexAs(page)).query("hr/org:getCompanyProfile")).value
          .profile?.name,
    )
    .toBe(name);
  await page.reload();
  await expect(form.getByLabel(/^Company name( \*)?$/)).toHaveValue(name);
  await expect(accounts.getByLabel(/^Account number/)).toHaveValue(
    "1234567890",
  );
  const screenshot = info.outputPath("company-persisted.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await info.attach("persisted company", {
    path: screenshot,
    contentType: "image/png",
  });
  await form.getByLabel(/^Company name( \*)?$/).fill("Unsaved company draft");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  const guard = page.getByRole("dialog", {
    name: "Save changes before leaving?",
  });
  await guard
    .getByRole("button", { name: "Keep editing", exact: true })
    .click();
  await expect(form.getByLabel(/^Company name( \*)?$/)).toHaveValue(
    "Unsaved company draft",
  );
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await guard
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await expect(page).toHaveURL(/\/en\/hr\/today\?origin=company-e2e#origin$/);
  expect(
    (await (await convexAs(page)).query("hr/org:getCompanyProfile")).value
      .profile.name,
  ).toBe(name);
});

test("Phase1 logo uploads real PNG bytes and removal persists after reload", async ({
  page,
}) => {
  await page.goto("/en/hr/settings?section=company");
  const form = page.getByTestId("hr-company-form");
  const input = form.getByLabel("Company logo", { exact: true });
  await input.setInputFiles({
    name: "local-test-logo.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  const preview = form.getByRole("img", {
    name: "Current company logo",
    exact: true,
  });
  await expect(preview).toBeVisible();
  await expect
    .poll(() =>
      preview.evaluate((element) => (element as HTMLImageElement).naturalWidth),
    )
    .toBe(1);
  const api = await convexAs(page);
  expect((await api.query("hr/org:getCompanyLogo")).value).toEqual({
    mimeType: "image/png",
    base64: PNG.toString("base64"),
  });
  await page.reload();
  await expect(preview).toBeVisible();
  await form.getByRole("button", { name: "Remove logo", exact: true }).click();
  await expect(preview).toBeHidden();
  await page.reload();
  await expect(form.getByLabel(/^Company name( \*)?$/)).toBeVisible();
  expect(
    (await (await convexAs(page)).query("hr/org:getCompanyLogo")).value,
  ).toBeNull();
});

test("Phase1 branch save persists and completion consumes modal history", async ({
  page,
}, info) => {
  const name = `E2E branch ${randomUUID().slice(0, 8)}`;
  const apiOrigin = "/en/hr/today?origin=branch-e2e#origin";
  await page.goto(apiOrigin);
  await page.getByRole("heading", { name: "My day", exact: true }).waitFor();
  await page.goto("/en/hr/settings?section=branches#branches");
  const api = await convexAs(page);
  const existing = (await api.query("hr/org:listBranches")).value.items;
  const used = new Set(
    existing.map((row: { revenueBranchNo: string }) => row.revenueBranchNo),
  );
  let number = 10001;
  while (used.has(String(number))) number += 1;
  await page.getByRole("button", { name: "Add branch", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add branch", exact: true });
  await dialog.getByLabel(/^Branch name( \*)?$/).fill(name);
  await dialog
    .getByLabel(/^Revenue Department branch number/)
    .fill(String(number));
  await dialog
    .getByLabel(/^Social Security employer account/)
    .fill("1234567890");
  await dialog.getByRole("radio", { name: "Branch", exact: true }).check();
  await address(dialog);
  await dialog
    .getByRole("button", { name: "Save branch", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(
    page.getByRole("button", { name: `Edit branch ${name}`, exact: true }),
  ).toBeVisible();
  const saved = (
    await (await convexAs(page)).query("hr/org:listBranches")
  ).value.items.find((row: { name: string }) => row.name === name);
  expect(saved).toMatchObject({
    name,
    revenueBranchNo: String(number),
    ssoEmployerAccount: "1234567890",
    status: "ACTIVE",
    type: "BRANCH",
  });
  const screenshot = info.outputPath("branch-persisted.png");
  await page.screenshot({ path: screenshot });
  await info.attach("persisted branch", {
    path: screenshot,
    contentType: "image/png",
  });
  await page.goBack();
  await expect(page).toHaveURL(/\/en\/hr\/today\?origin=branch-e2e#origin$/);
});

test("Phase1 branch Cancel then next Back and nested dirty dismissal preserve origin", async ({
  page,
}) => {
  await page.goto("/en/hr/today?origin=branch-cancel#origin");
  await page.getByRole("heading", { name: "My day", exact: true }).waitFor();
  await page.goto("/en/hr/settings?section=branches#cancel");
  await page.getByRole("button", { name: "Add branch", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Add branch", exact: true });
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(editor).toBeHidden();
  await page.goBack();
  await expect(page).toHaveURL(/\/en\/hr\/today\?origin=branch-cancel#origin$/);
  await page.goto("/en/hr/settings?section=branches#dirty");
  await page.getByRole("button", { name: "Add branch", exact: true }).click();
  const name = editor.getByLabel(/^Branch name( \*)?$/);
  await name.fill("Unsaved branch draft");
  await page.goBack();
  const guard = page.getByRole("dialog", {
    name: "Save changes before leaving?",
  });
  await guard
    .getByRole("button", { name: "Keep editing", exact: true })
    .click();
  await expect(name).toHaveValue("Unsaved branch draft");
  await page.goBack();
  await guard
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await expect(editor).toBeHidden();
  await expect(page).toHaveURL(/\/en\/hr\/settings\?section=branches#dirty$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/en\/hr\/today\?origin=branch-cancel#origin$/);
});

test("Phase1 masters and employee employment assignments persist after reload", async ({
  page,
}, info) => {
  const tag = randomUUID().slice(0, 8);
  const department = `E2E department ${tag}`;
  const position = `E2E position ${tag}`;
  const level = `E2E level ${tag}`;
  await page.goto("/en/hr/settings?section=organization");
  for (const [kind, name] of [
    ["department", department],
    ["position", position],
    ["level", level],
  ] as const) {
    await page
      .getByRole("button", { name: `Add ${kind}`, exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: `Add ${kind}`,
      exact: true,
    });
    await dialog
      .getByLabel(
        new RegExp(`^${kind[0]!.toUpperCase()}${kind.slice(1)} name( \\*)?$`),
      )
      .fill(name!);
    if (kind === "level") await dialog.getByLabel(/^Sort order/).fill("10");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toBeHidden();
  }
  await page.reload();
  for (const [kind, name] of [
    ["department", department],
    ["position", position],
    ["level", level],
  ] as const)
    await expect(
      page.getByRole("button", { name: `Edit ${kind} ${name}`, exact: true }),
    ).toBeVisible();
  const code = `ORG-${tag}`;
  const api = await convexAs(page);
  const existingBranches = (await api.query("hr/org:listBranches")).value.items;
  const usedNumbers = new Set(
    existingBranches.map(
      (row: { revenueBranchNo: string }) => row.revenueBranchNo,
    ),
  );
  let branchNumber = 20001;
  while (usedNumbers.has(String(branchNumber))) branchNumber += 1;
  const branchName = `E2E employment branch ${tag}`;
  const branchWrite = await api.mutation("hr/org:saveBranch", {
    requestId: randomUUID(),
    name: branchName,
    revenueBranchNo: String(branchNumber),
    ssoEmployerAccount: "1234567890",
    type: "BRANCH",
    status: "ACTIVE",
    address: "123 Local test road",
    province: "Bangkok",
    district: "Pathum Wan",
    subDistrict: "Lumphini",
    postcode: "10330",
  });
  expect(branchWrite.ok && branchWrite.value.written).toBe(true);
  await page.goto(`/en/hr/employees?q=${code}`);
  await page.getByRole("button", { name: "Add employee", exact: true }).click();
  const form = page.getByTestId("hr-employee-form");
  await form.getByLabel(/^Employee code/).fill(code);
  await form.getByLabel(/^Display name/).fill(`Org employee ${tag}`);
  const employment = form.getByRole("group", {
    name: "Employment",
    exact: true,
  });
  await choose(page, employment, /^Department/, department);
  await choose(page, employment, /^Position/, position);
  await choose(page, employment, /^Level$/, level);
  await choose(page, employment, /^Branch$/, branchName);
  await expect(
    employment.getByRole("combobox", { name: "Workplace", exact: true }),
  ).toHaveText(/Local Demo/);
  await employment
    .getByRole("radio", { name: "Fixed-term", exact: true })
    .check();
  await employment.getByLabel("On probation", { exact: true }).check();
  await employment.getByLabel(/^Probation end date/).fill("2027-01-31");
  await form
    .getByRole("button", { name: "Save employee", exact: true })
    .click();
  await expect(form).toBeHidden();
  await expectEmployeeList(page, code);
  await page.reload();
  await page
    .getByRole("button", { name: `Edit Org employee ${tag}`, exact: true })
    .click();
  await expect(
    employment.getByRole("combobox", { name: /^Department/ }),
  ).toHaveText(department);
  await expect(
    employment.getByRole("combobox", { name: /^Position/ }),
  ).toHaveText(position);
  await expect(
    employment.getByRole("combobox", { name: "Level", exact: true }),
  ).toHaveText(level);
  await expect(
    employment.getByRole("combobox", { name: "Branch", exact: true }),
  ).toHaveText(branchName);
  await expect(
    employment.getByRole("radio", { name: "Fixed-term", exact: true }),
  ).toBeChecked();
  await expect(employment.getByLabel(/^Probation end date/)).toHaveValue(
    "2027-01-31",
  );
  const screenshot = info.outputPath("employment-persisted.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await info.attach("persisted employment", {
    path: screenshot,
    contentType: "image/png",
  });
  await employment
    .getByRole("radio", { name: "Permanent", exact: true })
    .check();
  await employment.getByLabel("On probation", { exact: true }).uncheck();
  await form
    .getByRole("button", { name: "Save employee", exact: true })
    .click();
  await expect(form).toBeHidden();
  await expectEmployeeList(page, code);
  await page.reload();
  await page
    .getByRole("button", { name: `Edit Org employee ${tag}`, exact: true })
    .click();
  await expect(
    employment.getByRole("radio", { name: "Permanent", exact: true }),
  ).toBeChecked();
  await expect(
    employment.getByLabel("On probation", { exact: true }),
  ).not.toBeChecked();
  await expect(employment.getByLabel(/^Probation end date/)).toHaveCount(0);
  await form.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(form).toBeHidden();
});

test("Phase1 legacy unassigned employee remains editable after masters exist", async ({
  page,
}) => {
  await page.goto("/en/hr/employees?q=EMP-DEMO-002");
  await page.getByRole("button", { name: /^Edit .*No account/ }).click();
  const form = page.getByTestId("hr-employee-form");
  const name = form.getByLabel(/^Display name/);
  const original = await name.inputValue();
  await expect(
    form.getByRole("combobox", { name: "Department", exact: true }),
  ).toHaveText("No department");
  await name.fill(`${original.replace(/ \[checked\]$/, "")} [checked]`);
  await form
    .getByRole("button", { name: "Save employee", exact: true })
    .click();
  await expect(form).toBeHidden();
  await expectEmployeeList(page, "EMP-DEMO-002");
  await page.reload();
  await expect(
    page.getByRole("button", { name: /^Edit .*No account.*\[checked\]/ }),
  ).toBeVisible();
});
