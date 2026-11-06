import { defineTable } from "convex/server";
import { v } from "convex/values";
import { byOrg, tenantFields } from "../../lib/tenantTable";

/**
 * Original source PDFs stay in private tenant records with no public URL.
 * Statement rows hold only metadata; bytes live in `hrPayslipPayloads`, which
 * only the ticketed document command and deliberate integrity checks read.
 */
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
      /** Private payload holding the original bytes (immutable once written). */
      payloadId: v.optional(v.id("hrPayslipPayloads")),
      /**
       * Deprecated inline bytes of rows written before the payload split.
       * Only `hr/payslipMigration:migrateInlinePayloads` reads it; remove the
       * field once that migration reports completion in every deployment.
       */
      sourceBase64: v.optional(v.string()),
      sourceHash: v.string(),
      version: v.number(),
      publishedAt: v.optional(v.number()),
      predecessorId: v.optional(v.id("hrPayslipRows")),
      supersededById: v.optional(v.id("hrPayslipRows")),
    }),
  )
    .index("by_orgId_importId", byOrg("importId"))
    .index("by_orgId_employeeId_from", byOrg("employeeId", "from")),
  /** Immutable original bytes of one statement; never listed or subscribed. */
  hrPayslipPayloads: defineTable(
    tenantFields({
      importId: v.id("hrPayslipImports"),
      employeeId: v.id("hrEmployees"),
      sourceBase64: v.string(),
      /** SHA-256 of the decoded bytes; equals the owning row's sourceHash. */
      sourceHash: v.string(),
      byteLength: v.number(),
      createdAt: v.number(),
    }),
  ).index("by_orgId_importId", byOrg("importId")),
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
  )
    .index("by_orgId_userId", byOrg("userId"))
    .index("by_orgId_expiresAt", byOrg("expiresAt")),
};
