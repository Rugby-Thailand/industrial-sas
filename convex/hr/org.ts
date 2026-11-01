/** Tenant-owned legal identity and organization masters. Workplace stays in warehouses. */
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { HR_PERMISSION } from "../lib/permissions";
import {
  mutationWithOrg,
  queryWithOrg,
  type TenantFunctionContext,
} from "../lib/tenantFunctions";
import { TENANT_INDEX_MAX_BATCH_SIZE } from "../lib/tenantDb";
import {
  deriveManagementView,
  employeeCodePrefix,
  normalizedNameKey,
  suggestEmployeeCode as deriveCode,
  validTaxId,
  validateBranchCodes,
  validateCompanyLogo,
} from "../model/hr/org";
import {
  branchFields,
  companyFields,
  masterFields,
  orgStatus,
} from "../model/hr/orgSchema";
import {
  fail,
  diff,
  hrCommand,
  siteAllowed,
  siteScope,
  type Employee,
} from "./shared";

const ADMIN = HR_PERMISSION.adminManage;
type MasterTable = "hrDepartments" | "hrPositions" | "hrPositionLevels";
type AssignmentTable = MasterTable | "hrBranches";
type OrgDocument<T extends AssignmentTable> = Doc<T> & {
  orgId: Id<"organizations">;
};
const item = <T extends { _id: string }>(row: T) => ({ ...row, id: row._id });
const audit = (
  ctx: TenantFunctionContext,
  before: { version: number } | null,
) => ({
  version: (before?.version ?? 0) + 1,
  updatedAt: Date.now(),
  updatedByUserId: ctx.tenant.actor._id,
  ...(before === null
    ? { createdAt: Date.now(), createdByUserId: ctx.tenant.actor._id }
    : {}),
});
function normalizeText<T extends object>(fields: T): T {
  const optional = new Set([
    "nameEn",
    "addressEn",
    "phone",
    "fax",
    "accountName",
  ]);
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      typeof value === "string"
        ? optional.has(key)
          ? value.trim() || undefined
          : value.trim()
        : value,
    ]),
  ) as T;
}
function textError(
  fields: Record<string, unknown>,
  required: readonly string[],
) {
  for (const field of required) {
    if (typeof fields[field] !== "string" || fields[field].length === 0)
      return fail("ORG_FIELD_REQUIRED", field);
  }
  for (const [field, value] of Object.entries(fields)) {
    if (
      typeof value === "string" &&
      value.length > (field === "address" || field === "addressEn" ? 500 : 120)
    )
      return fail("ORG_FIELD_INVALID", field);
  }
  return null;
}
const addressRequired = [
  "name",
  "address",
  "province",
  "district",
  "subDistrict",
  "postcode",
];

export async function companyProfile(ctx: TenantFunctionContext) {
  return await ctx.tenantDb
    .byIndex<Doc<"hrCompanyProfiles">>("hrCompanyProfiles", "by_orgId", [])
    .unique();
}

export const getCompanyProfile = queryWithOrg({
  args: {},
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "hrCompanyProfiles" },
  handler: async (ctx) => {
    const profile = await companyProfile(ctx);
    return { profile: profile === null ? null : item(profile) };
  },
});

async function companyLogo(ctx: TenantFunctionContext) {
  return await ctx.tenantDb
    .byIndex<Doc<"hrCompanyLogos">>("hrCompanyLogos", "by_orgId", [])
    .unique();
}

export const getCompanyLogo = queryWithOrg({
  args: {},
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "hrCompanyLogos" },
  handler: async (ctx) => {
    const logo = await companyLogo(ctx);
    return logo === null
      ? null
      : { mimeType: logo.mimeType, base64: logo.base64 };
  },
});

