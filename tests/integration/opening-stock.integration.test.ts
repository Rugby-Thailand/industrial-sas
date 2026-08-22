/** Opening-stock import → validation → maker-checker → balanced ledger posting. */
import type { GenericMutationCtx } from "convex/server";
import type { GenericId } from "convex/values";
import { describe, expect, it } from "vitest";

import {
  approveOpeningStockBatch,
  createOpeningStockBatch,
  getOpeningStockBatch,
  importOpeningStockRows,
  listOpeningStockRows,
  postNextOpeningStockChunk,
  submitOpeningStockBatch,
} from "../../convex/inventory/openingStock";
import type { DataModel } from "../../convex/schema";
import {
  createConvexInventoryWorld,
  type ConvexInventoryWorld,
} from "../fixtures/convex-inventory-world";
import {
  recordStepUp,
  seedSecondActorForOrgA,
} from "../fixtures/convex-tenant-world";

interface RuntimeFunction {
  readonly _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
}

const actorA = { subject: "user_fixture_a", org_id: "org_fixture_a" };

const requestId = (suffix: string): string => {
  const tail = [...suffix].reduce(
    (hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0,
    0,
  );
  return `0193f2c1-0000-7000-8000-0000${tail.toString(16).padStart(8, "0")}`;
};

async function call(
  world: ConvexInventoryWorld,
  fn: unknown,
  args: unknown,
  identity: { readonly subject: string; readonly org_id: string } = actorA,
): Promise<Record<string, unknown>> {
  return (await world.t
    .withIdentity(identity)
    .run(async (ctx) =>
      (fn as RuntimeFunction)._handler(
        ctx as GenericMutationCtx<DataModel>,
        args,
      ),
    )) as Record<string, unknown>;
}

const value = (outcome: Record<string, unknown>): Record<string, unknown> => {
  expect(outcome["ok"], JSON.stringify(outcome)).toBe(true);
  return outcome["value"] as Record<string, unknown>;
};

const okWrite = (outcome: Record<string, unknown>): Record<string, unknown> => {
  const result = value(outcome);
  expect(result["written"], JSON.stringify(result)).toBe(true);
  return result;
};

const errorCode = (outcome: Record<string, unknown>): string => {
  const result = value(outcome);
  expect(result["written"], JSON.stringify(result)).toBe(false);
  return (result["error"] as Record<string, unknown>)["code"] as string;
};

async function createBatch(
  world: ConvexInventoryWorld,
  batchRef: string,
  declaredRowCount: number,
): Promise<GenericId<"openingStockBatches">> {
  const created = okWrite(
    await call(world, createOpeningStockBatch, {
      requestId: requestId(`create-${batchRef}`),
      warehouseId: world.warehouses.alphaA,
      batchRef,
      sourceFileName: `${batchRef}.csv`,
      sourceHash: "a".repeat(64),
      cutoffAt: Date.now(),
      declaredRowCount,
      reasonCodeId: world.a.adjustmentReason,
    }),
  );
  return created["documentId"] as GenericId<"openingStockBatches">;
}

describe("opening stock", () => {
  it("retains row errors and refuses to submit an invalid dry run", async () => {
    const world = await createConvexInventoryWorld();
    const batchId = await createBatch(world, "OPEN-INVALID", 2);

    const imported = okWrite(
      await call(world, importOpeningStockRows, {
        requestId: requestId("import-invalid"),
        warehouseId: world.warehouses.alphaA,
        openingStockBatchId: batchId,
        startSourceRowNumber: 1,
        rows: [
          {
            sku: "WIDGET-001",
            locationCode: "RACK-01",
            lotCode: "LOT-A",
            stockStatus: "AVAILABLE",
            entryUom: "PCS",
            entryMinorUnits: 2_000,
          },
          {
            sku: "MISSING-001",
            locationCode: "RACK-01",
            stockStatus: "AVAILABLE",
            entryUom: "PCS",
            entryMinorUnits: 1_000,
          },
        ],
      }),
    );
    expect(imported).toMatchObject({
      rowCount: 2,
      validRowCount: 1,
      validationErrorCount: 1,
    });
    expect(
      errorCode(
        await call(world, submitOpeningStockBatch, {
          requestId: requestId("submit-invalid"),
          warehouseId: world.warehouses.alphaA,
          openingStockBatchId: batchId,
        }),
      ),
    ).toBe("VALIDATION_ERRORS_REMAIN");

    const listed = value(
      await call(world, listOpeningStockRows, {
        warehouseId: world.warehouses.alphaA,
        openingStockBatchId: batchId,
        status: "INVALID",
        limit: 50,
      }),
    );
    expect(listed["rows"]).toEqual([
      expect.objectContaining({
        sourceRowNumber: 2,
        validationCode: "ITEM_NOT_FOUND",
      }),
    ]);
  });

  it("posts once, replays the same chunk, and links rows to a balanced ledger transaction", async () => {
    const world = await createConvexInventoryWorld();
    const checker = await seedSecondActorForOrgA(world, "WAREHOUSE_MANAGER");
    const batchId = await createBatch(world, "OPEN-VALID", 2);

    okWrite(
      await call(world, importOpeningStockRows, {
        requestId: requestId("import-valid"),
        warehouseId: world.warehouses.alphaA,
        openingStockBatchId: batchId,
        startSourceRowNumber: 1,
        rows: [
          {
            sku: "WIDGET-001",
            locationCode: "RACK-01",
            lotCode: "LOT-A",
            stockStatus: "AVAILABLE",
            entryUom: "PCS",
            entryMinorUnits: 2_000,
          },
          {
            sku: "BULK-001",
            locationCode: "RACK-01",
            stockStatus: "AVAILABLE",
            entryUom: "PCS",
            entryMinorUnits: 3_000,
          },
        ],
      }),
    );
    okWrite(
      await call(world, submitOpeningStockBatch, {
        requestId: requestId("submit-valid"),
        warehouseId: world.warehouses.alphaA,
        openingStockBatchId: batchId,
      }),
    );

    const now = Date.now();
    await recordStepUp(world, {
      orgId: world.orgA,
      userId: checker.userId,
      occurredAt: now,
      reverifiedAt: now,
    });
    const checkerIdentity = {
      subject: checker.clerkUserId,
      org_id: "org_fixture_a",
    };
    okWrite(
      await call(
        world,
        approveOpeningStockBatch,
        {
          requestId: requestId("approve-valid"),
          warehouseId: world.warehouses.alphaA,
          openingStockBatchId: batchId,
        },
        checkerIdentity,
      ),
    );

    const postArgs = {
      requestId: requestId("post-valid-1"),
      warehouseId: world.warehouses.alphaA,
      openingStockBatchId: batchId,
    };
    const first = okWrite(
      await call(world, postNextOpeningStockChunk, postArgs, checkerIdentity),
    );
    expect(first).toMatchObject({ rowCount: 2, batchComplete: true });
    const replay = okWrite(
      await call(world, postNextOpeningStockChunk, postArgs, checkerIdentity),
    );
    expect(replay).toMatchObject({
      replayed: true,
      transactionId: first["transactionId"],
      rowCount: 2,
      batchComplete: true,
    });

    const stored = await world.t.run(async (ctx) => {
      const transactions = await ctx.db
        .query("inventoryTransactions")
        .withIndex("by_orgId_operation_requestId", (query) =>
          query
            .eq("orgId", world.orgA)
            .eq("operation", "inventory.opening.post")
            .eq("requestId", postArgs.requestId),
        )
        .take(2);
      const lines = await ctx.db
        .query("inventoryLedgerLines")
        .withIndex("by_orgId_transactionId_lineIndex", (query) =>
          query
            .eq("orgId", world.orgA)
            .eq(
              "transactionId",
              first["transactionId"] as GenericId<"inventoryTransactions">,
            ),
        )
        .take(10);
      return { transactions, lines };
    });
    expect(stored.transactions).toHaveLength(1);
    expect(stored.lines).toHaveLength(4);
    expect(
      stored.lines.reduce((sum, line) => sum + line.quantity.minorUnits, 0),
    ).toBe(0);

    const detail = value(
      await call(world, getOpeningStockBatch, {
        warehouseId: world.warehouses.alphaA,
        openingStockBatchId: batchId,
      }),
    );
    expect(detail).toMatchObject({
      found: true,
      batch: { status: "POSTED", postedRowCount: 2 },
    });
  });
});
