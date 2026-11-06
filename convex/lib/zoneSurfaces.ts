import type { GenericMutationCtx } from "convex/server";
import { internal } from "../_generated/api";
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import { TenantDbError, type TenantDocumentAccess } from "./tenantDb";
import {
  canonical,
  legacyWriterGeneration,
  ZONE_OCCUPANCY_VERSION,
  zoneOccupancyReadiness,
  zoneRowsTrusted,
} from "./zoneOccupancy";

/**
 * Derived per-zone layout ("surface") rows for recommendations.
 *
 * A recommendation evaluates every compatible zone: its fields, whether it
 * and its location are usable, and its ACTIVE positions with each position's
 * location. Read from the layout that is two documents per zone plus two per
 * position; a surface row holds the same facts in one small document, indexed
 * by storage condition so a recommendation reads only zones whose condition
 * can match the product.
 *
 * Exactness:
 * - Tracked mutations rebuild the rows of every zone they touch (zones,
 *   positions, locations, a building's status) in the same transaction
 *   (`trackSurfaceWrites`). A mutation touching more than a budget defers:
 *   it marks the warehouse's occupancy readiness stale and schedules a
 *   rebuild, and readers use the layout meanwhile.
 * - The occupancy backfill rebuilds every zone's row, stamping its run.
 * - Readers use rows only while the occupancy readiness is ready and its
 *   `layoutGeneration` equals the warehouse's storage layout generation.
 *   Maintaining writes advance both; code that does not maintain these rows
 *   still advances the generation on layout writes, so readers stop trusting
 *   them until a rebuild (`recommendationReadiness`).
 * - Floors, buildings and reserved blocks are not copied: readers read them
 *   (one each per floor or building) and check them as before.
 */
export const MAX_ZONE_SURFACE_POSITIONS = 500;
/**
 * Per-mutation maintenance budgets. Beyond them a mutation defers: it marks
 * the warehouse's occupancy readiness stale and schedules a rebuild, so a
 * large layout change (activating a building of thousands of positions)
 * costs its transaction two documents, and readers use the layout meanwhile.
 */
/** Zones one mutation may rebuild. */
export const SURFACE_REFRESH_ZONE_BUDGET = 60;
/** Documents one mutation may read rebuilding zones' rows. */
export const SURFACE_REFRESH_READ_BUDGET = 1_200;
/** Locations one mutation may write (each may need a zone rebuilt). */
export const SURFACE_REFRESH_LOCATION_BUDGET = 300;
/** Written locations of zones not otherwise rebuilt, each found by two lookups. */
export const SURFACE_LOOKUP_LOCATION_BUDGET = 50;

type Zone = Doc<"storageZones">;
type Position = Doc<"storagePositions">;
type Building = Doc<"storageBuildings">;
type Location = Doc<"locations">;
export type ZoneSurfaceRow = Doc<"storageZoneSurfaces">;
export type SurfacePosition = ZoneSurfaceRow["positions"][number];

/** The zone fields recommendations read; a zone document satisfies it. */
export type SurfaceZone = Pick<
  Zone,
  | "_id"
  | "_creationTime"
  | "warehouseId"
  | "buildingId"
  | "floorId"
  | "locationId"
  | "code"
  | "label"
  | "qrValue"
  | "status"
  | "mode"
  | "storageCondition"
  | "baseElevationMm"
  | "xMm"
  | "yMm"
  | "widthMm"
  | "depthMm"
  | "maxStackHeightMm"
>;

/** conditionCheck's normalization: "" for none. */
export const conditionKey = (condition: string | undefined) =>
  condition?.trim().toUpperCase() ?? "";

/**
 * The zone conditions that can match a product's: every zone when the
 * product requires none or ANY (null), else unconditioned, ANY and its own.
 */
export function compatibleConditionKeys(required: string): string[] | null {
  const key = conditionKey(required);
  return !key || key === "ANY" ? null : [...new Set(["", "ANY", key])];
}

