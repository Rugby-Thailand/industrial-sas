import { randomUUID } from "node:crypto";

import {
  test,
  expect,
  convexAs,
  chooseRequiredEmployment,
  expectEmployeeList,
} from "./fixtures";

test("clock events and server times survive reload", async ({ page }, info) => {
  await page.goto("/en/hr/today");
  const api = await convexAs(page);
  let today = (await api.query("hr/self:today")).value;
  let writes = 0;
  if (today.nextAction === "CLOCK_IN") {
    await page.getByRole("button", { name: "Clock in", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Clock out", exact: true }),
    ).toBeVisible();
    today = (await api.query("hr/self:today")).value;
    expect(today.clockInAt).toBeGreaterThan(0);
    writes += 1;
    await page.reload();
  }
  if (today.nextAction === "CLOCK_OUT") {
    await page.getByRole("button", { name: "Clock out", exact: true }).click();
    await expect(page.getByText("Clocked out", { exact: true })).toBeVisible();
    writes += 1;
  }
  const recorded = (await (await convexAs(page)).query("hr/self:today")).value;
  expect(recorded.state).toBe("CLOCKED_OUT");
  expect(recorded.clockOutAt).toBeGreaterThanOrEqual(recorded.clockInAt);
  await page.reload();
  await expect(page.getByText("Clocked out", { exact: true })).toBeVisible();
  const reloaded = (await (await convexAs(page)).query("hr/self:today")).value;
  expect([reloaded.clockInAt, reloaded.clockOutAt]).toEqual([
    recorded.clockInAt,
    recorded.clockOutAt,
  ]);
  info.annotations.push({
    type: "real-clock-writes",
    description: String(writes),
  });
});

test("correction submits real request and preserves originals after reload", async ({
  page,
}) => {
  await page.goto("/en/hr/today");
  const api = await convexAs(page);
  const today = (await api.query("hr/self:today")).value.today;
  // Select an unused employed day outside the seeded closed/revised period.
  let selected: { date: string; detail: { events: unknown[] } } | undefined;
  for (const days of [4, 5, 6, 7, 8, 20, 21, 22, 23, 24, 25, 26]) {
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - days);
    const businessDate = date.toISOString().slice(0, 10);
    const result = await api.query("hr/self:dayDetail", { businessDate });
    if (
      result.ok &&
      result.value.ok &&
      !result.value.detail.locked &&
      !result.value.detail.pendingCorrectionId &&
      result.value.detail.corrections.length === 0
    ) {
      selected = { date: businessDate, detail: result.value.detail };
      break;
    }
  }
  expect(
    selected,
    "A fresh correction day is required; fixtures are not reset destructively",
  ).toBeDefined();
  const { date, detail } = selected!;
  const reason = `Real browser correction ${randomUUID().slice(0, 8)}`;
  await page.goto(`/en/hr/time/${date}?focus=correction#correction`);
  await page.getByLabel("Correct clock-in", { exact: true }).fill("08:30");
  await page.getByLabel("Correct clock-out", { exact: true }).fill("17:30");
  await page.getByLabel(/^Reason/).fill(reason);
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await expect(page.getByTestId("hr-correction-saved")).toHaveText(
    /Request sent/,
  );
  await page.reload();
  await expect(page.getByText(reason, { exact: true })).toBeVisible();
  const reloaded = (
    await (
      await convexAs(page)
    ).query("hr/self:dayDetail", { businessDate: date })
  ).value.detail;
  expect(reloaded.corrections[0]).toMatchObject({ reason, status: "PENDING" });
  expect(reloaded.events).toEqual(detail.events);
});

test("settings holiday save persists through reload", async ({
  page,
}, info) => {
  const name = `Local browser ${randomUUID().slice(0, 8)}`;
  const date = info.project.name === "hr-mobile" ? "2027-12-28" : "2027-12-27";
  await page.goto("/en/hr/settings?section=holidays");
  await page.getByLabel(/^Date( \*)?$/).fill(date);
  await page.getByLabel(/^Name or reason/).fill(name);
  await page.getByRole("button", { name: "Save holiday", exact: true }).click();
  await expect(page.getByLabel(/^Name or reason/)).toHaveValue("");
  await page.reload();
  await expect(
    page.getByRole("button", { name: `Remove holiday ${name}`, exact: true }),
  ).toBeVisible();
});

test("offline pending employee save blocks Back until the real backend settles", async ({
  page,
  context,
}) => {
  const code = `PEND-${randomUUID().slice(0, 8)}`;
  await page.goto(`/en/hr/employees?q=${code}#pending`);
  await page.getByRole("button", { name: "Add employee", exact: true }).click();
  const form = page.getByTestId("hr-employee-form");
  await form.getByLabel(/^Employee code/).fill(code);
  await form.getByLabel(/^Display name/).fill(`Pending ${code}`);
  await chooseRequiredEmployment(page);
  await context.setOffline(true);
  try {
    await form
      .getByRole("button", { name: "Save employee", exact: true })
      .click();
    await expect(
      form.getByRole("button", { name: /Submitting/ }),
    ).toBeDisabled();
    await page.goBack();
    const dialog = page.getByRole("dialog", {
      name: "Save changes before leaving?",
    });
    await expect(page.getByTestId("navigation-guard-pending")).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Discard changes", exact: true }),
    ).toBeDisabled();
    await dialog
      .getByRole("button", { name: "Keep editing", exact: true })
      .click();
    await expect(form.getByLabel(/^Display name/)).toHaveValue(
      `Pending ${code}`,
    );
  } finally {
    await context.setOffline(false);
  }
  await expect(form).toBeHidden();
  await expectEmployeeList(page, code);
  await page.reload();
  await expect(
    page.getByRole("button", { name: `Edit Pending ${code}`, exact: true }),
  ).toBeVisible();
});
