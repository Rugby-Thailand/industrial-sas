import { validatePacking } from "../model/finishedGoods/packing";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import {
  mutationWithOrg,
  queryWithOrg,
  type TenantFunctionContext,
} from "../lib/tenantFunctions";
import { refusal, written } from "../lib/writeEnvelope";
import {
  checkIdempotency,
  fingerprintArguments,
  sha256Hex,
  writeIdempotencyRecord,
} from "../lib/idempotency";
import type { TenantTableName } from "../lib/schemaPolicy";
import type { TenantIndexEquality, TenantOwnedDocument } from "../lib/tenantDb";
import {
  dimensions,
  firstFit,
  measured,
  placementError,
  validDimension,
  overlaps,
  type Surface,
  type Rectangle,
  type Rotation,
} from "../model/finishedGoods/placement";

// The extracted planner roles own this workflow until dedicated warehouse roles are introduced.
const READ = "masterData.storageLayout.read";
const MANAGE = "masterData.storageLayout.manage";
const warehouseArgs = { warehouseId: v.id("warehouses") };
const palletArgs = { ...warehouseArgs, palletId: v.id("finishedGoodsPallets") };
const writeArgs = { ...palletArgs, requestId: v.string() };
const productFields = {
  sku: v.string(),
  name: v.string(),
  unit: v.string(),
  storageFormat: v.optional(
    v.union(v.literal("PALLET"), v.literal("BOX"), v.literal("OTHER")),
  ),
  defaultQuantity: v.optional(v.number()),
  storageCondition: v.string(),
  notes: v.optional(v.string()),
  customerReference: v.optional(v.string()),
  productReference: v.optional(v.string()),
};
export const failure = (code: string, field?: string, reason?: string) =>
  refusal({ code, field, reason });
export const stamp = (ctx: TenantFunctionContext) => ({
  updatedAt: Date.now(),
  updatedByUserId: ctx.tenant.actor._id,
});
export const created = (ctx: TenantFunctionContext) => ({
  ...stamp(ctx),
  createdAt: Date.now(),
  createdByUserId: ctx.tenant.actor._id,
});
export const compact = <T extends Record<string, unknown>>(fields: T) =>
  Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  );

export async function rows<T extends TenantOwnedDocument>(
  ctx: TenantFunctionContext,
  table: TenantTableName,
  index: string,
  equality: TenantIndexEquality,
): Promise<T[]> {
  return [
    ...(await ctx.tenantDb.byIndex<T>(table, index, equality).all(10_000)),
  ];
}
export async function palletOf(
  ctx: TenantFunctionContext,
  args: { warehouseId: string; palletId: string },
) {
  const pallet = await ctx.tenantDb.get<Doc<"finishedGoodsPallets">>(
    "finishedGoodsPallets",
    args.palletId,
  );
  return pallet?.warehouseId === args.warehouseId && !pallet.retiredAt
    ? pallet
    : null;
}
export async function productOf(
  ctx: TenantFunctionContext,
  args: { warehouseId: string; productId: string },
) {
  const product = await ctx.tenantDb.get<Doc<"finishedGoodsProducts">>(
    "finishedGoodsProducts",
    args.productId,
  );
  return product?.warehouseId === args.warehouseId ? product : null;
}
export async function nextCode(
  ctx: TenantFunctionContext,
  warehouseId: Id<"warehouses">,
  kind: "pallet" | "position",
) {
  const counter = await ctx.tenantDb
    .byIndex<Doc<"finishedGoodsCounters">>(
      "finishedGoodsCounters",
      "by_orgId_warehouseId",
      [{ field: "warehouseId", value: warehouseId }],
    )
    .unique();
  const field = kind === "pallet" ? "palletSequence" : "positionSequence";
  const number = (counter?.[field] ?? 0) + 1;
  if (counter)
    await ctx.tenantDb.patch("finishedGoodsCounters", counter._id, {
      [field]: number,
    });
  else
    await ctx.tenantDb.insert("finishedGoodsCounters", {
      warehouseId,
      palletSequence: kind === "pallet" ? number : 0,
      positionSequence: kind === "position" ? number : 0,
    });
  return `${kind === "pallet" ? "P" : "POS"}-${String(number).padStart(6, "0")}`;
}
/** A mutation reads the complete occupancy range before inserting a hold. Convex retries conflicting transactions. */
export async function command(
  ctx: TenantFunctionContext,
  args: { warehouseId: Id<"warehouses">; requestId: string },
  operation: string,
  table: TenantTableName,
  run: () => Promise<ReturnType<typeof refusal> | { documentId: string }>,
) {
  if (!args.requestId.trim() || args.requestId.length > 200)
    return failure("REQUEST_IDENTITY_INVALID", "requestId");
  const hash = await fingerprintArguments(
    compact(
      operation.startsWith("finishedGoods.move.")
        ? { ...args, actorUserId: ctx.tenant.actor._id }
        : args,
    ),
  );
  if (!hash.ok) return refusal(hash.error);
  const replay = await checkIdempotency({
    tenantDb: ctx.tenantDb,
    operation,
    requestId: args.requestId,
    requestHash: hash.value,
  });
  if (!replay.ok) return refusal(replay.error);
  if (replay.value.kind === "REPLAY") {
    const id = replay.value.record.resultRef;
    if (
      !id ||
      replay.value.record.resultHash !== (await sha256Hex(`${table}:${id}`))
    )
      return failure("REPLAY_RESULT_UNVERIFIABLE");
    return written({ documentId: id, replayed: true });
  }
  const result = await run();
  if ("written" in result) {
    await ctx.tenantDb.insert("auditEvents", {
      occurredAt: Date.now(),
      actorKind: "USER",
      actorUserId: ctx.tenant.actor._id,
      action: operation,
      permissionCode: ctx.permission.code,
      entityTable: table,
      warehouseId: args.warehouseId,
      outcome: "DENIED",
      requestId: args.requestId,
      changes: [{ field: "error", to: result.error.code }],
    });
    return result;
  }
  const now = Date.now();
  await ctx.tenantDb.insert("auditEvents", {
    occurredAt: now,
    actorKind: "USER",
    actorUserId: ctx.tenant.actor._id,
    action: operation,
    permissionCode: ctx.permission.code,
    entityTable: table,
    entityId: result.documentId,
    warehouseId: args.warehouseId,
    outcome: "ALLOWED",
    requestId: args.requestId,
  });
  await writeIdempotencyRecord({
    tenantDb: ctx.tenantDb,
    operation,
    requestId: args.requestId,
    requestHash: hash.value,
    resultRef: result.documentId,
    resultHash: await sha256Hex(`${table}:${result.documentId}`),
    actorUserId: ctx.tenant.actor._id,
    now,
  });
  return written({ ...result, replayed: false });
}

export const saveProduct = mutationWithOrg({
  args: {
    ...warehouseArgs,
    ...productFields,
    requestId: v.string(),
    productId: v.optional(v.id("finishedGoodsProducts")),
    draft: v.boolean(),
  },
  returns: v.any(),
  permissionCode: MANAGE,
  target: { table: "finishedGoodsProducts" },
  warehouseId: (a) => a.warehouseId,
  handler: async (ctx, args) =>
    command(
      ctx,
      args,
      "finishedGoods.product.save",
      "finishedGoodsProducts",
      async () => {
        const before = args.productId
          ? await productOf(ctx, {
              warehouseId: args.warehouseId,
              productId: args.productId,
            })
          : null;
        if (args.productId && !before) return failure("NOT_FOUND");
        const sku = args.sku.trim().toUpperCase();
        const name = args.name.trim(),
          unit = args.unit.trim(),
          storageCondition = args.storageCondition.trim();
        for (const [field, value, max] of [
          ["sku", sku, 80],
          ["name", name, 200],
          ["unit", unit, 40],
          ["storageCondition", storageCondition, 100],
          ["notes", args.notes ?? "", 2000],
          ["customerReference", args.customerReference ?? "", 200],
          ["productReference", args.productReference ?? "", 200],
        ] as const) {
          if (
            value.length > max ||
            (!args.draft &&
              ["sku", "name", "unit", "storageCondition"].includes(field) &&
              !value)
          )
            return failure("FIELD_INVALID", field);
        }
        if (sku && !/^[\p{L}\p{N}_.\-/]+$/u.test(sku))
          return failure("FIELD_INVALID", "sku");
        if (
          args.defaultQuantity !== undefined &&
          (!Number.isFinite(args.defaultQuantity) ||
            args.defaultQuantity <= 0 ||
            args.defaultQuantity > 1_000_000_000)
        )
          return failure("FIELD_INVALID", "defaultQuantity");
        if (sku) {
          const duplicate = await ctx.tenantDb
            .byIndex<Doc<"finishedGoodsProducts">>(
              "finishedGoodsProducts",
              "by_orgId_warehouseId_sku",
              [
                { field: "warehouseId", value: args.warehouseId },
                { field: "sku", value: sku },
              ],
            )
            .first();
          if (duplicate && duplicate._id !== before?._id)
            return failure("DUPLICATE_KEY", "sku");
        }
        if (before?.status === "ACTIVE" && args.draft)
          return failure("PRODUCT_ALREADY_ACTIVE");
        if (
          before &&
          (before.unit.trim().toUpperCase() !== unit.toUpperCase() ||
            (args.storageFormat !== undefined &&
              before.storageFormat !== args.storageFormat))
        ) {
          const existingPallet = await ctx.tenantDb
            .byIndex<Doc<"finishedGoodsPallets">>(
              "finishedGoodsPallets",
              "by_orgId_productId",
              [{ field: "productId", value: before._id }],
            )
            .first();
          if (existingPallet)
            return failure(
              "PRODUCT_PACKING_IN_USE",
              before.unit.trim().toUpperCase() !== unit.toUpperCase()
                ? "unit"
                : "storageFormat",
            );
        }
        // Product requirements are as physical as the destination's conditions:
        // changing either side must not invalidate an existing hold or stock.
        const normalizedCondition = (condition: string) =>
          condition.trim().toUpperCase() === "ANY"
            ? ""
            : condition.trim().toUpperCase();
        if (
          before &&
          normalizedCondition(before.storageCondition) !==
            normalizedCondition(storageCondition)
        ) {
          const pallets = await rows<Doc<"finishedGoodsPallets">>(
            ctx,
            "finishedGoodsPallets",
            "by_orgId_warehouseId_code",
            [{ field: "warehouseId", value: args.warehouseId }],
          );
          if (
            pallets.some(
              (pallet) =>
                pallet.productId === before._id &&
                (pallet.status === "RESERVED" || pallet.status === "STORED"),
            )
          ) {
            return failure("LOCATION_OCCUPIED", "storageCondition");
          }
        }
        const fields = {
          sku,
          name,
          unit,
          storageFormat:
            args.storageFormat ?? before?.storageFormat ?? "PALLET",
          defaultQuantity: args.defaultQuantity ?? before?.defaultQuantity,
          storageCondition,
          notes: args.notes?.trim(),
          customerReference: args.customerReference?.trim(),
          productReference: args.productReference?.trim(),
          status: args.draft ? "DRAFT" : "ACTIVE",
          ...stamp(ctx),
        };
        if (before) {
          await ctx.tenantDb.patch("finishedGoodsProducts", before._id, fields);
          return { documentId: before._id };
        }
        return {
          documentId: await ctx.tenantDb.insert("finishedGoodsProducts", {
            ...compact(fields),
            warehouseId: args.warehouseId,
            ...created(ctx),
          }),
        };
      },
    ),
});

