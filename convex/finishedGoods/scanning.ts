import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import {
  mutationWithOrg,
  queryWithOrg,
  type TenantFunctionContext,
} from "../lib/tenantFunctions";
import {
  command,
  created,
  failure,
  palletOf,
  productOf,
  rows,
  stamp,
} from "./workflow";
import {
  isGeometricPlacement,
  scanGroupError,
  type ScanFailure,
  type ScanLocation,
  type ScanUnit,
} from "../model/finishedGoods/scanning";

const READ = "masterData.storageLayout.read";
const MANAGE = "masterData.storageLayout.manage";
const codeArgs = { warehouseId: v.id("warehouses"), code: v.string() };
const fail = (code: string): ScanFailure => ({ ok: false, error: { code } });

async function eligible(
  ctx: TenantFunctionContext,
  pallet: Doc<"finishedGoodsPallets">,
): Promise<boolean> {
  if (
    pallet.retiredAt ||
    !["AWAITING_MEASUREMENT", "AWAITING_PLACEMENT"].includes(pallet.status)
  )
    return false;
  const [placements, children, moves] = await Promise.all([
    rows<Doc<"finishedGoodsPlacements">>(
      ctx,
      "finishedGoodsPlacements",
      "by_orgId_palletId",
      [{ field: "palletId", value: pallet._id }],
    ),
    rows<Doc<"finishedGoodsPlacements">>(
      ctx,
      "finishedGoodsPlacements",
      "by_orgId_supportPalletId",
      [{ field: "supportPalletId", value: pallet._id }],
    ),
    rows<Doc<"finishedGoodsMoves">>(
      ctx,
      "finishedGoodsMoves",
      "by_orgId_palletId",
      [{ field: "palletId", value: pallet._id }],
    ),
  ]);
  return (
    ![...placements, ...children].some((row) => row.status !== "RELEASED") &&
    !moves.some(
      (row) => row.status === "RESERVED" || row.status === "IN_TRANSIT",
    )
  );
}

export const resolvePackageCode = queryWithOrg({
  args: codeArgs,
  returns: v.any(),
  permissionCode: READ,
  target: { table: "finishedGoodsPallets" },
  warehouseId: (args) => args.warehouseId,
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: true; unit: ScanUnit } | ScanFailure> => {
    const code = args.code.trim();
    if (!code || code.length > 500) return fail("INVALID_IDENTITY");
    let pallet: Doc<"finishedGoodsPallets"> | null = null;
    if (code.startsWith("ISAS:PALLET:1:")) {
      const id = code.slice("ISAS:PALLET:1:".length);
      // TenantDb normalizes ids and never exposes another tenant's documents.
      pallet = await palletOf(ctx, {
        warehouseId: args.warehouseId,
        palletId: id,
      });
    } else if (code.startsWith("ISAS:")) return fail("WRONG_ENTITY_TYPE");
    else {
      const matches = await rows<Doc<"finishedGoodsPallets">>(
        ctx,
        "finishedGoodsPallets",
        "by_orgId_warehouseId_code",
        [
          { field: "warehouseId", value: args.warehouseId },
          { field: "code", value: code.toUpperCase() },
        ],
      );
      if (matches.length > 1) return fail("AMBIGUOUS_IDENTITY");
      pallet = matches[0] ?? null;
    }
    if (!pallet) {
      const target = await resolveTarget(ctx, args.warehouseId, code);
      return fail("error" in target ? "NOT_FOUND" : "WRONG_ENTITY_TYPE");
    }
    if (!(await eligible(ctx, pallet))) return fail("UNIT_UNAVAILABLE");
    const product = await productOf(ctx, {
      warehouseId: args.warehouseId,
      productId: pallet.productId,
    });
    if (!product || product.status !== "ACTIVE")
      return fail("UNIT_UNAVAILABLE");
    return {
      ok: true,
      unit: {
        id: pallet._id,
        code: pallet.code,
        storageFormat:
          pallet.storageFormat ?? product.storageFormat ?? "PALLET",
        productId: product._id,
        productName: product.name,
        status: pallet.status,
        version: pallet.updatedAt,
        ...(pallet.sameSize === undefined ? {} : { sameSize: pallet.sameSize }),
        ...(pallet.fillPercent === undefined
          ? {}
          : { fillPercent: pallet.fillPercent }),
      },
    };
  },
});

