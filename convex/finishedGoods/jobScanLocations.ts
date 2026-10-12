import {
  keysetScan,
  prefixSegments,
  type KeysetSegment,
} from "../lib/keysetScan";
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
import {
  resolveTarget,
  targetContext,
  type LayoutParentReads,
} from "./scanning";
import { rows, created } from "./workflow";

const READ = "masterData.storageLayout.read";
const MANAGE = "masterData.storageLayout.manage";
const operation = "finishedGoods.jobScan.location.create";
const argsWarehouse = { warehouseId: v.id("warehouses") };

/** Human labels may contain spaces; reserved identities and control characters may not be registered. */
function normalizeJobLocationCode(raw: string): string | null {
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

type LayoutContext = NonNullable<Awaited<ReturnType<typeof targetContext>>>;

/** Project an already validated physical destination without reading its parents again. */
function locationFromLayout(context: LayoutContext): JobScanLocation {
  return {
    ...context.resolved,
    buildingName: context.building.name,
    buildingCode: context.building.code,
    floorNumber: context.floor.floorNumber,
    layoutPending: false,
  };
}

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
  const zoneOf = createQueryDocumentReader(ctx.tenantDb, "storageZones");
  // Ledger rows already read by an index scan in this snapshot.
  const known = new Map<string, Doc<"locations">>();
  const parents: LayoutParentReads = {
    building: buildingOf,
    floor: floorOf,
    location: (id) => {
      const row = known.get(id);
      return row ? Promise.resolve(row) : locationOf(id);
    },
  };
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
  /**
   * The display source of a physical ledger row: its support position (which
   * carries code, label and building) or, without one, its area. One indexed
   * read; the owning area of a position is read only when needed.
   */
  async function physicalSource(row: Doc<"locations">) {
    known.set(row._id, row);
    const position = await ctx.tenantDb
      .byIndex<Doc<"storagePositions">>(
        "storagePositions",
        "by_orgId_locationId",
        [{ field: "locationId", value: row._id }],
      )
      .first();
    if (position)
      return {
        source: position,
        position,
        zone: () => zoneOf(position.zoneId),
      };
    const zone = await ctx.tenantDb
      .byIndex<Doc<"storageZones">>("storageZones", "by_orgId_locationId", [
        { field: "locationId", value: row._id },
      ])
      .first();
    return zone
      ? { source: zone, position: undefined, zone: async () => zone }
      : null;
  }
  async function physicalTarget(row: Doc<"locations">) {
    const found = await physicalSource(row);
    const zone = found ? await found.zone() : null;
    return found && zone ? { zone, position: found.position } : null;
  }
  async function layout(
    zone: Doc<"storageZones">,
    position?: Doc<"storagePositions">,
  ): Promise<JobScanLocation | null> {
    // Same lifecycle and parent validation as physical scanning, with parents
    // shared across this snapshot. Named registrations never enter that resolver.
    const context = await targetContext(
      ctx,
      warehouseId,
      zone,
      position,
      parents,
    );
    return context ? locationFromLayout(context) : null;
  }
  async function fromRow(
    row: Doc<"locations">,
  ): Promise<JobScanLocation | null> {
    if (row.warehouseId !== warehouseId) return null;
    if (row.locationType === "NAMED_STORAGE") return named(row);
    const target = await physicalTarget(row);
    return target ? layout(target.zone, target.position) : null;
  }
  async function byId(input: {
    locationId?: string;
    zoneId?: string;
    supportPositionId?: string;
  }): Promise<JobScanLocation | null> {
    if (input.locationId) {
      const row = await locationOf(input.locationId);
      return row ? fromRow(row) : null;
    }
    const zone = input.zoneId ? await zoneOf(input.zoneId) : null;
    const position = input.supportPositionId
      ? await ctx.tenantDb.get<Doc<"storagePositions">>(
          "storagePositions",
          input.supportPositionId,
        )
      : undefined;
    if (!zone || (input.supportPositionId && !position)) return null;
    return layout(zone, position ?? undefined);
  }
  return {
    named,
    byId,
    fromRow,
    physicalSource,
    physicalTarget,
    layout,
    building: buildingOf,
    floor: floorOf,
    location: parents.location,
  };
}

async function lookupJobLocation(
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
  return { ok: true as const, location: locationFromLayout(resolved) };
}

/** Case-insensitive search text with the same normalization as registered codes. */
export function normalizeLocationSearch(raw: string) {
  return raw.trim().normalize("NFC").toUpperCase();
}
const containsNeedle = (needle: string) => (text: string) =>
  text.normalize("NFC").toUpperCase().includes(needle);

const ACTIVE_BY_CODE = "by_orgId_warehouseId_status_code";
const ACTIVE_BY_BUILDING = "by_orgId_warehouseId_status_buildingId_code";

