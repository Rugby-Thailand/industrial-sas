import type { Doc, Id } from "../_generated/dataModel";
import { storageFootprintUsage } from "../model/storageLayout/areaUsage";
import type { TenantDocumentAccess } from "./tenantDb";

/**
 * Derived per-zone occupancy.
 *
 * Readers (recommendations, building occupancy, building inventory) otherwise
 * read every held placement and its pallet for every zone on every execution
 * and re-run. Tracked finished-goods mutations keep these rows exact inside
 * their own transaction; a resumable backfill fills existing zones; readers
 * use them only when the warehouse is ready, and fall back to the
 * authoritative ranges for any zone above the entry cap.
 */
export const ZONE_OCCUPANCY_VERSION = 1;
/** Keeps an entries row far below Convex's 1 MiB document limit. */
export const MAX_ZONE_OCCUPANCY_ENTRIES = 500;

type Placement = Doc<"finishedGoodsPlacements">;
type Pallet = Doc<"finishedGoodsPallets">;
type Zone = Doc<"storageZones">;
export type ZoneOccupancySummary = Doc<"storageZoneOccupancy">;
export type ZoneOccupancyEntries = Doc<"storageZoneOccupancyEntries">;
/** The pallet fields occupancy readers use. Everything else stays on the pallet. */
export type OccupancyPallet = ZoneOccupancyEntries["pallets"][number];

const HELD = ["RESERVED", "STORED"] as const;
const isHeld = (placement: Placement | null): placement is Placement =>
  placement !== null &&
  (placement.status === "RESERVED" || placement.status === "STORED");

export function palletFacts(pallet: Pallet): OccupancyPallet {
  return {
    _id: pallet._id,
    warehouseId: pallet.warehouseId,
    productId: pallet.productId,
    code: pallet.code,
    quantity: pallet.quantity,
    status: pallet.status,
    ...(pallet.placementId === undefined
      ? {}
      : { placementId: pallet.placementId }),
    ...(pallet.retiredAt === undefined ? {} : { retiredAt: pallet.retiredAt }),
    ...(pallet.storageFormat === undefined
      ? {}
      : { storageFormat: pallet.storageFormat }),
    ...(pallet.stackable === undefined ? {} : { stackable: pallet.stackable }),
    ...(pallet.maxStackLevels === undefined
      ? {}
      : { maxStackLevels: pallet.maxStackLevels }),
  };
}

/**
 * The validator is the exact placement-document union; generated types merge
 * union members inside arrays, so narrow the stored copies back to documents.
 */
const storedPlacements = (row: ZoneOccupancyEntries) =>
  row.placements as unknown as readonly Placement[];

/** by_orgId_zoneId_status order: RESERVED before STORED, each by creation. */
const indexOrder = (a: Placement, b: Placement) =>
  (a.status === b.status ? 0 : a.status === "RESERVED" ? -1 : 1) ||
  a._creationTime - b._creationTime;

function summarize(zone: Zone, placements: readonly Placement[]) {
  const geometric = placements.filter((p) => p.mode !== "LOCATION_ONLY");
  return {
    held: placements.length,
    unmeasured: placements.length - geometric.length,
    buildingMismatch: placements.some((p) => p.buildingId !== zone.buildingId),
    ...storageFootprintUsage([{ placements: geometric }]),
  };
}

async function heldPlacementsOfZone(db: TenantDocumentAccess, zoneId: string) {
  const groups = await Promise.all(
    HELD.map((status) =>
      db
        .byIndex<Placement>(
          "finishedGoodsPlacements",
          "by_orgId_zoneId_status",
          [
            { field: "zoneId", value: zoneId },
            { field: "status", value: status },
          ],
        )
        .all(10_000),
    ),
  );
  return groups.flat();
}

async function rowsOf(db: TenantDocumentAccess, zoneId: string) {
  const [summary, entries] = await Promise.all([
    db
      .byIndex<ZoneOccupancySummary>(
        "storageZoneOccupancy",
        "by_orgId_zoneId",
        [{ field: "zoneId", value: zoneId }],
      )
      .unique(),
    db
      .byIndex<ZoneOccupancyEntries>(
        "storageZoneOccupancyEntries",
        "by_orgId_zoneId",
        [{ field: "zoneId", value: zoneId }],
      )
      .unique(),
  ]);
  return { summary, entries };
}

async function write(
  db: TenantDocumentAccess,
  zone: Zone,
  placements: readonly Placement[],
  pallets: ReadonlyMap<string, OccupancyPallet>,
  existing: Awaited<ReturnType<typeof rowsOf>>,
) {
  const ordered = [...placements].sort(indexOrder);
  // A zone that never held anything needs no rows: readers treat absence as empty.
  if (!ordered.length && !existing.summary && !existing.entries) return;
  const complete = ordered.length <= MAX_ZONE_OCCUPANCY_ENTRIES;
  const summary = {
    warehouseId: zone.warehouseId,
    buildingId: zone.buildingId,
    zoneId: zone._id,
    version: ZONE_OCCUPANCY_VERSION,
    complete,
    ...summarize(zone, ordered),
  };
  if (existing.summary)
    await db.replace("storageZoneOccupancy", existing.summary._id, summary);
  else await db.insert("storageZoneOccupancy", summary);
  if (summary.buildingMismatch) await blockReadiness(db, zone.warehouseId);
  const kept = complete ? ordered : [];
  const facts = [
    ...new Map(
      kept.flatMap((p) => {
        const pallet = pallets.get(p.palletId);
        return pallet ? [[pallet._id as string, pallet] as const] : [];
      }),
    ).values(),
  ];
  const entries = {
    warehouseId: zone.warehouseId,
    zoneId: zone._id,
    version: ZONE_OCCUPANCY_VERSION,
    complete,
    placements: kept,
    pallets: facts,
  };
  if (existing.entries)
    await db.replace(
      "storageZoneOccupancyEntries",
      existing.entries._id,
      entries,
    );
  else await db.insert("storageZoneOccupancyEntries", entries);
}

