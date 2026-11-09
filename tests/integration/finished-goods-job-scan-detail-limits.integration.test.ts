import { expect, it } from "vitest";
import type { GenericMutationCtx } from "convex/server";
import type { DataModel } from "../../convex/schema";
import * as jobScans from "../../convex/finishedGoods/jobScans";
import en from "../../messages/en.json";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "../fixtures/convex-tenant-world";

// Regression: saveJobScans stores ticket detail fields without the limits that
// updateJobScan enforces. The scan form (TicketCard) lets a user type a
// 200-character delivery date and any digit-only quantity, and an AI read can
// fill any length. Such a record is saved, but every later correction of it
// (even fixing only the Job No.) is refused, with an untranslated
// FIELD_TOO_LONG for the date.

interface RuntimeFunction {
  readonly _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
}
const identity = { subject: "user_fixture_a", org_id: "org_fixture_a" };
async function call(world: ConvexTenantWorld, fn: unknown, args: unknown) {
  return (await world.t
    .withIdentity(identity)
    .run((ctx) =>
      (fn as RuntimeFunction)._handler(
        ctx as GenericMutationCtx<DataModel>,
        args,
      ),
    )) as {
    ok: boolean;
    value: {
      written: boolean;
      documentId?: string;
      error?: { code: string; field?: string };
    };
  };
}

async function saveThenCorrect(detail: Record<string, string | number>) {
  const world = await createConvexTenantWorld();
  await seedConvexAuthorization(world, { roleA: "ORG_ADMIN" });
  const warehouseId = world.warehouses.alphaA;
  const item = {
    factoryOrder: "FO12345678",
    productBarcodeText: "SKU-1",
    source: "MANUAL" as const,
    ...detail,
  };
  const saved = await call(world, jobScans.saveJobScans, {
    warehouseId,
    requestId: crypto.randomUUID(),
    locationText: "Dock",
    items: [item],
  });
  if (!saved.value.written) {
    const field = Object.keys(detail)[0]!;
    expect(saved.value.error).toEqual({
      code: field === "quantity" ? "FIELD_INVALID" : "FIELD_TOO_LONG",
      field,
    });
    expect(
      await world.t.run((ctx) =>
        ctx.db.query("finishedGoodsJobScans").collect(),
      ),
    ).toHaveLength(0);
    return { saved: saved.value, corrected: undefined };
  }
  // The record editor resubmits every stored field; only the Job No. changes.
  const { source: _source, ...fields } = item;
  const corrected = await call(world, jobScans.updateJobScan, {
    warehouseId,
    jobScanId: saved.value.documentId,
    requestId: crypto.randomUUID(),
    expectedVersion: 1,
    fields: { ...fields, factoryOrder: "FO12345679" },
  });
  return { saved: saved.value, corrected: corrected.value };
}

it("a delivery date accepted by the scan save can still be corrected later", async () => {
  // TicketCard's detail inputs allow 200 characters (maxLength={200}).
  const result = await saveThenCorrect({
    deliveryDate: "6/7/2569 ".repeat(15),
  });
  console.info(
    JSON.stringify({
      correction: result,
      fgMessageForCode: (en.WriteError as Record<string, string>)[
        `FG_${result.corrected?.error?.code ?? result.saved.error?.code}`
      ],
    }),
  );
  const refusedCorrections =
    result.saved.written && !result.corrected?.written ? 1 : 0;
  expect(refusedCorrections).toBe(0);
});

it("a quantity accepted by the scan save can still be corrected later", async () => {
  // parseTicketQuantity accepts any digit string, e.g. "2000000000".
  const result = await saveThenCorrect({ quantity: 2_000_000_000 });
  console.info(JSON.stringify({ correction: result }));
  const refusedCorrections =
    result.saved.written && !result.corrected?.written ? 1 : 0;
  expect(refusedCorrections).toBe(0);
});
