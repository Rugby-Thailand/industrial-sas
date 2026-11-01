import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { makeFunctionReference } from "convex/server";
import type {
  GenericMutationCtx,
  RegisteredMutation,
  RegisteredQuery,
} from "convex/server";
import type { Id } from "../../../convex/_generated/dataModel";
import type { DataModel } from "../../../convex/schema";
import type { TenantFunctionOutcome } from "../../../convex/lib/tenantFunctions";
import * as org from "../../../convex/hr/org";
import * as setup from "../../../convex/hr/setup";
import * as recovery from "../../../convex/hr/recovery";
import * as payslips from "../../../convex/hr/payslips";
import { pdfHash } from "../../../convex/model/hr/payslip";
import {
  POLICY_PRESET,
  thailandDefaults,
} from "../../../convex/model/hr/policy";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  seedSecondActorForOrgA,
  type ConvexTenantWorld,
} from "../../fixtures/convex-tenant-world";

const ADMIN = { subject: "user_fixture_a", org_id: "org_fixture_a" };
const TENANT_B = { ...ADMIN, org_id: "org_fixture_b" };
const NOW = Date.UTC(2026, 9, 20, 3);
let sequence = 0;
const requestId = () => `s01-request-${++sequence}`;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function fixture() {
  const world = await createConvexTenantWorld({
    "../convex/hr/org.ts": () => import("../../../convex/hr/org"),
  });
  await seedConvexAuthorization(world, {
    roleA: "HR_ADMIN",
    roleB: "HR_ADMIN",
  });
  return world;
}
async function call<A extends Record<string, unknown>, R>(
  world: ConvexTenantWorld,
  fn:
    | RegisteredMutation<"public", A, TenantFunctionOutcome<R>>
    | RegisteredQuery<"public", A, TenantFunctionOutcome<R>>,
  args: A,
  identity = ADMIN,
): Promise<R> {
  const out = await world.t.withIdentity(identity).run((ctx) =>
    (
      fn as unknown as {
        _handler: (
          ctx: GenericMutationCtx<DataModel>,
          args: A,
        ) => Promise<TenantFunctionOutcome<R>>;
      }
    )._handler(ctx, args),
  );
  expect(out.ok, JSON.stringify(out)).toBe(true);
  if (!out.ok) throw new Error("Unexpected authorization denial");
  return out.value;
}
function saved<T extends { written: boolean }>(
  result: T,
): Extract<T, { written: true }> {
  expect(result, JSON.stringify(result)).toMatchObject({ written: true });
  return result as Extract<T, { written: true }>;
}
const address = {
  address: "123 Registered Road",
  addressEn: "123 Road",
  province: "Bangkok",
  district: "Bang Rak",
  subDistrict: "Silom",
  postcode: "10500",
};
const company = {
  ...address,
  name: "Example Employer",
  nameEn: "Example Co.",
  taxId: "0105500000001",
  phone: "02-1234567",
  fax: "02-1234568",
  bankAccounts: [
    {
      bankName: "Example Bank",
      accountNo: "1234567890",
      accountName: "Example Employer",
    },
  ],
};
const branch = {
  ...address,
  name: "Head office",
  revenueBranchNo: "00000",
  ssoEmployerAccount: "123-45",
  type: "HEAD_OFFICE" as const,
  status: "ACTIVE" as const,
};
const employee = (world: ConvexTenantWorld, code = "E001") => ({
  warehouseId: world.warehouses.alphaA,
  code,
  displayName: code,
  employmentStartDate: "2026-01-01",
  status: "ACTIVE" as const,
});
async function masters(world: ConvexTenantWorld) {
  const departmentId = saved(
    await call(world, org.saveDepartment, {
      requestId: requestId(),
      name: "Sales",
      status: "ACTIVE",
    }),
  ).documentId as Id<"hrDepartments">;
  const positionId = saved(
    await call(world, org.savePosition, {
      requestId: requestId(),
      name: "Salesperson",
      status: "ACTIVE",
    }),
  ).documentId as Id<"hrPositions">;
  return { departmentId, positionId };
}
const storeSnapshot = (world: ConvexTenantWorld) =>
  world.t.run(async (ctx) => ({
    companies: await ctx.db.query("hrCompanyProfiles").collect(),
    logos: await ctx.db.query("hrCompanyLogos").collect(),
    branches: await ctx.db.query("hrBranches").collect(),
    employees: await ctx.db.query("hrEmployees").collect(),
    departments: await ctx.db.query("hrDepartments").collect(),
    positions: await ctx.db.query("hrPositions").collect(),
    levels: await ctx.db.query("hrPositionLevels").collect(),
  }));

// Proposed functional contracts for OUR app; none claims an observed HRZoft
// write or validation message. Unknown rows S01-24 and S01-25 intentionally
// have no tests; S01-20 is DUP → S06-13 (tested there). Field names (companyProfile, branch.branchCode / ssoBranchCode,
// employee.departmentId / positionId / levelId / supervisorUserId) are proposed.

/*
Given a company-profile save. When taxId is "0105500000001" (13 digits), then
accept it. When taxId is "010550000001" (12 digits), "01055000000011" (14),
or "010550000000A" (non-digit), then reject with a tax-ID format error and
persist no change. Digits only; no check-digit algorithm is asserted here.
HRZoft's exact error wording was not observed.
*/
it("[guess] S01-06 company tax ID is validated as exactly 13 digits", async () => {
  const world = await fixture();
  const create = { requestId: requestId(), ...company };
  saved(await call(world, org.saveCompanyProfile, create));
  expect(
    saved(await call(world, org.saveCompanyProfile, create)).replayed,
  ).toBe(true);
  for (const taxId of [
    "010550000001",
    "01055000000011",
    "010550000000A",
    "０１０５５０００００００１",
    " 0105500000001",
  ]) {
    const before = await storeSnapshot(world);
    expect(
      await call(world, org.saveCompanyProfile, {
        ...company,
        taxId,
        expectedVersion: 1,
        requestId: requestId(),
      }),
    ).toMatchObject({
      written: false,
      error: { code: "TAX_ID_INVALID", field: "taxId" },
    });
    expect(await storeSnapshot(world)).toEqual(before);
  }
  expect((await call(world, org.getCompanyProfile, {})).profile).toMatchObject(
    company,
  );
  expect(
    (await call(world, org.getCompanyProfile, {}, TENANT_B)).profile,
  ).toBeNull();
  expect(
    await call(world, org.saveCompanyProfile, {
      ...company,
      expectedVersion: 0,
      requestId: requestId(),
    }),
  ).toMatchObject({ written: false, error: { code: "COMPANY_PROFILE_STALE" } });
});

