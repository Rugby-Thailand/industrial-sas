import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { makeFunctionReference } from "convex/server";
import type { Id } from "../../../convex/_generated/dataModel";
import type { TenantFunctionOutcome } from "../../../convex/lib/tenantFunctions";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "../../fixtures/convex-tenant-world";

// Cross-lane regression for the combined integration branch: the foundation
// org-field protocol (legacy fieldwise preservation, replaceOrgFields) and the
// slice-03 lifecycle/profile/payment commands write the same hrEmployees row.
// Every call goes through the registered function reference, so Convex's
// argument validators run too. Nothing is mocked; no browser or deployment.

const ADMIN = { subject: "user_fixture_a", org_id: "org_fixture_a" };
// 2026-10-20 10:00 in Bangkok.
const NOW = Date.UTC(2026, 9, 20, 3);
const TODAY = "2026-10-20";
let sequence = 0;
const requestId = () => `combined-request-${++sequence}`;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

async function fixture() {
  const world = await createConvexTenantWorld({
    "../convex/hr/org.ts": () => import("../../../convex/hr/org"),
    "../convex/hr/setup.ts": () => import("../../../convex/hr/setup"),
    "../convex/hr/employeeProfile.ts": () =>
      import("../../../convex/hr/employeeProfile"),
  });
  await seedConvexAuthorization(world, {
    roleA: "HR_ADMIN",
    roleB: "HR_ADMIN",
  });
  return world;
}

async function mutate(world: ConvexTenantWorld, name: string, args: object) {
  const out = (await world.t
    .withIdentity(ADMIN)
    .mutation(
      makeFunctionReference<"mutation">(name),
      args as never,
    )) as TenantFunctionOutcome<any>;
  expect(out.ok, JSON.stringify(out)).toBe(true);
  return (out as { value: any }).value;
}
async function query(world: ConvexTenantWorld, name: string, args: object) {
  const out = (await world.t
    .withIdentity(ADMIN)
    .query(
      makeFunctionReference<"query">(name),
      args as never,
    )) as TenantFunctionOutcome<any>;
  expect(out.ok, JSON.stringify(out)).toBe(true);
  return (out as { value: any }).value;
}
async function written(world: ConvexTenantWorld, name: string, args: object) {
  const value = await mutate(world, name, { ...args, requestId: requestId() });
  expect(value, JSON.stringify(value)).toMatchObject({ written: true });
  return value as { documentId: string };
}

const address = {
  address: "123 Registered Road",
  province: "Bangkok",
  district: "Bang Rak",
  subDistrict: "Silom",
  postcode: "10500",
};

async function orgFields(world: ConvexTenantWorld) {
  const departmentId = (
    await written(world, "hr/org:saveDepartment", {
      name: "Sales",
      status: "ACTIVE",
    })
  ).documentId as Id<"hrDepartments">;
  const positionId = (
    await written(world, "hr/org:savePosition", {
      name: "Salesperson",
      status: "ACTIVE",
    })
  ).documentId as Id<"hrPositions">;
  const branchId = (
    await written(world, "hr/org:saveBranch", {
      ...address,
      name: "Head office",
      revenueBranchNo: "00000",
      ssoEmployerAccount: "123-45",
      type: "HEAD_OFFICE",
      status: "ACTIVE",
    })
  ).documentId as Id<"hrBranches">;
  const levelId = (
    await written(world, "hr/org:saveLevel", {
      name: "Staff",
      sortOrder: 0,
      status: "ACTIVE",
    })
  ).documentId as Id<"hrPositionLevels">;
  return {
    branchId,
    departmentId,
    positionId,
    levelId,
    employmentType: "FIXED_TERM" as const,
    probationEndDate: "2026-04-01",
  };
}

const base = (world: ConvexTenantWorld) => ({
  warehouseId: world.warehouses.alphaA,
  code: "E001",
  displayName: "Employee E001",
  employmentStartDate: "2026-01-05",
});
const stored = (world: ConvexTenantWorld, id: Id<"hrEmployees">) =>
  world.t.run((ctx) => ctx.db.get(id));
const privateRows = (world: ConvexTenantWorld) =>
  world.t.run(async (ctx) => ({
    profiles: await ctx.db.query("hrEmployeeProfiles").collect(),
    payments: await ctx.db.query("hrEmployeePayments").collect(),
  }));
async function codes(
  world: ConvexTenantWorld,
  status?: "ACTIVE" | "INACTIVE" | "PROBATION" | "FORMER" | "ALL",
) {
  let scanCursor: string | undefined;
  for (let guard = 0; guard < 50; guard += 1) {
    const page = await query(world, "hr/setup:employeesPage", {
      ...(status === undefined ? {} : { status }),
      ...(scanCursor === undefined ? {} : { scanCursor }),
    });
    expect(page.ok, JSON.stringify(page)).toBe(true);
    if (page.status === "scanning") {
      scanCursor = page.scanCursor;
      continue;
    }
    expect(page.isDone).toBe(true);
    return {
      json: JSON.stringify(page),
      codes: page.page.map((item: { code: string }) => item.code),
    };
  }
  throw new Error("scan did not settle");
}

