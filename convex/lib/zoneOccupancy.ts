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
export const ZONE_OCCUPANCY_VERSION = 2;
/** Keeps an entries row far below Convex's 1 MiB document limit (~0.9 KB each). */
export const MAX_ZONE_OCCUPANCY_ENTRIES = 500;

type Placement = Doc<"finishedGoodsPlacements">;
type Pallet = Doc<"finishedGoodsPallets">;
type Zone = Doc<"storageZones">;
type Readiness = Doc<"storageZoneOccupancyReadiness">;
type PickPresent<T, K extends PropertyKey> = T extends unknown
  ? Pick<T, Extract<keyof T, K>>
  : never;
/**
 * The placement fields occupancy readers use (geometry, identity, ordering,
 * the inventory's columns). Entries rows store these, not whole documents, so
 * every reader and every rewrite moves roughly half the bytes.
 */
export type HeldPlacement = PickPresent<
  Placement,
  | "_id"
  | "_creationTime"
  | "warehouseId"
  | "buildingId"
  | "zoneId"
  | "palletId"
  | "status"
  | "positionCode"
  | "updatedAt"
  | "supportPositionId"
  | "supportPalletId"
  | "mode"
  | "xMm"
  | "yMm"
  | "zMm"
  | "widthMm"
  | "depthMm"
  | "heightMm"
  | "rotation"
  | "assignmentId"
  | "sequence"
>;
type Held = { placements: readonly HeldPlacement[]; complete: boolean };
export type ZoneOccupancySummary = Doc<"storageZoneOccupancy">;
export type ZoneOccupancyEntries = Doc<"storageZoneOccupancyEntries">;
type StoredPallet = ZoneOccupancyEntries["pallets"][number];
/**
 * The pallet fields occupancy readers use. Everything else stays on the
 * pallet. `activeMove`/`stackedPalletIds` absent: unknown, query them.
 */
export type OccupancyPallet = Omit<
  StoredPallet,
  "warehouseId" | "stackUnknown" | "activeMove"
> & { warehouseId: Id<"warehouses">; activeMove?: boolean };

/**
 * Stored form: the row's warehouse, no active move and no stacked pallets are
 * left implicit (the common case), and unknown stack facts are marked.
 */
function storedPallet(
  facts: OccupancyPallet,
  warehouseId: string,
): StoredPallet {
  const { warehouseId: own, activeMove, stackedPalletIds, ...rest } = facts;
  return {
    ...rest,
    ...(own === warehouseId ? {} : { warehouseId: own }),
    ...(activeMove === undefined || stackedPalletIds === undefined
      ? { stackUnknown: true }
      : {
          ...(activeMove ? { activeMove: true as const } : {}),
          ...(stackedPalletIds.length ? { stackedPalletIds } : {}),
        }),
  };
}
function occupancyPallet(
  stored: StoredPallet,
  row: Pick<ZoneOccupancyEntries, "warehouseId">,
): OccupancyPallet {
  const { warehouseId, stackUnknown, activeMove, stackedPalletIds, ...rest } =
    stored;
  return {
    ...rest,
    warehouseId: warehouseId ?? row.warehouseId,
    ...(stackUnknown
      ? {}
      : {
          activeMove: activeMove === true,
          stackedPalletIds: stackedPalletIds ?? [],
        }),
  };
}
const occupancyPallets = (row: ZoneOccupancyEntries) =>
  row.pallets.map((pallet) => occupancyPallet(pallet, row));

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

/** Stack supports one pallet per level; more is malformed: leave it unknown. */
const MAX_STACK_FACT_CHILDREN = 50;
/**
 * Pallets one mutation computes stack facts for when it rebuilds a zone that
 * had no rows. Beyond it the facts stay unknown and readers query them, so a
 * write never pays four index ranges per pallet of a dense zone.
 */
const STACK_FACTS_PER_REBUILD = 50;

/**
 * What stack validation asks of a support pallet besides its own fields:
 * whether it has an active move, and which pallets its held placements carry
 * (by_orgId_supportPalletId_status, creation order). Recommendations read
 * these here instead of four index ranges per supporting pallet; mutations
 * still query them. Maintained with the pallet's facts: move writes touch
 * their pallet, and placement writes touch the pallet they rest on.
 */
