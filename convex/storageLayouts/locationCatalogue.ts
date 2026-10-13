import { createQueryDocumentReader } from "../lib/queryDocumentReader";
import { storageCatalogueGeneration } from "../lib/finishedGoodsSummary";
import { isGeometricPlacement } from "../model/finishedGoods/scanning";
import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import {
  queryWithOrg,
  type TenantFunctionContext,
} from "../lib/tenantFunctions";
import { occupiedFootprintAreaSqMm } from "../model/storageLayout/occupancy";
import { paginatedScan } from "../lib/cataloguePagination";
import {
  keysetScan,
  KeysetSuspend,
  readKeysetRange,
  type KeysetSegment,
  type KeysetWork,
} from "../lib/keysetScan";

function createLocationReader(
  ctx: TenantFunctionContext,
  includePositions = true,
) {
  const readBuilding = createQueryDocumentReader(
    ctx.tenantDb,
    "storageBuildings",
  );
  const readFloor = createQueryDocumentReader(ctx.tenantDb, "storageFloors");
  return async (zone: Doc<"storageZones">) => {
    const [building, floor, positions] = await Promise.all([
      readBuilding(zone.buildingId),
      readFloor(zone.floorId),
      includePositions
        ? ctx.tenantDb
            .byIndex<Doc<"storagePositions">>(
              "storagePositions",
              "by_orgId_zoneId_status_code",
              [{ field: "zoneId", value: zone._id }],
            )
            .all(10_000)
        : Promise.resolve([] as Doc<"storagePositions">[]),
    ]);
    if (
      !building ||
      !floor ||
      floor.buildingId !== building._id ||
      building.warehouseId !== zone.warehouseId
    )
      throw new Error("Storage location parent is missing");
    return {
      _id: zone._id,
      warehouseId: zone.warehouseId,
      zoneId: zone._id,
      label: zone.label,
      code: zone.code,
      qrValue: zone.qrValue,
      buildingId: building._id,
      buildingName: building.name,
      buildingCode: building.code,
      floorNumber: floor.floorNumber,
      status:
        zone.status === "INACTIVE" ? ("ARCHIVED" as const) : building.status,
      widthMm: zone.widthMm,
      depthMm: zone.depthMm,
      heightMm: zone.maxStackHeightMm,
      positions: positions
        .filter((p) => !p.isDefault)
        .map((p) => ({
          id: p._id,
          label: p.label,
          code: p.code,
          status: p.status,
          xMm: p.xMm,
          yMm: p.yMm,
          zMm: p.elevationMm ?? zone.baseElevationMm ?? 0,
        })),
    };
  };
}
type LocationReader = ReturnType<typeof createLocationReader>;
async function withOccupancy(
  ctx: TenantFunctionContext,
  row: Awaited<ReturnType<LocationReader>>,
) {
  const placements = (
    await Promise.all(
      (["RESERVED", "STORED"] as const).map((status) =>
        ctx.tenantDb
          .byIndex<Doc<"finishedGoodsPlacements">>(
            "finishedGoodsPlacements",
            "by_orgId_zoneId_status",
            [
              { field: "zoneId", value: row.zoneId },
              { field: "status", value: status },
            ],
          )
          .all(10_000),
      ),
    )
  ).flat();
  const moveByPallet = new Map(
    await Promise.all(
      [...new Set(placements.map((p) => p.palletId))].map(async (palletId) => {
        const moves = await Promise.all(
          (["RESERVED", "IN_TRANSIT"] as const).map((status) =>
            ctx.tenantDb
              .byIndex<Doc<"finishedGoodsMoves">>(
                "finishedGoodsMoves",
                "by_orgId_palletId_status",
                [
                  { field: "palletId", value: palletId },
                  { field: "status", value: status },
                ],
              )
              .first(),
          ),
        );
        return [palletId, moves.find((m) => m !== null)] as const;
      }),
    ),
  );
  return {
    ...row,
    palletCount: new Set(placements.map((p) => p.palletId)).size,
    unmeasuredPalletCount: placements.filter((p) => !isGeometricPlacement(p))
      .length,
    measuredAreaPartial: placements.some((p) => !isGeometricPlacement(p)),
    occupiedFootprintAreaSqMm: occupiedFootprintAreaSqMm(
      placements.filter(isGeometricPlacement),
    ),
    placements: placements.map((p) => {
      if (!isGeometricPlacement(p))
        return {
          id: p._id,
          palletId: p.palletId,
          code: p.positionCode,
          status: p.status,
          mode: "LOCATION_ONLY" as const,
          assignmentId: p.assignmentId,
          sequence: p.sequence,
        };
      const move = moveByPallet.get(p.palletId);
      return {
        mode: "GEOMETRIC" as const,
        id: p._id,
        palletId: p.palletId,
        code: p.positionCode,
        xMm: p.xMm,
        yMm: p.yMm,
        zMm: p.zMm,
        status: p.status,
        rotation: p.rotation,
        ...(move
          ? {
              moveId: move._id,
              moveState: move.status as "RESERVED" | "IN_TRANSIT",
              moveRole:
                move.targetPlacementId === p._id
                  ? ("TARGET" as const)
                  : ("SOURCE" as const),
            }
          : {}),
      };
    }),
  };
}