export const createPallet = mutationWithOrg({
  args: {
    ...warehouseArgs,
    requestId: v.string(),
    productId: v.id("finishedGoodsProducts"),
  },
  returns: v.any(),
  permissionCode: MANAGE,
  target: { table: "finishedGoodsPallets" },
  warehouseId: (a) => a.warehouseId,
  handler: async (ctx, args) =>
    command(
      ctx,
      args,
      "finishedGoods.pallet.create",
      "finishedGoodsPallets",
      async () => {
        const product = await productOf(ctx, args);
        if (!product) return failure("NOT_FOUND");
        if (product.status !== "ACTIVE") return failure("PRODUCT_DRAFT");
        return {
          documentId: await ctx.tenantDb.insert("finishedGoodsPallets", {
            warehouseId: args.warehouseId,
            productId: product._id,
            code: await nextCode(ctx, args.warehouseId, "pallet"),
            quantity: product.defaultQuantity ?? 1,
            status: "AWAITING_MEASUREMENT",
            ...created(ctx),
          }),
        };
      },
    ),
});
export const createPacking = mutationWithOrg({
  args: {
    ...warehouseArgs,
    requestId: v.string(),
    productId: v.id("finishedGoodsProducts"),
    totalQuantity: v.number(),
    packages: v.array(
      v.object({
        quantity: v.number(),
        lengthMm: v.number(),
        widthMm: v.number(),
        heightMm: v.number(),
        weightKg: v.optional(v.number()),
        dimensionsChecked: v.boolean(),
      }),
    ),
  },
  returns: v.any(),
  permissionCode: MANAGE,
  target: { table: "finishedGoodsPallets" },
  warehouseId: (a) => a.warehouseId,
  handler: async (ctx, args) => {
    const outcome = await command(
      ctx,
      args,
      "finishedGoods.packing.create",
      "finishedGoodsPallets",
      async () => {
        const product = await productOf(ctx, args);
        if (!product) return failure("NOT_FOUND");
        if (product.status !== "ACTIVE") return failure("PRODUCT_DRAFT");
        const error = validatePacking(
          args.totalQuantity,
          args.packages,
          product.unit,
        );
        if (error) return failure(error, "packages");
        // Validate the entire batch before any pallet or sequence writes. Convex commits all rows together.
        let firstId: string | undefined;
        for (const row of args.packages) {
          const palletId = await ctx.tenantDb.insert("finishedGoodsPallets", {
            warehouseId: args.warehouseId,
            productId: product._id,
            code: await nextCode(ctx, args.warehouseId, "pallet"),
            quantity: row.quantity,
            lengthMm: row.lengthMm,
            widthMm: row.widthMm,
            heightMm: row.heightMm,
            ...compact({ weightKg: row.weightKg }),
            ...(firstId ? { packingBatchId: firstId } : {}),
            status: "AWAITING_PLACEMENT",
            ...created(ctx),
          });
          if (!firstId) {
            firstId = palletId;
            await ctx.tenantDb.patch("finishedGoodsPallets", palletId, {
              packingBatchId: firstId,
            });
          }
        }
        return { documentId: firstId! };
      },
    );
    if (!outcome.written) return outcome;
    // Reconstruct the exact same stable result for both initial and replayed requests.
    const pallets = await rows<Doc<"finishedGoodsPallets">>(
      ctx,
      "finishedGoodsPallets",
      "by_orgId_packingBatchId",
      [{ field: "packingBatchId", value: outcome.documentId }],
    );
    return {
      ...outcome,
      palletIds: pallets
        .sort((a, b) => Number(a.code.slice(2)) - Number(b.code.slice(2)))
        .map((pallet) => pallet._id),
    };
  },
});

export const saveMeasurement = mutationWithOrg({
  args: {
    ...writeArgs,
    quantity: v.number(),
    dimensionsChecked: v.optional(v.boolean()),
    lot: v.optional(v.string()),
    lengthMm: v.optional(v.number()),
    widthMm: v.optional(v.number()),
    heightMm: v.optional(v.number()),
    weightKg: v.optional(v.number()),
  },
  returns: v.any(),
  permissionCode: MANAGE,
  target: { table: "finishedGoodsPallets" },
  warehouseId: (a) => a.warehouseId,
  handler: async (ctx, args) =>
    command(
      ctx,
      args,
      "finishedGoods.measurement.save",
      "finishedGoodsPallets",
      async () => {
        const pallet = await palletOf(ctx, args);
        if (!pallet) return failure("NOT_FOUND");
        if (pallet.preparationBatchId)
          return failure("BATCH_MEASUREMENT_LOCKED");
        if (pallet.status === "RESERVED" || pallet.status === "STORED")
          return failure("RELEASE_RESERVATION_FIRST");
        if (
          (pallet.packingBatchId || pallet.preparationBatchId) &&
          args.quantity !== pallet.quantity
        )
          return failure("BATCH_QUANTITY_LOCKED", "quantity");
        if (
          !Number.isFinite(args.quantity) ||
          args.quantity <= 0 ||
          args.quantity > 1_000_000_000
        )
          return failure("FIELD_INVALID", "quantity");
        for (const field of ["lengthMm", "widthMm", "heightMm"] as const)
          if (args[field] !== undefined && !validDimension(args[field]))
            return failure("FIELD_INVALID", field);
        if (
          args.weightKg !== undefined &&
          (!Number.isFinite(args.weightKg) ||
            args.weightKg <= 0 ||
            args.weightKg > 1_000_000)
        )
          return failure("FIELD_INVALID", "weightKg");
        if ((args.lot?.length ?? 0) > 100)
          return failure("FIELD_INVALID", "lot");
        if (
          args.quantity !== pallet.quantity &&
          measured(args) &&
          !args.dimensionsChecked
        )
          return failure("DIMENSIONS_UNCHECKED");
        await ctx.tenantDb.patch("finishedGoodsPallets", pallet._id, {
          quantity: args.quantity,
          lot: args.lot?.trim(),
          lengthMm: args.lengthMm,
          widthMm: args.widthMm,
          heightMm: args.heightMm,
          weightKg: args.weightKg,
          status: measured(args)
            ? "AWAITING_PLACEMENT"
            : "AWAITING_MEASUREMENT",
          ...stamp(ctx),
        });
        return { documentId: pallet._id };
      },
    ),
});