async function targetContext(
  ctx: TenantFunctionContext,
  warehouseId: Id<"warehouses">,
  zone: Doc<"storageZones">,
  position?: Doc<"storagePositions">,
) {
  if (zone.warehouseId !== warehouseId || zone.status !== "ACTIVE") return null;
  const [building, floor, zoneLocation, location] = await Promise.all([
    ctx.tenantDb.get<Doc<"storageBuildings">>(
      "storageBuildings",
      zone.buildingId,
    ),
    ctx.tenantDb.get<Doc<"storageFloors">>("storageFloors", zone.floorId),
    ctx.tenantDb.get<Doc<"locations">>("locations", zone.locationId),
    ctx.tenantDb.get<Doc<"locations">>(
      "locations",
      position?.locationId ?? zone.locationId,
    ),
  ]);
  if (
    !building ||
    building.status !== "ACTIVE" ||
    building.warehouseId !== warehouseId ||
    !floor ||
    floor.buildingId !== building._id ||
    floor.warehouseId !== warehouseId ||
    !zoneLocation ||
    zoneLocation.status !== "ACTIVE" ||
    zoneLocation.warehouseId !== warehouseId ||
    !location ||
    location.status !== "ACTIVE" ||
    location.warehouseId !== warehouseId
  )
    return null;
  if (
    position &&
    (position.status !== "ACTIVE" ||
      position.warehouseId !== warehouseId ||
      position.zoneId !== zone._id ||
      position.floorId !== floor._id ||
      position.buildingId !== building._id)
  )
    return null;
  const target = position ?? zone;
  const resolved: ScanLocation = {
    zoneId: zone._id,
    locationId: location._id,
    buildingId: building._id,
    floorId: floor._id,
    ...(position ? { supportPositionId: position._id } : {}),
    code: target.code,
    name: target.label,
    version: JSON.stringify([
      zone.updatedAt,
      building.updatedAt,
      building.version,
      floor.updatedAt,
      floor.version,
      zoneLocation.status,
      zoneLocation.code,
      location.status,
      location.code,
      position?.updatedAt ?? null,
    ]),
  };
  return { resolved, zone, target };
}
async function resolveTarget(
  ctx: TenantFunctionContext,
  warehouseId: Id<"warehouses">,
  raw: string,
) {
  const code = raw.trim();
  if (!code || code.length > 500) return { error: "INVALID_IDENTITY" } as const;
  if (code.startsWith("ISAS:PALLET:"))
    return { error: "WRONG_ENTITY_TYPE" } as const;
  const [zonesByCode, zonesByQr, positionsByCode, positionsByQr] =
    await Promise.all([
      rows<Doc<"storageZones">>(
        ctx,
        "storageZones",
        "by_orgId_warehouseId_code",
        [
          { field: "warehouseId", value: warehouseId },
          { field: "code", value: code.toUpperCase() },
        ],
      ),
      rows<Doc<"storageZones">>(ctx, "storageZones", "by_orgId_qrValue", [
        { field: "qrValue", value: code },
      ]),
      rows<Doc<"storagePositions">>(
        ctx,
        "storagePositions",
        "by_orgId_warehouseId_code",
        [
          { field: "warehouseId", value: warehouseId },
          { field: "code", value: code.toUpperCase() },
        ],
      ),
      rows<Doc<"storagePositions">>(
        ctx,
        "storagePositions",
        "by_orgId_qrValue",
        [{ field: "qrValue", value: code }],
      ),
    ]);
  const zones = [
    ...new Map(
      [...zonesByCode, ...zonesByQr]
        .filter((row) => row.warehouseId === warehouseId)
        .map((row) => [row._id, row]),
    ).values(),
  ];
  const positions = [
    ...new Map(
      [...positionsByCode, ...positionsByQr]
        .filter((row) => row.warehouseId === warehouseId)
        .map((row) => [row._id, row]),
    ).values(),
  ];
  // Default position labels may deliberately alias their parent zone label.
  const distinctPositions = positions.filter(
    (position) =>
      !position.isDefault ||
      !zones.some(
        (zone) =>
          zone._id === position.zoneId &&
          zone.locationId === position.locationId,
      ),
  );
  if (zones.length + distinctPositions.length > 1)
    return { error: "AMBIGUOUS_IDENTITY" } as const;
  const position = distinctPositions[0];
  const zone =
    zones[0] ??
    (position
      ? await ctx.tenantDb.get<Doc<"storageZones">>(
          "storageZones",
          position.zoneId,
        )
      : null);
  const context = zone
    ? await targetContext(ctx, warehouseId, zone, position)
    : null;
  return context ?? ({ error: "LOCATION_UNAVAILABLE" } as const);
}
export const resolveLocationCode = queryWithOrg({
  args: codeArgs,
  returns: v.any(),
  permissionCode: READ,
  target: { table: "storageZones" },
  warehouseId: (args) => args.warehouseId,
  handler: async (ctx, args) => {
    const result = await resolveTarget(ctx, args.warehouseId, args.code);
    return "error" in result
      ? fail(result.error)
      : { ok: true as const, location: result.resolved };
  },
});
export const confirmScanAssignment = mutationWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    requestId: v.string(),
    units: v.array(
      v.object({
        unitId: v.id("finishedGoodsPallets"),
        version: v.number(),
        fillPercent: v.number(),
      }),
    ),
    location: v.object({
      zoneId: v.id("storageZones"),
      supportPositionId: v.optional(v.id("storagePositions")),
      version: v.string(),
      code: v.string(),
      method: v.union(v.literal("SCAN"), v.literal("MANUAL")),
    }),
    sameSize: v.boolean(),
    physicalConfirmed: v.boolean(),
  },
  returns: v.any(),
  permissionCode: MANAGE,
  target: { table: "finishedGoodsScanAssignments" },
  warehouseId: (args) => args.warehouseId,
  handler: async (ctx, args) =>
    command(
      ctx,
      args,
      "finishedGoods.scan.assign",
      "finishedGoodsScanAssignments",
      async () => {
        if (!args.physicalConfirmed)
          return failure("PHYSICAL_CONFIRMATION_REQUIRED");
        const error = scanGroupError(args.units);
        if (error) return failure(error);
        const target = await resolveTarget(
          ctx,
          args.warehouseId,
          args.location.code,
        );
        if ("error" in target) return failure(target.error);
        if (
          target.resolved.zoneId !== args.location.zoneId ||
          target.resolved.supportPositionId !==
            args.location.supportPositionId ||
          target.resolved.version !== args.location.version
        )
          return failure("LOCATION_CHANGED");
        // Unknown occupancy would invalidate an existing measured reservation or
        // move target. Reading this range also conflicts with concurrent holds.
        const reserved = await rows<Doc<"finishedGoodsPlacements">>(
          ctx,
          "finishedGoodsPlacements",
          "by_orgId_zoneId_status",
          [
            { field: "zoneId", value: target.resolved.zoneId },
            { field: "status", value: "RESERVED" },
          ],
        );
        if (reserved.some(isGeometricPlacement))
          return failure("LOCATION_HAS_ACTIVE_RESERVATIONS");
        const pallets: Doc<"finishedGoodsPallets">[] = [];
        for (const unit of args.units) {
          const pallet = await palletOf(ctx, {
            warehouseId: args.warehouseId,
            palletId: unit.unitId,
          });
          if (!pallet || !(await eligible(ctx, pallet)))
            return failure("UNIT_UNAVAILABLE");
          if (pallet.updatedAt !== unit.version) return failure("UNIT_CHANGED");
          const product = await productOf(ctx, {
            warehouseId: args.warehouseId,
            productId: pallet.productId,
          });
          if (!product || product.status !== "ACTIVE")
            return failure("UNIT_UNAVAILABLE");
          const condition = product.storageCondition.trim().toUpperCase();
          if (
            condition &&
            condition !== "ANY" &&
            target.zone.storageCondition?.trim() &&
            target.zone.storageCondition.trim().toUpperCase() !== "ANY" &&
            condition !== target.zone.storageCondition.trim().toUpperCase()
          )
            return failure("STORAGE_CONDITION_MISMATCH");
          pallets.push(pallet);
        }
        // All validation has finished. No returned refusal is allowed after the first write.
        const identity = target.resolved;
        const assignmentId = await ctx.tenantDb.insert(
          "finishedGoodsScanAssignments",
          {
            warehouseId: args.warehouseId,
            requestId: args.requestId,
            orderedUnitIds: pallets.map((p) => p._id),
            placementIds: [],
            sameSize: args.sameSize,
            fillPercents: args.units.map((u) => u.fillPercent),
            zoneId: identity.zoneId,
            locationId: identity.locationId,
            buildingId: identity.buildingId,
            floorId: identity.floorId,
            ...(identity.supportPositionId
              ? { supportPositionId: identity.supportPositionId }
              : {}),
            locationCode: identity.code,
            locationName: identity.name,
            locationVersion: identity.version,
            verificationMethod: args.location.method,
            verifiedCode: args.location.code.trim(),
            createdAt: Date.now(),
            createdByUserId: ctx.tenant.actor._id,
          },
        );
        const placementIds: string[] = [];
        for (const [index, pallet] of pallets.entries()) {
          const placementId = await ctx.tenantDb.insert(
            "finishedGoodsPlacements",
            {
              mode: "LOCATION_ONLY",
              assignmentId,
              sequence: index + 1,
              warehouseId: args.warehouseId,
              palletId: pallet._id,
              zoneId: identity.zoneId,
              locationId: identity.locationId,
              buildingId: identity.buildingId,
              floorId: identity.floorId,
              ...(identity.supportPositionId
                ? { supportPositionId: identity.supportPositionId }
                : {}),
              positionCode: identity.code,
              qrValue: target.target.qrValue,
              status: "STORED",
              verifiedAt: Date.now(),
              verifiedByUserId: ctx.tenant.actor._id,
              verificationMethod: args.location.method,
              ...created(ctx),
            },
          );
          placementIds.push(placementId);
          await ctx.tenantDb.patch("finishedGoodsPallets", pallet._id, {
            placementId,
            status: "STORED",
            sameSize: args.sameSize,
            fillPercent: args.units[index]!.fillPercent,
            ...stamp(ctx),
          });
        }
        await ctx.tenantDb.patch("finishedGoodsScanAssignments", assignmentId, {
          placementIds,
        });
        return { documentId: assignmentId };
      },
    ),
});
export const getScanAssignment = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    assignmentId: v.id("finishedGoodsScanAssignments"),
  },
  returns: v.any(),
  permissionCode: READ,
  target: { table: "finishedGoodsScanAssignments" },
  warehouseId: (args) => args.warehouseId,
  handler: async (ctx, args) => {
    const receipt = await ctx.tenantDb.get<Doc<"finishedGoodsScanAssignments">>(
      "finishedGoodsScanAssignments",
      args.assignmentId,
    );
    if (!receipt || receipt.warehouseId !== args.warehouseId) return null;
    const orderedUnits = await Promise.all(
      receipt.orderedUnitIds.map(async (unitId, index) => {
        const pallet = await ctx.tenantDb.get<Doc<"finishedGoodsPallets">>(
          "finishedGoodsPallets",
          unitId,
        );
        const placement = await ctx.tenantDb.get<
          Doc<"finishedGoodsPlacements">
        >("finishedGoodsPlacements", receipt.placementIds[index]!);
        if (
          !pallet ||
          !placement ||
          placement.mode !== "LOCATION_ONLY" ||
          placement.assignmentId !== receipt._id ||
          placement.sequence !== index + 1 ||
          placement.palletId !== unitId
        )
          throw new Error("Scan assignment integrity failure");
        const product = await productOf(ctx, {
          warehouseId: args.warehouseId,
          productId: pallet.productId,
        });
        return {
          unitId,
          code: pallet.code,
          productName: product?.name ?? "",
          fillPercent: receipt.fillPercents[index],
          sequence: index + 1,
        };
      }),
    );
    return {
      ...receipt,
      orderedUnits,
      location: {
        zoneId: receipt.zoneId,
        locationId: receipt.locationId,
        buildingId: receipt.buildingId,
        floorId: receipt.floorId,
        ...(receipt.supportPositionId
          ? { supportPositionId: receipt.supportPositionId }
          : {}),
        code: receipt.locationCode,
        name: receipt.locationName,
        version: receipt.locationVersion,
      },
    };
  },
});
