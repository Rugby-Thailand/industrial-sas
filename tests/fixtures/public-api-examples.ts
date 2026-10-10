import { makeFunctionReference, type FunctionReference } from "convex/server";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
  type ConvexTestModuleMap,
} from "./convex-tenant-world";

export const PUBLIC_API_ACTOR = {
  subject: "user_fixture_a",
  org_id: "org_fixture_a",
};
export const PUBLIC_API_FOREIGN_ACTOR = {
  subject: "user_fixture_a",
  org_id: "org_fixture_b",
};

export type PublicApiWorld = ConvexTenantWorld & {
  readonly productId: Id<"finishedGoodsProducts">;
  readonly batchId: Id<"finishedGoodsBatches">;
  readonly palletId: Id<"finishedGoodsPallets">;
  readonly buildingId: Id<"storageBuildings">;
};

export function allowedValue(outcome: unknown): unknown {
  if (
    outcome === null ||
    typeof outcome !== "object" ||
    !("ok" in outcome) ||
    outcome.ok !== true ||
    !("value" in outcome)
  ) {
    throw new Error("Expected a permitted registered public API result.");
  }
  return outcome.value;
}

function writtenId(outcome: unknown): string {
  const value = allowedValue(outcome);
  if (
    value === null ||
    typeof value !== "object" ||
    !("written" in value) ||
    value.written !== true ||
    !("documentId" in value) ||
    typeof value.documentId !== "string"
  ) {
    throw new Error("Expected a successful registered fixture write.");
  }
  return value.documentId;
}

/**
 * Use the real role catalogue and real registered mutations, with no extra
 * permissions or handler stubs. Domain IDs belong to actual schema-validated
 * in-memory documents rather than hand-written strings that only look like IDs.
 */
export async function createPublicApiWorld(
  modules: ConvexTestModuleMap,
  role: "ORG_ADMIN" | "SUPERVISOR" = "ORG_ADMIN",
): Promise<PublicApiWorld> {
  const world = await createConvexTenantWorld(modules);
  const authorization = await seedConvexAuthorization(world, {
    roleA: "ORG_ADMIN",
  });
  const actor = world.t.withIdentity(PUBLIC_API_ACTOR);
  const warehouseId = world.warehouses.alphaA;
  const product = writtenId(
    await actor.mutation(api.finishedGoods.workflow.saveProduct, {
      warehouseId,
      requestId: "public-fixture-product",
      sku: "PUBLIC-1",
      name: "Public contract product",
      unit: "PCS",
      storageFormat: "PALLET",
      defaultQuantity: 50,
      storageCondition: "ANY",
      draft: false,
    }),
  );
  const productId = await world.t.run(async (ctx) =>
    ctx.db.normalizeId("finishedGoodsProducts", product),
  );
  if (productId === null)
    throw new Error("Registered product write returned the wrong table ID.");
  const batch = writtenId(
    await actor.mutation(api.finishedGoods.batches.saveBatchDraft, {
      warehouseId,
      productId,
      requestId: "public-fixture-batch",
      storageFormat: "PALLET",
      totalQuantity: 50,
      packages: [
        {
          quantity: 50,
          dimensionsChecked: true,
          lengthMm: 1_200,
          widthMm: 1_000,
          heightMm: 1_400,
        },
      ],
    }),
  );
  const batchId = await world.t.run(async (ctx) =>
    ctx.db.normalizeId("finishedGoodsBatches", batch),
  );
  if (batchId === null)
    throw new Error("Registered batch write returned the wrong table ID.");
  const pallet = writtenId(
    await actor.mutation(api.finishedGoods.workflow.createPallet, {
      warehouseId,
      productId,
      requestId: "public-fixture-pallet",
    }),
  );
  const palletId = await world.t.run(async (ctx) =>
    ctx.db.normalizeId("finishedGoodsPallets", pallet),
  );
  if (palletId === null)
    throw new Error("Registered pallet write returned the wrong table ID.");
  const building = writtenId(
    await actor.mutation(api.storageLayouts.writes.createStorageBuilding, {
      warehouseId,
      requestId: "public-fixture-building",
      code: "PUBLIC-B",
      name: "Public contract building",
      widthMm: 10_000,
      depthMm: 20_000,
      defaultFloorHeightMm: 3_000,
      floorCount: 1,
    }),
  );
  const buildingId = await world.t.run(async (ctx) =>
    ctx.db.normalizeId("storageBuildings", building),
  );
  if (buildingId === null)
    throw new Error("Registered building write returned the wrong table ID.");
  if (role !== "ORG_ADMIN") {
    const roleId = authorization.rolesA.get(role);
    if (roleId === undefined)
      throw new Error("Missing existing read-only fixture role.");
    await world.t.run(
      async (ctx) =>
        await ctx.db.patch("membershipRoles", authorization.membershipRoleA, {
          roleId,
        }),
    );
  }
  return { ...world, productId, batchId, palletId, buildingId };
}