export const usableLocation = (
  location: Pick<Location, "status" | "warehouseId"> | null,
  warehouseId: string,
) =>
  location !== null &&
  location.status === "ACTIVE" &&
  location.warehouseId === warehouseId;

export function surfacePosition(
  position: Position,
  usable: boolean,
): SurfacePosition {
  return {
    _id: position._id,
    code: position.code,
    label: position.label,
    ...(position.xMm === undefined ? {} : { xMm: position.xMm }),
    ...(position.yMm === undefined ? {} : { yMm: position.yMm }),
    ...(position.widthMm === undefined ? {} : { widthMm: position.widthMm }),
    ...(position.depthMm === undefined ? {} : { depthMm: position.depthMm }),
    ...(position.elevationMm === undefined
      ? {}
      : { elevationMm: position.elevationMm }),
    usable,
  };
}

/** The zone's view as a row stores it (`zone`), back as a SurfaceZone. */
export function surfaceZone(row: ZoneSurfaceRow): SurfaceZone {
  return {
    ...row.zone,
    _id: row.zoneId,
    warehouseId: row.warehouseId,
    buildingId: row.buildingId,
    floorId: row.floorId,
    code: row.code,
  };
}

/** ACTIVE positions in by_orgId_zoneId_status_code order, or null above the cap. */
export async function activePositions(
  db: Pick<TenantDocumentAccess, "byIndex">,
  zoneId: string,
) {
  try {
    return await db
      .byIndex<Position>("storagePositions", "by_orgId_zoneId_status_code", [
        { field: "zoneId", value: zoneId },
        { field: "status", value: "ACTIVE" },
      ])
      .all(MAX_ZONE_SURFACE_POSITIONS);
  } catch (error) {
    if (error instanceof TenantDbError && error.code === "CAPACITY_DATA_LIMIT")
      return null;
    throw error;
  }
}

/** Build one zone's row from the layout. Returns its fields and documents read. */
async function buildSurface(
  db: Pick<TenantDocumentAccess, "get" | "byIndex">,
  zone: Zone,
  runId: string,
  readBuilding: (id: string) => Promise<Building | null>,
) {
  const [building, location, positions] = await Promise.all([
    readBuilding(zone.buildingId),
    db.get<Location>("locations", zone.locationId),
    activePositions(db, zone._id),
  ]);
  const locations = new Map<string, Promise<Location | null>>([
    [zone.locationId as string, Promise.resolve(location)],
  ]);
  const surfaces = await Promise.all(
    (positions ?? []).map(async (position) => {
      let pending = locations.get(position.locationId);
      if (!pending) {
        pending = db.get<Location>("locations", position.locationId);
        locations.set(position.locationId, pending);
      }
      return surfacePosition(
        position,
        usableLocation(await pending, zone.warehouseId),
      );
    }),
  );
  const fields = {
    warehouseId: zone.warehouseId,
    buildingId: zone.buildingId,
    floorId: zone.floorId,
    zoneId: zone._id,
    version: ZONE_OCCUPANCY_VERSION,
    runId,
    buildingActive:
      building?.status === "ACTIVE" &&
      building.warehouseId === zone.warehouseId,
    eligible:
      zone.status === "ACTIVE" && usableLocation(location, zone.warehouseId),
    conditionKey: conditionKey(zone.storageCondition),
    code: zone.code,
    zone: {
      _creationTime: zone._creationTime,
      locationId: zone.locationId,
      label: zone.label,
      qrValue: zone.qrValue,
      status: zone.status,
      ...(zone.mode === undefined ? {} : { mode: zone.mode }),
      ...(zone.storageCondition === undefined
        ? {}
        : { storageCondition: zone.storageCondition }),
      ...(zone.baseElevationMm === undefined
        ? {}
        : { baseElevationMm: zone.baseElevationMm }),
      xMm: zone.xMm,
      yMm: zone.yMm,
      widthMm: zone.widthMm,
      depthMm: zone.depthMm,
      maxStackHeightMm: zone.maxStackHeightMm,
    },
    complete: positions !== null,
    positions: surfaces,
  };
  const read =
    3 +
    (positions === null ? MAX_ZONE_SURFACE_POSITIONS + 1 : positions.length) +
    locations.size;
  return { fields, read, locations: [...locations.keys()] };
}

