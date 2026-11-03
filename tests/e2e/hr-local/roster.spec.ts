import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { test, expect, convexAs } from "./fixtures";
import { localRun, readHrFixture } from "./setup";

async function site(page: Page, warehouseId = readHrFixture().warehouseId) {
  const api = await convexAs(page);
  const access = (await api.query("hr/access:display")).value;
  const chosen = access.sites.find(
    (row: { id: string }) => row.id === warehouseId,
  );
  expect(chosen).toBeDefined();
  const selector = page.getByRole("combobox", {
    name: "Workplace",
    exact: true,
  });
  await selector.click();
  await page
    .getByRole("option", {
      name: `${chosen.code} · ${chosen.name}`,
      exact: true,
    })
    .click();
  return { api, warehouseId };
}

test("roster fixed shift UI saves and reloads while pristine Cancel consumes its entry", async ({
  page,
}) => {
  const code = `QA-${randomUUID().slice(0, 8)}`.toUpperCase();
  const origin = "/en/hr/settings?section=organization#shift-origin";
  await page.goto(origin);
  await page.getByRole("link", { name: "Shifts", exact: true }).click();
  const { api, warehouseId } = await site(page);
  await page.getByRole("button", { name: "Add shift", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add shift", exact: true });
  await dialog.getByLabel(/^Shift code(?: \*)?$/).fill(code);
  await dialog
    .getByLabel(/^Shift name(?: \*)?$/)
    .fill("Synthetic morning shift");
  await dialog.getByLabel(/^Start(?: \*)?$/).fill("08:00");
  await dialog.getByLabel(/^End(?: \*)?$/).fill("17:00");
  await dialog
    .getByRole("spinbutton", { name: "Unpaid break (minutes)", exact: true })
    .fill("60");
  await dialog.getByRole("button", { name: "Save shift", exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(
    page.getByRole("button", { name: `Edit shift ${code}`, exact: true }),
  ).toBeVisible();
  const shifts = (await api.query("hr/roster:shifts", { warehouseId })).value
    .items;
  expect(
    shifts.find((row: { code: string }) => row.code === code),
  ).toMatchObject({
    startTime: "08:00",
    endTime: "17:00",
    breakMinutes: 60,
    version: 1,
  });
  await page.getByRole("button", { name: "Add shift", exact: true }).click();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`${origin.replace(/[?]/g, "\\?")}$`));
});

test("roster real batch SHIFT OFF Clear persists and selected newly recorded cell can be removed", async ({
  page,
}, info) => {
  // The real roster intentionally refuses sites above 50 employees before
  // search. Repeated employee acceptance runs must not exhaust this fixture.
  const isolated = localRun("staging/hrDemo:createLocalTestSite", {
    sourceWarehouseId: readHrFixture().warehouseId,
    code: `TRAIN-E2E-${randomUUID()}`,
    confirmation: "LOCAL_HR_FIXTURES_V1",
  }) as { warehouseId: string; sourceEmployeeCountAtLeast: number };
  await info.attach("isolated-roster-fixture", {
    body: JSON.stringify({
      sourceEmployeeCountAtLeast: isolated.sourceEmployeeCountAtLeast,
      rosterEmployeeLimit: 50,
      deletes: 0,
    }),
    contentType: "application/json",
  });
  await page.goto("/en/hr/roster?qa=baseline#grid");
  const { api, warehouseId } = await site(page, isolated.warehouseId);
  const code = `GRID-${randomUUID().slice(0, 8)}`;
  const assignments: Record<string, string> = {};
  for (const [endpoint, key] of [
    ["hr/org:listDepartments", "departmentId"],
    ["hr/org:listPositions", "positionId"],
  ] as const) {
    const active = (await api.query(endpoint)).value.items.find(
      (row: { status: string }) => row.status === "ACTIVE",
    );
    if (active) assignments[key] = active.id;
  }
  const created = await api.mutation("hr/setup:saveEmployee", {
    requestId: randomUUID(),
    warehouseId,
    code,
    displayName: code,
    employmentStartDate: "2026-01-01",
    status: "ACTIVE",
    ...assignments,
    schedule: {
      workDays: [1, 2, 3, 4, 5, 6, 7],
      startTime: "09:00",
      endTime: "18:00",
      endsNextDay: false,
      breakMinutes: 60,
    },
  });
  expect(created.value.written).toBe(true);
  const employeeId = created.value.documentId;
  const shiftCode = `RS-${randomUUID().slice(0, 8)}`.toUpperCase();
  const shift = await api.mutation("hr/roster:saveShift", {
    requestId: randomUUID(),
    warehouseId,
    code: shiftCode,
    name: "Synthetic roster shift",
    color: "teal",
    status: "ACTIVE",
    startTime: "08:00",
    endTime: "17:00",
    endsNextDay: false,
    breakMinutes: 60,
  });
  expect(shift.value.written).toBe(true);
  const prepare = async () => {
    // The site's documented view filter resets to the first site on remount.
    await site(page, warehouseId);
    await page.getByLabel("Month", { exact: true }).fill("2026-10");
    await page.getByLabel("Employee code or name", { exact: true }).fill(code);
    await expect(
      page.getByRole("rowheader", { name: new RegExp(code) }),
    ).toBeVisible();
  };
  await prepare();
  const bar = page.getByRole("form", {
    name: "Assign shifts to selected dates",
    exact: true,
  });
  const cell = (date: string) =>
    page.getByRole("button", { name: new RegExp(`^${code}, ${date}:`) });
  const read = async (date: string) => {
    const roster = (
      await api.query("hr/roster:roster", {
        warehouseId,
        month: "2026-10",
        search: code,
      })
    ).value;
    return roster.employees
      .find((row: { id: string }) => row.id === employeeId)
      .cells.find((entry: { date: string }) => entry.date === date);
  };
  for (const [choice, expected] of [
    [
      `${shiftCode} · 08:00–17:00`,
      { assignment: { kind: "SHIFT", code: shiftCode }, revision: 1 },
    ],
    [
      "OFF",
      {
        assignment: { kind: "OFF" },
        plan: { kind: "NONWORKING", reason: "OFF" },
        revision: 2,
      },
    ],
    [
      "Clear (use weekly schedule)",
      {
        assignment: null,
        plan: { kind: "SCHEDULED", startTime: "09:00" },
        revision: 3,
      },
    ],
  ] as const) {
    await page
      .getByRole("button", { name: "Assign shifts", exact: true })
      .click();
    for (const date of ["2026-10-21", "2026-10-22"]) await cell(date).click();
    await expect(bar.getByRole("status")).toHaveText("2 dates selected");
    await bar.getByRole("combobox", { name: "Assign", exact: true }).click();
    await page.getByRole("option", { name: choice, exact: true }).click();
    await bar
      .getByRole("button", { name: "Save assignment", exact: true })
      .click();
    await expect(bar).toBeHidden();
    for (const date of ["2026-10-21", "2026-10-22"])
      expect(await read(date)).toMatchObject(expected);
    await page.reload();
    await prepare();
  }
  await page
    .getByRole("button", { name: "Assign shifts", exact: true })
    .click();
  await cell("2026-10-21").click();
  await cell("2026-10-22").click();
  const recorded = await api.mutation("hr/review:disposeDay", {
    requestId: randomUUID(),
    employeeId,
    businessDate: "2026-10-21",
    expectedRevision: 0,
    disposition: "ABSENT",
    reason: "Synthetic locked selection acceptance",
  });
  expect(recorded.value.written).toBe(true);
  await expect(cell("2026-10-21")).toHaveAttribute(
    "title",
    "Attendance recorded; the plan is fixed",
  );
  await expect(cell("2026-10-21")).toBeEnabled();
  await cell("2026-10-21").click();
  await expect(cell("2026-10-21")).toBeDisabled();
  await expect(bar.getByRole("status")).toHaveText("1 date selected");
  await bar.getByRole("combobox", { name: "Assign", exact: true }).click();
  await page.getByRole("option", { name: "OFF", exact: true }).click();
  await bar
    .getByRole("button", { name: "Save assignment", exact: true })
    .click();
  await expect(bar).toBeHidden();
  expect(await read("2026-10-21")).toMatchObject({
    revision: 3,
    lock: "RECORDED",
    assignment: null,
  });
  expect(await read("2026-10-22")).toMatchObject({
    revision: 4,
    assignment: { kind: "OFF" },
  });
});
