import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import { createTenantDocumentAccess } from "../lib/tenantDb";
import { createMutationTenantStorage } from "../lib/tenantStorage";

const BATCH = 100;
const STATUSES = ["ACTIVE", "INACTIVE"] as const;
type Cursor = { s: number; code?: string; time?: number };

function decode(raw: string | undefined): Cursor | null {
  if (!raw) return { s: 0 };
  try {
    const value = JSON.parse(raw) as Cursor;
    return Number.isSafeInteger(value.s) &&
      value.s >= 0 &&
      value.s <= STATUSES.length &&
      (value.code === undefined || typeof value.code === "string") &&
      (value.code === undefined) === (value.time === undefined)
      ? value
      : null;
  } catch {
    return null;
  }
}

/**
 * Operational migration: copy `buildingId`/`floorId` from the owning area onto
 * physical ledger rows written before those fields were maintained.
 *
 * Reads never depend on this: building-filtered location queries also read the
 * "missing building" index range. Running it only shrinks that range. The tenant
 * is derived from the warehouse, every call is bounded, and re-running is
 * idempotent. Rows without an area (for example operational docks) are skipped
 * by the code cursor so the migration always terminates. Resume with the
 * returned `cursor` until `done` is true:
 *
 *   pnpm exec convex run staging/locationBuildingBackfill:run \
 *     '{"warehouseId":"<id>"}'
 */
export const run = internalMutation({
  args: { warehouseId: v.id("warehouses"), cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const warehouse = await ctx.db.get(args.warehouseId);
    if (!warehouse) throw new Error("Warehouse not found");
    const cursor = decode(args.cursor);
    if (!cursor) throw new Error("Invalid backfill cursor");
    const requestId = "location-building-backfill";
    const db = createTenantDocumentAccess(
      { orgId: warehouse.orgId, requestId },
      createMutationTenantStorage(ctx, requestId),
    );
    let updated = 0;
    let skipped = 0;
    let position: Cursor = cursor;
    let read = 0;
    while (position.s < STATUSES.length && read < BATCH) {
      const equality = [
        { field: "warehouseId", value: args.warehouseId },
        { field: "status", value: STATUSES[position.s] },
        { field: "buildingId", value: undefined, missing: true as const },
      ];
      const index = "by_orgId_warehouseId_status_buildingId_code";
      const limit = BATCH - read;
      const same =
        position.code === undefined
          ? []
          : await db
              .byIndex<Doc<"locations">>(
                "locations",
                index,
                [...equality, { field: "code", value: position.code }],
                {
                  field: "_creationTime",
                  lower: { value: position.time!, inclusive: false },
                },
              )
              .take(limit);
      const rest =
        same.length >= limit
          ? []
          : await db
              .byIndex<Doc<"locations">>(
                "locations",
                index,
                equality,
                position.code === undefined
                  ? undefined
                  : {
                      field: "code",
                      lower: { value: position.code, inclusive: false },
                    },
              )
              .take(limit - same.length);
      const rows = [...same, ...rest];
      read += rows.length;
      for (const row of rows) {
        const support = await db
          .byIndex<Doc<"storagePositions">>(
            "storagePositions",
            "by_orgId_locationId",
            [{ field: "locationId", value: row._id }],
          )
          .first();
        const zone = support
          ? await db.get<Doc<"storageZones">>("storageZones", support.zoneId)
          : await db
              .byIndex<Doc<"storageZones">>(
                "storageZones",
                "by_orgId_locationId",
                [{ field: "locationId", value: row._id }],
              )
              .first();
        if (
          row.locationType === "NAMED_STORAGE" ||
          !zone ||
          zone.warehouseId !== args.warehouseId
        ) {
          // Not owned by an area: it stays in the legacy range, and readers
          // still evaluate it there. Advance past it.
          skipped += 1;
          position = { s: position.s, code: row.code, time: row._creationTime };
          continue;
        }
        await db.patch("locations", row._id, {
          buildingId: zone.buildingId,
          floorId: zone.floorId,
        });
        updated += 1;
      }
      if (rows.length < limit) position = { s: position.s + 1 };
    }
    const done = position.s >= STATUSES.length;
    return {
      done,
      updated,
      skipped,
      ...(done ? {} : { cursor: JSON.stringify(position) }),
    };
  },
});