const POSITION_STATUSES = ["ACTIVE", "INACTIVE"] as const;
/** Where one area's descendant text search stopped, and the text carried over. */
type DescendantScan = {
  st: number;
  k?: string;
  t?: number;
  i?: string;
  tail: string;
};
function validDescendantScan(value: unknown): value is DescendantScan {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  const boundary = [state.k, state.t, state.i];
  return (
    Number.isSafeInteger(state.st) &&
    (state.st as number) >= 0 &&
    (state.st as number) <= POSITION_STATUSES.length &&
    typeof state.tail === "string" &&
    (boundary.every((part) => part === undefined) ||
      (typeof state.k === "string" &&
        typeof state.t === "number" &&
        Number.isFinite(state.t) &&
        typeof state.i === "string"))
  );
}

/**
 * Search one area's complete position history (active, then inactive, each
 * in index order) for `needle`, in bounded chunks. A match may span adjacent
 * labels/codes, so the last `needle.length - 1` characters carry across
 * chunks. Each call reads at least one chunk, then returns `KeysetSuspend`
 * with its position once this request's budget is spent; the scan resumes it
 * on the next request. History is never truncated or capped.
 */
async function descendantsMatch(
  ctx: TenantFunctionContext,
  zone: Doc<"storageZones">,
  needle: string,
  heading: string,
  work: KeysetWork,
  resume: unknown,
): Promise<boolean | KeysetSuspend> {
  const keep = Math.max(0, needle.length - 1);
  const carry = (text: string) =>
    keep ? text.slice(Math.max(0, text.length - keep)) : "";
  let state: DescendantScan = validDescendantScan(resume)
    ? resume
    : { st: 0, tail: carry(heading) };
  for (let chunk = 0; ; chunk += 1) {
    const status = POSITION_STATUSES[state.st];
    if (!status) return false;
    if (chunk > 0 && work.remaining() <= 0) return new KeysetSuspend(state);
    const limit = Math.min(100, Math.max(10, work.remaining()));
    const { rows, full, read } = await readKeysetRange(
      ctx,
      {
        table: "storagePositions",
        index: "by_orgId_zoneId_status_code",
        equalities: [
          [
            { field: "zoneId", value: zone._id },
            { field: "status", value: status },
          ],
        ],
        keyField: "code",
      },
      state.k === undefined
        ? undefined
        : { key: state.k, time: state.t!, id: state.i! },
      limit,
    );
    work.reads += read + (state.k === undefined ? 1 : 2);
    // Normalize after joining the carried tail, so a combining mark at the
    // start of a chunk composes with the character before it.
    const text = (
      state.tail +
      (rows as Doc<"storagePositions">[])
        .filter((p) => !p.isDefault)
        .map((p) => `${p.label} ${p.code} `)
        .join("")
    )
      .normalize("NFC")
      .toLocaleLowerCase();
    if (text.includes(needle)) return true;
    const last = rows.at(-1) as Doc<"storagePositions"> | undefined;
    state =
      full && last
        ? {
            st: state.st,
            k: last.code,
            t: last._creationTime,
            i: last._id,
            tail: carry(text),
          }
        : { st: state.st + 1, tail: carry(text) };
  }
}

