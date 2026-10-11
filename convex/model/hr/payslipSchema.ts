import { defineTable } from "convex/server";
import { v } from "convex/values";
import { byOrg, tenantFields } from "../../lib/tenantTable";

/** Original small source PDFs stay in private tenant records. No public URL. */
export const hrPayslipTables = {
  hrPayslipImports: defineTable(
    tenantFields({
      from: v.string(),
      to: v.string(),
      sourceName: v.string(),
      sourceCsv: v.string(),
      sourceHash: v.string(),
      inclusionHash: v.optional(v.string()),
      policyVersionId: v.id("hrPolicyVersions"),
      status: v.union(v.literal("STAGED"), v.literal("PUBLISHED")),
      rowCount: v.number(),
      exclusions: v.optional(
        v.array(
          v.object({
            rowNumber: v.number(),
            employeeCode: v.string(),
            reason: v.string(),
          }),
        ),
      ),
      createdAt: v.number(),
      createdByUserId: v.id("users"),
      publishedAt: v.optional(v.number()),
      publishedByUserId: v.optional(v.id("users")),
    }),
  ).index("by_orgId_createdAt", byOrg("createdAt")),
  hrPayslipRows: defineTable(
    tenantFields({
      importId: v.id("hrPayslipImports"),
      employeeId: v.id("hrEmployees"),
      warehouseId: v.id("warehouses"),
      employeeCode: v.string(),
      employeeName: v.string(),
      from: v.string(),
      to: v.string(),
      paymentDate: v.string(),
      gross: v.number(),
      deductions: v.number(),
      net: v.number(),
      sourceBase64: v.string(),
      sourceHash: v.string(),
      version: v.number(),
      publishedAt: v.optional(v.number()),
      predecessorId: v.optional(v.id("hrPayslipRows")),
      supersededById: v.optional(v.id("hrPayslipRows")),
    }),
  )
    .index("by_orgId_importId", byOrg("importId"))
    .index("by_orgId_employeeId_from", byOrg("employeeId", "from")),
  hrPayslipTickets: defineTable(
    tenantFields({
      rowId: v.id("hrPayslipRows"),
      employeeId: v.id("hrEmployees"),
      userId: v.id("users"),
      sessionId: v.string(),
      policyVersionId: v.id("hrPolicyVersions"),
      issuedAt: v.number(),
      expiresAt: v.number(),
    }),
  ).index("by_orgId_userId", byOrg("userId")),
};