export const saveCompanyLogo = mutationWithOrg({
  // Convex requires object args: either { mimeType, base64 } or { remove }.
  args: {
    requestId: v.string(),
    mimeType: v.optional(v.string()),
    base64: v.optional(v.string()),
    remove: v.optional(v.literal(true)),
  },
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "hrCompanyLogos" },
  handler: async (ctx, args) =>
    hrCommand(ctx, {
      operation: "hr.org.logo.save",
      requestId: args.requestId,
      payload: args,
      table: "hrCompanyLogos",
      run: async () => {
        const remove = args.remove === true;
        const upload =
          args.mimeType === undefined || args.base64 === undefined
            ? null
            : { mimeType: args.mimeType, base64: args.base64 };
        if (remove !== (upload === null))
          return fail("LOGO_FILE_INVALID", "base64");
        if (upload) {
          const valid = validateCompanyLogo(upload.mimeType, upload.base64);
          if (!valid.ok) return fail(valid.error.code, valid.error.field);
        }
        const before = await companyLogo(ctx);
        const profile = await companyProfile(ctx);
        let id: string = before?._id ?? ctx.tenant.organization._id;
        if (remove) {
          if (before) await ctx.tenantDb.delete("hrCompanyLogos", before._id);
        } else if (upload) {
          const fields = {
            ...upload,
            ...audit(ctx, before),
          };
          if (before)
            await ctx.tenantDb.patch("hrCompanyLogos", before._id, fields);
          else id = await ctx.tenantDb.insert("hrCompanyLogos", fields);
        }
        // Presence is metadata; profile reads never fetch image bytes. The
        // separate logo command owns its version and audit, not profile edits.
        if (profile && profile.hasLogo !== !remove)
          await ctx.tenantDb.patch("hrCompanyProfiles", profile._id, {
            hasLogo: !remove,
          });
        return {
          documentId: id,
          changes: [
            {
              field: "logo",
              from: before ? "present" : "absent",
              to: remove ? "absent" : "present",
            },
          ],
        };
      },
    }),
});

export const saveCompanyProfile = mutationWithOrg({
  args: {
    requestId: v.string(),
    expectedVersion: v.optional(v.number()),
    ...companyFields,
  },
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "hrCompanyProfiles" },
  handler: async (ctx, args) =>
    hrCommand(ctx, {
      operation: "hr.org.company.save",
      requestId: args.requestId,
      payload: args,
      table: "hrCompanyProfiles",
      run: async () => {
        const { requestId: _requestId, expectedVersion, ...input } = args;
        const fields = normalizeText({
          ...input,
          nameEn: input.nameEn,
          addressEn: input.addressEn,
          phone: input.phone,
          fax: input.fax,
        });
        if (!validTaxId(args.taxId)) return fail("TAX_ID_INVALID", "taxId");
        const invalid = textError(fields, addressRequired);
        if (invalid) return invalid;
        fields.bankAccounts = fields.bankAccounts.map(normalizeText);
        for (const [index, bank] of fields.bankAccounts.entries()) {
          const invalidBank = textError(bank, ["bankName", "accountNo"]);
          if (invalidBank)
            return fail(
              invalidBank.error.code,
              `bankAccounts.${index}.${invalidBank.error.field}`,
            );
        }
        const before = await companyProfile(ctx);
        if (
          before
            ? before.version !== expectedVersion
            : expectedVersion !== undefined
        )
          return fail("COMPANY_PROFILE_STALE");
        const stamps = audit(ctx, before);
        const id =
          before === null
            ? await ctx.tenantDb.insert("hrCompanyProfiles", {
                hasLogo: (await companyLogo(ctx)) !== null,
                ...fields,
                ...stamps,
              })
            : before._id;
        if (before)
          await ctx.tenantDb.patch("hrCompanyProfiles", id, {
            ...fields,
            ...stamps,
          });
        return { documentId: id, changes: diff(before, fields) };
      },
    }),
});

async function rows<T extends AssignmentTable>(
  ctx: TenantFunctionContext,
  table: T,
  activeOnly = false,
) {
  return await ctx.tenantDb
    .byIndex<OrgDocument<T>>(
      table,
      "by_orgId_status_name",
      activeOnly ? [{ field: "status", value: "ACTIVE" }] : [],
    )
    .all(TENANT_INDEX_MAX_BATCH_SIZE);
}
async function options<T extends AssignmentTable>(
  ctx: TenantFunctionContext,
  table: T,
  currentId?: string,
) {
  const active = await rows(ctx, table, true);
  const current =
    currentId === undefined
      ? null
      : await ctx.tenantDb.get<OrgDocument<T>>(table, currentId);
  const items = [...active];
  if (current && !items.some((row) => row._id === current._id))
    items.push(current);
  return { items: items.map(item) };
}
const sortedLevels = <T extends Doc<"hrPositionLevels">>(list: readonly T[]) =>
  [...list].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
  );