export const page = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    search: v.optional(v.string()),
    status: v.optional(v.string()),
    buildingId: v.optional(v.id("storageBuildings")),
    floorNumber: v.optional(v.number()),
    pageSize: v.number(),
    cursor: v.optional(v.string()),
    scanCursor: v.optional(v.string()),
  },
  returns: v.any(),
  permissionCode: "masterData.storageLayout.read",
  target: { table: "storageZones" },
  warehouseId: (args) => args.warehouseId,
  handler: async (ctx, args) => {
    const { cursor, scanCursor, pageSize, ...criteria } = args;
    const needle = (args.search ?? "")
      .normalize("NFC")
      .trim()
      .toLocaleLowerCase();
    const readLocation = createLocationReader(ctx, false);
    const empty = {
      status: "ready" as const,
      page: [] as Awaited<ReturnType<LocationReader>>[],
      isDone: true,
      continueCursor: "",
      scanned: 0,
    };
    // A building filter reads only that building's areas, and a floor filter
    // inside it is an in-row comparison against one resolved floor.
    let floorId: string | undefined;
    if (args.buildingId) {
      const building = await ctx.tenantDb.get<Doc<"storageBuildings">>(
        "storageBuildings",
        args.buildingId,
      );
      if (!building || building.warehouseId !== args.warehouseId) return empty;
      if (
        args.status &&
        args.status !== "ARCHIVED" &&
        building.status !== args.status
      )
        return empty;
      if (args.floorNumber !== undefined) {
        const floor = await ctx.tenantDb
          .byIndex<Doc<"storageFloors">>(
            "storageFloors",
            "by_orgId_buildingId_floorNumber",
            [
              { field: "buildingId", value: args.buildingId },
              { field: "floorNumber", value: args.floorNumber },
            ],
          )
          .first();
        if (!floor) return empty;
        floorId = floor._id;
      }
    }
    const segment: KeysetSegment = args.buildingId
      ? {
          table: "storageZones",
          index: "by_orgId_buildingId_code",
          equalities: [[{ field: "buildingId", value: args.buildingId }]],
          keyField: "code",
        }
      : {
          table: "storageZones",
          index: "by_orgId_warehouseId_code",
          equalities: [[{ field: "warehouseId", value: args.warehouseId }]],
          keyField: "code",
        };
    const result = await keysetScan(ctx, {
      generation: await storageCatalogueGeneration(
        ctx.tenantDb,
        args.warehouseId,
      ),
      scope: { entity: "locations-v2", ...criteria },
      pageSize,
      cursor,
      scanCursor,
      segments: [
        {
          ...segment,
          dense: !needle && !args.status && args.floorNumber === undefined,
        },
      ],
      maxWork: 1_200,
      // One area at a time, so a long position history can suspend and
      // resume instead of overrunning this request's budget.
      sequential: true,
      get: (id) => ctx.tenantDb.get<Doc<"storageZones">>("storageZones", id),
      evaluate: async (zone, work, { resume, retained }) => {
        // In-row filters first, then cached parents, then descendant text.
        if (zone.warehouseId !== args.warehouseId) return null;
        if (floorId && zone.floorId !== floorId) return null;
        // An archived area is ARCHIVED whatever its building's status.
        if (
          args.status &&
          args.status !== "ARCHIVED" &&
          zone.status !== "ACTIVE"
        )
          return null;
        // Building and floor reads are shared across the snapshot.
        const row = await readLocation(zone);
        if (
          (args.status && row.status !== args.status) ||
          (args.floorNumber !== undefined &&
            row.floorNumber !== args.floorNumber)
        )
          return null;
        // A retained match already passed the text search on this page.
        if (!needle || retained) return row;
        const heading =
          `${row.label} ${row.code} ${row.buildingName} ${row.buildingCode} `
            .normalize("NFC")
            .toLocaleLowerCase();
        if (resume === undefined && heading.includes(needle)) return row;
        const found = await descendantsMatch(
          ctx,
          zone,
          needle,
          heading,
          work,
          resume,
        );
        if (found instanceof KeysetSuspend) return found;
        return found ? row : null;
      },
    });
    return { ...result, page: result.page };
  },
});