/*
Given a saved company profile with taxId, registered address and one bank
account, and a payroll/tax document built for that tenant. When the document
is produced, then it carries the employer tax ID, the registered address and
the bank account from the profile rather than blanks or hard-coded values.
This asserts the profile is the single source for employer identity; the exact
document layout belongs to payroll (slice out of scope).
*/
it("[guess] S01-07 company tax ID, address and bank flow into payroll/tax documents", async () => {
  const world = await fixture();
  vi.stubEnv("HR_PAYSLIP_PROVIDER_FRESHNESS_ENABLED", "true");
  vi.stubEnv("HR_PAYSLIP_PRIVATE_STORAGE_ENABLED", "true");
  const employeeId = saved(
    await call(world, setup.saveEmployee, {
      ...employee(world),
      userId: world.userA,
      requestId: requestId(),
    }),
  ).documentId as Id<"hrEmployees">;
  const base64 = btoa("%PDF-1.7\nOriginal employer statement\n%%EOF");
  const hash = await pdfHash(new TextEncoder().encode(atob(base64)));
  const rowId = await world.t.run(async (ctx) => {
    const policyVersionId = await ctx.db.insert("hrPolicyVersions", {
      orgId: world.orgA,
      capability: "PAYSLIPS",
      config: thailandDefaults(),
      effectiveDate: "2026-01-01",
      version: 1,
      draftVersion: 1,
      preset: POLICY_PRESET,
      coverageConfirmed: true,
      existingBenefitsReviewed: true,
      activatedAt: NOW,
      activatedByUserId: world.userA,
    });
    const importId = await ctx.db.insert("hrPayslipImports", {
      orgId: world.orgA,
      from: "2026-10-01",
      to: "2026-10-31",
      sourceName: "Payroll",
      sourceCsv: "",
      sourceHash: hash,
      status: "PUBLISHED",
      rowCount: 1,
      policyVersionId,
      createdAt: NOW,
      createdByUserId: world.userA,
    });
    return await ctx.db.insert("hrPayslipRows", {
      orgId: world.orgA,
      employeeId,
      employeeCode: "E001",
      importId,
      from: "2026-10-01",
      to: "2026-10-31",
      paymentDate: "2026-10-30",
      gross: 100,
      deductions: 0,
      net: 100,
      version: 1,
      publishedAt: NOW,
      sourceBase64: base64,
      sourceHash: hash,
      warehouseId: world.warehouses.alphaA,
      employeeName: "E001",
    });
  });
  const identity = {
    ...ADMIN,
    sid: "s01-session",
    iat: NOW / 1000,
    fva: [0, -1],
  };
  const ticket = saved(
    await call(
      world,
      payslips.ticket,
      { requestId: requestId(), rowId },
      identity,
    ),
  );
  const input = { requestId: requestId(), ticketId: ticket.documentId };
  expect(
    saved(await call(world, payslips.document, input, identity)),
  ).toMatchObject({ employer: null, base64, sha256: hash });
  saved(
    await call(world, org.saveCompanyProfile, {
      ...company,
      requestId: requestId(),
    }),
  );
  const employer = {
    name: company.name,
    taxId: company.taxId,
    ...address,
    primaryBankAccount: company.bankAccounts[0],
  };
  expect(
    saved(await call(world, payslips.document, input, identity)),
  ).toMatchObject({ employer, base64, sha256: hash, replayed: true });
  saved(
    await call(world, org.saveCompanyProfile, {
      ...company,
      bankAccounts: [],
      expectedVersion: 1,
      requestId: requestId(),
    }),
  );
  expect(
    saved(
      await call(
        world,
        payslips.document,
        { ...input, requestId: requestId() },
        identity,
      ),
    ).employer,
  ).toMatchObject({ primaryBankAccount: null });
});

/*
Given a branch save. When the Revenue-Department branch number is "00000"
(head office) or "00012" (a 5-digit branch), then accept it. When it is "12"
or "ABCDE", then reject with a branch-number format error. When the SSO
employer account is empty, then reject as required. On any rejection persist
no change. Thai Revenue branch numbers are 5 digits (00000 = head office);
the SSO employer-account format is treated as required, non-empty.
*/
it("[guess] S01-11 branch Revenue and SSO codes are required and format-checked", async () => {
  const world = await fixture();
  const branchId = saved(
    await call(world, org.saveBranch, {
      ...branch,
      ssoEmployerAccount: " 123-45 ",
      requestId: requestId(),
    }),
  ).documentId as Id<"hrBranches">;
  saved(
    await call(world, org.saveBranch, {
      ...branch,
      name: "Branch 12",
      revenueBranchNo: "00012",
      type: "BRANCH",
      requestId: requestId(),
    }),
  );
  for (const [patch, code] of [
    [{ revenueBranchNo: "00012" }, "BRANCH_TYPE_MISMATCH"],
    [{ type: "BRANCH" }, "BRANCH_TYPE_MISMATCH"],
    [{ revenueBranchNo: "12" }, "REVENUE_BRANCH_NO_INVALID"],
    [{ revenueBranchNo: "ABCDE" }, "REVENUE_BRANCH_NO_INVALID"],
    [{ ssoEmployerAccount: " " }, "SSO_EMPLOYER_ACCOUNT_REQUIRED"],
    [{ ssoEmployerAccount: "abc" }, "SSO_EMPLOYER_ACCOUNT_INVALID"],
    [{ ssoEmployerAccount: "1".repeat(21) }, "SSO_EMPLOYER_ACCOUNT_INVALID"],
  ] as const) {
    const before = await storeSnapshot(world);
    expect(
      await call(world, org.saveBranch, {
        ...branch,
        ...patch,
        branchId,
        expectedVersion: 1,
        requestId: requestId(),
      }),
    ).toMatchObject({ written: false, error: { code } });
    expect(await storeSnapshot(world)).toEqual(before);
  }
  for (const patch of [
    { revenueBranchNo: "00002" },
    { type: "BRANCH" as const },
  ]) {
    const before = await storeSnapshot(world);
    expect(
      await call(world, org.saveBranch, {
        ...branch,
        ...patch,
        requestId: requestId(),
      }),
    ).toMatchObject({
      written: false,
      error: { code: "BRANCH_TYPE_MISMATCH", field: "type" },
    });
    expect(await storeSnapshot(world)).toEqual(before);
  }
  expect(
    await call(world, org.saveBranch, { ...branch, requestId: requestId() }),
  ).toMatchObject({
    written: false,
    error: { code: "REVENUE_BRANCH_NO_TAKEN" },
  });
  expect((await call(world, org.listBranches, {})).items).toHaveLength(2);
  expect((await call(world, org.listBranches, {}, TENANT_B)).items).toEqual([]);
});

