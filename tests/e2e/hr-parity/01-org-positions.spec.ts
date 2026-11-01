import { expect, test } from "@playwright/test";

// Provisional UX contract for OUR app, not observed HRZoft controls. HRZoft's
// company/branch/employment screens were inspected read-only; the English tabs,
// panels and accessible names below are parity acceptance targets, not controls
// that exist yet. Before activation: provide an authenticated HR/ORG admin and
// an isolated tenant with a company profile (tax ID "0105500000001", a bank
// account, a Bangkok address), a branch "HQ" (Revenue branch "00000", an SSO
// employer account), departments "Sales"/"Recruitment", positions
// "Managing Director"/"Department Manager"/"General staff", a level "CEO",
// and employees E001 (position General staff, department Sales, supervisor E002)
// and E002. Routes /en/hr/settings and /en/hr/employees exist; the Company /
// Branches tabs and the employee Employment-info fields are proposed.
//
// Locator changes after the S01 UI landed (2026-10-20):
// - Settings uses `?section=` panels, not tabs. Company, Branches and
//   Departments & positions are panels reached by `?section=company|branches|
//   organization` (the same deep links search and other pages use), so the
//   `tab` clicks became direct section URLs.
// - The employee editor has no tabs yet (the tabbed profile is slice 03).
//   "Employment" is a fieldset group inside the editor, located as
//   `group "Employment"`; the edit button is named "Edit <display name>",
//   so it is found in the table row carrying the employee code.
// - Department, Position and Level are the app's shared select (a Radix
//   combobox), so the chosen value is the trigger's text and the options are
//   read from the opened listbox rather than a native <select>'s value.
// - Required fields show a visual " *" in their label, so required labels are
//   matched by a pattern that allows it.
// These remain `test.fixme`: no Playwright project runs tests/e2e/hr-parity,
// and they need the authenticated HR admin and seeded tenant described above.

test.fixme("[seen] S01-01 company profile shows name, EN name and tax ID", async ({
  page,
}) => {
  await page.goto("/en/hr/settings?section=company");
  const form = page.getByRole("form", { name: "Company profile" });
  await expect(form.getByLabel(/^Company name( \*)?$/)).toBeVisible();
  await expect(
    form.getByLabel("Company name (English)", { exact: true }),
  ).toBeVisible();
  const taxId = form.getByLabel(/^Tax ID( \*)?$/);
  await expect(taxId).toBeVisible();
  await expect(taxId).toHaveValue("0105500000001");
});

test.fixme("[seen] S01-02 company profile shows a full Thai address block", async ({
  page,
}) => {
  await page.goto("/en/hr/settings?section=company");
  const form = page.getByRole("form", { name: "Company profile" });
  for (const label of [
    /^Address( \*)?$/,
    /^Address \(English\)$/,
    /^Province( \*)?$/,
    /^District( \*)?$/,
    /^Sub-district( \*)?$/,
    /^Postcode( \*)?$/,
  ]) {
    await expect(form.getByLabel(label)).toBeVisible();
  }
});

test.fixme("[seen] S01-03 company profile adds and removes bank accounts", async ({
  page,
}) => {
  await page.goto("/en/hr/settings?section=company");
  const form = page.getByRole("form", { name: "Company profile" });
  const accounts = form.getByRole("group", { name: "Bank accounts" });
  await expect(accounts.getByLabel(/^Account number( \*)?$/)).toHaveCount(1);
  await accounts
    .getByRole("button", { name: "Add account", exact: true })
    .click();
  await expect(accounts.getByLabel(/^Account number( \*)?$/)).toHaveCount(2);
  await accounts
    .getByRole("button", { name: "Remove account 2", exact: true })
    .click();
  await expect(accounts.getByLabel(/^Account number( \*)?$/)).toHaveCount(1);
});

test.fixme("[seen] S01-04 company profile shows contact fields and a logo upload", async ({
  page,
}) => {
  await page.goto("/en/hr/settings?section=company");
  const form = page.getByRole("form", { name: "Company profile" });
  await expect(form.getByLabel("Phone", { exact: true })).toBeVisible();
  await expect(form.getByLabel("Fax", { exact: true })).toBeVisible();
  await expect(form.getByLabel("Company logo", { exact: true })).toBeVisible();
});

// Deferred: multi-company selection depends on the unknown affiliated-company
// model (S01-24). Kept on its original proposed locators until that exists.
test.fixme("[seen] S01-05 settings exposes a company selector and affiliated group", async ({
  page,
}) => {
  await page.goto("/en/hr/settings?section=company");
  await expect(
    page.getByRole("combobox", { name: "Active company", exact: true }),
  ).toBeVisible();
  // The affiliated-company form fields are unknown (S01-24); only the entry
  // point is asserted here.
  await expect(
    page.getByRole("button", { name: "Affiliated companies", exact: true }),
  ).toBeVisible();
});

