import { defineTable } from "convex/server";
import { v } from "convex/values";

import { byOrg, tenantFields } from "../../lib/tenantTable";

const shiftColor = v.union(
  v.literal("sky"),
  v.literal("teal"),
  v.literal("green"),
  v.literal("amber"),
  v.literal("rose"),
  v.literal("violet"),
  v.literal("slate"),
);

/** Fixed working times shared by a definition and its assignment snapshot. */
const fixedTimes = {
  startTime: v.string(),
  endTime: v.string(),
  endsNextDay: v.boolean(),
  breakMinutes: v.number(),
};

/** Provenance stored on a captured/frozen plan (see `hrPlan` in schema). */
export const rosterProvenance = v.object({
  kind: v.union(v.literal("SHIFT"), v.literal("OFF")),
  revision: v.number(),
  shiftId: v.optional(v.string()),
  shiftCode: v.optional(v.string()),
  shiftVersion: v.optional(v.number()),
});

export const hrRosterTables = {
  /** Named FIXED shift definitions, one code per site. */
  hrShifts: defineTable(
    tenantFields({
      warehouseId: v.id("warehouses"),
      /** Canonical upper-case code, unique within the site. */
      code: v.string(),
      name: v.string(),
      description: v.optional(v.string()),
      color: shiftColor,
      status: v.union(v.literal("ACTIVE"), v.literal("INACTIVE")),
      ...fixedTimes,
      version: v.number(),
      createdAt: v.number(),
      createdByUserId: v.id("users"),
      updatedAt: v.number(),
      updatedByUserId: v.id("users"),
    }),
  ).index("by_orgId_warehouseId_code", byOrg("warehouseId", "code")),
  /**
   * One row per employee business date once assigned. CLEARED is a tombstone
   * that restores the weekly fallback; rows are never deleted so `revision`
   * stays monotonic and a stale editor cannot overwrite a newer decision.
   */
  hrRosterAssignments: defineTable(
    tenantFields({
      warehouseId: v.id("warehouses"),
      employeeId: v.id("hrEmployees"),
      businessDate: v.string(),
      kind: v.union(v.literal("SHIFT"), v.literal("OFF"), v.literal("CLEARED")),
      /** The definition as it was when assigned; later edits do not apply. */
      shift: v.optional(
        v.object({
          shiftId: v.id("hrShifts"),
          code: v.string(),
          name: v.string(),
          color: shiftColor,
          version: v.number(),
          ...fixedTimes,
        }),
      ),
      revision: v.number(),
      createdAt: v.number(),
      updatedAt: v.number(),
      updatedByUserId: v.id("users"),
    }),
  )
    .index(
      "by_orgId_employeeId_businessDate",
      byOrg("employeeId", "businessDate"),
    )
    .index(
      "by_orgId_warehouseId_businessDate",
      byOrg("warehouseId", "businessDate"),
    ),
};