/*
Given an active branch B1 and an inactive branch B2, and an employee currently
assigned to B2. When listing branch options for a NEW assignment, then B1 is
offered and B2 is not. When reading the existing employee, then B2 still
resolves to its name/codes (history is not broken) and the employee remains
valid. Deactivating a branch must not silently reassign or orphan employees.
Mirrors our HrSiteSelect includeInactive behavior; HRZoft behavior unverified.
*/
it("[guess] S01-12 an inactive branch is hidden from new assignment but kept for history", async () => {
  const world = await fixture();
  const branchId = saved(
    await call(world, org.saveBranch, { ...branch, requestId: requestId() }),
  ).documentId as Id<"hrBranches">;
  const b1 = saved(
    await call(world, org.saveBranch, {
      ...branch,
      name: "Active branch",
      revenueBranchNo: "00001",
      type: "BRANCH",
      requestId: requestId(),
    }),
  ).documentId;
  const assignments = await masters(world);
  const levelId = saved(
    await call(world, org.saveLevel, {
      name: "Staff",
      sortOrder: 2,
      status: "ACTIVE",
      requestId: requestId(),
    }),
  ).documentId as Id<"hrPositionLevels">;
  const args = {
    ...employee(world),
    ...assignments,
    branchId,
    levelId,
    employmentType: "FIXED_TERM" as const,
    probationEndDate: "2026-12-31",
  };
  const employeeId = saved(
    await call(world, setup.saveEmployee, { ...args, requestId: requestId() }),
  ).documentId as Id<"hrEmployees">;
  const before = await world.t.run((ctx) => ctx.db.get(employeeId));
  saved(
    await call(world, org.saveBranch, {
      ...branch,
      branchId,
      status: "INACTIVE",
      expectedVersion: 1,
      requestId: requestId(),
    }),
  );
  saved(
    await call(world, org.saveDepartment, {
      departmentId: assignments.departmentId,
      name: "Sales",
      status: "INACTIVE",
      expectedVersion: 1,
      requestId: requestId(),
    }),
  );
  saved(
    await call(world, org.savePosition, {
      positionId: assignments.positionId,
      name: "Salesperson",
      status: "INACTIVE",
      expectedVersion: 1,
      requestId: requestId(),
    }),
  );
  saved(
    await call(world, org.saveLevel, {
      levelId,
      name: "Staff",
      sortOrder: 2,
      status: "INACTIVE",
      expectedVersion: 1,
      requestId: requestId(),
    }),
  );
  expect(await world.t.run((ctx) => ctx.db.get(employeeId))).toEqual(before);
  expect(
    (await call(world, org.branchOptions, {})).items.map((row) => row.id),
  ).toEqual([b1]);
  expect(
    (await call(world, org.branchOptions, { currentId: branchId })).items.map(
      (row) => row.id,
    ),
  ).toContain(branchId);
  expect((await call(world, org.departmentOptions, {})).items).toEqual([]);
  expect(
    (
      await call(world, org.departmentOptions, {
        currentId: assignments.departmentId,
      })
    ).items,
  ).toHaveLength(1);
  expect((await call(world, org.positionOptions, {})).items).toEqual([]);
  expect(
    (
      await call(world, org.positionOptions, {
        currentId: assignments.positionId,
      })
    ).items,
  ).toHaveLength(1);
  expect((await call(world, org.levelOptions, {})).items).toEqual([]);
  expect(
    (await call(world, org.levelOptions, { currentId: levelId })).items,
  ).toHaveLength(1);
  expect(await call(world, setup.employee, { employeeId })).toMatchObject({
    employee: {
      branchId,
      branchName: "Head office",
      branchRevenueBranchNo: "00000",
      branchSsoEmployerAccount: "123-45",
      departmentName: "Sales",
      positionName: "Salesperson",
      levelName: "Staff",
      employmentType: "FIXED_TERM",
      probationEndDate: "2026-12-31",
    },
  });
  saved(
    await call(world, setup.saveEmployee, {
      ...args,
      employeeId,
      expectedVersion: 1,
      requestId: requestId(),
    }),
  );
  for (const field of [
    "branchId",
    "departmentId",
    "positionId",
    "levelId",
  ] as const) {
    const snapshot = await storeSnapshot(world);
    expect(
      await call(world, setup.saveEmployee, {
        ...employee(world, `NEW-${field}`),
        [field]: args[field],
        requestId: requestId(),
      }),
    ).toMatchObject({
      written: false,
      error: { code: "ORG_REFERENCE_UNAVAILABLE", field },
    });
    expect(await storeSnapshot(world)).toEqual(snapshot);
  }
});