async function locationContext(
  ctx: TenantFunctionContext,
  warehouseId: string,
  zoneId: string,
) {
  const zone = await ctx.tenantDb.get<Doc<"storageZones">>(
    "storageZones",
    zoneId,
  );
  if (!zone || zone.warehouseId !== warehouseId || zone.status !== "ACTIVE")
    return null;
  const building = await ctx.tenantDb.get<Doc<"storageBuildings">>(
    "storageBuildings",
    zone.buildingId,
  );
  const floor = await ctx.tenantDb.get<Doc<"storageFloors">>(
    "storageFloors",
    zone.floorId,
  );
  const location = await ctx.tenantDb.get<Doc<"locations">>(
    "locations",
    zone.locationId,
  );
  if (
    !building ||
    building.status !== "ACTIVE" ||
    building.warehouseId !== warehouseId ||
    !floor ||
    floor.buildingId !== building._id ||
    !location ||
    location.status !== "ACTIVE" ||
    location.warehouseId !== warehouseId
  )
    return null;
  const positions = await rows<Doc<"storagePositions">>(
    ctx,
    "storagePositions",
    "by_orgId_zoneId_status_code",
    [
      { field: "zoneId", value: zone._id },
      { field: "status", value: "ACTIVE" },
    ],
  );
  const allBlocks = await rows<Doc<"storageFloorReservedBlocks">>(
    ctx,
    "storageFloorReservedBlocks",
    "by_orgId_floorId",
    [{ field: "floorId", value: floor._id }],
  );
  const unavailable = allBlocks
    .filter((block) => overlaps(zone, block))
    .map((block) => ({
      xMm: block.xMm - zone.xMm,
      yMm: block.yMm - zone.yMm,
      widthMm: block.widthMm,
      depthMm: block.depthMm,
    }));
  const held = await rows<Doc<"finishedGoodsPlacements">>(
    ctx,
    "finishedGoodsPlacements",
    "by_orgId_zoneId_status",
    [
      { field: "zoneId", value: zone._id },
      { field: "status", value: "RESERVED" },
    ],
  );
  const stored = await rows<Doc<"finishedGoodsPlacements">>(
    ctx,
    "finishedGoodsPlacements",
    "by_orgId_zoneId_status",
    [
      { field: "zoneId", value: zone._id },
      { field: "status", value: "STORED" },
    ],
  );
  const occupancy = [...held, ...stored];
  const base = zone.baseElevationMm ?? 0;
  const ceiling = Math.min(
    zone.maxStackHeightMm + base,
    floor.heightMm ?? building.defaultFloorHeightMm,
  );
  const supports: Array<{
    supportPositionId?: Id<"storagePositions">;
    supportPalletId?: Id<"finishedGoodsPallets">;
    supportCode?: string;
    baseSupportPositionId?: Id<"storagePositions">;
    surface: Surface;
  }> = [];
  if (!zone.mode || zone.mode === "SIMPLE")
    supports.push({
      surface: {
        xMm: 0,
        yMm: 0,
        zMm: base,
        widthMm: zone.widthMm,
        depthMm: zone.depthMm,
        heightMm: Math.max(0, ceiling - base),
      },
    });
  else
    for (const position of positions) {
      if (
        position.xMm === undefined ||
        position.yMm === undefined ||
        position.widthMm === undefined ||
        position.depthMm === undefined
      )
        continue;
      const positionLocation = await ctx.tenantDb.get<Doc<"locations">>(
        "locations",
        position.locationId,
      );
      if (
        !positionLocation ||
        positionLocation.status !== "ACTIVE" ||
        positionLocation.warehouseId !== warehouseId
      )
        continue;
      const zMm = position.elevationMm ?? base;
      const xMm = position.xMm - zone.xMm,
        yMm = position.yMm - zone.yMm;
      const upperLevels = positions
        .filter(
          (other) =>
            (other.elevationMm ?? base) > zMm &&
            other.xMm !== undefined &&
            other.yMm !== undefined &&
            other.widthMm !== undefined &&
            other.depthMm !== undefined &&
            overlaps(
              {
                xMm: position.xMm!,
                yMm: position.yMm!,
                widthMm: position.widthMm!,
                depthMm: position.depthMm!,
              },
              {
                xMm: other.xMm!,
                yMm: other.yMm!,
                widthMm: other.widthMm!,
                depthMm: other.depthMm!,
              },
            ),
        )
        .map((other) => other.elevationMm ?? base);
      const top = Math.min(ceiling, ...upperLevels);
      if (
        xMm < 0 ||
        yMm < 0 ||
        xMm + position.widthMm > zone.widthMm ||
        yMm + position.depthMm > zone.depthMm ||
        top <= zMm
      )
        continue;
      supports.push({
        supportPositionId: position._id,
        surface: {
          xMm,
          yMm,
          zMm,
          widthMm: position.widthMm,
          depthMm: position.depthMm,
          heightMm: top - zMm,
        },
      });
    }
  // Derive pallet tops from confirmed placement geometry. Preserve the root rack ceiling.
  const fixedSupports = [...supports];
  for (const lower of stored) {
    let root = lower;
    const seen = new Set<string>([lower.palletId]);
    while (root.supportPalletId) {
      if (seen.has(root.supportPalletId) || seen.size >= 10) break;
      seen.add(root.supportPalletId);
      const parent = stored.find((p) => p.palletId === root.supportPalletId);
      if (!parent) break;
      root = parent;
    }
    if (root.supportPalletId) continue;
    const fixed = fixedSupports.find(
      (p) => p.supportPositionId === root.supportPositionId,
    );
    const lowerPallet = await palletOf(ctx, {
      warehouseId,
      palletId: lower.palletId,
    });
    if (!fixed || !lowerPallet || lowerPallet.placementId !== lower._id)
      continue;
    const zMm = lower.zMm + lower.heightMm;
    supports.push({
      ...compact({ baseSupportPositionId: root.supportPositionId }),
      supportPalletId: lower.palletId,
      supportCode: lowerPallet.code,
      surface: {
        xMm: lower.xMm,
        yMm: lower.yMm,
        zMm,
        widthMm: lower.widthMm,
        depthMm: lower.depthMm,
        heightMm: Math.max(0, fixed.surface.zMm + fixed.surface.heightMm - zMm),
      },
    });
  }
  return { zone, building, floor, positions, supports, unavailable, occupancy };
}
type LocationContext = NonNullable<Awaited<ReturnType<typeof locationContext>>>;
export interface PreviewSupport {
  supportPositionId?: Id<"storagePositions">;
  supportPalletId?: Id<"finishedGoodsPallets">;
  baseSupportPositionId?: Id<"storagePositions">;
  supportCode?: string;
  blockedReason?: string;
  surface: Surface;
}
export interface Destination {
  previewSupports?: PreviewSupport[];
  zoneId: Id<"storageZones">;
  locationId: Id<"locations">;
  locationName: string;
  locationCode: string;
  locationQrValue: string;
  buildingId: Id<"storageBuildings">;
  buildingName: string;
  buildingCode: string;
  floorId: Id<"storageFloors">;
  floorNumber: number;
  zone: {
    xMm: number;
    yMm: number;
    widthMm: number;
    depthMm: number;
    maxStackHeightMm: number;
    baseElevationMm: number;
  };
  supportPositionId?: Id<"storagePositions">;
  supportPalletId?: Id<"finishedGoodsPallets">;
  supportLabel?: string;
  supportCode?: string;
  support: Surface;
  xMm: number;
  yMm: number;
  zMm: number;
  rotation: Rotation;
  widthMm: number;
  depthMm: number;
  heightMm: number;
  positionCode: string;
  checks: {
    boundary: boolean;
    height: boolean;
    collision: boolean;
    storageCondition: "UNKNOWN" | "MATCH" | "MISMATCH";
  };
  occupied: Array<{
    placementId: Id<"finishedGoodsPlacements">;
    palletId: Id<"finishedGoodsPallets">;
    positionCode: string;
    xMm: number;
    yMm: number;
    zMm: number;
    widthMm: number;
    depthMm: number;
    heightMm: number;
    status: "RESERVED" | "STORED";
  }>;
  unavailable: Rectangle[];
}
export type Candidate = Destination;
function conditionCheck(
  context: LocationContext,
  product: Doc<"finishedGoodsProducts">,
): "UNKNOWN" | "MATCH" | "MISMATCH" {
  const locationCondition = context.zone.storageCondition?.trim().toUpperCase();
  const requiredCondition = product.storageCondition.trim().toUpperCase();
  if (!locationCondition || locationCondition === "ANY" || !requiredCondition)
    return "UNKNOWN";
  if (requiredCondition === "ANY") return "MATCH";
  return locationCondition === requiredCondition ? "MATCH" : "MISMATCH";
}
function destination(
  context: LocationContext,
  support: LocationContext["supports"][number],
  box: {
    xMm: number;
    yMm: number;
    zMm: number;
    widthMm: number;
    depthMm: number;
    heightMm: number;
    rotation: Rotation;
  },
  product: Doc<"finishedGoodsProducts">,
  palletId: Id<"finishedGoodsPallets">,
  positionCode = "Proposed",
): Destination {
  const { zone, building, floor } = context;
  const supportPosition = context.positions.find(
    (position) => position._id === support.supportPositionId,
  );
  const occupied = context.occupancy
    .filter((p) => p.palletId !== palletId)
    .map((p) => ({
      placementId: p._id,
      palletId: p.palletId,
      positionCode: p.positionCode,
      xMm: p.xMm,
      yMm: p.yMm,
      zMm: p.zMm,
      widthMm: p.widthMm,
      depthMm: p.depthMm,
      heightMm: p.heightMm,
      status: p.status as "RESERVED" | "STORED",
    }));
  const error = placementError(
    box,
    support.surface,
    occupied,
    context.unavailable,
  );
  return {
    zoneId: zone._id,
    locationId: zone.locationId,
    locationName: zone.label,
    locationCode: zone.code,
    locationQrValue: zone.qrValue,
    buildingId: building._id,
    buildingName: building.name,
    buildingCode: building.code,
    floorId: floor._id,
    floorNumber: floor.floorNumber,
    zone: {
      xMm: zone.xMm,
      yMm: zone.yMm,
      widthMm: zone.widthMm,
      depthMm: zone.depthMm,
      maxStackHeightMm: zone.maxStackHeightMm,
      baseElevationMm: zone.baseElevationMm ?? 0,
    },
    ...(support.supportPalletId
      ? {
          supportPalletId: support.supportPalletId,
          supportCode: support.supportCode,
          supportLabel: support.supportCode,
        }
      : {}),
    ...(support.supportPositionId
      ? { supportPositionId: support.supportPositionId }
      : {}),
    ...(supportPosition
      ? {
          supportLabel: supportPosition.label,
          supportCode: supportPosition.code,
        }
      : {}),
    support: support.surface,
    ...box,
    positionCode,
    checks: {
      boundary:
        error !== "OUTSIDE_LOCATION" &&
        error !== "POSITION_INVALID" &&
        error !== "UNAVAILABLE_AREA",
      height: box.heightMm <= support.surface.heightMm,
      collision: error !== "SPACE_OCCUPIED",
      storageCondition: conditionCheck(context, product),
    },
    occupied,
    unavailable: context.unavailable,
  };
}
async function recommendations(
  ctx: TenantFunctionContext,
  args: { warehouseId: Id<"warehouses">; palletId: Id<"finishedGoodsPallets"> },
) {
  const pallet = await palletOf(ctx, args);
  if (!pallet) return { candidates: [], reasons: ["NOT_FOUND"] };
  if (!measured(pallet))
    return { candidates: [], reasons: ["MEASUREMENTS_REQUIRED"] };
  const product = await productOf(ctx, {
    warehouseId: args.warehouseId,
    productId: pallet.productId,
  });
  if (!product) return { candidates: [], reasons: ["NOT_FOUND"] };
  const zones = await rows<Doc<"storageZones">>(
    ctx,
    "storageZones",
    "by_orgId_warehouseId_code",
    [{ field: "warehouseId", value: args.warehouseId }],
  );
  const candidates: Candidate[] = [];
  const previewCandidates: Candidate[] = [];
  const reasons = new Set<string>();
  let active = 0;
  for (const zone of zones) {
    const context = await locationContext(ctx, args.warehouseId, zone._id);
    if (!context) continue;
    active++;
    if (conditionCheck(context, product) === "MISMATCH") {
      reasons.add("STORAGE_CONDITION_MISMATCH");
      continue;
    }
    if (!context.supports.length) {
      reasons.add("NO_SUPPORT_SURFACE");
      continue;
    }
    const previewSupports: PreviewSupport[] = [];
    for (const support of context.supports) {
      if (support.supportPalletId === pallet._id) continue;
      const blockedReason = support.supportPalletId
        ? await validateStack(ctx, pallet, support.supportPalletId)
        : null;
      previewSupports.push({
        ...support,
        ...compact({ blockedReason: blockedReason ?? undefined }),
      });
    }
    for (const support of previewSupports) {
      // A selectable height must be backed by a valid floor, rack, or pallet.
      // Re-run the same stack rules here and again when the reservation commits.
      if (support.blockedReason) {
        reasons.add(support.blockedReason);
        continue;
      }
      const box = firstFit(
        pallet,
        support.surface,
        context.occupancy.filter((p) => p.palletId !== pallet._id),
        context.unavailable,
      );
      if (!box) {
        // Keep an inspectable floor/rack context even when no placement fits.
        // This is a preview, never a reservation: geometry is checked in the UI
        // and again by reserve/confirm on the server.
        if (!support.supportPalletId) {
          previewCandidates.push({
            ...destination(
              context,
              support,
              {
                xMm: support.surface.xMm,
                yMm: support.surface.yMm,
                zMm: support.surface.zMm,
                rotation: 0,
                ...dimensions(pallet, 0),
              },
              product,
              pallet._id,
            ),
            previewSupports,
          });
        }
        reasons.add(
          pallet.heightMm > support.surface.heightMm
            ? "HEIGHT_EXCEEDED"
            : "NO_FREE_FOOTPRINT",
        );
        continue;
      }
      candidates.push({
        ...destination(context, support, box, product, pallet._id),
        previewSupports,
      });
    }
  }
  candidates.sort(
    (a, b) =>
      (a.checks.storageCondition === "MATCH" ? 0 : 1) -
        (b.checks.storageCondition === "MATCH" ? 0 : 1) ||
      a.floorNumber - b.floorNumber ||
      a.buildingCode.localeCompare(b.buildingCode) ||
      a.locationCode.localeCompare(b.locationCode) ||
      a.zMm - b.zMm,
  );
  return {
    candidates,
    previewCandidates,
    reasons: candidates.length
      ? []
      : active
        ? [...reasons]
        : ["NO_ACTIVE_LOCATIONS"],
  };
}