export const detail = queryWithOrg({
  args: { warehouseId: v.id("warehouses"), zoneId: v.id("storageZones") },
  returns: v.any(),
  permissionCode: "masterData.storageLayout.read",
  target: { table: "storageZones" },
  warehouseId: (args) => args.warehouseId,
  handler: async (ctx, args) => {
    const zone = await ctx.tenantDb.get<Doc<"storageZones">>(
      "storageZones",
      args.zoneId,
    );
    return zone?.warehouseId === args.warehouseId
      ? withOccupancy(ctx, await createLocationReader(ctx)(zone))
      : null;
  },
});

/** Independent lightweight selector metadata; never derive choices from a page. */
export const options = queryWithOrg({
  args: { warehouseId: v.id("warehouses"), cursor: v.optional(v.string()) },
  returns: v.any(),
  permissionCode: "masterData.storageLayout.read",
  target: { table: "storageBuildings" },
  warehouseId: (args) => args.warehouseId,
  handler: async (ctx, { warehouseId, cursor }) => {
    const result = await paginatedScan(ctx, {
      generation: await storageCatalogueGeneration(ctx.tenantDb, warehouseId),
      scope: { entity: "building-options-v2", warehouseId },
      pageSize: 100,
      ...(cursor ? { cursor } : {}),
      read: (raw, endCursor?: string) =>
        ctx.tenantDb
          .byIndex<Doc<"storageBuildings">>(
            "storageBuildings",
            "by_orgId_warehouseId_code",
            [{ field: "warehouseId", value: warehouseId }],
          )
          .page({
            limit: 100,
            ...(raw ? { cursor: raw } : {}),
            ...(endCursor ? { endCursor } : {}),
          }),
      get: (id) =>
        ctx.tenantDb.get<Doc<"storageBuildings">>("storageBuildings", id),
      hydrate: async (row) => row,
      matches: (row) => row.warehouseId === warehouseId,
    });
    return {
      ...result,
      page: result.page.map((b) => ({
        buildingId: b._id,
        buildingName: b.name,
        buildingCode: b.code,
        floorCount: b.floorCount,
      })),
    };
  },
});

// Compatibility for existing integrations. The catalogue UI uses page above.
export const list = queryWithOrg({
  args: { warehouseId: v.id("warehouses") },
  returns: v.any(),
  permissionCode: "masterData.storageLayout.read",
  target: { table: "storageZones" },
  warehouseId: (args) => args.warehouseId,
  handler: async (ctx, { warehouseId }) => {
    const zones = await ctx.tenantDb
      .byIndex<Doc<"storageZones">>(
        "storageZones",
        "by_orgId_warehouseId_code",
        [{ field: "warehouseId", value: warehouseId }],
      )
      .all(10_000);
    const rows = await Promise.all(zones.map(createLocationReader(ctx)));
    return await Promise.all(
      rows.filter((row) => row !== null).map((row) => withOccupancy(ctx, row)),
    );
  },
});