/**
 * Ordered index segments for the picker. Without text this is one browse range.
 * With text the indexed code-prefix range comes first, then the disjoint ranges
 * around it as a contains-match fallback. A building filter reads that
 * building's prefix merged in code order with rows still missing `buildingId`
 * (legacy physical rows), so an unmigrated location is never hidden by the
 * filter, and a row whose `buildingId` is backfilled between requests keeps
 * its traversal position instead of moving to an already visited range.
 */
function pickerSegments(
  warehouseId: Id<"warehouses">,
  needle: string,
  buildingId?: Id<"storageBuildings">,
): KeysetSegment[] {
  const active = [
    { field: "warehouseId", value: warehouseId },
    { field: "status", value: "ACTIVE" },
  ];
  const base = buildingId
    ? {
        table: "locations" as const,
        index: ACTIVE_BY_BUILDING,
        equalities: [
          [...active, { field: "buildingId", value: buildingId }],
          [
            ...active,
            { field: "buildingId", value: undefined, missing: true as const },
          ],
        ],
        keyField: "code",
      }
    : {
        table: "locations" as const,
        index: ACTIVE_BY_CODE,
        equalities: [active],
        keyField: "code",
      };
  if (!needle) return [{ ...base, dense: true, phase: "browse" }];
  const split = prefixSegments(base, needle);
  return [split.prefix, ...split.rest];
}

function readyItems(items: JobScanLocation[]) {
  return {
    status: "ready" as const,
    page: items.map((location) => ({ _id: location.locationId, location })),
    items,
    isDone: true,
    continueCursor: "",
    scanned: items.length,
    searching: false,
  };
}

export const resolve = queryWithOrg({
  args: {
    ...argsWarehouse,
    code: v.string(),
    buildingId: v.optional(v.id("storageBuildings")),
  },
  returns: v.any(),
  permissionCode: READ,
  target: { table: "locations" },
  warehouseId: (args) => args.warehouseId,
  handler: async (ctx, args) => {
    const result = await lookupJobLocation(ctx, args.warehouseId, args.code);
    // A filtered picker must not silently offer a location outside its filter.
    if (
      args.buildingId &&
      result.ok &&
      result.location.buildingId !== args.buildingId
    )
      return {
        ok: false as const,
        error: { code: "OUTSIDE_BUILDING_FILTER" },
        location: result.location,
      };
    return result;
  },
});

/** Authorized active buildings for the picker filter, independent of any location page. */
export const buildingOptions = queryWithOrg({
  args: {
    ...argsWarehouse,
    search: v.optional(v.string()),
    cursor: v.optional(v.string()),
    scanCursor: v.optional(v.string()),
    /** Ignored; a client Retry changes it to open a fresh subscription. */
    attempt: v.optional(v.number()),
  },
  returns: v.any(),
  permissionCode: READ,
  target: { table: "storageBuildings" },
  warehouseId: (args) => args.warehouseId,
  handler: async (ctx, args) => {
    const needle = normalizeLocationSearch(args.search ?? "");
    const matches = containsNeedle(needle);
    const result = await keysetScan(ctx, {
      scope: {
        entity: "job-location-buildings",
        warehouseId: args.warehouseId,
        needle,
      },
      pageSize: 50,
      cursor: args.cursor,
      scanCursor: args.scanCursor,
      // "More buildings" is offered only when another option really exists.
      lookahead: true,
      segments: [
        {
          table: "storageBuildings",
          index: "by_orgId_warehouseId_status_code",
          equalities: [
            [
              { field: "warehouseId", value: args.warehouseId },
              { field: "status", value: "ACTIVE" },
            ],
          ],
          keyField: "code",
          dense: !needle,
        },
      ],
      get: (id) =>
        ctx.tenantDb.get<Doc<"storageBuildings">>("storageBuildings", id),
      evaluate: async (row) =>
        row.warehouseId === args.warehouseId &&
        row.status === "ACTIVE" &&
        (!needle || [row.code, row.name].some(matches))
          ? { buildingId: row._id, code: row.code, name: row.name }
          : null,
    });
    return result;
  },
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
    const needle = normalizeLocationSearch(args.search ?? "");
    const matches = containsNeedle(needle);
    // Registrations are active ledger rows; any other status has no members.
    if (args.status && args.status !== "ACTIVE") return readyItems([]);
    const reader = jobLocationReader(ctx, args.warehouseId);
    const result = await keysetScan(ctx, {
      scope: { entity: "named-storage-locations", ...criteria, needle },
      pageSize,
      cursor,
      scanCursor,
      segments: [
        {
          table: "locations",
          index: "by_orgId_warehouseId_status_locationType_code",
          equalities: [
            [
              { field: "warehouseId", value: args.warehouseId },
              { field: "status", value: "ACTIVE" },
              { field: "locationType", value: "NAMED_STORAGE" },
            ],
          ],
          keyField: "code",
          dense: !needle && !args.buildingId && args.floorNumber === undefined,
        },
      ],
      get: (id) => reader.location(id),
      evaluate: async (row, work) => {
        // In-row filters before any parent read.
        if (row.locationType !== "NAMED_STORAGE") return null;
        if (args.buildingId && row.buildingId !== args.buildingId) return null;
        if (needle && ![row.code, row.label ?? row.code].some(matches)) {
          const building = row.buildingId
            ? await reader.building(row.buildingId)
            : null;
          work.reads += 1;
          if (!building || ![building.name, building.code].some(matches))
            return null;
        }
        work.reads += 1;
        const location = await reader.named(row);
        if (
          !location ||
          (args.floorNumber !== undefined &&
            location.floorNumber !== args.floorNumber)
        )
          return null;
        return { _id: row._id, location };
      },
    });
    return {
      ...result,
      items: result.page.map((row) => row.location),
      searching: result.status === "scanning",
    };
  },
});