export const recommend = queryWithOrg({
  args: palletArgs,
  returns: v.any(),
  permissionCode: READ,
  target: { table: "finishedGoodsPallets" },
  warehouseId: (a) => a.warehouseId,
  handler: recommendations,
});
export const recommendMove = queryWithOrg({
  args: palletArgs,
  returns: v.any(),
  permissionCode: READ,
  target: { table: "finishedGoodsPallets" },
  warehouseId: (a) => a.warehouseId,
  handler: async (ctx, args) => {
    const pallet = await palletOf(ctx, args);
    if (pallet?.status !== "STORED")
      return {
        candidates: [] as Candidate[],
        reasons: ["STORED_PALLET_REQUIRED"],
      };
    if ((await stackChildren(ctx, pallet._id)).length)
      return { candidates: [], reasons: ["PALLET_SUPPORTING_STACK"] };
    return recommendations(ctx, args);
  },
});

async function currentPlacement(
  ctx: TenantFunctionContext,
  pallet: Doc<"finishedGoodsPallets">,
) {
  if (!pallet.placementId) return null;
  const row = await ctx.tenantDb.get<Doc<"finishedGoodsPlacements">>(
    "finishedGoodsPlacements",
    pallet.placementId,
  );
  return row?.palletId === pallet._id &&
    row.warehouseId === pallet.warehouseId &&
    row.status !== "RELEASED"
    ? row
    : null;
}
async function detail(
  ctx: TenantFunctionContext,
  pallet: Doc<"finishedGoodsPallets">,
) {
  const product = await productOf(ctx, {
    warehouseId: pallet.warehouseId,
    productId: pallet.productId,
  });
  const placement = await currentPlacement(ctx, pallet);
  let resolved: Destination | null = null;
  if (placement && product) {
    const context = await locationContext(
      ctx,
      pallet.warehouseId,
      placement.zoneId,
    );
    const support = context?.supports.find(
      (s) =>
        s.supportPositionId === placement.supportPositionId &&
        s.supportPalletId === placement.supportPalletId,
    );
    if (context && support)
      resolved = destination(
        context,
        support,
        placement,
        product,
        pallet._id,
        placement.positionCode,
      );
  }
  return {
    pallet,
    product,
    placement,
    destination: resolved,
    stackChildren: await stackChildren(ctx, pallet._id),
    supportPallet: placement?.supportPalletId
      ? await palletOf(ctx, {
          warehouseId: pallet.warehouseId,
          palletId: placement.supportPalletId,
        })
      : null,
    ...(await (async () => {
      const moves = (await movesOf(ctx, pallet._id)).sort(
        (a, b) => b.createdAt - a.createdAt,
      );
      const active = moves.find(isActiveMove);
      return {
        ...(active ? { activeMove: await moveView(ctx, pallet, active) } : {}),
        ...(moves.length
          ? {
              moveHistory: await Promise.all(
                moves
                  .filter((m) => !isActiveMove(m))
                  .slice(0, 20)
                  .map((m) => moveView(ctx, pallet, m)),
              ),
            }
          : {}),
      };
    })()),
    destinationVerifiedForCurrentUser:
      placement?.verifiedAt !== undefined &&
      placement.verifiedByUserId === ctx.tenant.actor._id,
  };
}
export const getPallet = queryWithOrg({
  args: palletArgs,
  returns: v.any(),
  permissionCode: READ,
  target: { table: "finishedGoodsPallets" },
  warehouseId: (a) => a.warehouseId,
  handler: async (ctx, args) => {
    const pallet = await palletOf(ctx, args);
    return pallet ? await detail(ctx, pallet) : null;
  },
});
export const getProduct = queryWithOrg({
  args: { ...warehouseArgs, productId: v.id("finishedGoodsProducts") },
  returns: v.any(),
  permissionCode: READ,
  target: { table: "finishedGoodsProducts" },
  warehouseId: (a) => a.warehouseId,
  handler: productOf,
});
export const list = queryWithOrg({
  args: warehouseArgs,
  returns: v.any(),
  permissionCode: READ,
  target: { table: "finishedGoodsProducts" },
  warehouseId: (a) => a.warehouseId,
  handler: async (ctx, args) => {
    const products = await rows<Doc<"finishedGoodsProducts">>(
      ctx,
      "finishedGoodsProducts",
      "by_orgId_warehouseId_sku",
      [{ field: "warehouseId", value: args.warehouseId }],
    );
    const pallets = await rows<Doc<"finishedGoodsPallets">>(
      ctx,
      "finishedGoodsPallets",
      "by_orgId_warehouseId_code",
      [{ field: "warehouseId", value: args.warehouseId }],
    );
    const activeMoves = (
      await Promise.all(
        (["RESERVED", "IN_TRANSIT"] as const).map((status) =>
          rows<Doc<"finishedGoodsMoves">>(
            ctx,
            "finishedGoodsMoves",
            "by_orgId_warehouseId_status",
            [
              { field: "warehouseId", value: args.warehouseId },
              { field: "status", value: status },
            ],
          ),
        ),
      )
    ).flat();
    const productById = new Map(
      products.map((product) => [product._id, product]),
    );
    return {
      products: products.sort((a, b) => b.updatedAt - a.updatedAt),
      pallets: pallets
        .filter((pallet) => !pallet.retiredAt)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((pallet) => ({
          ...pallet,
          ...(() => {
            const move = activeMoves.find((m) => m.palletId === pallet._id);
            return move
              ? { moveStatus: move.status, activeMoveId: move._id }
              : {};
          })(),
          productName: productById.get(pallet.productId)?.name ?? "",
          sku: productById.get(pallet.productId)?.sku ?? "",
        })),
    };
  },
});

