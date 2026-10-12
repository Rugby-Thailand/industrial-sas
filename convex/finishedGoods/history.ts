import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { queryWithOrg } from "../lib/tenantFunctions";
import { isGeometricPlacement } from "../model/finishedGoods/scanning";
import { boundedRecordPage } from "../lib/boundedRecordPage";
import { palletOf } from "./workflow";

const READ = "masterData.storageLayout.read";
const isActive = (move: Doc<"finishedGoodsMoves">) =>
  move.status === "RESERVED" || move.status === "IN_TRANSIT";

/**
 * A storage unit's completed, cancelled and returned moves, newest first, in
 * cursor pages. Each row carries only the labels the history displays; it does
 * not rebuild the occupancy of every historical location.
 */
export const palletMoveHistory = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    palletId: v.id("finishedGoodsPallets"),
    cursor: v.optional(v.union(v.string(), v.null())),
    scanCursor: v.optional(v.string()),
    /** Client retry identity: a new value opens a fresh subscription. Ignored. */
    attempt: v.optional(v.number()),
    pageSize: v.optional(v.number()),
  },
  permissionCode: READ,
  target: { table: "finishedGoodsMoves" },
  warehouseId: (args) => args.warehouseId,
  handler: async (ctx, args) => {
    const pallet = await palletOf(ctx, args);
    if (!pallet) return null;
    const cached = new Map<string, Promise<unknown>>();
    const read = <T>(
      table:
        | "finishedGoodsPlacements"
        | "storageZones"
        | "storageBuildings"
        | "storageFloors",
      id: string,
    ): Promise<T | null> => {
      const key = `${table}:${id}`;
      if (!cached.has(key)) cached.set(key, ctx.tenantDb.get<never>(table, id));
      return cached.get(key) as Promise<T | null>;
    };
    const end = async (placementId: Id<"finishedGoodsPlacements">) => {
      const placement = await read<Doc<"finishedGoodsPlacements">>(
        "finishedGoodsPlacements",
        placementId,
      );
      if (
        !placement ||
        placement.palletId !== pallet._id ||
        placement.warehouseId !== pallet.warehouseId
      )
        return { placement: null, destination: null };
      const [zone, building, floor] = await Promise.all([
        read<Doc<"storageZones">>("storageZones", placement.zoneId),
        read<Doc<"storageBuildings">>("storageBuildings", placement.buildingId),
        read<Doc<"storageFloors">>("storageFloors", placement.floorId),
      ]);
      const geometric = isGeometricPlacement(placement) ? placement : null;
      return {
        placement: {
          mode: geometric ? ("GEOMETRIC" as const) : ("LOCATION_ONLY" as const),
          positionCode: placement.positionCode,
          ...(geometric
            ? {
                xMm: geometric.xMm,
                yMm: geometric.yMm,
                zMm: geometric.zMm,
                rotation: geometric.rotation,
              }
            : {}),
        },
        destination:
          zone?.warehouseId === pallet.warehouseId &&
          building?.warehouseId === pallet.warehouseId &&
          floor?.buildingId === building._id
            ? {
                buildingCode: building.code,
                floorNumber: floor.floorNumber,
                locationName: zone.label,
              }
            : null,
      };
    };
    const pageSize = args.pageSize ?? 20;
    if (![20, 50, 100].includes(pageSize)) return null;
    return boundedRecordPage(ctx, {
      scope: ["finishedGoodsMoves", args.warehouseId, pallet._id],
      pageSize,
      cursor: args.cursor,
      scanCursor: args.scanCursor,
      // A new endpoint: every caller follows scan continuations.
      progressive: true,
      // Active moves are shown by the current-move panel and rarely exist.
      filtering: false,
      read: (range, limit) =>
        ctx.tenantDb
          .byIndex<Doc<"finishedGoodsMoves">>(
            "finishedGoodsMoves",
            "by_orgId_palletId",
            [{ field: "palletId", value: pallet._id }],
          )
          .page({
            limit,
            order: "desc",
            ...(range.raw ? { cursor: range.raw } : {}),
            ...(range.end ? { endCursor: range.end } : {}),
          }),
      get: async (id) =>
        (await ctx.tenantDb.get<Doc<"finishedGoodsMoves">>(
          "finishedGoodsMoves",
          id,
        )) ?? null,
      accept: (move) =>
        move.palletId === pallet._id &&
        move.warehouseId === pallet.warehouseId &&
        !isActive(move),
      hydrate: (moves) =>
        Promise.all(
          moves.map(async (move) => {
            const [source, target] = await Promise.all([
              end(move.sourcePlacementId),
              end(move.targetPlacementId),
            ]);
            return {
              _id: move._id,
              status: move.status,
              createdAt: move.createdAt,
              ...(move.reason ? { reason: move.reason } : {}),
              sourcePlacement: source.placement,
              sourceDestination: source.destination,
              targetPlacement: target.placement,
              targetDestination: target.destination,
            };
          }),
        ),
    });
  },
});
