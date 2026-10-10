import {
  paginatedScan,
  remainingScanCapacity,
} from "../lib/cataloguePagination";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import {
  mutationWithOrg,
  queryWithOrg,
  type TenantFunctionContext,
} from "../lib/tenantFunctions";
import {
  createMasterDataRow,
  normalizeDisplayName,
  replayTenantWriteIfPresent,
} from "../lib/masterDataStore";
import { refusal, writeContextOf, written } from "../lib/writeEnvelope";
import { createQueryDocumentReader } from "../lib/queryDocumentReader";
import { resolveTarget, targetContext } from "./scanning";
import { rows, created } from "./workflow";

const READ = "masterData.storageLayout.read";
const MANAGE = "masterData.storageLayout.manage";
const operation = "finishedGoods.jobScan.location.create";
const argsWarehouse = { warehouseId: v.id("warehouses") };

/** Human labels may contain spaces; reserved identities and control characters may not be registered. */
export function normalizeJobLocationCode(raw: string): string | null {
  const code = raw.trim().normalize("NFC").toUpperCase();
  return !code ||
    code.length > 200 ||
    /\p{C}/u.test(code) ||
    /^ISAS:/i.test(code)
    ? null
    : code;
}

export type JobScanLocation = {
  locationId: Id<"locations">;
  zoneId?: Id<"storageZones">;
  supportPositionId?: Id<"storagePositions">;
  buildingId: Id<"storageBuildings">;
  buildingName: string;
  buildingCode: string;
  floorId?: Id<"storageFloors">;
  floorNumber?: number;
  code: string;
  name: string;
  layoutPending: boolean;
};

/** Cache parent reads only within this authorized query/mutation snapshot. */
export function jobLocationReader(
  ctx: TenantFunctionContext,
  warehouseId: Id<"warehouses">,
) {
  const buildingOf = createQueryDocumentReader(
    ctx.tenantDb,
    "storageBuildings",
  );
  const floorOf = createQueryDocumentReader(ctx.tenantDb, "storageFloors");
  const locationOf = createQueryDocumentReader(ctx.tenantDb, "locations");
  async function named(row: Doc<"locations">): Promise<JobScanLocation | null> {
    if (
      row.warehouseId !== warehouseId ||
      row.status !== "ACTIVE" ||
      row.locationType !== "NAMED_STORAGE" ||
      !row.buildingId
    )
      return null;
    const building = await buildingOf(row.buildingId);
    const floor = row.floorId ? await floorOf(row.floorId) : null;
    if (
      !building ||
      building.warehouseId !== warehouseId ||
      building.status !== "ACTIVE" ||
      (row.floorId &&
        (!floor ||
          floor.buildingId !== building._id ||
          floor.warehouseId !== warehouseId))
    )
      return null;
    return {
      locationId: row._id,
      buildingId: building._id,
      buildingName: building.name,
      buildingCode: building.code,
      ...(floor ? { floorId: floor._id, floorNumber: floor.floorNumber } : {}),
      code: row.code,
      name: row.label ?? row.code,
      layoutPending: true,
    };
  }
  async function layout(
    zone: Doc<"storageZones">,
    position?: Doc<"storagePositions">,
  ): Promise<JobScanLocation | null> {
    // Same lifecycle and parent validation as physical scanning. Named registrations never enter that resolver.
    const context = await targetContext(ctx, warehouseId, zone, position);
    if (!context) return null;
    const { building, floor } = context;
    return {
      ...context.resolved,
      buildingName: building.name,
      buildingCode: building.code,
      floorNumber: floor.floorNumber,
      layoutPending: false,
    };
  }
  async function byId(input: {
    locationId?: string;
    zoneId?: string;
    supportPositionId?: string;
  }): Promise<JobScanLocation | null> {
    if (input.locationId) {
      const row = await locationOf(input.locationId);
      if (!row || row.warehouseId !== warehouseId) return null;
      if (row.locationType === "NAMED_STORAGE") return named(row);
      const position = await ctx.tenantDb
        .byIndex<Doc<"storagePositions">>(
          "storagePositions",
          "by_orgId_locationId",
          [{ field: "locationId", value: row._id }],
        )
        .first();
      const zone = position
        ? await ctx.tenantDb.get<Doc<"storageZones">>(
            "storageZones",
            position.zoneId,
          )
        : await ctx.tenantDb
            .byIndex<Doc<"storageZones">>(
              "storageZones",
              "by_orgId_locationId",
              [{ field: "locationId", value: row._id }],
            )
            .first();
      return zone ? layout(zone, position ?? undefined) : null;
    }
    const zone = input.zoneId
      ? await ctx.tenantDb.get<Doc<"storageZones">>(
          "storageZones",
          input.zoneId,
        )
      : null;
    const position = input.supportPositionId
      ? await ctx.tenantDb.get<Doc<"storagePositions">>(
          "storagePositions",
          input.supportPositionId,
        )
      : undefined;
    if (!zone || (input.supportPositionId && !position)) return null;
    return layout(zone, position ?? undefined);
  }
  return { named, layout, byId };
}