/*
Given an ACTIVE employee save on a tenant that has departments and positions. When
departmentId or positionId is missing, then reject with a required-field error
for that field and persist no change. When both reference existing master rows
in the tenant, then accept. Compatibility decision (2026-11-01, unconfirmed
P1-2): an ACTIVE employee saved before masters existed may keep saving without
them; the requirement applies on create, on becoming ACTIVE, and once a value
is held (it cannot be cleared). Department and position are required (both shown
with "*" in HRZoft's Employment-info editor); level and supervisor are optional.
*/
it("[guess] S01-19 department and position are required to save an employee", async () => {
  const world = await fixture();
  // Legacy organizations without masters remain valid.
  const legacyId = saved(
    await call(world, setup.saveEmployee, {
      ...employee(world, "LEGACY"),
      requestId: requestId(),
    }),
  ).documentId as Id<"hrEmployees">;
  const assignments = await masters(world);
  // Compatibility: an ACTIVE employee saved before masters existed keeps
  // saving unchanged; adding masters does not force a migration.
  saved(
    await call(world, setup.saveEmployee, {
      ...employee(world, "LEGACY"),
      displayName: "Legacy renamed",
      employeeId: legacyId,
      expectedVersion: 1,
      requestId: requestId(),
    }),
  );
  // Once assigned, the department cannot be cleared from an ACTIVE employee.
  const legacyDepartmentId = saved(
    await call(world, org.saveDepartment, {
      requestId: requestId(),
      name: "Operations",
      status: "ACTIVE",
    }),
  ).documentId as Id<"hrDepartments">;
  saved(
    await call(world, setup.saveEmployee, {
      ...employee(world, "LEGACY"),
      departmentId: legacyDepartmentId,
      positionId: assignments.positionId,
      employeeId: legacyId,
      expectedVersion: 2,
      requestId: requestId(),
    }),
  );
  const assignedSnapshot = await storeSnapshot(world);
  expect(
    await call(world, setup.saveEmployee, {
      ...employee(world, "LEGACY"),
      positionId: assignments.positionId,
      employeeId: legacyId,
      expectedVersion: 3,
      requestId: requestId(),
    }),
  ).toMatchObject({
    written: false,
    error: { code: "DEPARTMENT_REQUIRED", field: "departmentId" },
  });
  expect(await storeSnapshot(world)).toEqual(assignedSnapshot);
  const inactiveId = saved(
    await call(world, setup.saveEmployee, {
      ...employee(world, "INACTIVE"),
      status: "INACTIVE",
      requestId: requestId(),
    }),
  ).documentId as Id<"hrEmployees">;
  saved(
    await call(world, setup.saveEmployee, {
      ...employee(world, "INACTIVE"),
      employeeId: inactiveId,
      expectedVersion: 1,
      status: "INACTIVE",
      requestId: requestId(),
    }),
  );
  const inactiveSnapshot = await storeSnapshot(world);
  expect(
    await call(world, setup.saveEmployee, {
      ...employee(world, "INACTIVE"),
      employeeId: inactiveId,
      expectedVersion: 2,
      status: "ACTIVE",
      requestId: requestId(),
    }),
  ).toMatchObject({ written: false, error: { code: "DEPARTMENT_REQUIRED" } });
  expect(await storeSnapshot(world)).toEqual(inactiveSnapshot);
  for (const [refs, code, field] of [
    [{}, "DEPARTMENT_REQUIRED", "departmentId"],
    [
      { departmentId: assignments.departmentId },
      "POSITION_REQUIRED",
      "positionId",
    ],
  ] as const) {
    const before = await storeSnapshot(world);
    expect(
      await call(world, setup.saveEmployee, {
        ...employee(world),
        ...refs,
        requestId: requestId(),
      }),
    ).toMatchObject({ written: false, error: { code, field } });
    expect(await storeSnapshot(world)).toEqual(before);
  }
  const args = {
    ...employee(world),
    ...assignments,
    employmentType: "PERMANENT" as const,
    probationEndDate: "2026-04-01",
  };
  const employeeId = saved(
    await call(world, setup.saveEmployee, { ...args, requestId: requestId() }),
  ).documentId as Id<"hrEmployees">;
  const before = await storeSnapshot(world);
  expect(
    await call(world, setup.saveEmployee, {
      ...args,
      probationEndDate: "2026-02-30",
      employeeId,
      expectedVersion: 1,
      requestId: requestId(),
    }),
  ).toMatchObject({
    written: false,
    error: { code: "EMPLOYMENT_DATE_INVALID", field: "probationEndDate" },
  });
  expect(await storeSnapshot(world)).toEqual(before);
  const otherDepartment = saved(
    await call(
      world,
      org.saveDepartment,
      { name: "Other", status: "ACTIVE", requestId: requestId() },
      TENANT_B,
    ),
  ).documentId as Id<"hrDepartments">;
  const beforeForeignSave = await storeSnapshot(world);
  expect(
    await call(world, setup.saveEmployee, {
      ...args,
      departmentId: otherDepartment,
      employeeId,
      expectedVersion: 1,
      requestId: requestId(),
    }),
  ).toMatchObject({
    written: false,
    error: { code: "ORG_REFERENCE_UNAVAILABLE", field: "departmentId" },
  });
  expect(await storeSnapshot(world)).toEqual(beforeForeignSave);
  const page = await call(world, setup.employeesPage, {
    pageSize: 20,
    departmentId: assignments.departmentId,
  });
  expect(page).toMatchObject({
    ok: true,
    page: [
      { id: employeeId, departmentName: "Sales", positionName: "Salesperson" },
    ],
  });
  expect(
    (await call(world, setup.listEmployees, { departmentId: otherDepartment }))
      .items,
  ).toEqual([]);
  expect(
    (
      await call(world, setup.listEmployees, {
        departmentId: assignments.departmentId,
      })
    ).items.map((row) => row.id),
  ).toEqual([employeeId]);
});

/*
Given an employee E001 whose linked account is U1. When saving with
supervisorUserId = U1 (its own account), then reject with a self-supervision
error. When supervisorUserId references an inactive or non-member user, then
reject as an invalid supervisor. When it references an active member other than
U1, then accept. This matches our existing saveEmployee rule; HRZoft's wording
and inactivity handling were not observed.
*/
it("[guess] S01-21 supervisor must be an active member and cannot be the employee's own account", async () => {
  const world = await fixture();
  const supervisor = await seedSecondActorForOrgA(world, "HR_SUPERVISOR");
  const notMember = await world.t.run((ctx) =>
    ctx.db.insert("users", {
      clerkUserId: "not-member",
      displayName: "Not member",
      status: "ACTIVE",
    }),
  );
  const args = { ...employee(world), userId: world.userA };
  for (const [supervisorUserId, code] of [
    [world.userA, "SELF_SUPERVISOR"],
    [notMember, "SUPERVISOR_UNAVAILABLE"],
  ] as const) {
    const before = await storeSnapshot(world);
    expect(
      await call(world, setup.saveEmployee, {
        ...args,
        supervisorUserId,
        requestId: requestId(),
      }),
    ).toMatchObject({
      written: false,
      error: { code, field: "supervisorUserId" },
    });
    expect(await storeSnapshot(world)).toEqual(before);
  }
  await world.t.run((ctx) =>
    ctx.db.patch(supervisor.membershipId, { status: "SUSPENDED" }),
  );
  expect(
    await call(world, setup.saveEmployee, {
      ...args,
      supervisorUserId: supervisor.userId,
      requestId: requestId(),
    }),
  ).toMatchObject({
    written: false,
    error: { code: "SUPERVISOR_UNAVAILABLE" },
  });
  await world.t.run((ctx) =>
    ctx.db.patch(supervisor.membershipId, { status: "ACTIVE" }),
  );
  saved(
    await call(world, setup.saveEmployee, {
      ...args,
      supervisorUserId: supervisor.userId,
      requestId: requestId(),
    }),
  );
});

/*
Given department Sales with employees E001, E003 and E004; E002 is the
supervisor of E001 and E003 and also the responsible manager of department
Sales. When deriving E002's management view, then responsible departments
contains exactly "Sales" and subordinates contains exactly {E001, E003}
(not E004, who reports elsewhere), each listed once. Mirrors HRZoft's employee
filters "แผนกที่รับผิดชอบ (D)" and "ใต้บังคับบัญชา (S)".
*/
it("[guess] S01-22 a manager's responsible departments and subordinates are derived from the reporting line", async () => {
  const world = await fixture();
  const assignments = await masters(world);
  const managerId = saved(
    await call(world, setup.saveEmployee, {
      ...employee(world, "E002"),
      ...assignments,
      userId: world.userA,
      requestId: requestId(),
    }),
  ).documentId as Id<"hrEmployees">;
  saved(
    await call(world, org.saveDepartment, {
      departmentId: assignments.departmentId,
      name: "Sales",
      managerEmployeeId: managerId,
      status: "ACTIVE",
      expectedVersion: 1,
      requestId: requestId(),
    }),
  );
  const subordinateIds = [];
  for (const code of ["E001", "E003", "E004"]) {
    const receipt = saved(
      await call(world, setup.saveEmployee, {
        ...employee(world, code),
        ...assignments,
        ...(code === "E004" ? {} : { supervisorUserId: world.userA }),
        requestId: requestId(),
      }),
    );
    if (code !== "E004") subordinateIds.push(receipt.documentId);
  }
  const view = await call(world, org.managementView, { employeeId: managerId });
  expect(view).toMatchObject({
    ok: true,
    responsibleDepartments: [{ id: assignments.departmentId, name: "Sales" }],
  });
  if (!view.ok) throw new Error("Missing manager");
  expect(view.responsibleDepartments.map((row) => row.id)).toEqual([
    assignments.departmentId,
  ]);
  expect(new Set(view.subordinates.map((row) => row.id)).size).toBe(
    view.subordinates.length,
  );
  expect(view.subordinates.map((row) => row.id).sort()).toEqual(
    subordinateIds.sort(),
  );
  expect(
    await call(world, org.managementView, { employeeId: managerId }, TENANT_B),
  ).toEqual({ ok: false, code: "NOT_FOUND" });
  const unlinked = view.subordinates[0]!;
  expect(
    await call(world, org.managementView, { employeeId: unlinked.id }),
  ).toMatchObject({ subordinates: [] });
});