export const reserve = mutationWithOrg({
  args: {
    ...writeArgs,
    zoneId: v.id("storageZones"),
    supportPositionId: v.optional(v.id("storagePositions")),
    supportPalletId: v.optional(v.id("finishedGoodsPallets")),
    xMm: v.number(),
    yMm: v.number(),
    rotation: v.union(v.literal(0), v.literal(90)),
    expectedMeasurementUpdatedAt: v.optional(v.number()),
  },
  returns: v.any(),
  permissionCode: MANAGE,
  target: { table: "finishedGoodsPlacements" },
  warehouseId: (a) => a.warehouseId,
  handler: async (ctx, args) =>
    command(
      ctx,
      args,
      "finishedGoods.position.reserve",
      "finishedGoodsPlacements",
      async () => {
        const pallet = await palletOf(ctx, args);
        if (!pallet) return failure("NOT_FOUND");
        if (pallet.status === "STORED") return failure("ALREADY_STORED");
        if (!measured(pallet)) return failure("MEASUREMENTS_REQUIRED");
        if (
          args.expectedMeasurementUpdatedAt !== undefined &&
          args.expectedMeasurementUpdatedAt !== pallet.updatedAt
        )
          return failure("MEASUREMENT_CHANGED");
        const product = await productOf(ctx, {
          warehouseId: args.warehouseId,
          productId: pallet.productId,
        });
        if (!product) return failure("NOT_FOUND");
        const context = await locationContext(
          ctx,
          args.warehouseId,
          args.zoneId,
        );
        if (!context) return failure("LOCATION_UNAVAILABLE");
        const support = context.supports.find(
          (s) =>
            s.supportPositionId === args.supportPositionId &&
            s.supportPalletId === args.supportPalletId,
        );
        if (!support) return failure("SUPPORT_REQUIRED");
        const stackError = await validateStack(
          ctx,
          pallet,
          args.supportPalletId,
        );
        if (stackError) return failure(stackError);
        if (conditionCheck(context, product) === "MISMATCH")
          return failure("STORAGE_CONDITION_MISMATCH");
        const box = {
          xMm: args.xMm,
          yMm: args.yMm,
          zMm: support.surface.zMm,
          ...dimensions(pallet, args.rotation),
        };
        const invalid = placementError(
          box,
          support.surface,
          context.occupancy.filter((p) => p.palletId !== pallet._id),
          context.unavailable,
        );
        if (invalid) return failure(invalid);
        const old = await currentPlacement(ctx, pallet);
        const positionCode = await nextCode(ctx, args.warehouseId, "position");
        const documentId = await ctx.tenantDb.insert(
          "finishedGoodsPlacements",
          {
            warehouseId: args.warehouseId,
            palletId: pallet._id,
            buildingId: context.building._id,
            floorId: context.floor._id,
            zoneId: context.zone._id,
            locationId: context.zone.locationId,
            ...compact({ supportPalletId: args.supportPalletId }),
            ...(args.supportPositionId
              ? { supportPositionId: args.supportPositionId }
              : {}),
            positionCode,
            qrValue: `ISAS:FG-POSITION:1:${args.warehouseId}:${positionCode}`,
            ...box,
            rotation: args.rotation,
            status: "RESERVED",
            ...created(ctx),
          },
        );
        if (old)
          await ctx.tenantDb.patch("finishedGoodsPlacements", old._id, {
            status: "RELEASED",
            ...stamp(ctx),
          });
        await ctx.tenantDb.patch("finishedGoodsPallets", pallet._id, {
          placementId: documentId,
          status: "RESERVED",
          ...stamp(ctx),
        });
        return { documentId };
      },
    ),
});
export const cancelReservation = mutationWithOrg({
  args: writeArgs,
  returns: v.any(),
  permissionCode: MANAGE,
  target: { table: "finishedGoodsPallets" },
  warehouseId: (a) => a.warehouseId,
  handler: async (ctx, args) =>
    command(
      ctx,
      args,
      "finishedGoods.position.cancel",
      "finishedGoodsPallets",
      async () => {
        const pallet = await palletOf(ctx, args);
        if (!pallet) return failure("NOT_FOUND");
        if (pallet.status === "STORED") return failure("ALREADY_STORED");
        const placement = await currentPlacement(ctx, pallet);
        if (placement)
          await ctx.tenantDb.patch("finishedGoodsPlacements", placement._id, {
            status: "RELEASED",
            ...stamp(ctx),
          });
        await ctx.tenantDb.patch("finishedGoodsPallets", pallet._id, {
          placementId: undefined,
          status: measured(pallet)
            ? "AWAITING_PLACEMENT"
            : "AWAITING_MEASUREMENT",
          ...stamp(ctx),
        });
        return { documentId: pallet._id };
      },
    ),
});
async function validReserved(
  ctx: TenantFunctionContext,
  pallet: Doc<"finishedGoodsPallets">,
  placement: Doc<"finishedGoodsPlacements">,
) {
  const context = await locationContext(
    ctx,
    pallet.warehouseId,
    placement.zoneId,
  );
  if (!context) return { error: "LOCATION_UNAVAILABLE" } as const;
  const support = context.supports.find(
    (s) =>
      s.supportPositionId === placement.supportPositionId &&
      s.supportPalletId === placement.supportPalletId,
  );
  if (!support) return { error: "SUPPORT_REQUIRED" } as const;
  const stackError = await validateStack(
    ctx,
    pallet,
    placement.supportPalletId,
  );
  if (stackError) return { error: stackError };
  const product = await productOf(ctx, {
    warehouseId: pallet.warehouseId,
    productId: pallet.productId,
  });
  if (!product) return { error: "NOT_FOUND" } as const;
  if (conditionCheck(context, product) === "MISMATCH")
    return { error: "STORAGE_CONDITION_MISMATCH" } as const;
  const error = placementError(
    placement,
    support.surface,
    context.occupancy.filter((p) => p._id !== placement._id),
    context.unavailable,
  );
  return error ? { error } : { context };
}
export const verifyDestination = mutationWithOrg({
  args: {
    ...writeArgs,
    code: v.string(),
    method: v.union(v.literal("SCAN"), v.literal("MANUAL")),
  },
  returns: v.any(),
  permissionCode: MANAGE,
  target: { table: "finishedGoodsPlacements" },
  warehouseId: (a) => a.warehouseId,
  handler: async (ctx, args) =>
    command(
      ctx,
      args,
      "finishedGoods.destination.verify",
      "finishedGoodsPlacements",
      async () => {
        const pallet = await palletOf(ctx, args);
        if (!pallet) return failure("NOT_FOUND");
        if (pallet.status !== "RESERVED")
          return failure("RESERVATION_REQUIRED");
        const placement = await currentPlacement(ctx, pallet);
        if (!placement) return failure("RESERVATION_REQUIRED");
        const valid = await validReserved(ctx, pallet, placement);
        if ("error" in valid) return failure(valid.error!);
        const code = args.code.trim();
        const support = valid.context.positions.find(
          (p) => p._id === placement.supportPositionId,
        );
        const qrCodes = [
          valid.context.zone.qrValue,
          placement.qrValue,
          ...(support ? [support.qrValue] : []),
        ];
        const manualCodes = [
          valid.context.zone.code,
          placement.positionCode,
          ...(support ? [support.code] : []),
        ];
        const matches = placement.supportPalletId
          ? matchesLocation(code, args.method, placement, valid.context)
          : code.length > 0 &&
            code.length <= 500 &&
            (qrCodes.includes(code) ||
              (args.method === "MANUAL" &&
                manualCodes.some(
                  (expected) => expected.toUpperCase() === code.toUpperCase(),
                )));
        if (!matches) {
          await ctx.tenantDb.patch("finishedGoodsPlacements", placement._id, {
            verifiedAt: undefined,
            verifiedByUserId: undefined,
            verificationMethod: undefined,
            ...stamp(ctx),
          });
          return failure("DESTINATION_MISMATCH", "code");
        }
        await ctx.tenantDb.patch("finishedGoodsPlacements", placement._id, {
          verifiedAt: Date.now(),
          verifiedByUserId: ctx.tenant.actor._id,
          verificationMethod: args.method,
          ...stamp(ctx),
        });
        return { documentId: placement._id };
      },
    ),
});
export const confirmStored = mutationWithOrg({
  args: {
    ...writeArgs,
    physicalConfirmed: v.optional(v.boolean()),
    palletCode: v.optional(v.string()),
  },
  returns: v.any(),
  permissionCode: MANAGE,
  target: { table: "finishedGoodsPallets" },
  warehouseId: (a) => a.warehouseId,
  handler: async (ctx, args) =>
    command(
      ctx,
      args,
      "finishedGoods.pallet.store",
      "finishedGoodsPallets",
      async () => {
        const pallet = await palletOf(ctx, args);
        if (!pallet) return failure("NOT_FOUND");
        if ((await movesOf(ctx, pallet._id)).some(isActiveMove))
          return failure("MOVE_ALREADY_ACTIVE");
        if (pallet.status === "STORED") return { documentId: pallet._id };
        const placement = await currentPlacement(ctx, pallet);
        if (!placement || pallet.status !== "RESERVED")
          return failure("RESERVATION_REQUIRED");
        if (
          placement.verifiedAt === undefined ||
          placement.verifiedByUserId !== ctx.tenant.actor._id
        )
          return failure("DESTINATION_NOT_VERIFIED");
        if (
          placement.supportPalletId &&
          (!args.physicalConfirmed ||
            ![
              pallet.code.toUpperCase(),
              `ISAS:PALLET:1:${pallet._id}`.toUpperCase(),
            ].includes(args.palletCode?.trim().toUpperCase() ?? ""))
        )
          return failure("STACK_PHYSICAL_VERIFICATION_REQUIRED");
        const valid = await validReserved(ctx, pallet, placement);
        if ("error" in valid) return failure(valid.error!);
        await ctx.tenantDb.patch("finishedGoodsPlacements", placement._id, {
          status: "STORED",
          ...stamp(ctx),
        });
        await ctx.tenantDb.patch("finishedGoodsPallets", pallet._id, {
          status: "STORED",
          ...stamp(ctx),
        });
        return { documentId: pallet._id };
      },
    ),
});

