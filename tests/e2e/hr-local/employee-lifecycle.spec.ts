import { randomUUID } from "node:crypto";
import { HR_TEST_IDENTITY } from "../../../scripts/lib/hr-e2e-env.mjs";
import { test, expect, convexAs } from "./fixtures";
import { localRun, readHrFixture } from "./setup";

const LIFE = "hr/employeeProfile:employeeLifecycle";
const EVENT = "hr/employeeProfile:recordEmploymentEvent";

test("employee offboard reinstate preserves separation gap and refuses reversed chronology through real reload", async ({
  page,
}) => {
  await page.goto("/en/hr/employees");
  await expect(
    page.getByRole("button", { name: "Add employee", exact: true }),
  ).toBeVisible();
  const api = await convexAs(page);
  const code = `LIFE-${randomUUID().slice(0, 8)}`;
  const assignments: Record<string, string> = {};
  for (const [endpoint, key] of [
    ["hr/org:listDepartments", "departmentId"],
    ["hr/org:listPositions", "positionId"],
  ]) {
    const rows = (await api.query(endpoint!)).value.items;
    const active = rows.find(
      (row: { status: string }) => row.status === "ACTIVE",
    );
    if (active) assignments[key!] = active.id;
  }
  const created = await api.mutation("hr/setup:saveEmployee", {
    requestId: randomUUID(),
    warehouseId: readHrFixture().warehouseId,
    code,
    displayName: code,
    employmentStartDate: "2026-01-01",
    status: "ACTIVE",
    ...assignments,
  });
  expect(created.value.written).toBe(true);
  const id = created.value.documentId;
  await page.goto(`/en/hr/employees?q=${code}#lifecycle`);
  await page.getByRole("button", { name: `Edit ${code}`, exact: true }).click();
  await page
    .getByRole("button", {
      name: "Record resignation or termination",
      exact: true,
    })
    .click();
  let d = page.getByRole("dialog", {
    name: "Record resignation or termination",
    exact: true,
  });
  await d.getByLabel("Last working day", { exact: true }).fill("2026-09-30");
  await d.getByLabel(/^Reason/).fill("Disposable acceptance exit");
  await d.getByRole("button", { name: "Save", exact: true }).click();
  await expect(d).toBeHidden();
  await page.reload();
  await expect(page.getByTestId("hr-employee-lifecycle")).toContainText(
    "Disposable acceptance exit",
  );
  let lifecycle = (await api.query(LIFE, { employeeId: id })).value;
  expect(lifecycle.state).toBe("RESIGNED");
  expect(lifecycle.employmentIntervals).toEqual([
    { startDate: "2026-01-01", endDate: "2026-09-30" },
  ]);
  await page.getByRole("button", { name: "Reinstate", exact: true }).click();
  d = page.getByRole("dialog", { name: "Reinstate", exact: true });
  await d.getByLabel("Reinstatement date", { exact: true }).fill("2026-10-20");
  await d.getByLabel(/^Reason/).fill("Disposable acceptance return");
  await d.getByRole("button", { name: "Save", exact: true }).click();
  await expect(d).toBeHidden();
  await page.reload();
  await expect(page.getByTestId("hr-employee-lifecycle")).toContainText(
    "Disposable acceptance return",
  );
  lifecycle = (await api.query(LIFE, { employeeId: id })).value;
  expect(lifecycle.employmentIntervals).toEqual([
    { startDate: "2026-01-01", endDate: "2026-09-30" },
    { startDate: "2026-10-20" },
  ]);
  const bad = await api.mutation(EVENT, {
    requestId: randomUUID(),
    employeeId: id,
    expectedVersion: lifecycle.version,
    kind: "OFFBOARD",
    separationType: "RESIGNATION",
    effectiveDate: "2026-10-01",
    reason: "Rejected reversed event",
  });
  expect(bad.value.written).toBe(false);
  expect((await api.query(LIFE, { employeeId: id })).value).toEqual(lifecycle);
  const gap = (
    await api.query("hr/review:dayDetail", {
      employeeId: id,
      businessDate: "2026-10-15",
    })
  ).value;
  // The carried e9d06c77 fix deliberately suppresses fabricated attendance
  // obligations in a separation gap, including direct deep links.
  expect(gap).toEqual({ ok: false, code: "HR_OUTSIDE_EMPLOYMENT" });
  const queue = await api.query("hr/review:queue", {
    from: "2026-10-15",
    to: "2026-10-15",
    warehouseId: readHrFixture().warehouseId,
  });
  expect(queue.ok).toBe(true);
  expect(JSON.stringify(queue.value.items)).not.toContain(id);
  await page.goBack();
  await expect(page.getByTestId("hr-employee-profile")).toBeHidden();
});

