import type { Doc } from "../_generated/dataModel";
import type { TenantDocumentAccess } from "./tenantDb";

/**
 * When the derived search indexes (job scans, picker locations) may answer.
 *
 * Code that does not maintain them can run after they were built: `main`, or
 * any commit before the index existed, deployed in a rollback and then rolled
 * forward. Its writes leave no postings, so readiness alone cannot be
 * trusted. Two markers make every such write visible to readers:
 *
 * - `layoutGeneration`: the warehouse's `storageCatalogueSignals.generation`
 *   the index accounts for. Every tracked layout write (buildings, floors,
 *   areas, positions) bumps that counter in old and new code alike; only
 *   maintained writes move this copy with it (`followLayoutGeneration`, in the
 *   same transaction). A difference means a layout write that did not
 *   maintain the index: readers stop trusting building names (job scans) or
 *   the whole location index until it is repaired.
 * - `watermark` (on `searchIndexReconcile`, which readers never read): rows
 *   written at or after it may be unindexed. The reconcile job, started every
 *   minute, re-indexes job scans whose search row no longer matches their
 *   fields and locations created since, then advances the watermark to at
 *   most `now - RECONCILE_MARGIN_MS`, so a write still in flight when it ran
 *   is never skipped.
 *
 * Guarantee: results equal the scan's for every write by code that maintains
 * the index, and readers fall back at once after a layout write that did
 * not. A job scan or location written by code that does not maintain the
 * index (a rollback to `main`) is findable again once reconcile has run,
 * within about two minutes; `invalidate` makes readers fall back at once.
 */
export type SearchKind = "jobScans" | "locations";
export type SearchReadiness = Doc<"searchIndexReadiness">;
export type CurrentSearchReadiness = SearchReadiness & {
  layoutGeneration: number;
};

/**
 * Longer than any transaction lives, so a write that read the clock before
 * the reconcile ran has committed before the watermark passes its time.
 */
export const RECONCILE_MARGIN_MS = 30_000;

/** Tables whose tracked writes bump `storageCatalogueSignals`. */
export const LAYOUT_TABLES: ReadonlySet<string> = new Set([
  "storageBuildings",
  "storageFloors",
  "storageZones",
  "storagePositions",
]);

export async function searchIndexReadiness(
  db: Pick<TenantDocumentAccess, "byIndex">,
  warehouseId: string,
  kind: SearchKind,
) {
  return db
    .byIndex<SearchReadiness>(
      "searchIndexReadiness",
      "by_orgId_warehouseId_kind",
      [
        { field: "warehouseId", value: warehouseId },
        { field: "kind", value: kind },
      ],
    )
    .unique();
}

/** Built, not invalidated, at `version`, with the layout marker. */
export function currentSearchReadiness(
  row: SearchReadiness | null,
  version: number,
): row is CurrentSearchReadiness {
  return (
    row?.ready === true &&
    row.stale !== true &&
    row.version === version &&
    row.layoutGeneration !== undefined
  );
}

/** The warehouse's layout write counter (0 before its first layout write). */
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
 * A maintained transaction moved the layout counter from `before` to
 * `after`: indexes that accounted for `before` account for `after` too.
 * Indexes already behind stay behind (an unmaintained write happened).
 */
export async function followLayoutGeneration(
  db: TenantDocumentAccess,
  warehouseId: string,
  before: number,
  after: number,
) {
  const rows = await db
    .byIndex<SearchReadiness>(
      "searchIndexReadiness",
      "by_orgId_warehouseId_kind",
      [{ field: "warehouseId", value: warehouseId }],
    )
    .take(2);
  for (const row of rows)
    if (row.layoutGeneration === before)
      await db.patch("searchIndexReadiness", row._id, {
        layoutGeneration: after,
      });
}
