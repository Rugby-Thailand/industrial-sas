import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { loadHrEnvironment } from "../../../scripts/lib/hr-e2e-env.mjs";
import { test, expect, convexAs } from "./fixtures";
import { localRun } from "./setup";
import { HR_TEST_IDENTITY } from "../../../scripts/lib/hr-e2e-env.mjs";

// Undo this lane's interrupted role case before any new browser authentication.
// The preceding role test asserted this exact baseline before lowering grants.
test.beforeAll(() => {
  const restored = localRun("staging/hrDemo:setLocalTestRoles", {
    clerkUserId: HR_TEST_IDENTITY.userId,
    clerkOrganizationId: HR_TEST_IDENTITY.organizationId,
    roleKeys: ["ORG_ADMIN", "HR_ADMIN", "HR_EMPLOYEE"],
    confirmation: "LOCAL_HR_FIXTURES_V1",
  });
  writeFileSync(
    ".cache/hr-final/role-restoration.json",
    JSON.stringify({
      ...restored,
      restoredTo: ["ORG_ADMIN", "HR_ADMIN", "HR_EMPLOYEE"],
      reason: "Outer bound interrupted owned mobile role case",
      at: Date.now(),
    }),
  );
});

// Illustrative local policy only. All setup writes use shipping authenticated
// public handlers; no fake actor, auth, response, or shared policy is used.
test("active illustrative leave submits in UI and claimed dates lock the real roster; self approval stays refused", async ({
  page,
}, info) => {
  const env = loadHrEnvironment();
  expect(env.NEXT_PUBLIC_CONVEX_URL).toBe("http://127.0.0.1:3320");
  expect(env.ALLOW_LOCAL_TEST_SEED).toBe("true");
  await page.goto("/en/hr/leave");
  const api = await convexAs(page);
  const query = async (name: string, args = {}) => {
    const out = await api.query(name, args);
    expect(out.ok).toBe(true);
    return out.value;
  };
  const write = async (name: string, args: Record<string, unknown>) => {
    const out = await api.mutation(name, { requestId: randomUUID(), ...args });
    expect(out.ok).toBe(true);
    expect(out.value, JSON.stringify(out.value)).toMatchObject({
      written: true,
    });
    return out.value;
  };
  let self = await query("hr/leave:self");
  let policy = await query("hr/policies:current", { capability: "LEAVE" });
  const today = self.today as string;
  if (!policy.active) {
    // Readiness covers all synthetic employees retained by preceding acceptance.
    for (const row of policy.employees) {
      const employee = (
        await query("hr/setup:employee", { employeeId: row.id })
      ).employee;
      if (!employee.schedule || employee.schedule.workDays.length > 6) {
        const fields: Record<string, unknown> = {
          employeeId: employee.id,
          expectedVersion: employee.version,
          warehouseId: employee.siteId,
          code: employee.code,
          displayName: employee.displayName,
          employmentStartDate: employee.employmentStartDate,
          status: employee.status,
          schedule: {
            workDays: [1, 2, 3, 4, 5],
            startTime: "08:30",
            endTime: "17:30",
            endsNextDay: false,
            breakMinutes: 60,
          },
        };
        for (const key of [
          "supervisorUserId",
          "employmentEndDate",
          "departmentId",
          "positionId",
          "branchId",
          "levelId",
          "employmentType",
          "probationEndDate",
          "probationConfirmedDate",
        ])
          if (employee[key] !== undefined) fields[key] = employee[key];
        if (employee.linkedUserId) fields.userId = employee.linkedUserId;
        await write("hr/setup:saveEmployee", fields);
      }
      for (const [type, granted] of [
        ["ANNUAL", 6],
        ["SICK", 30],
        ["PERSONAL", 3],
        ["MILITARY", 60],
      ] as const) {
        const previous = row.accounts.find(
          (a: { type: string }) => a.type === type,
        );
        if (!previous)
          await write("hr/policies:reconcileOpening", {
            employeeId: row.id,
            type,
            asOf: today,
            granted,
            used: 0,
            reserved: 0,
            paidUsed: 0,
            paidReserved: 0,
            sourceReference:
              "ILLUSTRATIVE LOCAL TRAINING FIXTURE — no legal entitlement assertion",
            expectedVersion: 0,
          });
      }
    }
    const sites = [
      ...new Set(
        policy.employees.map((e: { warehouseId: string }) => e.warehouseId),
      ),
    ];
    for (const warehouseId of sites) {
      const dates = Array.from(
        { length: 12 },
        (_, i) => `${today.slice(0, 4)}-01-${String(i + 1).padStart(2, "0")}`,
      );
      dates.push(`${today.slice(0, 4)}-05-01`);
      for (const date of dates)
        await write("hr/setup:saveHoliday", {
          warehouseId,
          date,
          name: "ILLUSTRATIVE training holiday",
        });
    }
    await write("hr/policies:saveDraft", {
      capability: "LEAVE",
      expectedVersion: policy.draft.version,
      effectiveDate: today,
      config: policy.draft.config,
    });
    policy = await query("hr/policies:current", { capability: "LEAVE" });
    expect(policy.blockers).toEqual([]);
    await write("hr/policies:activate", {
      capability: "LEAVE",
      expectedVersion: policy.draft.version,
      coverageConfirmed: true,
      existingBenefitsReviewed: true,
    });
  }
  self = await query("hr/leave:self");
  expect(self.gate).toBeNull();
  const before = self.accounts.find(
    (a: { type: string }) => a.type === "ANNUAL",
  );
  const reason = `TRAIN active leave ${randomUUID().slice(0, 8)}`;
  let date = "";
  for (let offset = 14; offset < 35; offset++) {
    const candidate = new Date(`${today}T00:00:00Z`);
    candidate.setUTCDate(candidate.getUTCDate() + offset);
    const iso = candidate.toISOString().slice(0, 10);
    const preview = await query("hr/leave:preview", {
      type: "ANNUAL",
      from: iso,
      to: iso,
      reason,
    });
    if (preview.ok && preview.days === 1) {
      date = iso;
      break;
    }
  }
  expect(date).not.toBe("");
  await page.reload();
  await page.getByLabel(/^Start date/).fill(date);
  await page.getByLabel(/^End date/).fill(date);
  await page.getByLabel(/^Reason/).fill(reason);
  await page
    .getByRole("button", { name: "Preview leave charges", exact: true })
    .click();
  await expect(page.getByTestId("hr-leave-preview")).toContainText(date);
  await page
    .getByRole("checkbox", {
      name: "I checked the charged dates and pay.",
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Submit request", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await query("hr/leave:self")).requests.find(
          (r: { reason: string }) => r.reason === reason,
        )?.status,
    )
    .toBe("PENDING");
  self = await query("hr/leave:self");
  const request = self.requests.find(
    (r: { reason: string }) => r.reason === reason,
  );
  const reserved = self.accounts.find(
    (a: { type: string }) => a.type === "ANNUAL",
  );
  expect(reserved.used).toBe(before.used);
  expect(reserved.reserved).toBe(before.reserved + 1);
  const access = (await api.query("hr/access:display")).value;
  const employee = (
    await query("hr/setup:employee", { employeeId: self.employeeId })
  ).employee;
  const warehouseId = employee.siteId;
  await page.goto("/en/hr/roster");
  await page.getByRole("combobox", { name: "Workplace", exact: true }).click();
  const site = access.sites.find((s: { id: string }) => s.id === warehouseId);
  await page
    .getByRole("option", { name: `${site.code} · ${site.name}`, exact: true })
    .click();
  await page.getByLabel("Month", { exact: true }).fill(date.slice(0, 7));
  await page
    .getByLabel("Employee code or name", { exact: true })
    .fill(employee.code);
  await page
    .getByRole("button", { name: "Assign shifts", exact: true })
    .click();
  const locked = page.getByRole("button", { name: new RegExp(`${date}:`) });
  await expect(locked).toBeDisabled();
  const roster = await query("hr/roster:roster", {
    warehouseId,
    month: date.slice(0, 7),
    search: employee.code,
  });
  const cell = roster.employees
    .find((e: { id: string }) => e.id === self.employeeId)
    .cells.find((c: { date: string }) => c.date === date);
  expect(cell.lock).toBe("LEAVE_CLAIMED");
  const refusal = await api.mutation("hr/roster:assignRoster", {
    requestId: randomUUID(),
    warehouseId,
    action: { kind: "OFF" },
    cells: [
      { employeeId: self.employeeId, date, expectedRevision: cell.revision },
    ],
  });
  expect(refusal.value).toMatchObject({
    written: false,
    error: { code: "ROSTER_DAY_LEAVE_CLAIMED" },
  });
  const approval = await api.mutation("hr/leave:decide", {
    requestId: randomUUID(),
    leaveRequestId: request._id,
    expectedVersion: request.version,
    decision: "APPROVE",
  });
  expect(approval.value).toMatchObject({
    written: false,
    error: { code: "SELF_REVIEW" },
  });
  await page.goto("/en/hr/leave");
  await page.reload();
  await expect(page.getByText(reason, { exact: true })).toBeVisible();
  const after = await query("hr/leave:self");
  expect(
    after.requests.find((r: { reason: string }) => r.reason === reason).status,
  ).toBe("PENDING");
  const balance = (a: typeof before) => ({
    used: a.used,
    reserved: a.reserved,
    granted: a.granted,
  });
  writeFileSync(
    `.cache/hr-final/active-leave-${info.project.name}.json`,
    JSON.stringify(
      {
        illustrative: true,
        date,
        before: balance(before),
        after: balance(
          after.accounts.find((a: { type: string }) => a.type === "ANNUAL"),
        ),
        lock: cell.lock,
        rosterRefusal: refusal.value.error.code,
        approval:
          "BLOCKED: SELF_REVIEW, only one verified real account authorized",
        status: "PENDING",
        uiSubmitted: true,
      },
      null,
      2,
    ),
  );
  info.annotations.push({
    type: "acceptance-gap",
    description:
      "Approval/balance consumption/attendance proof BLOCKED: second verified real reviewer unavailable. Submission and claim locking passed only.",
  });
});