const surfaceRow = (
  db: Pick<TenantDocumentAccess, "byIndex">,
  zoneId: string,
) =>
  db
    .byIndex<ZoneSurfaceRow>("storageZoneSurfaces", "by_orgId_zoneId", [
      { field: "zoneId", value: zoneId },
    ])
    .unique();

/**
 * Rebuild one zone's row (backfill, maintenance). Deletes the row of a zone
 * that no longer exists. Writes nothing when the row is unchanged, so layout
 * writes that do not change it never re-run its readers. Returns an upper
 * bound on the documents it read.
 */
export async function rebuildZoneSurface(
  db: TenantDocumentAccess,
  zoneId: string,
  runId: string,
  readBuilding: (id: string) => Promise<Building | null> = (id) =>
    db.get<Building>("storageBuildings", id),
  knownZone?: Zone,
) {
  const [zone, existing] = await Promise.all([
    knownZone ?? db.get<Zone>("storageZones", zoneId),
    surfaceRow(db, zoneId),
  ]);
  if (!zone) {
    if (existing) await db.delete("storageZoneSurfaces", existing._id);
    return { read: 2, locations: [] as string[] };
  }
  const { fields, read, locations } = await buildSurface(
    db,
    zone,
    runId,
    readBuilding,
  );
  if (!existing) await db.insert("storageZoneSurfaces", fields);
  else {
    const { _id, _creationTime, orgId, ...stored } = existing;
    void _id;
    void _creationTime;
    void orgId;
    if (canonical(stored) !== canonical(fields))
      await db.replace("storageZoneSurfaces", existing._id, fields);
  }
  /** Documents read (an upper bound), and the locations the row reflects. */
  return { read: read + 2, locations };
}

async function readinessRow(
  db: Pick<TenantDocumentAccess, "byIndex">,
  warehouseId: string,
) {
  return db
    .byIndex<Doc<"storageZoneOccupancyReadiness">>(
      "storageZoneOccupancyReadiness",
      "by_orgId_warehouseId",
      [{ field: "warehouseId", value: warehouseId }],
    )
    .unique();
}

/** The warehouse's storage layout generation (bumped by tracked layout writes). */
export async function layoutGeneration(
  db: Pick<TenantDocumentAccess, "byIndex">,
  warehouseId: string,
) {
  const row = await db
    .byIndex<Doc<"storageCatalogueSignals">>(
      "storageCatalogueSignals",
      "by_orgId_warehouseId",
      [{ field: "warehouseId", value: warehouseId }],
    )
    .unique();
  return row?.generation ?? 0;
}

/**
 * What recommendation readers may use, from one read of each readiness
 * input: `occupancy` (zone-scoped occupancy rows, as zoneOccupancyReady), and
 * `surfaces` when surface rows are also in step with the layout; their run
 * (rows of other runs belong to zones deleted since).
 */
export async function recommendationReadiness(
  db: Pick<TenantDocumentAccess, "byIndex">,
  warehouseId: string,
): Promise<{ occupancy: boolean; surfaces: { runId: string } | null }> {
  const [row, legacy, generation] = await Promise.all([
    zoneOccupancyReadiness(db, warehouseId),
    legacyWriterGeneration(db, warehouseId),
    layoutGeneration(db, warehouseId),
  ]);
  const occupancy = zoneRowsTrusted(row, legacy);
  return {
    occupancy,
    surfaces:
      occupancy &&
      row.runId !== undefined &&
      row.layoutGeneration === generation
        ? { runId: row.runId }
        : null,
  };
}