it("combined: legacy saves and lifecycle commands keep all six org fields, private details and one version sequence", async () => {
  const world = await fixture();
  const fields = await orgFields(world);
  const employeeId = (
    await written(world, "hr/setup:saveEmployee", {
      ...base(world),
      ...fields,
      status: "ACTIVE",
      replaceOrgFields: true,
    })
  ).documentId as Id<"hrEmployees">;

  await written(world, "hr/employeeProfile:saveEmployeeProfile", {
    employeeId,
    expectedVersion: 0,
    firstName: "Somchai",
    phone: "02 123 4567",
  });
  await written(world, "hr/employeeProfile:saveEmployeePayment", {
    employeeId,
    expectedVersion: 0,
    method: "BANK",
    bankName: "Example Bank",
    accountNumber: "9876543210",
    accountName: "Somchai",
  });
  const privateBefore = await privateRows(world);
  // Profile/payment rows are separate: the employee row version is untouched.
  expect(await stored(world, employeeId)).toMatchObject({ version: 1 });

  await written(world, "hr/employeeProfile:recordEmploymentEvent", {
    employeeId,
    expectedVersion: 1,
    kind: "CONFIRM_PROBATION",
    effectiveDate: "2026-04-01",
  });
  expect(await stored(world, employeeId)).toMatchObject({
    ...fields,
    probationConfirmedDate: "2026-04-01",
    version: 2,
  });

  // An old client that knows neither org fields nor slice-03 fields.
  await written(world, "hr/setup:saveEmployee", {
    ...base(world),
    displayName: "Renamed by an old client",
    status: "INACTIVE",
    employeeId,
    expectedVersion: 2,
  });
  expect(await stored(world, employeeId)).toMatchObject({
    ...fields,
    displayName: "Renamed by an old client",
    status: "INACTIVE",
    probationConfirmedDate: "2026-04-01",
    version: 3,
  });

  await written(world, "hr/employeeProfile:recordEmploymentEvent", {
    employeeId,
    expectedVersion: 3,
    kind: "OFFBOARD",
    separationType: "RESIGNATION",
    effectiveDate: "2026-09-30",
    reason: "Moved to another city",
  });
  const offboarded = await stored(world, employeeId);
  expect(offboarded).toMatchObject({
    ...fields,
    status: "INACTIVE",
    employmentEndDate: "2026-09-30",
    separation: { type: "RESIGNATION", lastWorkingDate: "2026-09-30" },
    version: 4,
  });
  expect((await codes(world)).codes).toEqual([]);
  expect((await codes(world, "FORMER")).codes).toEqual(["E001"]);
  expect((await codes(world, "ALL")).codes).toEqual(["E001"]);
  expect((await codes(world, "INACTIVE")).codes).toEqual(["E001"]);

  // An old client cannot reactivate a separated record, even fieldwise.
  expect(
    await mutate(world, "hr/setup:saveEmployee", {
      ...base(world),
      status: "ACTIVE",
      employeeId,
      expectedVersion: 4,
      requestId: requestId(),
    }),
  ).toMatchObject({
    written: false,
    error: { code: "EMPLOYEE_SEPARATED", field: "status" },
  });
  expect(await stored(world, employeeId)).toEqual(offboarded);
  // Nor can a modern full replacement that drops the last working day.
  expect(
    await mutate(world, "hr/setup:saveEmployee", {
      ...base(world),
      ...fields,
      status: "INACTIVE",
      replaceOrgFields: true,
      employeeId,
      expectedVersion: 4,
      requestId: requestId(),
    }),
  ).toMatchObject({
    written: false,
    error: { code: "EMPLOYEE_SEPARATED", field: "employmentEndDate" },
  });
  expect(await stored(world, employeeId)).toEqual(offboarded);

  // A legacy edit that keeps the separation still preserves every org field.
  await written(world, "hr/setup:saveEmployee", {
    ...base(world),
    displayName: "Former employee",
    status: "INACTIVE",
    employmentEndDate: "2026-09-30",
    employeeId,
    expectedVersion: 4,
  });
  expect(await stored(world, employeeId)).toMatchObject({
    ...fields,
    separation: { type: "RESIGNATION", lastWorkingDate: "2026-09-30" },
    version: 5,
  });

  vi.setSystemTime(NOW + 1000);
  await written(world, "hr/employeeProfile:recordEmploymentEvent", {
    employeeId,
    expectedVersion: 5,
    kind: "REINSTATE",
    effectiveDate: TODAY,
    reason: "Rehired",
  });
  const reinstated = await stored(world, employeeId);
  expect(reinstated).toMatchObject({ ...fields, status: "ACTIVE", version: 6 });
  expect(reinstated).not.toHaveProperty("separation");
  expect(reinstated).not.toHaveProperty("employmentEndDate");
  const current = await codes(world);
  expect(current.codes).toEqual(["E001"]);
  expect((await codes(world, "FORMER")).codes).toEqual([]);

  // Registry reads never carry private profile or payment values.
  expect(current.json).not.toContain("9876543210");
  expect(current.json).not.toContain("02 123 4567");
  expect(await privateRows(world)).toEqual(privateBefore);

  const history = await world.t.run((ctx) =>
    ctx.db.query("hrEmploymentEvents").collect(),
  );
  expect(history.map((row) => row.employeeVersion)).toEqual([2, 4, 6]);

  // After the lifecycle, a modern replacement can still clear optional
  // fields while required assignments remain enforced for ACTIVE.
  await written(world, "hr/setup:saveEmployee", {
    ...base(world),
    departmentId: fields.departmentId,
    positionId: fields.positionId,
    status: "ACTIVE",
    replaceOrgFields: true,
    employeeId,
    expectedVersion: 6,
  });
  const cleared = await stored(world, employeeId);
  expect(cleared).toMatchObject({
    departmentId: fields.departmentId,
    positionId: fields.positionId,
    probationConfirmedDate: "2026-04-01",
    version: 7,
  });
  for (const field of [
    "branchId",
    "levelId",
    "employmentType",
    "probationEndDate",
  ])
    expect(cleared).not.toHaveProperty(field);
});
