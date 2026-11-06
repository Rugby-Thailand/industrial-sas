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
  const criteria = { search: code, pageSize: 20 };
  let saved = await api.query("hr/setup:employeesPage", criteria);
  // A bounded search can return a scan continuation before its first ready page.
  // Follow the actual cursor protocol rather than treating that step as empty.
  for (
    let step = 0;
    saved.ok && saved.value.status === "scanning" && step < 20;
    step++
  ) {
    const scanCursor = saved.value.scanCursor;
    expect(scanCursor).toBeTruthy();
    const next = await api.query("hr/setup:employeesPage", {
      ...criteria,
      scanCursor,
    });
    if (next.ok && next.value.status === "scanning")
      expect(next.value.scanCursor).not.toBe(scanCursor);
    saved = next;
  }
  expect(saved).toMatchObject({
    ok: true,
    value: { ok: true, status: "ready" },
  });
  expect(JSON.stringify(saved.value.page)).toContain(`Updated ${code}`);
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
    name: "Discard changes?",
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

test("leave readiness matches the active policy and survives reload", async ({
  page,
}, info) => {
  await page.goto("/en/hr/leave");
  const api = await convexAs(page);
  const policy = await api.query("hr/policies:current", {
    capability: "LEAVE",
  });
  const result = await api.query("hr/leave:self");
  expect(policy.ok && result.ok).toBe(true);
  if (!policy.value.active) expect(result.value.gate).toBe("POLICY_NOT_ACTIVE");
  else expect(result.value.gate).not.toBe("POLICY_NOT_ACTIVE");
  info.annotations.push({
    type: "observed-leave-gate",
    description: result.value.gate ?? "READY",
  });
  // A retained local database may already have the illustrative policy activated.
  // Verify its actual readiness; never deactivate it or claim inactive coverage.
  for (const reload of [false, true]) {
    if (reload) await page.reload();
    const latest = await (await convexAs(page)).query("hr/leave:self");
    expect(latest.ok).toBe(true);
    expect(latest.value.gate).toBe(result.value.gate);
    if (result.value.gate === null) {
      await expect(page.getByTestId("hr-leave-gate")).toHaveCount(0);
      await expect(page.getByLabel(/^Start date/)).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Submit request", exact: true }),
      ).toBeVisible();
    } else {
      await expect(page.getByTestId("hr-leave-gate")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Submit request", exact: true }),
      ).toHaveCount(0);
    }
  }
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