/** Surface rows of a warehouse's listed zones with one condition key (or all). */
export function listedSurfaces(
  db: Pick<TenantDocumentAccess, "byIndex">,
  warehouseId: string,
  key?: string,
) {
  return db
    .byIndex<ZoneSurfaceRow>(
      "storageZoneSurfaces",
      "by_orgId_warehouseId_buildingActive_eligible_conditionKey",
      [
        { field: "warehouseId", value: warehouseId },
        { field: "buildingActive", value: true },
        { field: "eligible", value: true },
        ...(key === undefined ? [] : [{ field: "conditionKey", value: key }]),
      ],
    )
    .all(10_000);
}

/** One zone's row when it is current, else null (read the layout instead). */
export async function currentZoneSurface(
  db: Pick<TenantDocumentAccess, "byIndex">,
  zoneId: string,
  runId: string,
) {
  const row = await surfaceRow(db, zoneId);
  return row?.runId === runId && row.version === ZONE_OCCUPANCY_VERSION
    ? row
    : null;
}

/**
 * Collect one mutation's layout writes, then rebuild the affected zones' rows
 * in the same transaction (`flush`, after every source write).
 */
export function trackSurfaceWrites(db: TenantDocumentAccess) {
  const zones = new Set<string>();
  const locations = new Set<string>();
  const warehouses = new Set<string>();
  const buildingStatus = new Map<string, string | null>();
  /**
   * Called for each write, before and after it, with the document as the
   * write tracker read it then (null when absent), so nothing is read twice.
   * Locations are not read: the zones they belong to are found at flush.
   */
  const note = (
    table: string,
    id: string,
    row: { warehouseId: string; zoneId?: string; status?: string } | null,
    inserted: boolean,
  ) => {
    if (table === "locations") {
      locations.add(id);
      return;
    }
    if (
      table !== "storageZones" &&
      table !== "storagePositions" &&
      table !== "storageBuildings"
    )
      return;
    if (row) warehouses.add(row.warehouseId);
    if (table === "storageZones") zones.add(id);
    else if (table === "storagePositions") {
      if (row?.zoneId) zones.add(row.zoneId);
    } else if (!buildingStatus.has(id))
      buildingStatus.set(id, inserted ? null : (row?.status ?? null));
  };
  /** Zones of buildings whose status changed, or null above the budget. */
  const buildingZones = async (found: Set<string>) => {
    for (const [buildingId, before] of buildingStatus) {
      const building = await db.get<Building>("storageBuildings", buildingId);
      if ((building?.status ?? null) === before) continue;
      const zonesOf = await db
        .byIndex<Zone>("storageZones", "by_orgId_buildingId_code", [
          { field: "buildingId", value: buildingId },
        ])
        .take(SURFACE_REFRESH_ZONE_BUDGET + 1);
      for (const zone of zonesOf) found.add(zone._id);
      if (found.size > SURFACE_REFRESH_ZONE_BUDGET) return false;
    }
    return true;
  };
  return {
    note,
    /**
     * Rebuild the affected rows and keep each warehouse's readiness in step
     * with its layout generation. `generations` holds the layout generation
     * of each warehouse whose layout this mutation wrote, before and after
     * its own signal bump.
     */
    flush: async (
      generations: ReadonlyMap<string, { before: number; after: number }>,
      scheduler?: GenericMutationCtx<DataModel>["scheduler"],
    ) => {
      if (
        !zones.size &&
        !locations.size &&
        !buildingStatus.size &&
        !generations.size
      )
        return;
      for (const warehouseId of generations.keys()) warehouses.add(warehouseId);
      const readiness = new Map<
        string,
        Doc<"storageZoneOccupancyReadiness"> | null
      >();
      const readinessOf = async (warehouseId: string) => {
        if (!readiness.has(warehouseId))
          readiness.set(warehouseId, await readinessRow(db, warehouseId));
        return readiness.get(warehouseId)!;
      };
      const buildings = new Map<string, Promise<Building | null>>();
      const readBuilding = (id: string) => {
        let pending = buildings.get(id);
        if (!pending) {
          pending = db.get<Building>("storageBuildings", id);
          buildings.set(id, pending);
        }
        return pending;
      };
      const done = new Set<string>();
      const covered = new Set<string>();
      let spent = 0;
      /** Rebuild these zones' rows; false once over the read budget. */
      const rebuild = async (zoneIds: Iterable<string>) => {
        for (const zoneId of zoneIds) {
          if (done.has(zoneId)) continue;
          if (done.size >= SURFACE_REFRESH_ZONE_BUDGET) return false;
          if (spent >= SURFACE_REFRESH_READ_BUDGET) return false;
          done.add(zoneId);
          const zone = await db.get<Zone>("storageZones", zoneId);
          if (zone) warehouses.add(zone.warehouseId);
          const run = zone ? (await readinessOf(zone.warehouseId))?.runId : "";
          const result = await rebuildZoneSurface(
            db,
            zoneId,
            run ?? "",
            readBuilding,
            zone ?? undefined,
          );
          spent += result.read;
          for (const id of result.locations) covered.add(id);
        }
        return true;
      };
      const found = new Set(zones);
      let inBudget =
        locations.size <= SURFACE_REFRESH_LOCATION_BUDGET &&
        (await buildingZones(found)) &&
        (await rebuild(found));
      // Written locations the rebuilt rows do not reflect: find their zones.
      const uncovered = [...locations].filter((id) => !covered.has(id));
      if (inBudget && uncovered.length > SURFACE_LOOKUP_LOCATION_BUDGET)
        inBudget = false;
      if (inBudget)
        for (const locationId of uncovered) {
          const [zone, positions] = await Promise.all([
            db
              .byIndex<Zone>("storageZones", "by_orgId_locationId", [
                { field: "locationId", value: locationId },
              ])
              .take(SURFACE_REFRESH_ZONE_BUDGET + 1),
            db
              .byIndex<Position>("storagePositions", "by_orgId_locationId", [
                { field: "locationId", value: locationId },
              ])
              .take(SURFACE_REFRESH_ZONE_BUDGET + 1),
          ]);
          inBudget = await rebuild([
            ...zone.map((row) => row._id as string),
            ...positions.map((row) => row.zoneId as string),
          ]);
          if (!inBudget) break;
        }
      if (!inBudget && !warehouses.size)
        // Only locations were written: their warehouses (exactness over cost;
        // no current mutation writes many locations and nothing else).
        for (const locationId of locations) {
          const location = await db.get<Location>("locations", locationId);
          if (location) warehouses.add(location.warehouseId);
        }
      for (const warehouseId of warehouses) {
        const row = await readinessOf(warehouseId);
        if (!row) continue;
        const generation = generations.get(warehouseId);
        if (!inBudget) {
          // Too much for one transaction: readers use the layout until the
          // occupancy backfill rebuilds every row (this poisons a running one).
          if (row.ready || row.stale !== true)
            await db.patch("storageZoneOccupancyReadiness", row._id, {
              ready: false,
              stale: true,
            });
          if (scheduler)
            await scheduler.runAfter(
              0,
              internal.storageLayouts.zoneOccupancyBackfill.run,
              {
                warehouseId: warehouseId as Id<"warehouses">,
                restart: true,
                chain: true,
              },
            );
        } else if (
          generation &&
          row.layoutGeneration === generation.before &&
          generation.after !== generation.before
        )
          await db.patch("storageZoneOccupancyReadiness", row._id, {
            layoutGeneration: generation.after,
          });
      }
    },
  };
}