/*
Given a tenant whose last employee code is "2400010" and whose code year is the
CE short year 24. When generating the next employee code, then produce
"2400011" (year prefix "24" + zero-padded 5-digit sequence). When a new CE year
begins (year 25), then the next generated code restarts the sequence as
"2500001". Observed codes 2400001–2400010; the exact prefix source and reset
rule are inferred from the data, not confirmed by a save.
*/
it("[guess] S01-23 employee code is generated as a year-prefixed running number", async () => {
  const world = await fixture();
  vi.setSystemTime(Date.UTC(2024, 11, 31, 16, 59, 59)); // CE 2024 in Bangkok.
  for (const code of [
    "2400001",
    "2400010",
    "249999X",
    "24999999",
    "2309999",
    "EMP-1",
  ])
    saved(
      await call(world, setup.saveEmployee, {
        ...employee(world, code),
        requestId: requestId(),
      }),
    );
  // A long run of editable, nonmatching codes must not hide the last valid
  // sequence from the suggestion query.
  await world.t.run(async (ctx) => {
    for (let index = 0; index < 110; index += 1) {
      await ctx.db.insert("hrEmployees", {
        ...employee(world, `2400010.X${index}`),
        orgId: world.orgA,
        version: 1,
        createdAt: NOW,
        updatedAt: NOW,
        createdByUserId: world.userA,
        updatedByUserId: world.userA,
      });
    }
  });
  expect(await call(world, org.suggestEmployeeCode, {})).toEqual({
    ok: true,
    code: "2400011",
  });
  expect(await call(world, org.suggestEmployeeCode, {}, TENANT_B)).toEqual({
    ok: true,
    code: "2400001",
  });
  // The suggestion remains editable and code uniqueness still applies.
  saved(
    await call(world, setup.saveEmployee, {
      ...employee(world, "CUSTOM-EDIT"),
      requestId: requestId(),
    }),
  );
  expect(
    await call(world, setup.saveEmployee, {
      ...employee(world, "2400010"),
      requestId: requestId(),
    }),
  ).toMatchObject({ written: false, error: { code: "EMPLOYEE_CODE_TAKEN" } });
  vi.setSystemTime(Date.UTC(2024, 11, 31, 17)); // Bangkok New Year, still Dec 31 UTC.
  expect(await call(world, org.suggestEmployeeCode, {})).toEqual({
    ok: true,
    code: "2500001",
  });
});

it("org masters enforce normalized uniqueness, versions, ordering and audit fields", async () => {
  const world = await fixture();
  const assignments = await masters(world);
  const before = await storeSnapshot(world);
  expect(
    await call(world, org.saveDepartment, {
      name: "  sALES  ",
      status: "ACTIVE",
      requestId: requestId(),
    }),
  ).toMatchObject({
    written: false,
    error: { code: "ORG_NAME_TAKEN", field: "name" },
  });
  expect(
    await call(world, org.savePosition, {
      name: " SALESPERSON ",
      status: "INACTIVE",
      requestId: requestId(),
    }),
  ).toMatchObject({ written: false, error: { code: "ORG_NAME_TAKEN" } });
  expect(await storeSnapshot(world)).toEqual(before);
  expect(
    await call(world, org.saveDepartment, {
      departmentId: assignments.departmentId,
      name: "Changed",
      status: "ACTIVE",
      expectedVersion: 0,
      requestId: requestId(),
    }),
  ).toMatchObject({ written: false, error: { code: "ORG_MASTER_STALE" } });
  saved(
    await call(world, org.saveLevel, {
      name: "Staff",
      sortOrder: 20,
      status: "ACTIVE",
      requestId: requestId(),
    }),
  );
  saved(
    await call(world, org.saveLevel, {
      name: "CEO",
      sortOrder: 0,
      status: "ACTIVE",
      requestId: requestId(),
    }),
  );
  expect(
    (await call(world, org.listLevels, {})).items.map((row) => row.name),
  ).toEqual(["CEO", "Staff"]);
  expect(
    (await call(world, org.levelOptions, {})).items.map((row) => row.name),
  ).toEqual(["CEO", "Staff"]);
  expect(
    await call(world, org.saveLevel, {
      name: " ceo ",
      sortOrder: 3,
      status: "INACTIVE",
      requestId: requestId(),
    }),
  ).toMatchObject({ written: false, error: { code: "ORG_NAME_TAKEN" } });
  expect(
    await call(world, org.saveLevel, {
      name: "Bad order",
      sortOrder: 1.5,
      status: "ACTIVE",
      requestId: requestId(),
    }),
  ).toMatchObject({
    written: false,
    error: { code: "LEVEL_SORT_ORDER_INVALID" },
  });
  const managerId = saved(
    await call(world, setup.saveEmployee, {
      ...employee(world),
      ...assignments,
      requestId: requestId(),
    }),
  ).documentId as Id<"hrEmployees">;
  saved(
    await call(world, org.saveDepartment, {
      departmentId: assignments.departmentId,
      name: " Sales ",
      nameEn: " Sales EN ",
      managerEmployeeId: managerId,
      status: "ACTIVE",
      expectedVersion: 1,
      requestId: requestId(),
    }),
  );
  expect((await call(world, org.listDepartments, {})).items).toMatchObject([
    {
      name: "Sales",
      nameEn: "Sales EN",
      managerEmployeeId: managerId,
      version: 2,
      createdByUserId: world.userA,
      updatedByUserId: world.userA,
      createdAt: NOW,
      updatedAt: NOW,
    },
  ]);
  saved(
    await call(world, org.saveDepartment, {
      departmentId: assignments.departmentId,
      name: "Sales",
      status: "ACTIVE",
      expectedVersion: 2,
      requestId: requestId(),
    }),
  );
  const cleared = (await call(world, org.listDepartments, {})).items[0]!;
  expect(cleared.managerEmployeeId).toBeUndefined();
  expect(cleared.nameEn).toBeUndefined();
  expect(
    (await call(world, org.listPositions, {})).items.map((row) => row.name),
  ).toEqual(["Salesperson"]);
  expect((await call(world, org.listDepartments, {}, TENANT_B)).items).toEqual(
    [],
  );
  expect((await call(world, org.listPositions, {}, TENANT_B)).items).toEqual(
    [],
  );
  expect((await call(world, org.listLevels, {}, TENANT_B)).items).toEqual([]);
});