const moveArgs = { ...writeArgs, moveId: v.id("finishedGoodsMoves") };
const identificationArgs = {
  code: v.string(),
  method: v.union(v.literal("SCAN"), v.literal("MANUAL")),
};
// Explicit physical acknowledgement is distinct from typing/scanning an identity code.
const moveConfirmationArgs = {
  code: v.optional(v.string()),
  method: v.optional(v.union(v.literal("SCAN"), v.literal("MANUAL"))),
  confirmationMethod: v.optional(v.literal("ACKNOWLEDGEMENT")),
  physicalConfirmed: v.boolean(),
};
async function movesOf(
  ctx: TenantFunctionContext,
  palletId: Id<"finishedGoodsPallets">,
) {
  return rows<Doc<"finishedGoodsMoves">>(
    ctx,
    "finishedGoodsMoves",
    "by_orgId_palletId",
    [{ field: "palletId", value: palletId }],
  );
}
function isActiveMove(move: Doc<"finishedGoodsMoves">) {
  return move.status === "RESERVED" || move.status === "IN_TRANSIT";
}
async function resolvePlacement(
  ctx: TenantFunctionContext,
  pallet: Doc<"finishedGoodsPallets">,
  placement: Doc<"finishedGoodsPlacements"> | null,
) {
  if (!placement) return null;
  const product = await productOf(ctx, {
    warehouseId: pallet.warehouseId,
    productId: pallet.productId,
  });
  const context = await locationContext(
    ctx,
    pallet.warehouseId,
    placement.zoneId,
  );
  const support = context?.supports.find(
    (s) =>
      s.supportPositionId === placement.supportPositionId &&
      s.supportPalletId === placement.supportPalletId,
  );
  return product && context && support
    ? destination(
        context,
        support,
        placement,
        product,
        pallet._id,
        placement.positionCode,
      )
    : null;
}
async function moveView(
  ctx: TenantFunctionContext,
  pallet: Doc<"finishedGoodsPallets">,
  move: Doc<"finishedGoodsMoves">,
) {
  const sourcePlacement = await ctx.tenantDb.get<
    Doc<"finishedGoodsPlacements">
  >("finishedGoodsPlacements", move.sourcePlacementId);
  const targetPlacement = await ctx.tenantDb.get<
    Doc<"finishedGoodsPlacements">
  >("finishedGoodsPlacements", move.targetPlacementId);
  return {
    ...move,
    sourcePlacement,
    targetPlacement,
    sourceDestination: await resolvePlacement(ctx, pallet, sourcePlacement),
    targetDestination: await resolvePlacement(ctx, pallet, targetPlacement),
    isOwner: move.ownerUserId === ctx.tenant.actor._id,
    canManageMove: move.ownerUserId === ctx.tenant.actor._id,
    destinationVerifiedForCurrentUser:
      move.verifiedAt !== undefined &&
      move.verifiedByUserId === ctx.tenant.actor._id &&
      move.verifiedTargetUpdatedAt === targetPlacement?.updatedAt,
  };
}
async function moveContext(
  ctx: TenantFunctionContext,
  args: { warehouseId: string; palletId: string; moveId: string },
) {
  const pallet = await palletOf(ctx, args);
  const move = await ctx.tenantDb.get<Doc<"finishedGoodsMoves">>(
    "finishedGoodsMoves",
    args.moveId,
  );
  if (
    !pallet ||
    !move ||
    move.palletId !== pallet._id ||
    move.warehouseId !== args.warehouseId
  )
    return { error: "NOT_FOUND" } as const;
  if ((await stackChildren(ctx, pallet._id)).length)
    return { error: "PALLET_SUPPORTING_STACK" } as const;
  if (move.ownerUserId !== ctx.tenant.actor._id)
    return { error: "MOVE_OWNED_BY_ANOTHER_OPERATOR" } as const;
  if (!isActiveMove(move)) return { error: "MOVE_NOT_ACTIVE" } as const;
  const source = await ctx.tenantDb.get<Doc<"finishedGoodsPlacements">>(
    "finishedGoodsPlacements",
    move.sourcePlacementId,
  );
  const target = await ctx.tenantDb.get<Doc<"finishedGoodsPlacements">>(
    "finishedGoodsPlacements",
    move.targetPlacementId,
  );
  if (
    !source ||
    source.palletId !== pallet._id ||
    source.warehouseId !== pallet.warehouseId ||
    source.status !== "STORED" ||
    source.updatedAt !== move.sourceUpdatedAt ||
    pallet.placementId !== source._id ||
    pallet.status !== "STORED" ||
    pallet.updatedAt !== move.palletUpdatedAt
  )
    return { error: "MOVE_SOURCE_CHANGED" } as const;
  if (
    !target ||
    target.palletId !== pallet._id ||
    target.warehouseId !== pallet.warehouseId ||
    target.status !== "RESERVED"
  )
    return { error: "MOVE_TARGET_CHANGED" } as const;
  return { pallet, move, source, target };
}
async function validMovePlacement(
  ctx: TenantFunctionContext,
  pallet: Doc<"finishedGoodsPallets">,
  placement: Doc<"finishedGoodsPlacements">,
  sourceId: Id<"finishedGoodsPlacements">,
  targetId: Id<"finishedGoodsPlacements">,
) {
  const context = await locationContext(
    ctx,
    pallet.warehouseId,
    placement.zoneId,
  );
  const support = context?.supports.find(
    (s) =>
      s.supportPositionId === placement.supportPositionId &&
      s.supportPalletId === placement.supportPalletId,
  );
  if (!context) return { error: "LOCATION_UNAVAILABLE" } as const;
  if (!support) return { error: "SUPPORT_REQUIRED" } as const;
  const stackError = await validateStack(
    ctx,
    pallet,
    placement.supportPalletId,
  );
  if (stackError) return { error: stackError };
  const product = await productOf(ctx, {
    warehouseId: pallet.warehouseId,
    productId: pallet.productId,
  });
  if (!product) return { error: "NOT_FOUND" } as const;
  if (conditionCheck(context, product) === "MISMATCH")
    return { error: "STORAGE_CONDITION_MISMATCH" } as const;
  if (!measured(pallet)) return { error: "MEASUREMENTS_REQUIRED" } as const;
  const expected = dimensions(pallet, placement.rotation);
  if (
    placement.widthMm !== expected.widthMm ||
    placement.depthMm !== expected.depthMm ||
    placement.heightMm !== expected.heightMm ||
    placement.zMm !== support.surface.zMm
  )
    return { error: "MOVE_TARGET_CHANGED" } as const;
  const error = placementError(
    placement,
    support.surface,
    context.occupancy.filter((p) => p._id !== sourceId && p._id !== targetId),
    context.unavailable,
  );
  return error ? { error } : { context };
}
function matchesLocation(
  code: string,
  method: "SCAN" | "MANUAL",
  placement: Doc<"finishedGoodsPlacements">,
  context: LocationContext,
) {
  const trimmed = code.trim();
  if (!trimmed || trimmed.length > 500) return false;
  if (placement.supportPalletId) {
    const support = context.supports.find(
      (p) => p.supportPalletId === placement.supportPalletId,
    );
    return (
      trimmed === `ISAS:PALLET:1:${placement.supportPalletId}` ||
      (method === "MANUAL" &&
        trimmed.toUpperCase() === support?.supportCode?.toUpperCase())
    );
  }
  const support = context.positions.find(
    (p) => p._id === placement.supportPositionId,
  );
  return (
    [
      context.zone.qrValue,
      placement.qrValue,
      ...(support ? [support.qrValue] : []),
    ].includes(trimmed) ||
    (method === "MANUAL" &&
      [
        context.zone.code,
        placement.positionCode,
        ...(support ? [support.code] : []),
      ].some((c) => c.toUpperCase() === trimmed.toUpperCase()))
  );
}
export const reserveMove = mutationWithOrg({
  args: {
    ...writeArgs,
    zoneId: v.id("storageZones"),
    supportPositionId: v.optional(v.id("storagePositions")),
    supportPalletId: v.optional(v.id("finishedGoodsPallets")),
    xMm: v.number(),
    yMm: v.number(),
    rotation: v.union(v.literal(0), v.literal(90)),
    expectedSourcePlacementId: v.id("finishedGoodsPlacements"),
    expectedMeasurementUpdatedAt: v.optional(v.number()),
    reason: v.optional(v.string()),
    moveId: v.optional(v.id("finishedGoodsMoves")),
  },
  returns: v.any(),
  permissionCode: MANAGE,
  target: { table: "finishedGoodsMoves" },
  warehouseId: (a) => a.warehouseId,
  handler: async (ctx, args) =>
    command(
      ctx,
      args,
      "finishedGoods.move.reserve",
      "finishedGoodsMoves",
      async () => {
        const pallet = await palletOf(ctx, args);
        if (!pallet || pallet.status !== "STORED")
          return failure("STORED_PALLET_REQUIRED");
        if (!measured(pallet)) return failure("MEASUREMENTS_REQUIRED");
        if ((await stackChildren(ctx, pallet._id)).length)
          return failure("PALLET_SUPPORTING_STACK");
        if ((args.reason?.trim().length ?? 0) > 2000)
          return failure("FIELD_INVALID", "reason");
        const source = await currentPlacement(ctx, pallet);
        if (
          !source ||
          source._id !== args.expectedSourcePlacementId ||
          source.status !== "STORED"
        )
          return failure("MOVE_SOURCE_CHANGED");
        if (
          args.expectedMeasurementUpdatedAt !== undefined &&
          args.expectedMeasurementUpdatedAt !== pallet.updatedAt
        )
          return failure("MEASUREMENT_CHANGED");
        const activeMove = (await movesOf(ctx, pallet._id)).find(isActiveMove);
        if (activeMove && activeMove._id !== args.moveId)
          return failure("MOVE_ALREADY_ACTIVE");
        const replacing = args.moveId
          ? await moveContext(ctx, { ...args, moveId: args.moveId })
          : null;
        if (replacing && "error" in replacing) return failure(replacing.error!);
        if (replacing && replacing.move.status !== "RESERVED")
          return failure("MOVE_RETURN_REQUIRED");
        const product = await productOf(ctx, {
          warehouseId: args.warehouseId,
          productId: pallet.productId,
        });
        const context = await locationContext(
          ctx,
          args.warehouseId,
          args.zoneId,
        );
        if (!product) return failure("NOT_FOUND");
        if (!context) return failure("LOCATION_UNAVAILABLE");
        const support = context.supports.find(
          (s) =>
            s.supportPositionId === args.supportPositionId &&
            s.supportPalletId === args.supportPalletId,
        );
        if (!support) return failure("SUPPORT_REQUIRED");
        const stackError = await validateStack(
          ctx,
          pallet,
          args.supportPalletId,
        );
        if (stackError) return failure(stackError);
        if (conditionCheck(context, product) === "MISMATCH")
          return failure("STORAGE_CONDITION_MISMATCH");
        const box = {
          xMm: args.xMm,
          yMm: args.yMm,
          zMm: support.surface.zMm,
          ...dimensions(pallet, args.rotation),
        };
        if (
          source.zoneId === args.zoneId &&
          source.supportPositionId === args.supportPositionId &&
          source.xMm === box.xMm &&
          source.yMm === box.yMm &&
          source.zMm === box.zMm &&
          source.rotation === args.rotation
        )
          return failure("MOVE_UNCHANGED");
        const invalid = placementError(
          box,
          support.surface,
          context.occupancy.filter(
            (p) => p._id !== source._id && p._id !== replacing?.target._id,
          ),
          context.unavailable,
        );
        if (invalid) return failure(invalid);
        const positionCode = await nextCode(ctx, args.warehouseId, "position");
        const targetStamp = created(ctx);
        const targetId = await ctx.tenantDb.insert("finishedGoodsPlacements", {
          warehouseId: args.warehouseId,
          palletId: pallet._id,
          buildingId: context.building._id,
          floorId: context.floor._id,
          zoneId: context.zone._id,
          locationId: context.zone.locationId,
          ...compact({
            supportPositionId: args.supportPositionId,
            supportPalletId: args.supportPalletId,
          }),
          positionCode,
          qrValue: `ISAS:FG-POSITION:1:${args.warehouseId}:${positionCode}`,
          ...box,
          rotation: args.rotation,
          status: "RESERVED",
          ...targetStamp,
        });
        if (replacing) {
          await ctx.tenantDb.patch(
            "finishedGoodsPlacements",
            replacing.target._id,
            { status: "RELEASED", ...stamp(ctx) },
          );
          await ctx.tenantDb.patch("finishedGoodsMoves", replacing.move._id, {
            targetPlacementId: targetId,
            targetUpdatedAt: targetStamp.updatedAt,
            reason: args.reason?.trim(),
            verifiedAt: undefined,
            verifiedByUserId: undefined,
            verifiedTargetUpdatedAt: undefined,
            verificationMethod: undefined,
            ...stamp(ctx),
          });
          return { documentId: replacing.move._id };
        }
        const documentId = await ctx.tenantDb.insert("finishedGoodsMoves", {
          warehouseId: args.warehouseId,
          palletId: pallet._id,
          sourcePlacementId: source._id,
          targetPlacementId: targetId,
          sourceUpdatedAt: source.updatedAt,
          palletUpdatedAt: pallet.updatedAt,
          targetUpdatedAt: targetStamp.updatedAt,
          ownerUserId: ctx.tenant.actor._id,
          status: "RESERVED",
          ...compact({ reason: args.reason?.trim() }),
          ...created(ctx),
        });
        return { documentId };
      },
    ),
});
export const startMove = mutationWithOrg({
  args: { ...moveArgs, ...moveConfirmationArgs },
  returns: v.any(),
  permissionCode: MANAGE,
  target: { table: "finishedGoodsMoves" },
  warehouseId: (a) => a.warehouseId,
  handler: async (ctx, args) =>
    command(
      ctx,
      args,
      "finishedGoods.move.start",
      "finishedGoodsMoves",
      async () => {
        const state = await moveContext(ctx, args);
        if ("error" in state) return failure(state.error!);
        if (state.move.status !== "RESERVED")
          return failure("MOVE_ALREADY_STARTED");
        if (!args.physicalConfirmed)
          return failure("PHYSICAL_CONFIRMATION_REQUIRED");
        const code = args.code?.trim() ?? "";
        if (
          args.confirmationMethod !== "ACKNOWLEDGEMENT" &&
          (!args.method ||
            (code !== `ISAS:PALLET:1:${state.pallet._id}` &&
              !(
                args.method === "MANUAL" &&
                code.toUpperCase() === state.pallet.code.toUpperCase()
              )))
        )
          return failure("PALLET_MISMATCH", "code");
        if (state.target.updatedAt !== state.move.targetUpdatedAt)
          return failure("MOVE_TARGET_CHANGED");
        const valid = await validMovePlacement(
          ctx,
          state.pallet,
          state.target,
          state.source._id,
          state.target._id,
        );
        if ("error" in valid) return failure(valid.error!);
        await ctx.tenantDb.patch("finishedGoodsMoves", state.move._id, {
          status: "IN_TRANSIT",
          pickedUpAt: Date.now(),
          pickupConfirmationMethod: args.confirmationMethod ?? args.method,
          ...stamp(ctx),
        });
        return { documentId: state.move._id };
      },
    ),
});
export const verifyMoveDestination = mutationWithOrg({
  args: { ...moveArgs, ...identificationArgs },
  returns: v.any(),
  permissionCode: MANAGE,
  target: { table: "finishedGoodsMoves" },
  warehouseId: (a) => a.warehouseId,
  handler: async (ctx, args) =>
    command(
      ctx,
      args,
      "finishedGoods.move.verify",
      "finishedGoodsMoves",
      async () => {
        const state = await moveContext(ctx, args);
        if ("error" in state) return failure(state.error!);
        if (state.move.status !== "IN_TRANSIT")
          return failure("MOVE_PICKUP_REQUIRED");
        if (state.target.updatedAt !== state.move.targetUpdatedAt)
          return failure("MOVE_TARGET_CHANGED");
        const valid = await validMovePlacement(
          ctx,
          state.pallet,
          state.target,
          state.source._id,
          state.target._id,
        );
        if ("error" in valid) return failure(valid.error!);
        if (
          !matchesLocation(args.code, args.method, state.target, valid.context)
        ) {
          await ctx.tenantDb.patch("finishedGoodsMoves", state.move._id, {
            verifiedAt: undefined,
            verifiedByUserId: undefined,
            verifiedTargetUpdatedAt: undefined,
            verificationMethod: undefined,
            ...stamp(ctx),
          });
          return failure("DESTINATION_MISMATCH", "code");
        }
        await ctx.tenantDb.patch("finishedGoodsMoves", state.move._id, {
          verifiedAt: Date.now(),
          verifiedByUserId: ctx.tenant.actor._id,
          verifiedTargetUpdatedAt: state.target.updatedAt,
          verificationMethod: args.method,
          ...stamp(ctx),
        });
        return { documentId: state.move._id };
      },
    ),
});
export const completeMove = mutationWithOrg({
  args: {
    ...moveArgs,
    physicalConfirmed: v.boolean(),
    confirmationMethod: v.optional(v.literal("ACKNOWLEDGEMENT")),
  },
  returns: v.any(),
  permissionCode: MANAGE,
  target: { table: "finishedGoodsMoves" },
  warehouseId: (a) => a.warehouseId,
  handler: async (ctx, args) =>
    command(
      ctx,
      args,
      "finishedGoods.move.complete",
      "finishedGoodsMoves",
      async () => {
        const state = await moveContext(ctx, args);
        if ("error" in state) return failure(state.error!);
        if (state.move.status !== "IN_TRANSIT")
          return failure("MOVE_PICKUP_REQUIRED");
        if (!args.physicalConfirmed)
          return failure("PHYSICAL_CONFIRMATION_REQUIRED");
        if (
          args.confirmationMethod !== "ACKNOWLEDGEMENT" &&
          (state.move.verifiedAt === undefined ||
            state.move.verifiedByUserId !== ctx.tenant.actor._id ||
            state.move.verifiedTargetUpdatedAt !== state.target.updatedAt)
        )
          return failure("DESTINATION_NOT_VERIFIED");
        if (state.target.updatedAt !== state.move.targetUpdatedAt)
          return failure("MOVE_TARGET_CHANGED");
        const valid = await validMovePlacement(
          ctx,
          state.pallet,
          state.target,
          state.source._id,
          state.target._id,
        );
        if ("error" in valid) return failure(valid.error!);
        await ctx.tenantDb.patch("finishedGoodsPlacements", state.target._id, {
          status: "STORED",
          verifiedAt: args.confirmationMethod
            ? undefined
            : state.move.verifiedAt,
          verifiedByUserId: args.confirmationMethod
            ? undefined
            : ctx.tenant.actor._id,
          verificationMethod: args.confirmationMethod
            ? undefined
            : state.move.verificationMethod,
          ...stamp(ctx),
        });
        await ctx.tenantDb.patch("finishedGoodsPlacements", state.source._id, {
          status: "RELEASED",
          ...stamp(ctx),
        });
        await ctx.tenantDb.patch("finishedGoodsPallets", state.pallet._id, {
          placementId: state.target._id,
          ...stamp(ctx),
        });
        await ctx.tenantDb.patch("finishedGoodsMoves", state.move._id, {
          status: "COMPLETED",
          completedAt: Date.now(),
          completionConfirmationMethod:
            args.confirmationMethod ?? state.move.verificationMethod,
          ...stamp(ctx),
        });
        return { documentId: state.move._id };
      },
    ),
});
export const cancelMove = mutationWithOrg({
  args: moveArgs,
  returns: v.any(),
  permissionCode: MANAGE,
  target: { table: "finishedGoodsMoves" },
  warehouseId: (a) => a.warehouseId,
  handler: async (ctx, args) =>
    command(
      ctx,
      args,
      "finishedGoods.move.cancel",
      "finishedGoodsMoves",
      async () => {
        const state = await moveContext(ctx, args);
        if ("error" in state) return failure(state.error!);
        if (state.move.status !== "RESERVED")
          return failure("MOVE_RETURN_REQUIRED");
        await ctx.tenantDb.patch("finishedGoodsPlacements", state.target._id, {
          status: "RELEASED",
          ...stamp(ctx),
        });
        await ctx.tenantDb.patch("finishedGoodsMoves", state.move._id, {
          status: "CANCELLED",
          completedAt: Date.now(),
          ...stamp(ctx),
        });
        return { documentId: state.move._id };
      },
    ),
});
export const returnMove = mutationWithOrg({
  args: { ...moveArgs, ...moveConfirmationArgs },
  returns: v.any(),
  permissionCode: MANAGE,
  target: { table: "finishedGoodsMoves" },
  warehouseId: (a) => a.warehouseId,
  handler: async (ctx, args) =>
    command(
      ctx,
      args,
      "finishedGoods.move.return",
      "finishedGoodsMoves",
      async () => {
        const state = await moveContext(ctx, args);
        if ("error" in state) return failure(state.error!);
        if (state.move.status !== "IN_TRANSIT")
          return failure("MOVE_PICKUP_REQUIRED");
        if (!args.physicalConfirmed)
          return failure("PHYSICAL_CONFIRMATION_REQUIRED");
        // A failed destination must never prevent the operator from returning to the held source.
        const valid = await validMovePlacement(
          ctx,
          state.pallet,
          state.source,
          state.source._id,
          state.target._id,
        );
        if ("error" in valid) return failure(valid.error!);
        if (
          args.confirmationMethod !== "ACKNOWLEDGEMENT" &&
          (!args.code ||
            !args.method ||
            !matchesLocation(
              args.code,
              args.method,
              state.source,
              valid.context,
            ))
        )
          return failure("SOURCE_MISMATCH", "code");
        await ctx.tenantDb.patch("finishedGoodsPlacements", state.target._id, {
          status: "RELEASED",
          ...stamp(ctx),
        });
        await ctx.tenantDb.patch("finishedGoodsMoves", state.move._id, {
          status: "RETURNED",
          completedAt: Date.now(),
          completionConfirmationMethod: args.confirmationMethod ?? args.method,
          ...stamp(ctx),
        });
        return { documentId: state.move._id };
      },
    ),
});
export const reportMoveIssue = mutationWithOrg({
  args: { ...moveArgs, issue: v.string() },
  returns: v.any(),
  permissionCode: MANAGE,
  target: { table: "finishedGoodsMoves" },
  warehouseId: (a) => a.warehouseId,
  handler: async (ctx, args) =>
    command(
      ctx,
      args,
      "finishedGoods.move.issue",
      "finishedGoodsMoves",
      async () => {
        const pallet = await palletOf(ctx, args);
        const move = await ctx.tenantDb.get<Doc<"finishedGoodsMoves">>(
          "finishedGoodsMoves",
          args.moveId,
        );
        if (
          !pallet ||
          !move ||
          move.palletId !== pallet._id ||
          move.warehouseId !== args.warehouseId
        )
          return failure("NOT_FOUND");
        if (move.ownerUserId !== ctx.tenant.actor._id)
          return failure("MOVE_OWNED_BY_ANOTHER_OPERATOR");
        if (!isActiveMove(move)) return failure("MOVE_NOT_ACTIVE");
        const issue = args.issue.trim();
        if (!issue || issue.length > 2000)
          return failure("FIELD_INVALID", "issue");
        await ctx.tenantDb.patch("finishedGoodsMoves", move._id, {
          issue,
          ...stamp(ctx),
        });
        return { documentId: move._id };
      },
    ),
});

