import { randomUUID } from "node:crypto";

import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

import {
  test,
  expect,
  convexAs,
  chooseRequiredEmployment,
  expectEmployeeList,
} from "./fixtures";
import { readHrFixture } from "./setup";

test("real Clerk identity resolves the seeded HR employee after reload", async ({
  page,
}) => {
  await page.goto("/en/hr/today");
  await expect(
    page.getByRole("heading", { name: "My day", exact: true }),
  ).toBeVisible();
  const api = await convexAs(page);
  const before = await api.query("hr/self:today");
  expect(before.ok).toBe(true);
  expect(before.value.employee.code).toBe("EMP-DEMO-001");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "My day", exact: true }),
  ).toBeVisible();
  expect(
    (await (await convexAs(page)).query("hr/self:today")).value.employee.id,
  ).toBe(before.value.employee.id);
});

test("employee create and edit persist through real backend and reload", async ({
  page,
}, info) => {
  const code = `E2E-${randomUUID().slice(0, 8)}`;
  await page.goto(`/en/hr/employees?q=${code}`);
  await page.getByRole("button", { name: "Add employee", exact: true }).click();
  const form = page.getByTestId("hr-employee-form");
  await form.getByLabel(/^Employee code/).fill(code);
  await form.getByLabel(/^Display name/).fill(`Browser ${code}`);
  await chooseRequiredEmployment(page);
  await form
    .getByRole("button", { name: "Save employee", exact: true })
    .click();
  await expect(form).toBeHidden();
  await expectEmployeeList(page, code);
  await page.reload();
  await page
    .getByRole("button", { name: `Edit Browser ${code}`, exact: true })
    .click();
  await expect(form.getByLabel(/^Display name/)).toHaveValue(`Browser ${code}`);
  await form.getByLabel(/^Display name/).fill(`Updated ${code}`);
  await form
    .getByRole("button", { name: "Save employee", exact: true })
    .click();
  await expect(form).toBeHidden();
  await expectEmployeeList(page, code);
  await page.reload();
  await expect(
    page.getByRole("button", { name: `Edit Updated ${code}`, exact: true }),
  ).toBeVisible();
  const api = await convexAs(page);
  const saved = await api.query("hr/setup:employeesPage", {
    search: code,
    pageSize: 20,
  });
  expect(saved.ok).toBe(true);
  expect(JSON.stringify(saved.value)).toContain(`Updated ${code}`);
  const screenshot = info.outputPath("employee-persisted.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await info.attach("persisted employee", {
    path: screenshot,
    contentType: "image/png",
  });
});

test("employee Cancel consumes editor history and preserves locale query and hash", async ({
  page,
}) => {
  await page.goto("/en/hr/today?origin=hr-e2e#origin");
  await page.getByRole("heading", { name: "My day", exact: true }).waitFor();
  // Real navigation establishes a document origin; no fabricated popstate.
  await page.goto("/en/hr/employees?q=EMP-DEMO-001#list");
  await page.getByRole("button", { name: /^Edit .*Test account/ }).click();
  const form = page.getByTestId("hr-employee-form");
  await expect(form).toBeVisible();
  await form.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(form).toBeHidden();
  await expect(page).toHaveURL(/\/en\/hr\/employees\?q=EMP-DEMO-001#list$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/en\/hr\/today\?origin=hr-e2e#origin$/);
});

test("dirty employee Back offers Keep and Discard without losing retained values", async ({
  page,
}) => {
  await page.goto("/en/hr/employees?q=EMP-DEMO-001#dirty");
  await page.getByRole("button", { name: /^Edit .*Test account/ }).click();
  const form = page.getByTestId("hr-employee-form");
  const name = form.getByLabel(/^Display name/);
  await name.fill("Unsaved local browser draft");
  await page.goBack();
  const dialog = page.getByRole("dialog", {
    name: "Save changes before leaving?",
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /Keep|Stay|Continue/ }).click();
  await expect(name).toHaveValue("Unsaved local browser draft");
  await page.goBack();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /Discard/ }).click();
  await expect(form).toBeHidden();
  await expect(page).toHaveURL(/\/en\/hr\/employees\?q=EMP-DEMO-001#dirty$/);
  await page.reload();
  await page.getByRole("button", { name: /^Edit .*Test account/ }).click();
  await expect(name).not.toHaveValue("Unsaved local browser draft");
});

test("leave stays gated without an activated policy after reload", async ({
  page,
}) => {
  await page.goto("/en/hr/leave");
  await expect(
    page.getByText("Leave is not ready yet", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Submit request", exact: true }),
  ).toHaveCount(0);
  const result = await (await convexAs(page)).query("hr/leave:self");
  expect(result.ok).toBe(true);
  expect(result.value.gate).toBe("POLICY_NOT_ACTIVE");
  await page.reload();
  await expect(
    page.getByText("Leave is not ready yet", { exact: true }),
  ).toBeVisible();
});

test("real backend isolates foreign tenant site and denies anonymous HR access", async ({
  page,
}) => {
  await page.goto("/en/hr/employees");
  const api = await convexAs(page);
  const foreign = await api.query("hr/setup:listEmployees", {
    warehouseId: readHrFixture().otherWarehouseId,
  });
  expect(foreign.ok).toBe(true);
  expect(foreign.value.items).toEqual([]);
  expect(foreign.value.sites).toEqual([]);
  expect(JSON.stringify(foreign)).not.toContain("Local HR foreign fixture");
  const anonymous = new ConvexHttpClient("http://127.0.0.1:3320", {
    logger: false,
  });
  await expect(
    anonymous.query(
      makeFunctionReference<"query">("hr/setup:listEmployees"),
      {},
    ),
  ).rejects.toThrow(/ANONYMOUS/);
});

test("employee selection survives Forward and refresh before header Back closes it", async ({
  page,
}) => {
  await page.goto("/en/hr/employees?q=EMP-DEMO-001#restore");
  await page.getByRole("button", { name: /^Edit .*Test account/ }).click();
  const form = page.getByTestId("hr-employee-form");
  await expect(form).toBeVisible();
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get("mode") === "edit" &&
      url.searchParams.has("employee"),
  );
  const editorUrl = page.url();
  await page.goBack();
  await expect(form).toBeHidden();
  await expectEmployeeList(page, "EMP-DEMO-001");
  await page.goForward();
  await expect(page).toHaveURL(editorUrl);
  await expect(form).toBeVisible();
  await page.reload();
  await expect(form.getByLabel(/^Employee code/)).toHaveValue("EMP-DEMO-001");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(form).toBeHidden();
  await expect(page).toHaveURL(/\/en\/hr\/employees\?q=EMP-DEMO-001#restore$/);
});