it("rejects every foreign org assignment and hides foreign current options", async () => {
  const world = await fixture();
  const own = await masters(world);
  const departmentId = saved(
    await call(
      world,
      org.saveDepartment,
      { name: "Other department", status: "ACTIVE", requestId: requestId() },
      TENANT_B,
    ),
  ).documentId as Id<"hrDepartments">;
  const positionId = saved(
    await call(
      world,
      org.savePosition,
      { name: "Other position", status: "ACTIVE", requestId: requestId() },
      TENANT_B,
    ),
  ).documentId as Id<"hrPositions">;
  const branchId = saved(
    await call(
      world,
      org.saveBranch,
      { ...branch, requestId: requestId() },
      TENANT_B,
    ),
  ).documentId as Id<"hrBranches">;
  const levelId = saved(
    await call(
      world,
      org.saveLevel,
      {
        name: "Other level",
        sortOrder: 0,
        status: "ACTIVE",
        requestId: requestId(),
      },
      TENANT_B,
    ),
  ).documentId as Id<"hrPositionLevels">;
  const before = await storeSnapshot(world);
  for (const [field, id] of [
    ["departmentId", departmentId],
    ["positionId", positionId],
    ["branchId", branchId],
    ["levelId", levelId],
  ] as const) {
    expect(
      await call(world, setup.saveEmployee, {
        ...employee(world),
        ...own,
        [field]: id,
        requestId: requestId(),
      }),
    ).toMatchObject({
      written: false,
      error: { code: "ORG_REFERENCE_UNAVAILABLE", field },
    });
  }
  expect(await storeSnapshot(world)).toEqual(before);
  expect(
    (await call(world, org.branchOptions, { currentId: branchId })).items,
  ).toEqual([]);
  expect(
    (
      await call(world, org.departmentOptions, { currentId: departmentId })
    ).items.map((row) => row.id),
  ).not.toContain(departmentId);
  expect(
    (
      await call(world, org.positionOptions, { currentId: positionId })
    ).items.map((row) => row.id),
  ).not.toContain(positionId);
  expect(
    (await call(world, org.levelOptions, { currentId: levelId })).items,
  ).toEqual([]);
  expect(
    await call(world, org.saveBranch, {
      ...branch,
      branchId,
      expectedVersion: 1,
      requestId: requestId(),
    }),
  ).toMatchObject({ written: false, error: { code: "NOT_FOUND" } });
  expect(
    await call(world, org.saveDepartment, {
      name: "Foreign",
      departmentId,
      expectedVersion: 1,
      status: "ACTIVE",
      requestId: requestId(),
    }),
  ).toMatchObject({ written: false, error: { code: "NOT_FOUND" } });
});

it("requires HR administration for every org read and write", async () => {
  const world = await fixture();
  const actor = await seedSecondActorForOrgA(world, "HR_EMPLOYEE");
  const before = await storeSnapshot(world);
  for (const fn of [
    org.getCompanyProfile,
    org.saveCompanyProfile,
    org.getCompanyLogo,
    org.saveCompanyLogo,
    org.listBranches,
    org.saveBranch,
    org.branchOptions,
    org.listDepartments,
    org.saveDepartment,
    org.departmentOptions,
    org.listPositions,
    org.savePosition,
    org.positionOptions,
    org.listLevels,
    org.saveLevel,
    org.levelOptions,
    org.managementView,
    org.suggestEmployeeCode,
  ]) {
    const out = await world.t
      .withIdentity({ ...ADMIN, subject: actor.clerkUserId })
      .run((ctx) =>
        (
          fn as unknown as {
            _handler: (
              ctx: GenericMutationCtx<DataModel>,
              args: object,
            ) => Promise<TenantFunctionOutcome<unknown>>;
          }
        )._handler(ctx, {}),
      );
    expect(out).toMatchObject({
      ok: false,
      denial: { kind: "AUTHORIZATION_DENIED" },
    });
  }
  expect(await storeSnapshot(world)).toEqual(before);
  expect(
    await world.t.run((ctx) => ctx.db.query("hrCompanyLogos").collect()),
  ).toEqual([]);
});

it("company logos are tenant scoped, versioned, replayable and independently removable", async () => {
  const world = await fixture();
  expect(await call(world, org.getCompanyLogo, {})).toBeNull();
  const logo = { mimeType: "image/png", base64: btoa("\x89PNG\r\n\x1a\n") };
  const args = { ...logo, requestId: requestId() };
  const receipt = saved(await call(world, org.saveCompanyLogo, args));
  expect(saved(await call(world, org.saveCompanyLogo, args)).replayed).toBe(
    true,
  );
  expect(await call(world, org.getCompanyLogo, {})).toEqual(logo);
  expect(await call(world, org.getCompanyLogo, {}, TENANT_B)).toBeNull();
  // A logo may be saved before a profile; creating the profile derives presence.
  saved(
    await call(world, org.saveCompanyProfile, {
      ...company,
      requestId: requestId(),
    }),
  );
  const profile = (await call(world, org.getCompanyProfile, {})).profile!;
  expect(profile).toMatchObject({ hasLogo: true, version: 1 });
  expect(profile).not.toHaveProperty("logoUrl");
  expect(profile).not.toHaveProperty("base64");
  const jpeg = { mimeType: "image/jpeg", base64: btoa("\xff\xd8\xff") };
  const other = saved(
    await call(
      world,
      org.saveCompanyLogo,
      { ...jpeg, requestId: requestId() },
      TENANT_B,
    ),
  );
  expect(other.documentId).not.toBe(receipt.documentId);
  expect(await call(world, org.getCompanyLogo, {})).toEqual(logo);
  expect(await call(world, org.getCompanyLogo, {}, TENANT_B)).toEqual(jpeg);
  const replacement = {
    mimeType: "image/webp",
    base64: btoa("RIFF\x00\x00\x00\x00WEBP"),
  };
  saved(
    await call(world, org.saveCompanyLogo, {
      ...replacement,
      requestId: requestId(),
    }),
  );
  expect(await call(world, org.getCompanyLogo, {})).toEqual(replacement);
  expect(
    await world.t.run((ctx) =>
      ctx.db.get(receipt.documentId as Id<"hrCompanyLogos">),
    ),
  ).toMatchObject({
    ...replacement,
    orgId: world.orgA,
    version: 2,
    createdByUserId: world.userA,
    updatedByUserId: world.userA,
    createdAt: NOW,
    updatedAt: NOW,
  });
  const remove = { requestId: requestId(), remove: true as const };
  saved(await call(world, org.saveCompanyLogo, remove));
  expect(await call(world, org.getCompanyLogo, {})).toBeNull();
  expect((await call(world, org.getCompanyProfile, {})).profile).toMatchObject({
    hasLogo: false,
    version: 1,
  });
  // Replaying an old save/removal must not resurrect/delete a later logo.
  saved(await call(world, org.saveCompanyLogo, args));
  expect(await call(world, org.getCompanyLogo, {})).toBeNull();
  saved(
    await call(world, org.saveCompanyLogo, { ...logo, requestId: requestId() }),
  );
  expect(saved(await call(world, org.saveCompanyLogo, remove)).replayed).toBe(
    true,
  );
  expect(await call(world, org.getCompanyLogo, {})).toEqual(logo);
  expect((await call(world, org.getCompanyProfile, {})).profile?.hasLogo).toBe(
    true,
  );
  saved(
    await call(world, org.saveCompanyProfile, {
      ...company,
      expectedVersion: 1,
      requestId: requestId(),
    }),
  );
  expect(await call(world, org.getCompanyLogo, {})).toEqual(logo);
  const audits = await world.t.run((ctx) =>
    ctx.db.query("auditEvents").collect(),
  );
  for (const row of audits.filter((row) => row.action === "hr.org.logo.save")) {
    expect(JSON.stringify(row.changes)).not.toContain(logo.base64);
    expect(JSON.stringify(row.changes)).not.toContain(replacement.base64);
  }
});