/** Unit packaging is authoritative; product format is only a legacy fallback. */
async function isStackingPallet(
  ctx: TenantFunctionContext,
  pallet: Doc<"finishedGoodsPallets">,
) {
  if (pallet.retiredAt) return false;
  const format =
    pallet.storageFormat ??
    (
      await productOf(ctx, {
        warehouseId: pallet.warehouseId,
        productId: pallet.productId,
      })
    )?.storageFormat;
  return format === "PALLET";
}

/** A column has one pallet per level. Reservations hold both space and support capacity. */
async function stackChildren(
  ctx: TenantFunctionContext,
  palletId: Id<"finishedGoodsPallets">,
) {
  return (
    await rows<Doc<"finishedGoodsPlacements">>(
      ctx,
      "finishedGoodsPlacements",
      "by_orgId_supportPalletId",
      [{ field: "supportPalletId", value: palletId }],
    )
  ).filter((p) => p.status !== "RELEASED");
}
async function validateStack(
  ctx: TenantFunctionContext,
  upper: Doc<"finishedGoodsPallets">,
  supportPalletId?: Id<"finishedGoodsPallets">,
): Promise<string | null> {
  if (!supportPalletId) return null;
  if (!(await isStackingPallet(ctx, upper))) return "STACK_PALLET_ONLY";
  if ((await stackChildren(ctx, upper._id)).length)
    return "PALLET_SUPPORTING_STACK";
  let parentId: Id<"finishedGoodsPallets"> | undefined = supportPalletId;
  let childId = upper._id,
    levels = 2;
  const seen = new Set<string>([upper._id]);
  while (parentId) {
    if (seen.has(parentId) || levels > 10) return "STACK_CYCLE";
    seen.add(parentId);
    const parent = await palletOf(ctx, {
      warehouseId: upper.warehouseId,
      palletId: parentId,
    });
    if (!parent || parent.status !== "STORED")
      return "STACK_SUPPORT_UNAVAILABLE";
    if (!(await isStackingPallet(ctx, parent))) return "STACK_PALLET_ONLY";
    if ((await movesOf(ctx, parent._id)).some(isActiveMove))
      return "STACK_SUPPORT_MOVING";
    if (
      !parent.stackable ||
      !Number.isSafeInteger(parent.maxStackLevels) ||
      parent.maxStackLevels! < 2
    )
      return "STACK_LIMITS_REQUIRED";
    if (levels > parent.maxStackLevels!) return "STACK_LEVELS_EXCEEDED";
    if (
      (await stackChildren(ctx, parent._id)).some(
        (p) => p.palletId !== childId && p.palletId !== upper._id,
      )
    )
      return "STACK_SUPPORT_OCCUPIED";
    const placement = await currentPlacement(ctx, parent);
    if (!placement || placement.status !== "STORED")
      return "STACK_SUPPORT_UNAVAILABLE";
    childId = parent._id;
    parentId = placement.supportPalletId;
    levels++;
  }
  return null;
}
export const saveStackingLimits = mutationWithOrg({
  args: {
    ...writeArgs,
    stackable: v.boolean(),
    maxStackLevels: v.optional(v.number()),
  },
  returns: v.any(),
  permissionCode: MANAGE,
  target: { table: "finishedGoodsPallets" },
  warehouseId: (a) => a.warehouseId,
  handler: async (ctx, args) =>
    command(
      ctx,
      args,
      "finishedGoods.stacking.configure",
      "finishedGoodsPallets",
      async () => {
        const pallet = await palletOf(ctx, args);
        if (!pallet) return failure("NOT_FOUND");
        if (!(await isStackingPallet(ctx, pallet)))
          return failure("STACK_PALLET_ONLY");
        if ((await movesOf(ctx, pallet._id)).some(isActiveMove))
          return failure("MOVE_ALREADY_ACTIVE");
        if ((await stackChildren(ctx, pallet._id)).length)
          return failure("PALLET_SUPPORTING_STACK");
        const placement = await currentPlacement(ctx, pallet);
        if (placement?.supportPalletId || pallet.status === "RESERVED")
          return failure("STACK_SETTINGS_LOCKED");
        if (
          args.stackable &&
          (!Number.isSafeInteger(args.maxStackLevels) ||
            args.maxStackLevels! < 2 ||
            args.maxStackLevels! > 10)
        )
          return failure("STACK_LIMITS_REQUIRED");
        await ctx.tenantDb.patch("finishedGoodsPallets", pallet._id, {
          ...stamp(ctx),
          stackable: args.stackable,
          maxStackLevels: args.stackable ? args.maxStackLevels : undefined,
        });
        return { documentId: pallet._id };
      },
    ),
});
export const stackOptions = queryWithOrg({
  args: {
    ...palletArgs,
    upperPalletId: v.optional(v.id("finishedGoodsPallets")),
    rotation: v.union(v.literal(0), v.literal(90)),
  },
  returns: v.any(),
  permissionCode: READ,
  target: { table: "finishedGoodsPallets" },
  warehouseId: (a) => a.warehouseId,
  handler: async (ctx, args) => {
    const lower = await palletOf(ctx, args);
    if (
      !lower ||
      lower.status !== "STORED" ||
      !(await isStackingPallet(ctx, lower))
    )
      return null;
    const placement = await currentPlacement(ctx, lower);
    if (!placement) return null;
    const context = await locationContext(
      ctx,
      args.warehouseId,
      placement.zoneId,
    );
    const support = context?.supports.find(
      (s) => s.supportPalletId === lower._id,
    );
    const possiblePallets = (
      await rows<Doc<"finishedGoodsPallets">>(
        ctx,
        "finishedGoodsPallets",
        "by_orgId_warehouseId_code",
        [{ field: "warehouseId", value: args.warehouseId }],
      )
    ).filter(
      (p) =>
        !p.retiredAt &&
        p._id !== lower._id &&
        measured(p) &&
        ["AWAITING_PLACEMENT", "STORED", "RESERVED"].includes(p.status),
    );
    const flags = await Promise.all(
      possiblePallets.map((p) => isStackingPallet(ctx, p)),
    );
    const pallets = possiblePallets.filter((_, i) => flags[i]);
    const upper = pallets.find((p) => p._id === args.upperPalletId);
    let candidate: Destination | null = null;
    let error: string | null = null;
    if (upper) {
      error = await validateStack(ctx, upper, lower._id);
      if ((await movesOf(ctx, upper._id)).some(isActiveMove))
        error = "MOVE_ALREADY_ACTIVE";
      const product = await productOf(ctx, {
        warehouseId: args.warehouseId,
        productId: upper.productId,
      });
      if (!context || !support || !product)
        error ??= "STACK_SUPPORT_UNAVAILABLE";
      else if (measured(upper)) {
        const size = dimensions(upper, args.rotation);
        const box = {
          ...size,
          xMm:
            support.surface.xMm +
            Math.floor((support.surface.widthMm - size.widthMm) / 2),
          yMm:
            support.surface.yMm +
            Math.floor((support.surface.depthMm - size.depthMm) / 2),
          zMm: support.surface.zMm,
          rotation: args.rotation,
        };
        candidate = destination(context, support, box, product, upper._id);
        error ??= placementError(
          box,
          support.surface,
          context.occupancy.filter((p) => p.palletId !== upper._id),
          context.unavailable,
        );
        if (conditionCheck(context, product) === "MISMATCH")
          error ??= "STORAGE_CONDITION_MISMATCH";
        const current = await currentPlacement(ctx, upper);
        if (
          upper.status === "STORED" &&
          current?.zoneId === candidate.zoneId &&
          current.xMm === box.xMm &&
          current.yMm === box.yMm &&
          current.zMm === box.zMm &&
          current.rotation === box.rotation
        )
          error ??= "MOVE_UNCHANGED";
      }
    }
    return {
      lower,
      lowerSettingsLocked:
        Boolean(placement.supportPalletId) ||
        (await movesOf(ctx, lower._id)).some(isActiveMove),
      upperSettingsLocked: upper
        ? Boolean((await currentPlacement(ctx, upper))?.supportPalletId) ||
          (await movesOf(ctx, upper._id)).some(isActiveMove)
        : false,
      children: await stackChildren(ctx, lower._id),
      pallets,
      candidate,
      error,
    };
  },
});