export async function lookupJobLocation(
  ctx: TenantFunctionContext,
  warehouseId: Id<"warehouses">,
  raw: string,
) {
  const input = raw.trim();
  const fail = (code: string) => ({ ok: false as const, error: { code } });
  if (!input || input.length > 500 || /\p{C}/u.test(input))
    return fail("INVALID_IDENTITY");
  const reader = jobLocationReader(ctx, warehouseId);
  if (/^ISAS:/i.test(input)) {
    // A reserved QR is an identity, never a candidate label for creation.
    const match = /^ISAS:LOCATION:1:([^:]+)$/.exec(input);
    if (!match) return fail("INVALID_IDENTITY");
    const found = await reader.byId({ locationId: match[1]! });
    return found
      ? { ok: true as const, location: found }
      : fail("LOCATION_UNAVAILABLE");
  }
  const code = normalizeJobLocationCode(input);
  if (!code) return fail("INVALID_IDENTITY");
  const [ledger, zone, position, pallet, zonesByQr, positionsByQr] =
    await Promise.all([
      ctx.tenantDb
        .byIndex<Doc<"locations">>("locations", "by_orgId_warehouseId_code", [
          { field: "warehouseId", value: warehouseId },
          { field: "code", value: code },
        ])
        .first(),
      ctx.tenantDb
        .byIndex<Doc<"storageZones">>(
          "storageZones",
          "by_orgId_warehouseId_code",
          [
            { field: "warehouseId", value: warehouseId },
            { field: "code", value: code },
          ],
        )
        .first(),
      ctx.tenantDb
        .byIndex<Doc<"storagePositions">>(
          "storagePositions",
          "by_orgId_warehouseId_code",
          [
            { field: "warehouseId", value: warehouseId },
            { field: "code", value: code },
          ],
        )
        .first(),
      ctx.tenantDb
        .byIndex<Doc<"finishedGoodsPallets">>(
          "finishedGoodsPallets",
          "by_orgId_warehouseId_code",
          [
            { field: "warehouseId", value: warehouseId },
            { field: "code", value: code },
          ],
        )
        .first(),
      rows<Doc<"storageZones">>(ctx, "storageZones", "by_orgId_qrValue", [
        { field: "qrValue", value: input },
      ]),
      rows<Doc<"storagePositions">>(
        ctx,
        "storagePositions",
        "by_orgId_qrValue",
        [{ field: "qrValue", value: input }],
      ),
    ]);
  const hasLegacyQr = [...zonesByQr, ...positionsByQr].some(
    (row) => row.warehouseId === warehouseId,
  );
  if (pallet) return fail("WRONG_ENTITY_TYPE");
  if (ledger?.locationType === "NAMED_STORAGE") {
    if (zone || position || hasLegacyQr) return fail("AMBIGUOUS_IDENTITY");
    const found = await reader.named(ledger);
    return found
      ? { ok: true as const, location: found }
      : fail("LOCATION_UNAVAILABLE");
  }
  if (!ledger && !zone && !position && !hasLegacyQr)
    return fail("LOCATION_NOT_FOUND");
  const resolved = await resolveTarget(ctx, warehouseId, input);
  if ("error" in resolved) return fail(resolved.error);
  if (ledger && ledger._id !== resolved.resolved.locationId)
    return fail("AMBIGUOUS_IDENTITY");
  const found = await reader.layout(
    resolved.zone,
    "zoneId" in resolved.target ? resolved.target : undefined,
  );
  return found
    ? { ok: true as const, location: found }
    : fail("LOCATION_UNAVAILABLE");
}

export const resolve = queryWithOrg({
  args: { ...argsWarehouse, code: v.string() },
  returns: v.any(),
  permissionCode: READ,
  target: { table: "locations" },
  warehouseId: (args) => args.warehouseId,
  handler: (ctx, args) => lookupJobLocation(ctx, args.warehouseId, args.code),
});