export const listBranches = queryWithOrg({
  args: {},
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "hrBranches" },
  handler: async (ctx) => ({
    items: (await rows(ctx, "hrBranches")).map(item),
  }),
});
export const branchOptions = queryWithOrg({
  args: { currentId: v.optional(v.id("hrBranches")) },
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "hrBranches" },
  handler: async (ctx, args) => options(ctx, "hrBranches", args.currentId),
});
export const listDepartments = queryWithOrg({
  args: {},
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "hrDepartments" },
  handler: async (ctx) => ({
    items: (await rows(ctx, "hrDepartments")).map(item),
  }),
});
export const departmentOptions = queryWithOrg({
  args: { currentId: v.optional(v.id("hrDepartments")) },
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "hrDepartments" },
  handler: async (ctx, args) => options(ctx, "hrDepartments", args.currentId),
});
export const listPositions = queryWithOrg({
  args: {},
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "hrPositions" },
  handler: async (ctx) => ({
    items: (await rows(ctx, "hrPositions")).map(item),
  }),
});
export const positionOptions = queryWithOrg({
  args: { currentId: v.optional(v.id("hrPositions")) },
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "hrPositions" },
  handler: async (ctx, args) => options(ctx, "hrPositions", args.currentId),
});
export const listLevels = queryWithOrg({
  args: {},
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "hrPositionLevels" },
  handler: async (ctx) => ({
    items: sortedLevels(await rows(ctx, "hrPositionLevels")).map(item),
  }),
});
export const levelOptions = queryWithOrg({
  args: { currentId: v.optional(v.id("hrPositionLevels")) },
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "hrPositionLevels" },
  handler: async (ctx, args) => {
    const result = await options(ctx, "hrPositionLevels", args.currentId);
    return {
      items: sortedLevels(result.items),
    };
  },
});

export const saveBranch = mutationWithOrg({
  args: {
    requestId: v.string(),
    branchId: v.optional(v.id("hrBranches")),
    expectedVersion: v.optional(v.number()),
    ...branchFields,
  },
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "hrBranches", id: (args) => args.branchId },
  handler: async (ctx, args) =>
    hrCommand(ctx, {
      operation: "hr.org.branch.save",
      requestId: args.requestId,
      payload: args,
      table: "hrBranches",
      run: async () => {
        const {
          requestId: _requestId,
          branchId,
          expectedVersion,
          ...input
        } = args;
        const codes = validateBranchCodes(
          args.revenueBranchNo,
          args.ssoEmployerAccount,
          args.type,
        );
        if (!codes.ok) return fail(codes.error.code, codes.error.field);
        const fields = {
          ...normalizeText({
            ...input,
            nameEn: input.nameEn,
            addressEn: input.addressEn,
          }),
          ...codes.value,
        };
        const invalid = textError(fields, addressRequired);
        if (invalid) return invalid;
        const before =
          branchId === undefined
            ? null
            : await ctx.tenantDb.get<Doc<"hrBranches">>("hrBranches", branchId);
        if (branchId !== undefined && !before)
          return fail("NOT_FOUND", "branchId");
        if (
          before
            ? before.version !== expectedVersion
            : expectedVersion !== undefined
        )
          return fail("BRANCH_STALE");
        const same = await ctx.tenantDb
          .byIndex<Doc<"hrBranches">>(
            "hrBranches",
            "by_orgId_revenueBranchNo",
            [{ field: "revenueBranchNo", value: fields.revenueBranchNo }],
          )
          .unique();
        if (same && same._id !== before?._id)
          return fail("REVENUE_BRANCH_NO_TAKEN", "revenueBranchNo");
        const stamps = audit(ctx, before);
        const id =
          before === null
            ? await ctx.tenantDb.insert("hrBranches", { ...fields, ...stamps })
            : before._id;
        if (before)
          await ctx.tenantDb.patch("hrBranches", id, { ...fields, ...stamps });
        return { documentId: id, changes: diff(before, fields) };
      },
    }),
});