async function stackFacts(
  db: Pick<TenantDocumentAccess, "byIndex">,
  palletId: string,
): Promise<Pick<OccupancyPallet, "activeMove" | "stackedPalletIds">> {
  const [moves, children] = await Promise.all([
    Promise.all(
      (["RESERVED", "IN_TRANSIT"] as const).map((status) =>
        db
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
    ),
    Promise.all(
      HELD.map((status) =>
        db
          .byIndex<Placement>(
            "finishedGoodsPlacements",
            "by_orgId_supportPalletId_status",
            [
              { field: "supportPalletId", value: palletId },
              { field: "status", value: status },
            ],
          )
          .take(MAX_STACK_FACT_CHILDREN + 1),
      ),
    ),
  ]);
  const held = children.flat();
  return {
    activeMove: moves.some((move) => move !== null),
    ...(held.length > MAX_STACK_FACT_CHILDREN
      ? {}
      : {
          stackedPalletIds: held
            .sort((a, b) => a._creationTime - b._creationTime)
            .map((p) => p.palletId),
        }),
  };
}
async function palletWithStackFacts(db: TenantDocumentAccess, pallet: Pallet) {
  return { ...palletFacts(pallet), ...(await stackFacts(db, pallet._id)) };
}

const present = <T extends Record<string, unknown>>(fields: T) =>
  Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  ) as T;

/** The reader projection of a placement document (see HeldPlacement). */
export function heldPlacement(p: Placement | HeldPlacement): HeldPlacement {
  const base = {
    _id: p._id,
    _creationTime: p._creationTime,
    warehouseId: p.warehouseId,
    buildingId: p.buildingId,
    zoneId: p.zoneId,
    palletId: p.palletId,
    status: p.status,
    positionCode: p.positionCode,
    updatedAt: p.updatedAt,
    supportPositionId: p.supportPositionId,
  };
  if (p.mode === "LOCATION_ONLY")
    return present({
      ...base,
      mode: p.mode,
      assignmentId: p.assignmentId,
      sequence: p.sequence,
      supportPalletId: p.supportPalletId,
    }) as HeldPlacement;
  return present({
    ...base,
    mode: p.mode,
    supportPalletId: p.supportPalletId,
    xMm: p.xMm,
    yMm: p.yMm,
    zMm: p.zMm,
    widthMm: p.widthMm,
    depthMm: p.depthMm,
    heightMm: p.heightMm,
    rotation: p.rotation,
  }) as HeldPlacement;
}

/**
 * Stored form: the zone, and the warehouse and building when they are the
 * zone's (always, unless a malformed placement names others), come from the
 * row, so only exceptions are written per entry.
 */
function storedEntry(p: HeldPlacement, zone: Zone) {
  const { zoneId, warehouseId, buildingId, ...rest } = p;
  void zoneId;
  return {
    ...rest,
    ...(warehouseId === zone.warehouseId ? {} : { warehouseId }),
    ...(buildingId === zone.buildingId ? {} : { buildingId }),
  };
}

/**
 * Current-version entries back as reader projections. Generated types merge
 * the validator's union members inside arrays, so narrow them here.
 */
function heldEntries(row: ZoneOccupancyEntries): HeldPlacement[] {
  const stored = row.placements as unknown as readonly (Partial<
    Pick<HeldPlacement, "warehouseId" | "buildingId">
  > &
    Omit<HeldPlacement, "zoneId" | "warehouseId" | "buildingId">)[];
  return stored.map(
    (entry) =>
      ({
        ...entry,
        zoneId: row.zoneId,
        warehouseId: entry.warehouseId ?? row.warehouseId,
        buildingId: entry.buildingId ?? row.buildingId!,
      }) as HeldPlacement,
  );
}
const currentEntries = (row: ZoneOccupancyEntries | null) =>
  row?.version === ZONE_OCCUPANCY_VERSION && row.buildingId !== undefined;

/** by_orgId_zoneId_status order: RESERVED before STORED, each by creation. */
const indexOrder = (a: HeldPlacement, b: HeldPlacement) =>
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
    const placements = groups.flat().map(heldPlacement);
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

/**
 * Key-order-independent serialization: stored documents reorder fields.
 * Compare field values only, so an unchanged row is not rewritten.
 */