test.fixme("[seen] S01-08 branches tab lists branches and offers add branch", async ({
  page,
}) => {
  await page.goto("/en/hr/settings?section=branches");
  const list = page.getByRole("table", { name: "Branches" });
  await expect(list.getByRole("row").filter({ hasText: "HQ" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add branch", exact: true }),
  ).toBeVisible();
});

test.fixme("[seen] S01-09 branch form has Revenue branch number and SSO employer account", async ({
  page,
}) => {
  await page.goto("/en/hr/settings?section=branches");
  await page.getByRole("button", { name: "Add branch", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Add branch", exact: true });
  await expect(
    editor.getByLabel(/^Revenue Department branch number( \*)?$/),
  ).toBeVisible();
  await expect(
    editor.getByLabel(/^Social Security employer account( \*)?$/),
  ).toBeVisible();
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(editor).toBeHidden();
});

test.fixme("[seen] S01-10 branch form has address, EN name, type and an active toggle", async ({
  page,
}) => {
  await page.goto("/en/hr/settings?section=branches");
  await page.getByRole("button", { name: "Add branch", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Add branch", exact: true });
  await expect(editor.getByLabel(/^Branch name( \*)?$/)).toBeVisible();
  await expect(
    editor.getByLabel("Branch name (English)", { exact: true }),
  ).toBeVisible();
  await expect(editor.getByLabel(/^Address( \*)?$/)).toBeVisible();
  await expect(
    editor.getByRole("group", { name: "Branch type", exact: true }),
  ).toBeVisible();
  const active = editor.getByLabel("Active", { exact: true });
  await expect(active).toBeChecked();
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(editor).toBeHidden();
});

test.fixme("[seen] S01-13 employee employment tab has a department select", async ({
  page,
}) => {
  await page.goto("/en/hr/employees");
  await page
    .getByRole("row")
    .filter({ hasText: "E001" })
    .getByRole("button", { name: /^Edit / })
    .click();
  const employment = page.getByRole("group", {
    name: "Employment",
    exact: true,
  });
  const department = employment.getByLabel(/^Department( \*)?$/);
  await expect(department).toBeVisible();
  await expect(department).toHaveText("Sales");
});

test.fixme("[seen] S01-14 employee employment tab has a position select with the master options", async ({
  page,
}) => {
  await page.goto("/en/hr/employees");
  await page
    .getByRole("row")
    .filter({ hasText: "E001" })
    .getByRole("button", { name: /^Edit / })
    .click();
  const employment = page.getByRole("group", {
    name: "Employment",
    exact: true,
  });
  const position = employment.getByLabel(/^Position( \*)?$/);
  await expect(position).toBeVisible();
  await position.click();
  const options = page.getByRole("listbox");
  for (const option of [
    "Managing Director",
    "Department Manager",
    "General staff",
  ]) {
    await expect(options.getByRole("option", { name: option })).toBeAttached();
  }
});

test.fixme("[seen] S01-15 employee employment tab has a level select", async ({
  page,
}) => {
  await page.goto("/en/hr/employees");
  await page
    .getByRole("row")
    .filter({ hasText: "E002" })
    .getByRole("button", { name: /^Edit / })
    .click();
  const employment = page.getByRole("group", {
    name: "Employment",
    exact: true,
  });
  const level = employment.getByLabel("Level", { exact: true });
  await expect(level).toBeVisible();
  await expect(level).toHaveText("CEO");
});

test.fixme("[seen] S01-16 employee employment tab has a supervisor picker", async ({
  page,
}) => {
  await page.goto("/en/hr/employees");
  await page
    .getByRole("row")
    .filter({ hasText: "E001" })
    .getByRole("button", { name: /^Edit / })
    .click();
  const employment = page.getByRole("group", {
    name: "Employment",
    exact: true,
  });
  await expect(
    employment.getByLabel("Supervisor", { exact: true }),
  ).toBeVisible();
});

test.fixme("[seen] S01-17 employee employment tab has branch and workplace selects", async ({
  page,
}) => {
  await page.goto("/en/hr/employees");
  await page
    .getByRole("row")
    .filter({ hasText: "E001" })
    .getByRole("button", { name: /^Edit / })
    .click();
  const employment = page.getByRole("group", {
    name: "Employment",
    exact: true,
  });
  await expect(employment.getByLabel("Branch", { exact: true })).toBeVisible();
  await expect(
    employment.getByLabel("Workplace", { exact: true }),
  ).toBeVisible();
});

test.fixme("[seen] S01-18 employee employment tab has employment status, type and probation", async ({
  page,
}) => {
  await page.goto("/en/hr/employees");
  await page
    .getByRole("row")
    .filter({ hasText: "E001" })
    .getByRole("button", { name: /^Edit / })
    .click();
  const employment = page.getByRole("group", {
    name: "Employment",
    exact: true,
  });
  await expect(
    employment.getByLabel("Employment status", { exact: true }),
  ).toBeVisible();
  const type = employment.getByRole("group", {
    name: "Employment type",
    exact: true,
  });
  await expect(
    type.getByRole("radio", { name: "Permanent", exact: true }),
  ).toBeVisible();
  await expect(
    type.getByRole("radio", { name: "Fixed-term", exact: true }),
  ).toBeVisible();
  await expect(
    employment.getByLabel("On probation", { exact: true }),
  ).toBeVisible();
});