test("employee reinstatement refuses missing assignments in genuine backend and retains draft", async ({
  page,
}) => {
  await page.goto("/en/hr/employees");
  await expect(
    page.getByRole("button", { name: "Add employee", exact: true }),
  ).toBeVisible();
  const api = await convexAs(page);
  const code = `REFUSE-${randomUUID().slice(0, 8)}`;
  const assignments: Record<string, string> = {};
  for (const [endpoint, key] of [
    ["hr/org:saveDepartment", "departmentId"],
    ["hr/org:savePosition", "positionId"],
  ]) {
    const saved = await api.mutation(endpoint!, {
      requestId: randomUUID(),
      name: `${code} ${key}`,
      status: "ACTIVE",
    });
    expect(saved.value.written).toBe(true);
    assignments[key!] = saved.value.documentId;
  }
  const base = {
    warehouseId: readHrFixture().warehouseId,
    code,
    displayName: code,
    employmentStartDate: "2026-01-01",
  };
  const created = await api.mutation("hr/setup:saveEmployee", {
    ...base,
    status: "ACTIVE",
    requestId: randomUUID(),
    ...assignments,
  });
  expect(created.value.written).toBe(true);
  const id = created.value.documentId;
  const exit = await api.mutation(EVENT, {
    requestId: randomUUID(),
    employeeId: id,
    expectedVersion: 1,
    kind: "OFFBOARD",
    separationType: "RESIGNATION",
    effectiveDate: "2026-09-30",
    reason: "Disposable assignment scenario",
  });
  expect(exit.value.written).toBe(true);
  const cleared = await api.mutation("hr/setup:saveEmployee", {
    ...base,
    employeeId: id,
    expectedVersion: 2,
    requestId: randomUUID(),
    status: "INACTIVE",
    employmentEndDate: "2026-09-30",
    replaceOrgFields: true,
  });
  expect(cleared.value.written).toBe(true);
  await page.goto(`/en/hr/employees?q=${code}&status=ALL#refusal`);
  await page.getByRole("button", { name: `Edit ${code}`, exact: true }).click();
  await page.getByRole("button", { name: "Reinstate", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Reinstate", exact: true });
  await dialog
    .getByLabel("Reinstatement date", { exact: true })
    .fill("2026-10-20");
  await dialog.getByLabel(/^Reason/).fill("Missing assignment refusal");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog.getByText(/Nothing was saved/)).toBeVisible();
  await expect(dialog.getByLabel(/^Reason/)).toHaveValue(
    "Missing assignment refusal",
  );
  const lifecycle = (await api.query(LIFE, { employeeId: id })).value;
  expect(lifecycle.state).toBe("RESIGNED");
  expect(lifecycle.version).toBe(3);
  expect(lifecycle.events).toHaveLength(1);
  await page.goBack();
  await page
    .getByRole("dialog", { name: "Save changes before leaving?" })
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Reinstate", exact: true }),
  ).toBeVisible();
});

test("employee payment and profile are denied to own local employee role with exact grant restoration", async ({
  page,
}) => {
  await page.goto("/en/hr/today");
  await expect(
    page.getByRole("heading", { name: "My day", exact: true }),
  ).toBeVisible();
  const api = await convexAs(page);
  const id = (await api.query("hr/self:today")).value.employee.id;
  const roles = (roleKeys: string[]) =>
    localRun("staging/hrDemo:setLocalTestRoles", {
      clerkUserId: HR_TEST_IDENTITY.userId,
      clerkOrganizationId: HR_TEST_IDENTITY.organizationId,
      roleKeys,
      confirmation: "LOCAL_HR_FIXTURES_V1",
    });
  const previous = roles(["HR_EMPLOYEE"]).previous;
  try {
    for (const endpoint of [
      "hr/employeeProfile:employeePayment",
      "hr/employeeProfile:employeeProfile",
    ]) {
      let denied = false;
      try {
        const result = await api.query(endpoint, { employeeId: id });
        denied =
          result.ok === false && result.denial?.kind === "AUTHORIZATION_DENIED";
      } catch (error) {
        denied =
          (error as { data?: { kind?: string } }).data?.kind ===
          "AUTHORIZATION_DENIED";
      }
      expect(denied).toBe(true);
    }
    let denied = false;
    try {
      const result = await api.mutation(
        "hr/employeeProfile:saveEmployeePayment",
        {
          requestId: randomUUID(),
          employeeId: id,
          expectedVersion: 0,
          method: "CASH",
        },
      );
      denied =
        result.ok === false && result.denial?.kind === "AUTHORIZATION_DENIED";
    } catch (error) {
      denied =
        (error as { data?: { kind?: string } }).data?.kind ===
        "AUTHORIZATION_DENIED";
    }
    expect(denied).toBe(true);
    await page.goto("/en/hr/employees");
    await expect(page.getByTestId("hr-denied")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Edit payment details", exact: true }),
    ).toHaveCount(0);
  } finally {
    expect(roles(previous).previous).toEqual(["HR_EMPLOYEE"]);
  }
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Add employee", exact: true }),
  ).toBeVisible();
});
