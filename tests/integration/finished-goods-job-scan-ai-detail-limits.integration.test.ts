import { assert, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { parseJobTicket } from "../../convex/model/finishedGoods/jobScans";
import {
  mergeExtracted,
  newTicket,
  toPayload,
} from "../../src/features/finishedGoods/jobScan/ticketDraft";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
} from "../fixtures/convex-tenant-world";

// Exercise the public mutations (including argument validators), and the same
// AI parsing/draft serialization path used by the screen. Long names cannot be
// typed into TicketCard, but AI output is not constrained by its maxLength.
it.each([
  ["partName", "part_name", 501],
  ["customer", "customer", 501],
  ["manufacturingDate", "manufacturing_date", 101],
] as const)(
  "an AI %s accepted at intake remains correctable",
  async (field, rawField, length) => {
    const world = await createConvexTenantWorld({
      "../convex/finishedGoods/jobScans.ts": () =>
        import("../../convex/finishedGoods/jobScans"),
    });
    await seedConvexAuthorization(world, { roleA: "ORG_ADMIN" });
    const actor = world.t.withIdentity({
      subject: "user_fixture_a",
      org_id: "org_fixture_a",
    });
    const item = toPayload(
      mergeExtracted(
        newTicket("AI"),
        parseJobTicket({
          factory_order: "FO11111111",
          product_barcode_text: "SKU-1",
          [rawField]: "x".repeat(length),
        }),
      ),
    );
    const saved = await actor.mutation(
      api.finishedGoods.jobScans.saveJobScans,
      {
        warehouseId: world.warehouses.alphaA,
        requestId: crypto.randomUUID(),
        locationText: "Dock",
        items: [item],
      },
    );
    assert(saved.ok);
    if (!saved.value.written) {
      expect(saved.value.error).toEqual({ code: "FIELD_TOO_LONG", field });
      expect(
        await world.t.run((ctx) =>
          ctx.db.query("finishedGoodsJobScans").collect(),
        ),
      ).toHaveLength(0);
    }
    const { source: _source, ...fields } = item;
    const corrected = saved.value.written
      ? await actor.mutation(api.finishedGoods.jobScans.updateJobScan, {
          warehouseId: world.warehouses.alphaA,
          jobScanId: saved.value.documentId as Id<"finishedGoodsJobScans">,
          requestId: crypto.randomUUID(),
          expectedVersion: 1,
          fields: { ...fields, factoryOrder: "FO22222222" },
        })
      : undefined;
    assert(!corrected || corrected.ok);
    const correction = corrected?.ok ? corrected.value : undefined;
    console.info(
      JSON.stringify({
        field,
        saved: saved.value.written,
        correction,
      }),
    );
    const savedButUncorrectable =
      saved.value.written && !correction?.written ? 1 : 0;
    expect(savedButUncorrectable).toBe(0);
  },
);