export const canonical = (value: unknown): string =>
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
  ordered: readonly HeldPlacement[],
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
    buildingId: zone.buildingId,
    zoneId: zone._id,
    version: ZONE_OCCUPANCY_VERSION,
    complete,
    placements: kept.map((p) => storedEntry(p, zone)),
    pallets: facts.map((pallet) => storedPallet(pallet, zone.warehouseId)),
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
  /** Pallets that may get stack facts (Infinity in the backfill). */
  stackLimit = STACK_FACTS_PER_REBUILD,
) {
  const facts = new Map(known);
  // Overflowed zones keep no entries, so their pallet facts would be discarded.
  if (!held.complete) return facts;
  const missing = [
    ...new Set(held.placements.map((p) => p.palletId as string)),
  ].filter((id) => !facts.has(id));
  const withStack = missing.length <= stackLimit;
  await Promise.all(
    missing.map(async (id) => {
      const pallet = await db.get<Pallet>("finishedGoodsPallets", id);
      if (pallet)
        facts.set(
          id,
          withStack
            ? await palletWithStackFacts(db, pallet)
            : palletFacts(pallet),
        );
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
  const facts = await factsFor(db, held, new Map(), Infinity);
  await write(db, zone, held, facts, await rowsOf(db, zone._id));
  // An overflowed zone may have read up to cap+1 rows per status. Each
  // pallet's stack facts take four index ranges: count them as documents so
  // a page of dense zones stays far below the range limit too.
  const placements = held.complete
    ? held.placements.length
    : HELD.length * (MAX_ZONE_OCCUPANCY_ENTRIES + 1);
  return placements + facts.size * 5 + 2;
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
    if (pallet)
      changedPallets.set(palletId, await palletWithStackFacts(db, pallet));
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
      currentEntries(existing.entries);
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
      ...heldEntries(existing.entries).filter((p) => !placementIds.has(p._id)),
      ...[...current.values()]
        .filter((p): p is Placement => isHeld(p) && p.zoneId === zoneId)
        .map(heldPlacement),
    ];
    const held = {
      placements,
      complete: placements.length <= MAX_ZONE_OCCUPANCY_ENTRIES,
    };
    const known = new Map(
      occupancyPallets(existing.entries)
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
    zoneRowsTrusted(row, generation) &&
    (scope === "zone" || (await buildingScopeClear(db, warehouseId)))
  );
}

/** The readiness row says zone-scoped readers may use the rows. */
export function zoneRowsTrusted(
  row: Readiness | null,
  legacyGeneration: number,
): row is Readiness {
  return (
    row?.ready === true &&
    row.stale !== true &&
    row.version === ZONE_OCCUPANCY_VERSION &&
    (row.summaryGeneration ?? 0) === legacyGeneration
  );
}

/** The warehouse's occupancy readiness row (null before any backfill). */
export async function zoneOccupancyReadiness(
  db: Pick<TenantDocumentAccess, "byIndex">,
  warehouseId: string,
) {
  return readinessRow(db, warehouseId);
}

/**
 * No zone row is overflowed or holds a placement of another building. Rows
 * change with every tracked write, so this recovers as soon as the cause is
 * gone, unlike the sticky readiness flags.
 */
export async function buildingScopeClear(
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
  placements: readonly HeldPlacement[];
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
  if (!currentEntries(row) || !row.complete) return null;
  return {
    placements: heldEntries(row),
    pallets: new Map(
      occupancyPallets(row).map((pallet) => [pallet._id as string, pallet]),
    ),
  };
}

/**
 * A zone's unmeasured held-placement count from its small summary row, or
 * null to count it from the placements. Both rows of a zone are written
 * together (`write`), so this equals the entries' LOCATION_ONLY count.
 */
export async function zoneUnmeasuredCount(
  db: Pick<TenantDocumentAccess, "byIndex">,
  zoneId: Id<"storageZones"> | string,
): Promise<number | null> {
  const row = await db
    .byIndex<ZoneOccupancySummary>("storageZoneOccupancy", "by_orgId_zoneId", [
      { field: "zoneId", value: zoneId },
    ])
    .unique();
  // As for entries: a ready warehouse has rows for every zone holding anything.
  if (!row) return 0;
  if (row.version !== ZONE_OCCUPANCY_VERSION || !row.complete) return null;
  return row.unmeasured;
}
