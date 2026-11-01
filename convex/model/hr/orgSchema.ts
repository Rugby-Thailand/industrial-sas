import { defineTable } from "convex/server";
import { v } from "convex/values";
import { byOrg, tenantFields } from "../../lib/tenantTable";

export const orgStatus = v.union(v.literal("ACTIVE"), v.literal("INACTIVE"));
export const employmentType = v.union(
  v.literal("PERMANENT"),
  v.literal("FIXED_TERM"),
);
export const employeeOrgFields = {
  branchId: v.optional(v.id("hrBranches")),
  departmentId: v.optional(v.id("hrDepartments")),
  positionId: v.optional(v.id("hrPositions")),
  levelId: v.optional(v.id("hrPositionLevels")),
  employmentType: v.optional(employmentType),
  probationEndDate: v.optional(v.string()),
};
export const addressFields = {
  address: v.string(),
  addressEn: v.optional(v.string()),
  province: v.string(),
  district: v.string(),
  subDistrict: v.string(),
  postcode: v.string(),
};
export const companyFields = {
  name: v.string(),
  nameEn: v.optional(v.string()),
  taxId: v.string(),
  ...addressFields,
  phone: v.optional(v.string()),
  fax: v.optional(v.string()),
  bankAccounts: v.array(
    v.object({
      bankName: v.string(),
      accountNo: v.string(),
      accountName: v.optional(v.string()),
    }),
  ),
};
export const branchFields = {
  name: v.string(),
  nameEn: v.optional(v.string()),
  revenueBranchNo: v.string(),
  ssoEmployerAccount: v.string(),
  type: v.union(v.literal("HEAD_OFFICE"), v.literal("BRANCH")),
  ...addressFields,
  status: orgStatus,
};
export const masterFields = {
  name: v.string(),
  nameEn: v.optional(v.string()),
  status: orgStatus,
};
const auditFields = {
  version: v.number(),
  createdAt: v.number(),
  createdByUserId: v.id("users"),
  updatedAt: v.number(),
  updatedByUserId: v.id("users"),
};

export const hrOrgTables = {
  hrCompanyProfiles: defineTable(
    tenantFields({ ...companyFields, hasLogo: v.boolean(), ...auditFields }),
  ).index("by_orgId", byOrg()),
  // Kept separate so ordinary profile and payslip reads never load image bytes.
  hrCompanyLogos: defineTable(
    tenantFields({
      mimeType: v.string(),
      base64: v.string(),
      ...auditFields,
    }),
  ).index("by_orgId", byOrg()),
  hrBranches: defineTable(tenantFields({ ...branchFields, ...auditFields }))
    .index("by_orgId_revenueBranchNo", byOrg("revenueBranchNo"))
    .index("by_orgId_status_name", byOrg("status", "name")),
  hrDepartments: defineTable(
    tenantFields({
      ...masterFields,
      nameKey: v.string(),
      managerEmployeeId: v.optional(v.id("hrEmployees")),
      ...auditFields,
    }),
  )
    .index("by_orgId_nameKey", byOrg("nameKey"))
    .index("by_orgId_status_name", byOrg("status", "name"))
    .index("by_orgId_managerEmployeeId", byOrg("managerEmployeeId")),
  hrPositions: defineTable(
    tenantFields({ ...masterFields, nameKey: v.string(), ...auditFields }),
  )
    .index("by_orgId_nameKey", byOrg("nameKey"))
    .index("by_orgId_status_name", byOrg("status", "name")),
  hrPositionLevels: defineTable(
    tenantFields({
      name: v.string(),
      nameKey: v.string(),
      sortOrder: v.number(),
      status: orgStatus,
      ...auditFields,
    }),
  )
    .index("by_orgId_nameKey", byOrg("nameKey"))
    .index("by_orgId_status_name", byOrg("status", "name")),
};
