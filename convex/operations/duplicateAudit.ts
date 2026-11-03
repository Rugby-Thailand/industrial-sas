import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import { createTenantDocumentAccess, type TenantOrgId } from "../lib/tenantDb";
import { createQueryTenantStorage } from "../lib/tenantStorage";
import {
  UNIQUENESS_CONTRACTS,
  uniquenessIndexName,
  type TenantTableName,
} from "../lib/schemaPolicy";

const supported = [
  "finishedGoodsProducts",
  "storageBuildings",
  "storageZones",
  "storageFloors",
  "hrPeriodRows",
  "finishedGoodsPlacements",
];
/** Read-only candidate report: duplicates require domain review, never automatic deletion. */
export const page = internalQuery({
  args: {
    orgId: v.id("organizations"),
    contract: v.string(),
    cursor: v.optional(v.string()),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const contract = UNIQUENESS_CONTRACTS.find(
      (candidate) =>
        `${candidate.table}.${candidate.key.slice(1).join("+")}` ===
        args.contract,
    );
    if (!contract || !supported.includes(contract.table))
      throw new Error("Unsupported audit contract");
    if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 50)
      throw new Error("Limit must be 1..50");
    const db = createTenantDocumentAccess(
      { orgId: args.orgId, requestId: "duplicate-audit-v1" },
      createQueryTenantStorage(ctx, "duplicate-audit-v1"),
    );
    const table = contract.table as TenantTableName;
    const index = uniquenessIndexName(contract.key);
    const scanned = await db
      .byIndex<Record<string, unknown> & { orgId: TenantOrgId }>(
        table,
        index,
        [],
      )
      .page({ limit: args.limit, cursor: args.cursor });
    const findings: Array<{ id: string; matchingIds: string[] }> = [];
    for (const row of scanned.page) {
      const condition = contract.condition;
      if (
        condition.kind === "whenPresent" &&
        condition.fields.some((field) => row[field] === undefined)
      )
        continue;
      if (condition.kind === "nonEmpty" && !row[condition.field]) continue;
      if (
        condition.kind === "activePlacement" &&
        row.status !== "RESERVED" &&
        row.status !== "STORED"
      )
        continue;
      const equality = contract.key
        .slice(1)
        .map((field) => ({ field, value: row[field] as string | number }));
      const matches = await db
        .byIndex<{ _id: string; orgId: TenantOrgId }>(table, index, equality)
        .take(2);
      if (matches.length > 1)
        findings.push({
          id: String(row._id),
          matchingIds: matches.map((r) => r._id),
        });
    }
    return {
      version: 1,
      contract: args.contract,
      scanned: scanned.page.length,
      findings,
      cursor: scanned.continueCursor,
      isDone: scanned.isDone,
    };
  },
});