export const options = queryWithOrg({
  args: argsWarehouse,
  returns: v.any(),
  permissionCode: READ,
  target: { table: "storageBuildings" },
  warehouseId: (args) => args.warehouseId,
  handler: async (ctx, args) => {
    const buildings = (
      await rows<Doc<"storageBuildings">>(
        ctx,
        "storageBuildings",
        "by_orgId_warehouseId_status_code",
        [{ field: "warehouseId", value: args.warehouseId }],
      )
    ).filter((row) => row.status === "ACTIVE");
    return {
      buildings: await Promise.all(
        buildings.map(async (building) => ({
          id: building._id,
          code: building.code,
          name: building.name,
          floors: (
            await rows<Doc<"storageFloors">>(
              ctx,
              "storageFloors",
              "by_orgId_warehouseId_buildingId_floorNumber",
              [
                { field: "warehouseId", value: args.warehouseId },
                { field: "buildingId", value: building._id },
              ],
            )
          )
            .filter((floor) => floor.warehouseId === args.warehouseId)
            .map((floor) => ({ id: floor._id, number: floor.floorNumber })),
        })),
      ),
    };
  },
});

export const create = mutationWithOrg({
  args: {
    ...argsWarehouse,
    requestId: v.string(),
    code: v.string(),
    name: v.optional(v.string()),
    buildingId: v.id("storageBuildings"),
    floorId: v.optional(v.id("storageFloors")),
  },
  returns: v.any(),
  permissionCode: MANAGE,
  target: { table: "locations" },
  warehouseId: (args) => args.warehouseId,
  handler: async (ctx, args) => {
    if (!args.requestId.trim() || args.requestId.length > 200)
      return refusal({ code: "REQUEST_IDENTITY_INVALID" });
    const code = normalizeJobLocationCode(args.code);
    if (!code) return refusal({ code: "FIELD_INVALID", field: "code" });
    const name = normalizeDisplayName("name", args.name?.trim() || code);
    if (!name.ok) return refusal(name.error);
    const context = writeContextOf(ctx, {
      table: "locations",
      operation,
      requestId: args.requestId,
      warehouseId: args.warehouseId,
    });
    const fingerprint = { ...args, code, name: name.value };
    const replay = await replayTenantWriteIfPresent({
      ...context,
      fingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value) return written(replay.value);
    const [warehouse, building, floor] = await Promise.all([
      ctx.tenantDb.get<Doc<"warehouses">>("warehouses", args.warehouseId),
      ctx.tenantDb.get<Doc<"storageBuildings">>(
        "storageBuildings",
        args.buildingId,
      ),
      args.floorId
        ? ctx.tenantDb.get<Doc<"storageFloors">>("storageFloors", args.floorId)
        : null,
    ]);
    if (
      !warehouse ||
      warehouse.status !== "ACTIVE" ||
      !building ||
      building.warehouseId !== args.warehouseId ||
      building.status !== "ACTIVE"
    )
      return refusal({ code: "REFERENCE_NOT_FOUND", field: "buildingId" });
    if (
      args.floorId &&
      (!floor ||
        floor.buildingId !== building._id ||
        floor.warehouseId !== args.warehouseId)
    )
      return refusal({ code: "REFERENCE_NOT_FOUND", field: "floorId" });
    // Reads cover canonical and legacy code indexes; concurrent registration/layout creation conflicts and retries.
    const lookup = await lookupJobLocation(ctx, args.warehouseId, code);
    if (lookup.ok || lookup.error.code !== "LOCATION_NOT_FOUND")
      return refusal({ code: "DUPLICATE_KEY", field: "code" });
    const result = await createMasterDataRow({
      ...context,
      fingerprint,
      uniqueness: [
        {
          field: "code",
          index: "by_orgId_warehouseId_code",
          equality: [
            { field: "warehouseId", value: args.warehouseId },
            { field: "code", value: code },
          ],
        },
      ],
      document: {
        warehouseId: args.warehouseId,
        code,
        label: name.value,
        locationType: "NAMED_STORAGE",
        status: "ACTIVE",
        buildingId: args.buildingId,
        ...(args.floorId ? { floorId: args.floorId } : {}),
        version: 1,
        ...created(ctx),
      },
    });
    return result.ok ? written(result.value) : refusal(result.error);
  },
});

/** Independent bounded catalogue page for registrations that have no floor-plan geometry. */
export const page = queryWithOrg({
  args: {
    ...argsWarehouse,
    search: v.optional(v.string()),
    buildingId: v.optional(v.id("storageBuildings")),
    floorNumber: v.optional(v.number()),
    status: v.optional(v.string()),
    pageSize: v.number(),
    cursor: v.optional(v.string()),
    scanCursor: v.optional(v.string()),
  },
  returns: v.any(),
  permissionCode: READ,
  target: { table: "locations" },
  warehouseId: (args) => args.warehouseId,
  handler: async (ctx, args) => {
    const { cursor, scanCursor, pageSize, ...criteria } = args;
    const reader = jobLocationReader(ctx, args.warehouseId);
    const needle = args.search?.trim().toUpperCase();
    return paginatedScan(ctx, {
      scope: { entity: "named-storage-locations", ...criteria },
      pageSize,
      cursor,
      scanCursor,
      read: (rawCursor, endCursor) =>
        ctx.tenantDb
          .byIndex<Doc<"locations">>(
            "locations",
            "by_orgId_warehouseId_status_locationType_code",
            [
              { field: "warehouseId", value: args.warehouseId },
              { field: "status", value: "ACTIVE" },
              { field: "locationType", value: "NAMED_STORAGE" },
            ],
          )
          .page({
            limit: Math.min(20, remainingScanCapacity(scanCursor, pageSize)),
            ...(rawCursor ? { cursor: rawCursor } : {}),
            ...(endCursor ? { endCursor } : {}),
          }),
      get: (id) => ctx.tenantDb.get<Doc<"locations">>("locations", id),
      hydrate: async (row) => ({
        _id: row._id,
        location: await reader.named(row),
      }),
      matches: (row) =>
        !!row.location &&
        (!args.status || args.status === "ACTIVE") &&
        (!args.buildingId || row.location.buildingId === args.buildingId) &&
        (args.floorNumber === undefined ||
          row.location.floorNumber === args.floorNumber) &&
        (!needle ||
          [
            row.location.code,
            row.location.name,
            row.location.buildingName,
            row.location.buildingCode,
          ].some((text) => text.toUpperCase().includes(needle))),
    });
  },
});

export const searchPage = queryWithOrg({
  args: {
    ...argsWarehouse,
    text: v.string(),
    pageSize: v.number(),
    cursor: v.optional(v.string()),
    scanCursor: v.optional(v.string()),
  },
  returns: v.any(),
  permissionCode: READ,
  target: { table: "locations" },
  warehouseId: (args) => args.warehouseId,
  handler: async (ctx, args) => {
    const { cursor, scanCursor, pageSize, ...criteria } = args;
    const reader = jobLocationReader(ctx, args.warehouseId);
    const needle = args.text.trim().toUpperCase();
    const exact = needle
      ? await lookupJobLocation(ctx, args.warehouseId, args.text)
      : null;
    const result = await paginatedScan(ctx, {
      scope: { entity: "job-scan-locations", ...criteria },
      pageSize,
      cursor,
      scanCursor,
      read: (rawCursor, endCursor) =>
        ctx.tenantDb
          .byIndex<Doc<"locations">>(
            "locations",
            "by_orgId_warehouseId_status_code",
            [
              { field: "warehouseId", value: args.warehouseId },
              { field: "status", value: "ACTIVE" },
            ],
          )
          .page({
            limit: Math.min(20, remainingScanCapacity(scanCursor, pageSize)),
            ...(rawCursor ? { cursor: rawCursor } : {}),
            ...(endCursor ? { endCursor } : {}),
          }),
      get: (id) => ctx.tenantDb.get<Doc<"locations">>("locations", id),
      hydrate: async (row) => ({
        _id: row._id,
        location: await reader.byId({ locationId: row._id }),
      }),
      matches: (row) =>
        !!row.location &&
        (!needle ||
          (exact?.ok &&
            row.location.locationId === exact.location.locationId) ||
          [row.location.code, row.location.name].some((text) =>
            text.toUpperCase().includes(needle),
          )),
    });
    return {
      ...result,
      items: result.page.flatMap((row) => (row.location ? [row.location] : [])),
      canCreate:
        exact !== null &&
        !exact.ok &&
        exact.error.code === "LOCATION_NOT_FOUND",
      lookupError: exact && !exact.ok ? exact.error.code : undefined,
    };
  },
});
