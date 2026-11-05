import type { GenericMutationCtx } from "convex/server";
import type { DataModel } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import type {
  TenantDocumentAccess,
  TenantOwnedDocument,
  TenantTableName,
} from "./tenantDb";
import {
  indexBuildingNames,
  indexJobScans,
  JOB_SCAN_SEARCH_FIELDS,
  searchBudget,
} from "./jobScanSearch";
import { indexLocations } from "./locationSearch";

/** Fields whose change can change a search row, posting or term. */
const RELEVANT: Partial<Record<TenantTableName, readonly string[]>> = {
  finishedGoodsJobScans: [
    ...JOB_SCAN_SEARCH_FIELDS,
    "warehouseId",
    "mapped",
    "buildingId",
    "zoneId",
    "createdAt",
  ],
  storageBuildings: ["name", "warehouseId"],
  locations: ["code", "label", "locationType", "warehouseId"],
  storagePositions: ["code", "label", "locationId", "warehouseId"],
  storageZones: ["code", "label", "locationId", "warehouseId"],
};

/**
 * Wrap tenant writes so the derived search indexes (job scans, building
 * names, picker locations) are brought up to date by `flush()` at the end of
 * the same transaction. Derived writes go to `derived`, which is not tracked.
 * Work that does not fit the per-transaction write budget is left in an
 * always-searched state and scheduled for re-indexing.
 */
export function trackSearchIndexWrites(
  db: TenantDocumentAccess,
  derived: TenantDocumentAccess,
  orgId: string,
  scheduler?: GenericMutationCtx<DataModel>["scheduler"],
) {
  const scans = new Set<string>();
  const buildings = new Map<string, Set<string>>();
  const locations = new Set<string>();
  const relevant = (table: TenantTableName, fields?: object) => {
    const watched = RELEVANT[table];
    return (
      watched !== undefined &&
      (fields === undefined || watched.some((field) => field in fields))
    );
  };
  const note = async (table: TenantTableName, id: string) => {
    if (table === "finishedGoodsJobScans") scans.add(id);
    else if (table === "locations") locations.add(id);
    else if (table === "storageBuildings") {
      const row = await db.get<TenantOwnedDocument & { warehouseId: string }>(
        table,
        id,
      );
      let seen = buildings.get(id);
      if (!seen) buildings.set(id, (seen = new Set()));
      if (row) seen.add(row.warehouseId);
    } else {
      const row = await db.get<TenantOwnedDocument & { locationId: string }>(
        table,
        id,
      );
      if (row) locations.add(row.locationId);
    }
  };
  const tracked: TenantDocumentAccess = {
    ...db,
    insert: async (table, payload) => {
      const id = await db.insert(table, payload);
      if (relevant(table)) await note(table, id);
      return id;
    },
    patch: async (table, id, fields) => {
      const watch = relevant(table, fields);
      if (watch) await note(table, id);
      await db.patch(table, id, fields);
      if (watch) await note(table, id);
    },
    replace: async (table, id, fields) => {
      const watch = relevant(table);
      if (watch) await note(table, id);
      await db.replace(table, id, fields);
      if (watch) await note(table, id);
    },
    delete: async (table, id) => {
      if (relevant(table)) await note(table, id);
      await db.delete(table, id);
    },
  };
  return {
    db: tracked,
    flush: async () => {
      if (!scans.size && !buildings.size && !locations.size) return;
      const budget = searchBudget();
      const jobs = await indexJobScans(derived, scans, budget);
      const terms = [
        ...jobs.deferredTerms,
        ...(await indexBuildingNames(
          derived,
          [...buildings].map(([buildingId, warehouseIds]) => ({
            buildingId,
            warehouseIds,
          })),
          budget,
        )),
      ];
      const deferredLocations = await indexLocations(
        derived,
        locations,
        budget,
      );
      const pending = {
        scans: [...jobs.deferredScans, ...jobs.orphanScans],
        terms,
        locations: deferredLocations,
      };
      if (
        scheduler &&
        (pending.scans.length ||
          pending.terms.length ||
          pending.locations.length)
      )
        await scheduler.runAfter(
          0,
          internal.finishedGoods.searchIndexBackfill.reindex,
          { orgId: orgId as never, ...pending },
        );
    },
  };
}