async function saveMaster(
  ctx: TenantFunctionContext,
  table: MasterTable,
  args: {
    requestId: string;
    id?: string | undefined;
    expectedVersion?: number;
    name: string;
    nameEn?: string;
    status: "ACTIVE" | "INACTIVE";
    sortOrder?: number;
    managerEmployeeId?: string;
  },
) {
  return await hrCommand(ctx, {
    operation: `hr.org.${table}.save`,
    requestId: args.requestId,
    payload: args,
    table,
    run: async () => {
      const { requestId: _requestId, id, expectedVersion, ...input } = args;
      const fields = {
        ...normalizeText(input),
        nameKey: normalizedNameKey(args.name),
        ...(table !== "hrPositionLevels"
          ? { nameEn: args.nameEn?.trim() || undefined }
          : {}),
        ...(table === "hrDepartments"
          ? { managerEmployeeId: args.managerEmployeeId }
          : {}),
      };
      const invalid = textError(fields, ["name"]);
      if (invalid) return invalid;
      if (table === "hrPositionLevels" && !Number.isSafeInteger(args.sortOrder))
        return fail("LEVEL_SORT_ORDER_INVALID", "sortOrder");
      const before =
        id === undefined
          ? null
          : await ctx.tenantDb.get<Doc<MasterTable>>(table, id);
      if (id !== undefined && !before) return fail("NOT_FOUND", "id");
      if (
        before
          ? before.version !== expectedVersion
          : expectedVersion !== undefined
      )
        return fail("ORG_MASTER_STALE");
      const same = await ctx.tenantDb
        .byIndex<Doc<MasterTable>>(table, "by_orgId_nameKey", [
          { field: "nameKey", value: fields.nameKey },
        ])
        .unique();
      if (same && same._id !== before?._id)
        return fail("ORG_NAME_TAKEN", "name");
      if (args.managerEmployeeId !== undefined) {
        const manager = await ctx.tenantDb.get<Employee>(
          "hrEmployees",
          args.managerEmployeeId,
        );
        if (
          !manager ||
          !(await siteAllowed(ctx, await siteScope(ctx), manager.warehouseId))
        )
          return fail("MANAGER_UNAVAILABLE", "managerEmployeeId");
      }
      const stamps = audit(ctx, before);
      const savedId =
        before === null
          ? await ctx.tenantDb.insert(table, { ...fields, ...stamps })
          : before._id;
      if (before)
        await ctx.tenantDb.patch(table, savedId, { ...fields, ...stamps });
      return { documentId: savedId, changes: diff(before, fields) };
    },
  });
}
const saveArgs = {
  requestId: v.string(),
  expectedVersion: v.optional(v.number()),
};
export const saveDepartment = mutationWithOrg({
  args: {
    ...saveArgs,
    departmentId: v.optional(v.id("hrDepartments")),
    ...masterFields,
    managerEmployeeId: v.optional(v.id("hrEmployees")),
  },
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "hrDepartments", id: (args) => args.departmentId },
  handler: async (ctx, { departmentId, ...args }) =>
    saveMaster(ctx, "hrDepartments", { ...args, id: departmentId }),
});
export const savePosition = mutationWithOrg({
  args: {
    ...saveArgs,
    positionId: v.optional(v.id("hrPositions")),
    ...masterFields,
  },
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "hrPositions", id: (args) => args.positionId },
  handler: async (ctx, { positionId, ...args }) =>
    saveMaster(ctx, "hrPositions", { ...args, id: positionId }),
});
export const saveLevel = mutationWithOrg({
  args: {
    ...saveArgs,
    levelId: v.optional(v.id("hrPositionLevels")),
    name: v.string(),
    status: orgStatus,
    sortOrder: v.number(),
  },
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "hrPositionLevels", id: (args) => args.levelId },
  handler: async (ctx, { levelId, ...args }) =>
    saveMaster(ctx, "hrPositionLevels", { ...args, id: levelId }),
});

/** Historical inactive references are valid only when already owned by this employee. */
/**
 * Legacy compatibility (S01-19): an ACTIVE employee saved before the org had
 * masters keeps saving without them. The assignment is required only when the
 * record is created, becomes ACTIVE, or already holds one (it cannot be
 * cleared). Forcing every legacy employee is a separate, unconfirmed policy.
 */
function requiresAssignment(
  before: Employee | null,
  field: "departmentId" | "positionId",
) {
  return (
    before === null || before.status !== "ACTIVE" || before[field] !== undefined
  );
}

