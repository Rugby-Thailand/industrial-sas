import { randomUUID } from "node:crypto";

import type { Page } from "@playwright/test";

import { HR_TEST_IDENTITY } from "../../../scripts/lib/hr-e2e-env.mjs";
import { test, expect, convexAs } from "./fixtures";
import { localRun } from "./setup";

type RoleKey = "ORG_ADMIN" | "HR_ADMIN" | "HR_SUPERVISOR" | "HR_EMPLOYEE";
const ADMIN_GRANTS: RoleKey[] = ["ORG_ADMIN", "HR_ADMIN", "HR_EMPLOYEE"];

const setRoles = (roleKeys: RoleKey[]) =>
  localRun("staging/hrDemo:setLocalTestRoles", {
    clerkUserId: HR_TEST_IDENTITY.userId,
    clerkOrganizationId: HR_TEST_IDENTITY.organizationId,
    roleKeys,
    confirmation: "LOCAL_HR_FIXTURES_V1",
  }) as { previous: RoleKey[] };

/**
 * Lowers ONLY the local tenant grants of the same genuine Clerk identity for
 * one test, then restores the exact previous grants even when it fails.
 */
async function asLocalRoles(roleKeys: RoleKey[], body: () => Promise<void>) {
  const { previous } = setRoles(roleKeys);
  expect([...previous].sort()).toEqual([...ADMIN_GRANTS].sort());
  try {
    await body();
  } finally {
    const restored = setRoles(previous);
    expect([...restored.previous].sort()).toEqual([...roleKeys].sort());
  }
}

/** The real backend's authorization denial, returned or thrown; not a mock. */
async function denial(call: Promise<unknown>) {
  try {
    const result = (await call) as {
      ok?: boolean;
      denial?: { kind?: string };
    };
    return result.ok === false && result.denial
      ? result.denial.kind
      : "ALLOWED";
  } catch (error) {
    return (error as { data?: { kind?: string } }).data?.kind ?? "THREW";
  }
}

async function expectAdminDenied(page: Page) {
  const api = await convexAs(page);
  expect(
    await denial(
      api.query("hr/setup:employeesPage", { search: "", pageSize: 20 }),
    ),
  ).toBe("AUTHORIZATION_DENIED");
  expect(await denial(api.query("hr/org:getCompanyProfile"))).toBe(
    "AUTHORIZATION_DENIED",
  );
  const name = `Denied department ${randomUUID().slice(0, 8)}`;
  expect(
    await denial(
      api.mutation("hr/org:saveDepartment", {
        requestId: randomUUID(),
        name,
        status: "ACTIVE",
      }),
    ),
  ).toBe("AUTHORIZATION_DENIED");
  for (const path of ["/en/hr/employees", "/en/hr/settings"]) {
    await page.goto(path);
    await expect(page.getByTestId("hr-denied")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Add employee", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByTestId("hr-company-form")).toHaveCount(0);
  }
  return name;
}

async function expectSelfService(page: Page) {
  await page.goto("/en/hr/today");
  await expect(
    page.getByRole("heading", { name: "My day", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("hr-denied")).toHaveCount(0);
  const today = await (await convexAs(page)).query("hr/self:today");
  expect(today.ok).toBe(true);
  expect(today.value.employee.code).toBe("EMP-DEMO-001");
}

async function expectRestoredAdmin(page: Page, deniedDepartment: string) {
  await page.goto("/en/hr/employees");
  await expect(
    page.getByRole("button", { name: "Add employee", exact: true }),
  ).toBeVisible();
  const departments = await (
    await convexAs(page)
  ).query("hr/org:listDepartments");
  expect(departments.ok).toBe(true);
  expect(JSON.stringify(departments.value)).not.toContain(deniedDepartment);
}

test("roles HR employee keeps self-service while real backend denies admin reads, writes and pages", async ({
  page,
}) => {
  let denied = "";
  await asLocalRoles(["HR_EMPLOYEE"], async () => {
    await expectSelfService(page);
    const api = await convexAs(page);
    expect(
      await denial(
        api.query("hr/review:queue", { from: "2026-01-01", to: "2026-01-02" }),
      ),
    ).toBe("AUTHORIZATION_DENIED");
    await page.goto("/en/hr/review");
    await expect(page.getByTestId("hr-denied")).toBeVisible();
    denied = await expectAdminDenied(page);
  });
  await expectRestoredAdmin(page, denied);
});

test("roles HR supervisor reviews team attendance but stays denied for HR administration", async ({
  page,
}) => {
  let denied = "";
  await asLocalRoles(["HR_SUPERVISOR", "HR_EMPLOYEE"], async () => {
    await expectSelfService(page);
    await page.goto("/en/hr/review");
    await expect(
      page.getByRole("heading", { name: "Review attendance", exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("hr-denied")).toHaveCount(0);
    const today = (await (await convexAs(page)).query("hr/self:today")).value
      .today as string;
    const queue = await (
      await convexAs(page)
    ).query("hr/review:queue", { from: today, to: today });
    expect(queue.ok).toBe(true);
    denied = await expectAdminDenied(page);
  });
  await expectRestoredAdmin(page, denied);
});