it("invalid logos persist no domain change and removal is safe without an existing logo", async () => {
  const world = await fixture();
  saved(
    await call(world, org.saveCompanyProfile, {
      ...company,
      requestId: requestId(),
    }),
  );
  saved(
    await call(world, org.saveCompanyLogo, {
      mimeType: "image/png",
      base64: btoa("\x89PNG\r\n\x1a\n"),
      requestId: requestId(),
    }),
  );
  const before = await storeSnapshot(world);
  for (const [mimeType, base64, code] of [
    ["image/gif", btoa("GIF89a"), "LOGO_FILE_INVALID"],
    ["image/png", btoa("\xff\xd8\xff"), "LOGO_FILE_INVALID"],
    ["image/jpeg", "!invalid!", "LOGO_FILE_INVALID"],
    ["image/webp", "", "LOGO_FILE_INVALID"],
    [
      "image/png",
      btoa("\x89PNG\r\n\x1a\n" + "x".repeat(256 * 1024 - 7)),
      "LOGO_TOO_LARGE",
    ],
  ]) {
    expect(
      await call(world, org.saveCompanyLogo, {
        mimeType: mimeType!,
        base64: base64!,
        requestId: requestId(),
      }),
    ).toMatchObject({
      written: false,
      error: { code },
    });
    expect(await storeSnapshot(world)).toEqual(before);
  }
  // The object validator admits ambiguous shapes; the handler refuses them.
  for (const ambiguous of [
    {},
    { mimeType: "image/png" },
    { mimeType: "image/png", remove: true as const },
    { base64: btoa("\x89PNG\r\n\x1a\n"), remove: true as const },
    {
      mimeType: "image/png",
      base64: btoa("\x89PNG\r\n\x1a\n"),
      remove: true as const,
    },
  ]) {
    const outcome = await world.t
      .withIdentity(ADMIN)
      .mutation(makeFunctionReference<"mutation">("hr/org:saveCompanyLogo"), {
        ...ambiguous,
        requestId: requestId(),
      });
    expect(outcome).toMatchObject({
      ok: true,
      value: { written: false, error: { code: "LOGO_FILE_INVALID" } },
    });
    expect(await storeSnapshot(world)).toEqual(before);
  }
  const remove = { remove: true as const, requestId: requestId() };
  saved(await call(world, org.saveCompanyLogo, remove, TENANT_B));
  expect(
    saved(await call(world, org.saveCompanyLogo, remove, TENANT_B)).replayed,
  ).toBe(true);
  expect(await storeSnapshot(world)).toEqual(before);
});

it("management relations honor workplace scope and reject foreign managers", async () => {
  const world = await fixture();
  const managerId = saved(
    await call(world, setup.saveEmployee, {
      ...employee(world),
      userId: world.userA,
      requestId: requestId(),
    }),
  ).documentId as Id<"hrEmployees">;
  await world.t.run((ctx) =>
    ctx.db.insert("hrEmployees", {
      ...employee(world, "HIDDEN"),
      orgId: world.orgA,
      warehouseId: world.warehouses.bravoA,
      supervisorUserId: world.userA,
      version: 1,
      createdAt: NOW,
      updatedAt: NOW,
      createdByUserId: world.userA,
      updatedByUserId: world.userA,
    }),
  );
  expect(
    await call(world, org.managementView, { employeeId: managerId }),
  ).toMatchObject({ subordinates: [] });
  const foreignManager = saved(
    await call(
      world,
      setup.saveEmployee,
      {
        ...employee(world),
        warehouseId: world.warehouses.alphaB,
        requestId: requestId(),
      },
      TENANT_B,
    ),
  ).documentId as Id<"hrEmployees">;
  const before = await storeSnapshot(world);
  expect(
    await call(world, org.saveDepartment, {
      name: "Invalid manager",
      managerEmployeeId: foreignManager,
      status: "ACTIVE",
      requestId: requestId(),
    }),
  ).toMatchObject({
    written: false,
    error: { code: "MANAGER_UNAVAILABLE", field: "managerEmployeeId" },
  });
  expect(await storeSnapshot(world)).toEqual(before);
});

it("re-saving an employee unchanged with an INACTIVE department succeeds while other departments are active", async () => {
  const world = await fixture();
  const assignments = await masters(world);
  const args = { ...employee(world), ...assignments };
  const employeeId = saved(
    await call(world, setup.saveEmployee, { ...args, requestId: requestId() }),
  ).documentId as Id<"hrEmployees">;
  saved(
    await call(world, org.saveDepartment, {
      departmentId: assignments.departmentId,
      name: "Sales",
      status: "INACTIVE",
      expectedVersion: 1,
      requestId: requestId(),
    }),
  );
  const otherDepartment = saved(
    await call(world, org.saveDepartment, {
      name: "Operations",
      status: "ACTIVE",
      requestId: requestId(),
    }),
  ).documentId;
  expect(
    (await call(world, org.departmentOptions, {})).items.map((row) => row.id),
  ).toEqual([otherDepartment]);
  expect(
    (
      await call(world, org.departmentOptions, {
        currentId: assignments.departmentId,
      })
    ).items.map((row) => row.id),
  ).toEqual([otherDepartment, assignments.departmentId]);
  saved(
    await call(world, setup.saveEmployee, {
      ...args,
      employeeId,
      expectedVersion: 1,
      requestId: requestId(),
    }),
  );
  expect(
    (await call(world, setup.employee, { employeeId })).employee,
  ).toMatchObject({
    departmentId: assignments.departmentId,
    departmentName: "Sales",
    version: 2,
  });
});