export async function validateEmployeeOrgReferences(
  ctx: TenantFunctionContext,
  args: {
    status: "ACTIVE" | "INACTIVE";
    branchId?: string;
    departmentId?: string;
    positionId?: string;
    levelId?: string;
  },
  before: Employee | null,
) {
  for (const [field, table, requiredCode] of [
    ["branchId", "hrBranches", null],
    ["departmentId", "hrDepartments", "DEPARTMENT_REQUIRED"],
    ["positionId", "hrPositions", "POSITION_REQUIRED"],
    ["levelId", "hrPositionLevels", null],
  ] as const) {
    const id = args[field];
    if (id === undefined) {
      if (
        requiredCode &&
        args.status === "ACTIVE" &&
        requiresAssignment(before, field) &&
        (await ctx.tenantDb
          .byIndex(table, "by_orgId_status_name", [
            { field: "status", value: "ACTIVE" },
          ])
          .first())
      )
        return fail(requiredCode, field);
      continue;
    }
    const reference = await ctx.tenantDb.get<Doc<AssignmentTable>>(table, id);
    if (!reference || (reference.status !== "ACTIVE" && before?.[field] !== id))
      return fail("ORG_REFERENCE_UNAVAILABLE", field);
  }
  return null;
}

export const managementView = queryWithOrg({
  args: { employeeId: v.id("hrEmployees") },
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "hrEmployees", id: (args) => args.employeeId },
  handler: async (ctx, args) => {
    const manager = await ctx.tenantDb.get<Employee>(
      "hrEmployees",
      args.employeeId,
    );
    const scope = await siteScope(ctx);
    if (!manager || !(await siteAllowed(ctx, scope, manager.warehouseId)))
      return { ok: false as const, code: "NOT_FOUND" };
    const departments = await ctx.tenantDb
      .byIndex<Doc<"hrDepartments">>(
        "hrDepartments",
        "by_orgId_managerEmployeeId",
        [{ field: "managerEmployeeId", value: manager._id }],
      )
      .all(TENANT_INDEX_MAX_BATCH_SIZE);
    const employees =
      manager.userId === undefined
        ? []
        : await ctx.tenantDb
            .byIndex<Employee>("hrEmployees", "by_orgId_supervisorUserId", [
              { field: "supervisorUserId", value: manager.userId },
            ])
            .all(TENANT_INDEX_MAX_BATCH_SIZE);
    const visible = [];
    for (const employee of employees)
      if (await siteAllowed(ctx, scope, employee.warehouseId))
        visible.push(employee);
    const view = deriveManagementView(manager, departments, visible);
    return {
      ok: true as const,
      responsibleDepartments: view.responsibleDepartments.map((row) => ({
        id: row._id,
        name: row.name,
        status: row.status,
      })),
      subordinates: view.subordinates.map((row) => ({
        id: row._id,
        code: row.code,
        displayName: row.displayName,
        departmentId: row.departmentId,
        positionId: row.positionId,
        status: row.status,
      })),
    };
  },
});

export const suggestEmployeeCode = queryWithOrg({
  args: {},
  returns: v.any(),
  permissionCode: ADMIN,
  target: { table: "hrEmployees" },
  handler: async (ctx) => {
    const now = Date.now();
    const prefix = employeeCodePrefix(now);
    // Read backwards to the highest matching code. Valid sequences need only
    // one small batch even in a registry with more than 10,000 employees.
    let upper = { value: `${prefix}99999`, inclusive: true };
    let highest: string | undefined;
    // At most ten batches / 1,000 rows, even for pathological editable codes.
    for (let batchNumber = 0; batchNumber < 10; batchNumber += 1) {
      const batch = await ctx.tenantDb
        .byIndex<Employee>("hrEmployees", "by_orgId_code", [], {
          field: "code",
          lower: { value: `${prefix}00000`, inclusive: true },
          upper,
        })
        .take(100, "desc");
      highest = batch.find((row) =>
        new RegExp(`^${prefix}[0-9]{5}$`).test(row.code),
      )?.code;
      if (highest !== undefined || batch.length < 100) break;
      upper = { value: batch[batch.length - 1]!.code, inclusive: false };
    }
    // If the bounded scan found no sequence, suggest YY00001. It remains
    // editable and saveEmployee still enforces uniqueness.
    const result = deriveCode(highest === undefined ? [] : [highest], now);
    return result.ok
      ? { ok: true as const, code: result.value }
      : { ok: false as const, code: result.error.code };
  },
});
