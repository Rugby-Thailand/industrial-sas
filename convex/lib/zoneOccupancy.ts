import type { Doc, Id } from "../_generated/dataModel";
import { storageFootprintUsage } from "../model/storageLayout/areaUsage";
import { TenantDbError, type TenantDocumentAccess } from "./tenantDb";

/**
 * Derived per-zone occupancy.
 *
 * Readers (recommendations, building occupancy, building inventory) otherwise
 * read every held placement and its pallet for every zone on every execution
 * and re-run. Tracked finished-goods mutations keep these rows exact inside
 * their own transaction; a resumable backfill fills existing zones; readers
 * use them only when the warehouse is ready.
 *
 * Zones above the entry cap ("overflowed") keep a marker row only. Writes do
 * no per-write work for them (and never read their whole range), zone-scoped
 * readers read them directly, and building-scoped readers fall back for the
 * whole warehouse, because the building of every placement in such a zone
 * cannot be checked cheaply.
 */
export const ZONE_OCCUPANCY_VERSION = 1;
/** Keeps an entries row far below Convex's 1 MiB document limit (~0.9 KB each). */
export const MAX_ZONE_OCCUPANCY_ENTRIES = 500;

type Placement = Doc<"finishedGoodsPlacements">;
type Pallet = Doc<"finishedGoodsPallets">;
type Zone = Doc<"storageZones">;
type Readiness = Doc<"storageZoneOccupancyReadiness">;
type Held = { placements: readonly Placement[]; complete: boolean };
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

/**
 * At most cap+1 rows per status: `.all(cap)` reads cap+1 and refuses beyond the
 * cap, which tells exact from overflowed without ever reading a huge range.
 */
async function heldPlacementsOfZone(
  db: TenantDocumentAccess,
  zoneId: string,
): Promise<Held> {
  try {
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
          .all(MAX_ZONE_OCCUPANCY_ENTRIES),
      ),
    );
    const placements = groups.flat();
    return {
      placements,
      complete: placements.length <= MAX_ZONE_OCCUPANCY_ENTRIES,
    };
  } catch (error) {
    if (error instanceof TenantDbError && error.code === "CAPACITY_DATA_LIMIT")
      return { placements: [], complete: false };
    throw error;
  }
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