it("optional org text is trimmed and empty values clear fields instead of storing empty strings", async () => {
  const world = await fixture();
  saved(
    await call(world, org.saveCompanyProfile, {
      ...company,
      requestId: requestId(),
    }),
  );
  saved(
    await call(world, org.saveCompanyProfile, {
      ...company,
      nameEn: " \t ",
      addressEn: " ",
      phone: " ",
      fax: " ",
      bankAccounts: [
        { bankName: " Bank ", accountNo: " 123 ", accountName: " " },
      ],
      expectedVersion: 1,
      requestId: requestId(),
    }),
  );
  const profile = (await call(world, org.getCompanyProfile, {})).profile!;
  for (const field of ["nameEn", "addressEn", "phone", "fax"] as const)
    expect(profile[field]).toBeUndefined();
  expect(profile.bankAccounts).toEqual([
    { bankName: "Bank", accountNo: "123" },
  ]);
  const branchId = saved(
    await call(world, org.saveBranch, {
      ...branch,
      nameEn: " HQ ",
      requestId: requestId(),
    }),
  ).documentId as Id<"hrBranches">;
  saved(
    await call(world, org.saveBranch, {
      ...branch,
      branchId,
      nameEn: " ",
      addressEn: " ",
      expectedVersion: 1,
      requestId: requestId(),
    }),
  );
  const row = (await call(world, org.listBranches, {})).items[0]!;
  expect(row.nameEn).toBeUndefined();
  expect(row.addressEn).toBeUndefined();
  const departmentId = saved(
    await call(world, org.saveDepartment, {
      name: " Sales ",
      nameEn: " Sales EN ",
      status: "ACTIVE",
      requestId: requestId(),
    }),
  ).documentId as Id<"hrDepartments">;
  saved(
    await call(world, org.saveDepartment, {
      departmentId,
      name: "Sales",
      nameEn: " ",
      status: "ACTIVE",
      expectedVersion: 1,
      requestId: requestId(),
    }),
  );
  saved(
    await call(world, org.savePosition, {
      name: " Role ",
      nameEn: " ",
      status: "ACTIVE",
      requestId: requestId(),
    }),
  );
  expect(
    (await call(world, org.listDepartments, {})).items[0]!.nameEn,
  ).toBeUndefined();
  expect(
    (await call(world, org.listPositions, {})).items[0]!.nameEn,
  ).toBeUndefined();
  const audit = await world.t.run((ctx) =>
    ctx.db.query("auditEvents").collect(),
  );
  expect(
    audit.some(
      (row) =>
        row.action === "hr.org.company.save" &&
        row.changes?.some(
          (change) =>
            change.field === "nameEn" &&
            change.from === JSON.stringify(company.nameEn) &&
            change.to === undefined,
        ),
    ),
  ).toBe(true);
});

it("employee code suggestions stop after 1,000 editable codes and fall back to the Bangkok CE year", async () => {
  const world = await fixture();
  expect(await call(world, org.suggestEmployeeCode, {})).toEqual({
    ok: true,
    code: "2600001",
  });
  await world.t.run(async (ctx) => {
    const fields = {
      ...employee(world),
      orgId: world.orgA,
      version: 1,
      createdAt: NOW,
      updatedAt: NOW,
      createdByUserId: world.userA,
      updatedByUserId: world.userA,
    };
    await ctx.db.insert("hrEmployees", { ...fields, code: "2600010" });
    for (let index = 0; index < 1001; index += 1)
      await ctx.db.insert("hrEmployees", {
        ...fields,
        code: `2600010.X${index}`,
      });
  });
  expect(await call(world, org.suggestEmployeeCode, {})).toEqual({
    ok: true,
    code: "2600001",
  });
});

it("all org saves reconcile committed requests after reload and fence absent requests", async () => {
  const world = await fixture();
  const operations = [
    [org.saveCompanyProfile, "hr.org.company.save", company],
    [
      org.saveCompanyLogo,
      "hr.org.logo.save",
      { mimeType: "image/png", base64: btoa("\x89PNG\r\n\x1a\n") },
    ],
    [org.saveBranch, "hr.org.branch.save", branch],
    [
      org.saveDepartment,
      "hr.org.hrDepartments.save",
      { name: "Sales", status: "ACTIVE" },
    ],
    [
      org.savePosition,
      "hr.org.hrPositions.save",
      { name: "Role", status: "ACTIVE" },
    ],
    [
      org.saveLevel,
      "hr.org.hrPositionLevels.save",
      { name: "Staff", status: "ACTIVE", sortOrder: 0 },
    ],
  ] as const;
  const otherActor = await seedSecondActorForOrgA(world, "HR_ADMIN");
  // The fixture helper uses a fixed external identity; give this actor a
  // distinct one before adding another role to the same tenant.
  await world.t.run((ctx) =>
    ctx.db.patch(otherActor.userId, { clerkUserId: "user_fixture_admin2" }),
  );
  const employeeActor = await seedSecondActorForOrgA(world, "HR_EMPLOYEE");
  for (const [fn, operation, payload] of operations) {
    // Registered mutations have different argument shapes; this loop drives
    // each real handler with its paired payload and the common command receipt.
    const save = fn as unknown as RegisteredMutation<
      "public",
      Record<string, unknown>,
      TenantFunctionOutcome<{ written: boolean }>
    >;
    const command = { ...payload, requestId: requestId() };
    saved(await call(world, save, command));
    const input = { operation, requestId: command.requestId };
    expect(await call(world, recovery.reconcileRequest, input)).toEqual({
      resolved: true,
      status: "COMMITTED",
    });
    expect(
      await call(world, recovery.reconcileRequest, input, TENANT_B),
    ).toEqual({ resolved: true, status: "FENCED" });
    expect(
      await call(world, recovery.reconcileRequest, input, {
        ...ADMIN,
        subject: "user_fixture_admin2",
      }),
    ).toEqual({ resolved: false, code: "NOT_FOUND" });
    expect(
      await call(world, recovery.reconcileRequest, input, {
        ...ADMIN,
        subject: employeeActor.clerkUserId,
      }),
    ).toEqual({ resolved: false, code: "PERMISSION_DENIED" });
    const absent = { operation, requestId: requestId() };
    expect(await call(world, recovery.reconcileRequest, absent)).toEqual({
      resolved: true,
      status: "FENCED",
    });
    const before = await storeSnapshot(world);
    expect(
      await call(world, save, { ...payload, requestId: absent.requestId }),
    ).toMatchObject({ written: false, error: { code: "REQUEST_RETIRED" } });
    expect(await storeSnapshot(world)).toEqual(before);
  }
});