async function factsFor(
  db: TenantDocumentAccess,
  placements: readonly Placement[],
  known: ReadonlyMap<string, OccupancyPallet> = new Map(),
) {
  const facts = new Map(known);
  await Promise.all(
    [...new Set(placements.map((p) => p.palletId as string))]
      .filter((id) => !facts.has(id))
      .map(async (id) => {
        const pallet = await db.get<Pallet>("finishedGoodsPallets", id);
        if (pallet) facts.set(id, palletFacts(pallet));
      }),
  );
  return facts;
}

/** Rebuild one zone from its authoritative ranges (first touch, backfill, overflow). */
export async function rebuildZoneOccupancy(
  db: TenantDocumentAccess,
  zone: Zone,
) {
  const placements = await heldPlacementsOfZone(db, zone._id);
  await write(
    db,
    zone,
    placements,
    await factsFor(db, placements),
    await rowsOf(db, zone._id),
  );
}

/**
 * Apply one mutation's placement and pallet writes to every affected zone.
 * Called from trackFinishedGoodsWrites().flush(), after all source writes.
 */
export async function refreshZoneOccupancy(
  db: TenantDocumentAccess,
  touched: {
    readonly zones: ReadonlySet<string>;
    readonly placements: ReadonlySet<string>;
    readonly pallets: ReadonlySet<string>;
  },
) {
  if (!touched.zones.size && !touched.placements.size && !touched.pallets.size)
    return;
  // A pallet's facts live on the entries of its held placements.
  const placementIds = new Set(touched.placements);
  const zones = new Set(touched.zones);
  const changedPallets = new Map<string, OccupancyPallet>();
  for (const palletId of touched.pallets) {
    const [pallet, holds] = await Promise.all([
      db.get<Pallet>("finishedGoodsPallets", palletId),
      Promise.all(
        HELD.map((status) =>
          db
            .byIndex<Placement>(
              "finishedGoodsPlacements",
              "by_orgId_palletId_status",
              [
                { field: "palletId", value: palletId },
                { field: "status", value: status },
              ],
            )
            .all(10),
        ),
      ),
    ]);
    if (pallet) changedPallets.set(palletId, palletFacts(pallet));
    for (const hold of holds.flat()) {
      placementIds.add(hold._id);
      zones.add(hold.zoneId);
    }
  }
  const current = new Map<string, Placement | null>();
  for (const id of placementIds) {
    const placement = await db.get<Placement>("finishedGoodsPlacements", id);
    current.set(id, placement);
    if (placement) zones.add(placement.zoneId);
  }
  for (const zoneId of zones) {
    const zone = await db.get<Zone>("storageZones", zoneId);
    if (!zone) continue;
    const existing = await rowsOf(db, zoneId);
    if (
      !existing.summary ||
      !existing.entries ||
      !existing.entries.complete ||
      existing.summary.version !== ZONE_OCCUPANCY_VERSION ||
      existing.entries.version !== ZONE_OCCUPANCY_VERSION
    ) {
      const placements = await heldPlacementsOfZone(db, zoneId);
      await write(
        db,
        zone,
        placements,
        await factsFor(db, placements, changedPallets),
        existing,
      );
      continue;
    }
    const placements = [
      ...storedPlacements(existing.entries).filter(
        (p) => !placementIds.has(p._id),
      ),
      ...[...current.values()].filter(
        (p): p is Placement => isHeld(p) && p.zoneId === zoneId,
      ),
    ];
    const known = new Map(
      existing.entries.pallets
        .filter((pallet) => !touched.pallets.has(pallet._id))
        .map((pallet) => [pallet._id as string, pallet] as const),
    );
    for (const [id, pallet] of changedPallets) known.set(id, pallet);
    await write(
      db,
      zone,
      placements,
      await factsFor(db, placements, known),
      existing,
    );
  }
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

/** Building-scoped readers must not use zone rows for this warehouse. */
async function blockReadiness(db: TenantDocumentAccess, warehouseId: string) {
  const row = await readinessRow(db, warehouseId);
  if (row && !row.blocked)
    await db.patch("storageZoneOccupancyReadiness", row._id, {
      ready: false,
      blocked: true,
    });
}

export async function zoneOccupancyReady(
  db: Pick<TenantDocumentAccess, "byIndex">,
  warehouseId: string,
) {
  const row = await readinessRow(db, warehouseId);
  return (
    row?.ready === true &&
    row.blocked !== true &&
    row.version === ZONE_OCCUPANCY_VERSION
  );
}

/** Held placements and pallet facts for one zone, or null to read it directly. */
export async function zoneOccupancyEntries(
  db: Pick<TenantDocumentAccess, "byIndex">,
  zoneId: Id<"storageZones"> | string,
): Promise<{
  placements: readonly Placement[];
  pallets: ReadonlyMap<string, OccupancyPallet>;
} | null> {
  const row = await db
    .byIndex<ZoneOccupancyEntries>(
      "storageZoneOccupancyEntries",
      "by_orgId_zoneId",
      [{ field: "zoneId", value: zoneId }],
    )
    .unique();
  // Ready warehouses keep rows for every zone holding a placement, so a zone
  // without one holds nothing.
  if (!row) return { placements: [], pallets: new Map() };
  if (row.version !== ZONE_OCCUPANCY_VERSION || !row.complete) return null;
  return {
    placements: storedPlacements(row),
    pallets: new Map(
      row.pallets.map((pallet) => [pallet._id as string, pallet]),
    ),
  };
}