/** Compare field values only, so an unchanged row is not rewritten. */
/** Key-order-independent serialization: stored documents reorder fields. */
const canonical = (value: unknown): string =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(",")}]`
    : value !== null && typeof value === "object"
      ? `{${Object.keys(value)
          .filter(
            (key) => (value as Record<string, unknown>)[key] !== undefined,
          )
          .sort()
          .map(
            (key) =>
              `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
          )
          .join(",")}}`
      : JSON.stringify(value);
const sameFields = (existing: object, next: Record<string, unknown>) =>
  Object.keys(next).every(
    (key) =>
      canonical((existing as Record<string, unknown>)[key]) ===
      canonical(next[key]),
  );

function summaryFields(
  zone: Zone,
  ordered: readonly Placement[],
  complete: boolean,
) {
  if (!complete)
    // Overflowed: a marker only; readers never use these numbers.
    return {
      held: ordered.length,
      unmeasured: 0,
      buildingMismatch: false,
      storedFootprintAreaSqMm: 0,
      heldFootprintAreaSqMm: 0,
    };
  const geometric = ordered.filter((p) => p.mode !== "LOCATION_ONLY");
  return {
    held: ordered.length,
    unmeasured: ordered.length - geometric.length,
    buildingMismatch: ordered.some((p) => p.buildingId !== zone.buildingId),
    ...storageFootprintUsage([{ placements: geometric }]),
  };
}

async function write(
  db: TenantDocumentAccess,
  zone: Zone,
  held: Held,
  pallets: ReadonlyMap<string, OccupancyPallet>,
  existing: Awaited<ReturnType<typeof rowsOf>>,
) {
  const ordered = [...held.placements].sort(indexOrder);
  const { complete } = held;
  // A zone that never held anything needs no rows: readers treat absence as empty.
  if (complete && !ordered.length && !existing.summary && !existing.entries)
    return;
  const summary = {
    warehouseId: zone.warehouseId,
    buildingId: zone.buildingId,
    zoneId: zone._id,
    version: ZONE_OCCUPANCY_VERSION,
    complete,
    ...summaryFields(zone, ordered, complete),
  };
  if (!existing.summary) await db.insert("storageZoneOccupancy", summary);
  else if (!sameFields(existing.summary, summary))
    await db.replace("storageZoneOccupancy", existing.summary._id, summary);
  if (summary.buildingMismatch)
    await flagReadiness(db, zone.warehouseId, "blocked");
  if (!complete) await flagReadiness(db, zone.warehouseId, "overflow");
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
  if (!existing.entries)
    await db.insert("storageZoneOccupancyEntries", entries);
  else if (!sameFields(existing.entries, entries))
    await db.replace(
      "storageZoneOccupancyEntries",
      existing.entries._id,
      entries,
    );
}

async function factsFor(
  db: TenantDocumentAccess,
  held: Held,
  known: ReadonlyMap<string, OccupancyPallet> = new Map(),
) {
  const facts = new Map(known);
  // Overflowed zones keep no entries, so their pallet facts would be discarded.
  if (!held.complete) return facts;
  await Promise.all(
    [...new Set(held.placements.map((p) => p.palletId as string))]
      .filter((id) => !facts.has(id))
      .map(async (id) => {
        const pallet = await db.get<Pallet>("finishedGoodsPallets", id);
        if (pallet) facts.set(id, palletFacts(pallet));
      }),
  );
  return facts;
}

/**
 * Rebuild one zone from its authoritative ranges (first touch, backfill,
 * overflow re-check). Returns an upper bound on the documents it read.
 */
export async function rebuildZoneOccupancy(
  db: TenantDocumentAccess,
  zone: Zone,
) {
  const held = await heldPlacementsOfZone(db, zone._id);
  const facts = await factsFor(db, held);
  await write(db, zone, held, facts, await rowsOf(db, zone._id));
  // An overflowed zone may have read up to cap+1 rows per status.
  const placements = held.complete
    ? held.placements.length
    : HELD.length * (MAX_ZONE_OCCUPANCY_ENTRIES + 1);
  return placements + facts.size + 2;
}

/** Overflowed zones of a warehouse, for the bounded hourly re-check. */
export async function overflowedZones(
  db: Pick<TenantDocumentAccess, "byIndex">,
  warehouseId: string,
  limit: number,
) {
  return db
    .byIndex<ZoneOccupancySummary>(
      "storageZoneOccupancy",
      "by_orgId_warehouseId_complete",
      [
        { field: "warehouseId", value: warehouseId },
        { field: "complete", value: false },
      ],
    )
    .take(limit);
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
    const currentVersion =
      existing.summary?.version === ZONE_OCCUPANCY_VERSION &&
      existing.entries?.version === ZONE_OCCUPANCY_VERSION;
    // Overflowed zones are read directly: no per-write work, no full-range read.
    if (currentVersion && existing.summary && !existing.summary.complete)
      continue;
    if (!currentVersion || !existing.summary || !existing.entries) {
      const held = await heldPlacementsOfZone(db, zoneId);
      await write(
        db,
        zone,
        held,
        await factsFor(db, held, changedPallets),
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
    const held = {
      placements,
      complete: placements.length <= MAX_ZONE_OCCUPANCY_ENTRIES,
    };
    const known = new Map(
      existing.entries.pallets
        .filter((pallet) => !touched.pallets.has(pallet._id))
        .map((pallet) => [pallet._id as string, pallet] as const),
    );
    for (const [id, pallet] of changedPallets) known.set(id, pallet);
    await write(db, zone, held, await factsFor(db, held, known), existing);
  }
}

async function readinessRow(
  db: Pick<TenantDocumentAccess, "byIndex">,
  warehouseId: string,
) {
  return db
    .byIndex<Readiness>(
      "storageZoneOccupancyReadiness",
      "by_orgId_warehouseId",
      [{ field: "warehouseId", value: warehouseId }],
    )
    .unique();
}

/**
 * A cross-building placement (blocked) or an overflowed zone was written.
 * Current readers check the zone rows themselves (buildingScopeClear); the
 * sticky flag remains for code that predates that check.
 */
async function flagReadiness(
  db: TenantDocumentAccess,
  warehouseId: string,
  flag: "blocked" | "overflow",
) {
  const row = await readinessRow(db, warehouseId);
  if (!row || row[flag]) return;
  await db.patch(
    "storageZoneOccupancyReadiness",
    row._id,
    flag === "blocked" ? { blocked: true } : { overflow: true },
  );
}

/**
 * The legacy generation on the finished-goods summary row. Only code that
 * predates the change log still bumps it on every write, so a value that moved
 * since the backfill means writes ran that did not maintain these rows (for
 * example a rollback followed by a roll-forward).
 */
export async function legacyWriterGeneration(
  db: Pick<TenantDocumentAccess, "byIndex">,
  warehouseId: string,
) {
  const row = await db
    .byIndex<Doc<"finishedGoodsSummaryReadiness">>(
      "finishedGoodsSummaryReadiness",
      "by_orgId_warehouseId",
      [{ field: "warehouseId", value: warehouseId }],
    )
    .unique();
  return row?.generation ?? 0;
}

/**
 * `zone`: zone-scoped readers (recommendations). `building`: readers that
 * select by a placement's building; they also need no cross-building
 * placement and no overflowed zone in the warehouse.
 */
export async function zoneOccupancyReady(
  db: Pick<TenantDocumentAccess, "byIndex">,
  warehouseId: string,
  scope: "zone" | "building" = "zone",
) {
  const [row, generation] = await Promise.all([
    readinessRow(db, warehouseId),
    legacyWriterGeneration(db, warehouseId),
  ]);
  return (
    row?.ready === true &&
    row.stale !== true &&
    row.version === ZONE_OCCUPANCY_VERSION &&
    (row.summaryGeneration ?? 0) === generation &&
    (scope === "zone" || (await buildingScopeClear(db, warehouseId)))
  );
}

/**
 * No zone row is overflowed or holds a placement of another building. Rows
 * change with every tracked write, so this recovers as soon as the cause is
 * gone, unlike the sticky readiness flags.
 */
async function buildingScopeClear(
  db: Pick<TenantDocumentAccess, "byIndex">,
  warehouseId: string,
) {
  const [overflowed, mixed] = await Promise.all([
    overflowedZones(db, warehouseId, 1),
    db
      .byIndex<ZoneOccupancySummary>(
        "storageZoneOccupancy",
        "by_orgId_warehouseId_buildingMismatch",
        [
          { field: "warehouseId", value: warehouseId },
          { field: "buildingMismatch", value: true },
        ],
      )
      .take(1),
  ]);
  return overflowed.length === 0 && mixed.length === 0;
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