type Kind = "query" | "mutation" | "action";
type ExampleFor<K extends Kind> = {
  readonly name: string;
  readonly kind: K;
  readonly reference: FunctionReference<
    K,
    "public",
    Record<string, unknown>,
    unknown
  >;
  readonly args: (world: PublicApiWorld) => Record<string, unknown>;
  /** Explicit gaps: import-specific approved geometry is covered only by guards. */
  readonly domainGuardOnly?: boolean;
};
export type PublicApiExample =
  ExampleFor<"query"> | ExampleFor<"mutation"> | ExampleFor<"action">;

function example<K extends Kind>(
  name: string,
  kind: K,
  args: ExampleFor<K>["args"],
  domainGuardOnly = false,
): ExampleFor<K> {
  return {
    name,
    kind,
    reference: makeFunctionReference<K, Record<string, unknown>, unknown>(name),
    args,
    ...(domainGuardOnly ? { domainGuardOnly: true } : {}),
  };
}

// Each shipping public module has an explicit example. The coverage suite
// compares this inventory with runtime registered exports, so new modules
// cannot silently be omitted. This is representative coverage, not all 87 APIs.
export const PUBLIC_API_EXAMPLES: readonly PublicApiExample[] = [
  example("finishedGoods/batches:getBatch", "query", (w) => ({
    warehouseId: w.warehouses.alphaA,
    batchId: w.batchId,
  })),
  example("finishedGoods/batchManagement:get", "query", (w) => ({
    warehouseId: w.warehouses.alphaA,
    batchId: w.batchId,
  })),
  example("finishedGoods/catalogue:findSku", "query", (w) => ({
    warehouseId: w.warehouses.alphaA,
    sku: "PUBLIC-1",
  })),
  example("finishedGoods/jobScanLocations:resolve", "query", (w) => ({
    warehouseId: w.warehouses.alphaA,
    code: "PUBLIC-UNKNOWN-LOCATION",
  })),
  example("finishedGoods/jobScans:listJobScans", "query", (w) => ({
    warehouseId: w.warehouses.alphaA,
    filter: "ALL",
    pageSize: 20,
  })),
  example("finishedGoods/jobScans:extractJobTicket", "action", (w) => ({
    warehouseId: w.warehouses.alphaA,
    imageUrl: "https://example.test/synthetic-ticket.png",
  })),
  example(
    "finishedGoods/locationImage:extractLocationLabel",
    "action",
    (w) => ({
      warehouseId: w.warehouses.alphaA,
      imageDataUrl: "data:image/jpeg;base64,YWJj",
    }),
  ),
  example("finishedGoods/scanning:resolvePackageCode", "query", (w) => ({
    warehouseId: w.warehouses.alphaA,
    code: `ISAS:PALLET:1:${w.palletId}`,
  })),
  example("finishedGoods/summaryMaintenance:prepare", "mutation", (w) => ({
    warehouseId: w.warehouses.alphaA,
  })),
  example("finishedGoods/workflow:list", "query", (w) => ({
    warehouseId: w.warehouses.alphaA,
  })),
  example("storageLayouts/catalogue:getStorageBuilding", "query", (w) => ({
    warehouseId: w.warehouses.alphaA,
    buildingId: w.buildingId,
  })),
  example(
    "storageLayouts/fg1Import:preflight",
    "query",
    (w) => ({
      warehouseId: w.warehouses.alphaA,
      buildingId: w.buildingId,
    }),
    true,
  ),
  example("storageLayouts/locationCatalogue:list", "query", (w) => ({
    warehouseId: w.warehouses.alphaA,
  })),
  example(
    "storageLayouts/pdImport:preflight",
    "query",
    (w) => ({
      warehouseId: w.warehouses.alphaA,
      buildingId: w.buildingId,
    }),
    true,
  ),
  example("storageLayouts/writes:createStorageBuilding", "mutation", (w) => ({
    warehouseId: w.warehouses.alphaA,
    requestId: "public-second-building",
    code: "PUBLIC-C",
    name: "Second contract building",
    widthMm: 10_000,
    depthMm: 20_000,
    defaultFloorHeightMm: 3_000,
    floorCount: 1,
  })),
  example("storageLayouts/zones:resolveStorageAddress", "query", (w) => ({
    warehouseId: w.warehouses.alphaA,
    scan: "PUBLIC-UNKNOWN-LOCATION",
  })),
  example("workspace/current:readCurrent", "query", () => ({})),
];

export async function invokePublicExample(
  world: PublicApiWorld,
  example: PublicApiExample,
  identity?: { readonly subject: string; readonly org_id?: string },
  args = example.args(world),
): Promise<unknown> {
  const harness =
    identity === undefined ? world.t : world.t.withIdentity(identity);
  switch (example.kind) {
    case "query":
      return await harness.query(example.reference, args);
    case "mutation":
      return await harness.mutation(example.reference, args);
    case "action":
      return await harness.action(example.reference, args);
  }
}
