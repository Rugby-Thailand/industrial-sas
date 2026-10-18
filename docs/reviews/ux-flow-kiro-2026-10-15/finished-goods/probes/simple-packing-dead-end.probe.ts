import { readFileSync } from "node:fs";
import type { GenericMutationCtx } from "convex/server";
import { expect, it, vi } from "vitest";

// unitNextAction imports shared UI modules; only the pure helper is used.
vi.mock("next/navigation", () => ({
  useRouter: () => ({}),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: () => null,
  useRouter: () => ({}),
  usePathname: () => "/",
}));
import type { DataModel } from "../../../../../convex/schema";
import * as batches from "../../../../../convex/finishedGoods/batches";
import * as workflow from "../../../../../convex/finishedGoods/workflow";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "@tests/fixtures/convex-tenant-world";
import { unitNextAction } from "@/features/finishedGoods/unitNextAction";
import { ticketBarcodeError } from "@/features/finishedGoods/jobScan/ticketDraft";

// FG-UX-01: the default "Simple packing" path creates dimensionless units whose
// only guided next step is the Job tickets page.

interface RuntimeFunction {
  _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
}
type Outcome = {
  ok: boolean;
  value: {
    written?: boolean;
    error?: { code: string };
    candidates?: unknown[];
    reasons?: string[];
  };
};
async function call(world: ConvexTenantWorld, fn: unknown, args: unknown) {
  return (await world.t
    .withIdentity({ subject: "user_fixture_a", org_id: "org_fixture_a" })
    .run((ctx) =>
      (fn as RuntimeFunction)._handler(
        ctx as GenericMutationCtx<DataModel>,
        args,
      ),
    )) as Outcome;
}

async function simpleBatchUnit() {
  const world = await createConvexTenantWorld();
  await seedConvexAuthorization(world, { roleA: "ORG_ADMIN" });
  const warehouseId = world.warehouses.alphaA;
  const productId = await world.t.run((ctx) =>
    ctx.db.insert("finishedGoodsProducts", {
      orgId: world.orgA,
      warehouseId,
      sku: "SIMPLE-1",
      name: "Simple packed product",
      unit: "PCS",
      storageFormat: "PALLET",
      defaultQuantity: 50,
      storageCondition: "ANY",
      status: "ACTIVE",
      createdAt: 1,
      updatedAt: 1,
      createdByUserId: world.userA,
      updatedByUserId: world.userA,
    }),
  );
  // Same payload shape PackingScreen sends for its default Simple packing mode.
  const committed = await call(world, batches.commitBatch, {
    warehouseId,
    productId,
    requestId: "simple-pack-1",
    totalQuantity: 100,
    storageFormat: "PALLET",
    simplePacking: true,
    sameSize: true,
    splitMode: "CAPACITY",
    capacity: 50,
    packages: [
      { quantity: 50, dimensionsChecked: false, fillPercent: 100 },
      { quantity: 50, dimensionsChecked: false, fillPercent: 100 },
    ],
  });
  expect(committed).toMatchObject({ ok: true, value: { written: true } });
  const units = await world.t.run((ctx) =>
    ctx.db.query("finishedGoodsPallets").collect(),
  );
  return { world, warehouseId, unit: units.find((u) => !u.retiredAt)! };
}

it("OBSERVED (real handlers): a default simple-packed unit cannot get dimensions or a recommendation", async () => {
  const { world, warehouseId, unit } = await simpleBatchUnit();
  expect(unit).toMatchObject({
    status: "AWAITING_PLACEMENT",
    sameSize: true,
  });
  expect(unit.lengthMm).toBeUndefined();

  const recommendation = await call(world, workflow.recommend, {
    warehouseId,
    palletId: unit._id,
  });
  expect(recommendation).toMatchObject({
    ok: true,
    value: { candidates: [], reasons: ["MEASUREMENTS_REQUIRED"] },
  });

  // The pallet Measure route redirects batch units to the batch editor; the
  // direct measurement write is refused for them as well.
  const measured = await call(world, workflow.saveMeasurement, {
    warehouseId,
    palletId: unit._id,
    requestId: "measure-simple-1",
    expectedRevision: 0,
    quantity: unit.quantity,
    lengthMm: 1200,
    widthMm: 1000,
    heightMm: 1400,
    dimensionsChecked: true,
  });
  expect(measured).toMatchObject({
    ok: true,
    value: { written: false, error: { code: "BATCH_MEASUREMENT_LOCKED" } },
  });
});

it("OBSERVED: the 'Scan Packages' route renders the Job tickets screen, which rejects package labels", () => {
  const page = readFileSync(
    "src/app/[locale]/(desktop)/finished-goods/scan/page.tsx",
    "utf8",
  );
  expect(page).toContain("<JobScanScreen />");
  expect(ticketBarcodeError("productBarcodeText", "ISAS:PALLET:1:unit-a")).toBe(
    "invalidTicketBarcode",
  );
});

it("DESIRED: the guided next action for a simple-packed unit leads to a flow that accepts its package label", () => {
  const action = unitNextAction(
    {
      _id: "unit-a",
      status: "AWAITING_PLACEMENT",
      sameSize: true,
    } as never,
    true,
  );
  const labelAccepted =
    ticketBarcodeError("productBarcodeText", "ISAS:PALLET:1:unit-a") ===
    undefined;
  // Either do not send the unit to Job tickets, or that page must accept it.
  expect(action.href !== "/finished-goods/scan" || labelAccepted).toBe(true);
});
