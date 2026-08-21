import type { GenericMutationCtx } from "convex/server";
import { describe, expect, it } from "vitest";

import {
  listCustomerOrders,
  releaseCustomerOrder,
} from "../../convex/sales/orders";
import {
  confirmSimilarDesign,
  listDesignRequests,
  listSimilarReleasedDesigns,
} from "../../convex/engineering/designRequests";
import {
  listMasterCards,
  listMasterCardRevisions,
} from "../../convex/engineering/masterCards";
import {
  listMasterCardFiles,
  requestMasterCardFileAccess,
} from "../../convex/engineering/files";
import { applyLegacyMasterCardImportChunk } from "../../convex/engineering/masterCardImports";
import {
  issueFactoryPacket,
  listFactoryPackets,
  requestFactoryPacketFileAccess,
} from "../../convex/production/packets";
import type { DataModel } from "../../convex/schema";
import {
  createConvexInventoryWorld,
  type ConvexInventoryWorld,
} from "../fixtures/convex-inventory-world";

interface RuntimeFunction {
  readonly _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
}

const callAs = async (
  world: ConvexInventoryWorld,
  org: "a" | "b",
  fn: unknown = listCustomerOrders,
  args: unknown = {},
) =>
  (await world.t
    .withIdentity({
      subject: "user_fixture_a",
      org_id: `org_fixture_${org}`,
    })
    .run(async (ctx) =>
      (fn as RuntimeFunction)._handler(
        ctx as GenericMutationCtx<DataModel>,
        args,
      ),
    )) as Record<string, unknown>;