/**
 * Picker choices. Blank text browses the first page in code order. Text first
 * reads the indexed code-prefix range (`F1-L30` → `F1-L30-16`) and then the
 * remaining ranges for case-insensitive code/name contains matching (Thai,
 * interior fragments); the response says which phase it is in. A page is
 * `ready` once it is full and one further match was found (`isDone: false`)
 * or once every range is exhausted (`isDone: true`); only the latter proves
 * that nothing else matches. Exact identity lookup stays in `resolve`, which
 * the client queries once per settled text.
 */
export const searchPage = queryWithOrg({
  args: {
    ...argsWarehouse,
    text: v.string(),
    buildingId: v.optional(v.id("storageBuildings")),
    pageSize: v.number(),
    cursor: v.optional(v.string()),
    scanCursor: v.optional(v.string()),
    /** Ignored; a client Retry changes it to open a fresh subscription. */
    attempt: v.optional(v.number()),
  },
  returns: v.any(),
  permissionCode: READ,
  target: { table: "locations" },
  warehouseId: (args) => args.warehouseId,
  handler: async (ctx, args) => {
    const raw = args.text.trim();
    const needle = normalizeLocationSearch(raw);
    const reader = jobLocationReader(ctx, args.warehouseId);
    if (args.buildingId) {
      const building = await reader.building(args.buildingId);
      if (
        !building ||
        building.warehouseId !== args.warehouseId ||
        building.status !== "ACTIVE"
      )
        return { ...readyItems([]), buildingUnavailable: true };
    }
    const inBuilding = (location: JobScanLocation | null) =>
      location && (!args.buildingId || location.buildingId === args.buildingId)
        ? location
        : null;
    // A reserved QR is one identity, never a text fragment: answer it directly.
    if (/^ISAS:/i.test(raw)) {
      const match = /^ISAS:LOCATION:1:([^:]+)$/.exec(raw);
      const found = inBuilding(
        match ? await reader.byId({ locationId: match[1]! }) : null,
      );
      return readyItems(found ? [found] : []);
    }
    const matches = containsNeedle(needle);
    const result = await keysetScan(ctx, {
      scope: {
        entity: "job-scan-locations",
        warehouseId: args.warehouseId,
        needle,
        buildingId: args.buildingId ?? null,
      },
      pageSize: args.pageSize,
      cursor: args.cursor,
      scanCursor: args.scanCursor,
      segments: pickerSegments(args.warehouseId, needle, args.buildingId),
      maxWork: 800,
      // A ready page with `isDone` means no later row matches, so the client
      // may treat it as search exhaustion (for example before offering to
      // register typed text). `ready` alone only completes this page.
      lookahead: true,
      get: (id) => reader.location(id),
      evaluate: async (row, work) => {
        if (row.warehouseId !== args.warehouseId || row.status !== "ACTIVE")
          return null;
        if (row.locationType === "NAMED_STORAGE") {
          if (needle && ![row.code, row.label ?? row.code].some(matches))
            return null;
          if (args.buildingId && row.buildingId !== args.buildingId)
            return null;
          work.reads += 1;
          return reader.named(row);
        }
        // Match on the position/area text and building before reading parents.
        const found = await reader.physicalSource(row);
        work.reads += 1;
        if (!found) return null;
        const { source } = found;
        if (needle && ![source.code, source.label].some(matches)) return null;
        if (args.buildingId && source.buildingId !== args.buildingId)
          return null;
        const zone = await found.zone();
        work.reads += 2;
        return zone
          ? inBuilding(await reader.layout(zone, found.position))
          : null;
      },
    });
    return {
      ...result,
      page: result.page.map((location) => ({
        _id: location.locationId,
        location,
      })),
      items: result.page,
      searching: result.status === "scanning",
    };
  },
});