describe("order-to-ship tenant isolation", () => {
  it("never returns another tenant's colliding sales order", async () => {
    const world = await createConvexInventoryWorld(
      {},
      { roleA: "SALES_CUSTOMER_SERVICE", roleB: "SALES_CUSTOMER_SERVICE" },
    );
    await world.t.run(async (ctx) => {
      for (const [orgId, suffix] of [
        [world.orgA, "A"],
        [world.orgB, "B"],
      ] as const) {
        const customerId = await ctx.db.insert("customers", {
          orgId,
          code: "GOLD",
          name: `Gold ${suffix}`,
          status: "ACTIVE",
        });
        await ctx.db.insert("customerOrders", {
          orgId,
          orderNumber: "SO-COLLISION",
          customerId,
          status: "DRAFT",
          orderedAt: 1,
        });
      }
    });

    const mine = (call: Record<string, unknown>) =>
      (
        (call["value"] as Record<string, unknown>)["items"] as Record<
          string,
          unknown
        >[]
      )[0]!;
    const a = mine(await callAs(world, "a"));
    const b = mine(await callAs(world, "b"));
    expect(a["orderNumber"]).toBe("SO-COLLISION");
    expect(b["orderNumber"]).toBe("SO-COLLISION");
    expect(a["customerOrderId"]).not.toBe(b["customerOrderId"]);
    expect(a["customerId"]).not.toBe(b["customerId"]);
  });

  it("makes a foreign order identifier indistinguishable from a missing one", async () => {
    const world = await createConvexInventoryWorld(
      {},
      { roleA: "SALES_CUSTOMER_SERVICE", roleB: "SALES_CUSTOMER_SERVICE" },
    );
    const foreignOrderId = await world.t.run(async (ctx) => {
      const customerId = await ctx.db.insert("customers", {
        orgId: world.orgA,
        code: "PRIVATE-A",
        name: "Tenant A private customer",
        status: "ACTIVE",
      });
      return await ctx.db.insert("customerOrders", {
        orgId: world.orgA,
        orderNumber: "SO-PRIVATE-A",
        customerId,
        status: "DRAFT",
        orderedAt: 1,
      });
    });

    const foreign = await callAs(world, "b", releaseCustomerOrder, {
      requestId: "cross-tenant-order",
      customerOrderId: foreignOrderId,
    });
    expect(foreign["ok"]).toBe(true);
    expect(foreign["value"]).toEqual({
      written: false,
      error: { code: "NOT_FOUND", table: "customerOrders" },
    });
  });

  it("keeps every engineering, file, import, and packet aggregate nondiscoverable", async () => {
    process.env.CONVEX_SITE_URL = "https://tenant-files.invalid";
    const world = await createConvexInventoryWorld(
      {},
      { roleA: "ORG_ADMIN", roleB: "ORG_ADMIN" },
    );
    const foreign = await world.t.run(async (ctx) => {
      const specification = {
        styleCode: "RSC",
        internalLengthMm: 300,
        internalWidthMm: 200,
        internalHeightMm: 150,
        boardGrade: "KA125/C/KA125",
        printColourCount: 1,
      };
      const customerId = await ctx.db.insert("customers", {
        orgId: world.orgA,
        code: "PRIVATE-AGGREGATE",
        name: "Private aggregate customer",
        status: "ACTIVE",
      });
      const orderId = await ctx.db.insert("customerOrders", {
        orgId: world.orgA,
        orderNumber: "SO-PRIVATE-AGGREGATE",
        customerId,
        status: "RELEASED",
        orderedAt: 1,
      });
      const lineId = await ctx.db.insert("customerOrderLines", {
        orgId: world.orgA,
        customerOrderId: orderId,
        lineNumber: 1,
        customerProductCode: "PRIVATE-BOX",
        specification,
        designKey: "RSC|300X200X150|KA125/C/KA125|C1",
        designSource: "NEW",
        status: "DESIGN_READY",
        orderedQuantity: 10,
      });
      const requestId = await ctx.db.insert("designRequests", {
        orgId: world.orgA,
        requestNumber: "SO-PRIVATE-AGGREGATE-1",
        customerOrderLineId: lineId,
        status: "OPEN",
        priority: "NORMAL",
      });
      const cardId = await ctx.db.insert("masterCards", {
        orgId: world.orgA,
        cardNumber: "MC-PRIVATE",
        customerId,
        customerProductCode: "PRIVATE-BOX",
        designKey: "RSC|300X200X150|KA125/C/KA125|C1",
        name: "Private card",
        status: "ACTIVE",
      });
      const revisionId = await ctx.db.insert("masterCardRevisions", {
        orgId: world.orgA,
        masterCardId: cardId,
        revisionNumber: 1,
        status: "RELEASED",
        specification,
        designKey: "RSC|300X200X150|KA125/C/KA125|C1",
        authoredByUserId: world.userA,
        submittedByUserId: world.userA,
        decidedByUserId: world.userA,
        decidedAt: 1,
      });
      await ctx.db.patch(cardId, { releasedRevisionId: revisionId });
      await ctx.db.patch(lineId, { masterCardRevisionId: revisionId });
      const storageId = await ctx.storage.store(
        new Blob(["tenant A private dieline"], { type: "application/pdf" }),
      );
      const fileId = await ctx.db.insert("masterCardFiles", {
        orgId: world.orgA,
        masterCardRevisionId: revisionId,
        fileKey: "DIELINE-1",
        fileName: "private.pdf",
        kind: "DIELINE",
        contentType: "application/pdf",
        byteSize: 25,
        contentDigest: "a".repeat(64),
        storageId,
        verifiedAt: 1,
        storageState: "AVAILABLE",
        attachedByUserId: world.userA,
      });
      await ctx.db.insert("masterCardUploadGrants", {
        orgId: world.orgA,
        masterCardRevisionId: revisionId,
        authorizedByUserId: world.userA,
        expiresAt: Date.now() + 60_000,
      });
      await ctx.db.insert("masterCardFileAccessGrants", {
        orgId: world.orgA,
        masterCardFileId: fileId,
        issuedToUserId: world.userA,
        expiresAt: Date.now() + 60_000,
      });
      await ctx.db.insert("masterCardImportChunks", {
        orgId: world.orgA,
        batchRef: "PRIVATE-BATCH",
        startSourceRow: 1,
        nextSourceRow: 2,
        importedCount: 1,
        releasedCount: 1,
        draftCount: 0,
        importedByUserId: world.userA,
        completedAt: 1,
      });
      const packetId = await ctx.db.insert("factoryPackets", {
        orgId: world.orgA,
        warehouseId: world.warehouses.alphaA,
        packetNumber: "SO-PRIVATE-AGGREGATE-1",
        customerOrderLineId: lineId,
        masterCardRevisionId: revisionId,
        status: "ISSUED",
        issuedByUserId: world.userA,
      });
      await ctx.db.insert("factoryPacketFiles", {
        orgId: world.orgA,
        factoryPacketId: packetId,
        masterCardFileId: fileId,
      });
      return {
        customerId,
        lineId,
        requestId,
        cardId,
        revisionId,
        fileId,
        packetId,
      };
    });

    const pageItems = (outcome: Record<string, unknown>) =>
      ((outcome["value"] as Record<string, unknown>)["items"] ??
        []) as unknown[];
    expect(pageItems(await callAs(world, "b", listDesignRequests, {}))).toEqual(
      [],
    );
    expect(pageItems(await callAs(world, "b", listMasterCards, {}))).toEqual(
      [],
    );
    expect(
      pageItems(
        await callAs(world, "b", listMasterCardRevisions, {
          masterCardId: foreign.cardId,
        }),
      ),
    ).toEqual([]);
    expect(
      pageItems(
        await callAs(world, "b", listMasterCardFiles, {
          masterCardRevisionId: foreign.revisionId,
        }),
      ),
    ).toEqual([]);
    expect(
      pageItems(
        await callAs(world, "b", listFactoryPackets, {
          warehouseId: world.warehouses.alphaB,
        }),
      ),
    ).toEqual([]);
    expect(
      (
        await callAs(world, "b", listSimilarReleasedDesigns, {
          designRequestId: foreign.requestId,
        })
      )["value"],
    ).toEqual([]);

    const fileAccess = await callAs(world, "b", requestMasterCardFileAccess, {
      masterCardFileId: foreign.fileId,
    });
    expect(fileAccess["value"]).toMatchObject({
      granted: false,
      error: { code: "NOT_FOUND" },
    });
    const packetFileAccess = await callAs(
      world,
      "b",
      requestFactoryPacketFileAccess,
      {
        warehouseId: world.warehouses.alphaB,
        factoryPacketId: foreign.packetId,
        masterCardFileId: foreign.fileId,
      },
    );
    expect(packetFileAccess["value"]).toMatchObject({
      granted: false,
      error: { code: "NOT_FOUND" },
    });
    const confirmation = await callAs(world, "b", confirmSimilarDesign, {
      requestId: "foreign-confirmation",
      designRequestId: foreign.requestId,
      masterCardRevisionId: foreign.revisionId,
      reason: "should never be visible",
    });
    expect(confirmation["value"]).toMatchObject({
      written: false,
      error: { code: "NOT_FOUND" },
    });
    const packetIssue = await callAs(world, "b", issueFactoryPacket, {
      requestId: "foreign-packet",
      warehouseId: world.warehouses.alphaB,
      customerOrderLineId: foreign.lineId,
    });
    expect(packetIssue["value"]).toMatchObject({
      written: false,
      error: { code: "NOT_FOUND" },
    });
    const migration = await callAs(
      world,
      "b",
      applyLegacyMasterCardImportChunk,
      {
        requestId: "foreign-import",
        batchRef: "PRIVATE-BATCH",
        rows: [
          {
            sourceRow: 1,
            sourceReference: "foreign.pdf",
            cardNumber: "FOREIGN-1",
            customerId: foreign.customerId,
            customerProductCode: "FOREIGN-1",
            name: "Foreign",
            verified: false,
            specification: {
              styleCode: "RSC",
              internalLengthMm: 1,
              internalWidthMm: 1,
              internalHeightMm: 1,
              boardGrade: "A",
              printColourCount: 0,
            },
            files: [],
          },
        ],
      },
    );
    expect(migration["value"]).toMatchObject({
      written: false,
      error: { code: "REFERENCE_NOT_FOUND", field: "customerId" },
    });
  });
});
