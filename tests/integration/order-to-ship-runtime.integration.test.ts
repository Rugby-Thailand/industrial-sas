import type { GenericMutationCtx } from "convex/server";
import type { GenericId } from "convex/values";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createCustomer } from "../../convex/sales/customers";
import {
  addCustomerOrderLine,
  createCustomerOrder,
  listCustomerOrderLines,
  listRoutableCustomerOrderLines,
  releaseCustomerOrder,
} from "../../convex/sales/orders";
import {
  authorizeMasterCardFileUpload,
  attachMasterCardFile,
  claimMasterCardUploadGrant,
  completeMasterCardUploadGrant,
  completeUploadThingMasterCardUploadGrant,
} from "../../convex/engineering/files";
import {
  createMasterCard,
  decideMasterCardRevision,
  draftMasterCardRevision,
  submitMasterCardRevision,
} from "../../convex/engineering/masterCards";
import {
  fulfilDesignRequest,
  listDesignRequests,
  listSimilarReleasedDesigns,
} from "../../convex/engineering/designRequests";
import { recordDesignRequirements } from "../../convex/engineering/requirements";
import {
  acknowledgeFactoryPacket,
  issueFactoryPacket,
  listFactoryPackets,
} from "../../convex/production/packets";
import { routeCustomerOrderLine } from "../../convex/fulfillment/orders";
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

const identity = { subject: "user_fixture_a", org_id: "org_fixture_a" };
const call = async (
  world: ConvexInventoryWorld,
  fn: unknown,
  args: unknown,
  actor: { readonly subject: string; readonly org_id: string } = identity,
): Promise<Record<string, unknown>> =>
  (await world.t
    .withIdentity(actor)
    .run(async (ctx) =>
      (fn as RuntimeFunction)._handler(
        ctx as GenericMutationCtx<DataModel>,
        args,
      ),
    )) as Record<string, unknown>;

const value = (outcome: Record<string, unknown>) => {
  expect(outcome["ok"], JSON.stringify(outcome)).toBe(true);
  return outcome["value"] as Record<string, unknown>;
};

const routeForProduction = async (
  world: ConvexInventoryWorld,
  customerOrderLineId: string,
  code: string,
) =>
  value(
    await call(world, routeCustomerOrderLine, {
      requestId: `route-${code}`,
      warehouseId: world.warehouses.alphaA,
      fulfillmentNumber: `FF-${code}`,
      customerOrderLineId,
      itemId: world.a.item,
      allowPartial: true,
      shipTo: {
        name: "Journey customer DC",
        addressLine1: "99 Industrial Road",
        province: "Bangkok",
        countryCode: "TH",
      },
    }),
  );

const specification = {
  styleCode: "RSC",
  internalLengthMm: 300,
  internalWidthMm: 200,
  internalHeightMm: 150,
  boardGrade: "KA125/C/KA125",
  printColourCount: 2,
};

const completeSpecification = {
  ...specification,
  productNameEn: "Export carton",
  productNameTh: "กล่องส่งออก",
  sheetLengthMm: 720,
  sheetWidthMm: 460,
  fluteCode: "C",
  printColours: ["BLACK", "RED"],
  packingInstructions: "Bundle and palletize to customer standard",
  layers: [{ position: 1, paperCode: "KA125", grammageGsm: 125 }],
  route: [{ sequence: 1, workCenterCode: "PRN-01", operationCode: "PRINT" }],
  materials: [
    {
      itemCode: "BOARD-01",
      description: "Corrugated board",
      quantityPerUnit: 1,
      uom: "SHEET",
    },
  ],
  qualityRequirements: [
    { code: "BCT", description: "Compression", target: ">= 4500 N" },
  ],
  calculations: [
    {
      name: "BCT",
      formulaVersion: "MCKEE-1",
      inputs: [{ name: "ECT", value: 7.1, unit: "kN/m" }],
      result: 4680,
      unit: "N",
      passed: true,
      // Public arguments carry placeholders; the master-card function replaces
      // these with the authorized actor and server clock.
      verifiedByUserId: "SERVER",
      verifiedAt: 1,
    },
  ],
};

describe("order-to-ship public Convex functions", () => {
  it("uses customer product code for exact reuse and replays retries", async () => {
    const world = await createConvexInventoryWorld(
      {},
      {
        roleA: "SALES_CUSTOMER_SERVICE",
      },
    );
    const customer = value(
      await call(world, createCustomer, {
        requestId: "customer-create-1",
        code: "GOLD",
        name: "Gold Foods",
      }),
    )["documentId"] as string;
    const order = value(
      await call(world, createCustomerOrder, {
        requestId: "order-create-1",
        orderNumber: "SO-1001",
        customerId: customer,
      }),
    )["documentId"] as string;

    await world.t.run(async (ctx) => {
      const cardId = await ctx.db.insert("masterCards", {
        orgId: world.orgA,
        cardNumber: "MC-001",
        customerId: customer as never,
        customerProductCode: "FG-001",
        designKey: "RSC|300x200x150|KA125/C/KA125|C2",
        name: "Gold export carton",
        status: "ACTIVE",
      });
      const revisionId = await ctx.db.insert("masterCardRevisions", {
        orgId: world.orgA,
        masterCardId: cardId,
        revisionNumber: 1,
        status: "RELEASED",
        specification,
        designKey: "RSC|300x200x150|KA125/C/KA125|C2",
        authoredByUserId: world.userA,
        decidedByUserId: world.userA,
        decidedAt: 1,
      });
      await ctx.db.patch("masterCards", cardId, {
        releasedRevisionId: revisionId,
      });
    });

    const firstArgs = {
      requestId: "line-add-1",
      customerOrderId: order,
      lineNumber: 1,
      customerProductCode: "fg-001",
      specification,
      orderedQuantity: 100,
    };
    const first = value(await call(world, addCustomerOrderLine, firstArgs));
    const retry = value(await call(world, addCustomerOrderLine, firstArgs));
    expect(first["replayed"]).toBe(false);
    expect(retry).toMatchObject({
      documentId: first["documentId"],
      replayed: true,
    });

    value(
      await call(world, addCustomerOrderLine, {
        ...firstArgs,
        requestId: "line-add-2",
        lineNumber: 2,
        customerProductCode: "FG-002",
      }),
    );

    const competing = await Promise.all([
      call(world, addCustomerOrderLine, {
        ...firstArgs,
        requestId: "line-add-concurrent-a",
        lineNumber: 3,
        customerProductCode: "FG-003",
      }),
      call(world, addCustomerOrderLine, {
        ...firstArgs,
        requestId: "line-add-concurrent-b",
        lineNumber: 3,
        customerProductCode: "FG-003",
      }),
    ]);
    const competingValues = competing.map(value);
    expect(
      competingValues.filter((result) => result["written"] === true),
    ).toHaveLength(1);

    await world.t.run(async (ctx) => {
      const card = await ctx.db
        .query("masterCards")
        .withIndex("by_orgId_customerId_customerProductCode", (query) =>
          query
            .eq("orgId", world.orgA)
            .eq("customerId", customer as GenericId<"customers">)
            .eq("customerProductCode", "FG-001"),
        )
        .unique();
      await ctx.db.patch(card!._id, { status: "INACTIVE" });
    });
    value(
      await call(world, addCustomerOrderLine, {
        ...firstArgs,
        requestId: "line-add-inactive-card",
        lineNumber: 4,
      }),
    );
    expect(
      competingValues.filter(
        (result) =>
          result["written"] === false &&
          (result["error"] as Record<string, unknown> | undefined)?.["code"] ===
            "DUPLICATE_KEY",
      ),
    ).toHaveLength(1);

    const page = value(
      await call(world, listCustomerOrderLines, { customerOrderId: order }),
    );
    const rows = page["items"] as Record<string, unknown>[];
    expect(
      rows.map((row) => [row["customerProductCode"], row["designSource"]]),
    ).toEqual(
      expect.arrayContaining([
        ["FG-001", "EXISTING"],
        ["FG-002", "NEW"],
        ["FG-003", "NEW"],
        ["FG-001", "NEW"],
      ]),
    );

    value(
      await call(world, releaseCustomerOrder, {
        requestId: "order-release-after-lines",
        customerOrderId: order,
      }),
    );
    expect(
      value(await call(world, addCustomerOrderLine, firstArgs)),
    ).toMatchObject({ documentId: first["documentId"], replayed: true });
    expect(
      value(
        await call(world, addCustomerOrderLine, {
          ...firstArgs,
          orderedQuantity: 101,
        }),
      ),
    ).toMatchObject({
      written: false,
      error: { code: "REQUEST_ARGUMENT_CONFLICT" },
    });
  });

  it("replays every state transition through factory acknowledgement", async () => {
    process.env.CONVEX_SITE_URL = "https://tenant-files.invalid";
    const world = await createConvexInventoryWorld({}, { roleA: "ORG_ADMIN" });
    const checker = await world.t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        clerkUserId: "user_fixture_checker",
        displayName: "Fixture Checker",
        status: "ACTIVE",
      });
      const membershipId = await ctx.db.insert("memberships", {
        orgId: world.orgA,
        userId,
        clerkMembershipId: "orgmem_fixture_checker",
        status: "ACTIVE",
        scopeMode: "ORG_WIDE",
        effectiveFrom: 0,
      });
      await ctx.db.insert("membershipRoles", {
        orgId: world.orgA,
        membershipId,
        roleId: world.authorization.rolesA.get("ORG_ADMIN")!,
        grantedAt: 0,
      });
      return userId;
    });
    const checkerIdentity = {
      subject: "user_fixture_checker",
      org_id: "org_fixture_a",
    };

    const customerId = value(
      await call(world, createCustomer, {
        requestId: "journey-customer",
        code: "JOURNEY",
        name: "Journey Foods",
      }),
    )["documentId"] as string;
    const orderId = value(
      await call(world, createCustomerOrder, {
        requestId: "journey-order",
        orderNumber: "SO-JOURNEY-1",
        customerId,
        customerReference: "PO-JOURNEY-1",
      }),
    )["documentId"] as string;
    const lineId = value(
      await call(world, addCustomerOrderLine, {
        requestId: "journey-line",
        customerOrderId: orderId,
        lineNumber: 1,
        customerProductCode: "JRN-BOX-1",
        specification: completeSpecification,
        orderedQuantity: 250,
      }),
    )["documentId"] as string;
    const designRequestPage = await call(world, listDesignRequests, {
      status: "OPEN",
    });
    expect(
      (
        (designRequestPage["value"] as Record<string, unknown>)[
          "items"
        ] as unknown[]
      )[0],
    ).toMatchObject({
      customerOrderLineId: lineId,
      customerId,
      customerProductCode: "JRN-BOX-1",
      designKey: expect.any(String),
      specification: expect.objectContaining(specification),
    });

    const releaseArgs = {
      requestId: "journey-order-release",
      customerOrderId: orderId,
    };
    expect(
      value(await call(world, releaseCustomerOrder, releaseArgs)),
    ).toMatchObject({ written: true, replayed: false });
    expect(
      value(await call(world, releaseCustomerOrder, releaseArgs)),
    ).toMatchObject({ written: true, replayed: true });

    const cardArgs = {
      requestId: "journey-card",
      cardNumber: "MC-JOURNEY-1",
      customerId,
      customerProductCode: "JRN-BOX-1",
      name: "Journey export carton",
      specification: completeSpecification,
    };
    const cardResult = value(await call(world, createMasterCard, cardArgs));
    const cardId = cardResult["documentId"] as string;
    expect(value(await call(world, createMasterCard, cardArgs))).toMatchObject({
      documentId: cardId,
      replayed: true,
    });
    expect(
      value(
        await call(world, createMasterCard, {
          ...cardArgs,
          name: "Different name under reused request",
        }),
      ),
    ).toMatchObject({
      written: false,
      error: { code: "REQUEST_ARGUMENT_CONFLICT" },
    });
    const { revisionId, requestId } = await world.t.run(async (ctx) => {
      const revision = await ctx.db
        .query("masterCardRevisions")
        .withIndex("by_orgId_masterCardId_revisionNumber", (query) =>
          query
            .eq("orgId", world.orgA)
            .eq("masterCardId", cardId as GenericId<"masterCards">)
            .eq("revisionNumber", 1),
        )
        .unique();
      const request = await ctx.db
        .query("designRequests")
        .withIndex("by_orgId_customerOrderLineId", (query) =>
          query
            .eq("orgId", world.orgA)
            .eq(
              "customerOrderLineId",
              lineId as GenericId<"customerOrderLines">,
            ),
        )
        .unique();
      return { revisionId: revision!._id, requestId: request!._id };
    });

    const upload = value(
      await call(world, authorizeMasterCardFileUpload, {
        masterCardRevisionId: revisionId,
      }),
    );
    const claimed = await world.t.run(async (ctx) =>
      (claimMasterCardUploadGrant as unknown as RuntimeFunction)._handler(
        ctx as GenericMutationCtx<DataModel>,
        { grantId: upload["uploadGrantId"] },
      ),
    );
    expect(claimed).toEqual({ kind: "CLAIMED" });
    const stored = await world.t.run(async (ctx) => {
      const storageId = await ctx.storage.store(
        new Blob(["verified dieline"], { type: "application/pdf" }),
      );
      const unboundStorageId = await ctx.storage.store(
        new Blob(["verified dieline"], { type: "application/pdf" }),
      );
      const metadata = await ctx.db.system.get("_storage", storageId);
      return { storageId, unboundStorageId, metadata: metadata! };
    });
    expect(
      await world.t.run(async (ctx) =>
        (completeMasterCardUploadGrant as unknown as RuntimeFunction)._handler(
          ctx as GenericMutationCtx<DataModel>,
          {
            grantId: upload["uploadGrantId"],
            storageId: stored.storageId,
          },
        ),
      ),
    ).toBe(true);
    const attachArgs = {
      requestId: "journey-file",
      masterCardRevisionId: revisionId,
      fileKey: "DIELINE-1",
      fileName: "journey-dieline.pdf",
      kind: "DIELINE",
      contentType: stored.metadata.contentType ?? "application/octet-stream",
      byteSize: stored.metadata.size,
      contentDigest: createHash("sha256")
        .update("verified dieline")
        .digest("hex"),
      storageId: stored.storageId,
      uploadGrantId: upload["uploadGrantId"],
    };
    const adoptionAttempt = value(
      await call(world, attachMasterCardFile, {
        ...attachArgs,
        requestId: "journey-file-adoption-attempt",
        storageId: stored.unboundStorageId,
      }),
    );
    expect(adoptionAttempt).toMatchObject({
      written: false,
      error: { reason: "UPLOAD_GRANT_INVALID" },
    });
    value(await call(world, attachMasterCardFile, attachArgs));
    const retryAttach = value(
      await call(world, attachMasterCardFile, attachArgs),
    );
    expect(retryAttach, JSON.stringify(retryAttach)).toMatchObject({
      written: true,
      replayed: true,
    });

    const vendorUpload = value(
      await call(world, authorizeMasterCardFileUpload, {
        masterCardRevisionId: revisionId,
        transport: "UPLOADTHING",
      }),
    );
    const vendorDigest = createHash("sha256")
      .update("verified vendor artwork")
      .digest("hex");
    const completeVendor = (uploaderClerkUserId: string) =>
      world.t.run(async (ctx) =>
        (
          completeUploadThingMasterCardUploadGrant as unknown as RuntimeFunction
        )._handler(ctx as GenericMutationCtx<DataModel>, {
          grantId: vendorUpload["uploadGrantId"],
          providerKey: "uploadthing_private_artwork_1",
          uploaderClerkUserId,
          contentDigest: vendorDigest,
          contentType: "image/webp",
          byteSize: 23,
        }),
      );
    expect(await completeVendor("different_clerk_subject")).toBe(false);
    expect(await completeVendor(identity.subject)).toBe(true);
    value(
      await call(world, attachMasterCardFile, {
        requestId: "journey-vendor-file",
        masterCardRevisionId: revisionId,
        fileKey: "ARTWORK-1",
        fileName: "journey-artwork.webp",
        kind: "ARTWORK",
        contentType: "image/webp",
        byteSize: 23,
        contentDigest: vendorDigest,
        uploadThingKey: "uploadthing_private_artwork_1",
        uploadGrantId: vendorUpload["uploadGrantId"],
      }),
    );

    const submitArgs = {
      requestId: "journey-submit",
      masterCardRevisionId: revisionId,
    };
    value(await call(world, submitMasterCardRevision, submitArgs));
    expect(
      value(await call(world, submitMasterCardRevision, submitArgs))[
        "replayed"
      ],
    ).toBe(true);

    const decisionArgs = {
      requestId: "journey-approve",
      masterCardRevisionId: revisionId,
      decision: "APPROVE",
      note: "Independent release",
    };
    value(
      await call(
        world,
        decideMasterCardRevision,
        decisionArgs,
        checkerIdentity,
      ),
    );
    expect(
      value(
        await call(
          world,
          decideMasterCardRevision,
          decisionArgs,
          checkerIdentity,
        ),
      )["replayed"],
    ).toBe(true);

    const fulfilArgs = {
      requestId: "journey-fulfil",
      designRequestId: requestId,
      masterCardRevisionId: revisionId,
    };
    expect(
      value(await call(world, fulfilDesignRequest, fulfilArgs)),
    ).toMatchObject({
      written: false,
      error: { reason: "REQUIREMENTS_INCOMPLETE" },
    });
    const requirementArgs = {
      requestId: "journey-requirements",
      designRequestId: requestId,
      confirmations: {
        CUSTOMER_PRODUCT_IDENTITY: true,
        DIMENSIONS: true,
        CONSTRUCTION: true,
        PRINT: true,
        PACKING: true,
        ROUTE: true,
        MATERIALS: true,
        QUALITY: true,
      },
      note: "Customer Service and Engineering confirmed the production hand-off.",
    };
    expect(
      value(await call(world, recordDesignRequirements, requirementArgs)),
    ).toMatchObject({ written: true, replayed: false });
    expect(
      value(await call(world, recordDesignRequirements, requirementArgs)),
    ).toMatchObject({ written: true, replayed: true });
    value(await call(world, fulfilDesignRequest, fulfilArgs));
    expect(
      value(await call(world, fulfilDesignRequest, fulfilArgs))["replayed"],
    ).toBe(true);

    expect(
      value(
        await call(world, listRoutableCustomerOrderLines, {
          maxPageSize: 20,
        }),
      )["items"],
    ).toEqual([
      expect.objectContaining({
        customerOrderLineId: lineId,
        status: "DESIGN_READY",
      }),
    ]);

    await routeForProduction(world, lineId, "JOURNEY-1");
    expect(
      value(
        await call(world, listRoutableCustomerOrderLines, {
          maxPageSize: 20,
        }),
      )["items"],
    ).toEqual([]);

    const packetArgs = {
      requestId: "journey-packet",
      warehouseId: world.warehouses.alphaA,
      customerOrderLineId: lineId,
    };
    const packetId = value(await call(world, issueFactoryPacket, packetArgs))[
      "documentId"
    ] as string;
    expect(
      value(await call(world, issueFactoryPacket, packetArgs))["replayed"],
    ).toBe(true);
    const acknowledgeArgs = {
      requestId: "journey-acknowledge",
      warehouseId: world.warehouses.alphaA,
      factoryPacketId: packetId,
    };
    value(await call(world, acknowledgeFactoryPacket, acknowledgeArgs));
    expect(
      value(await call(world, acknowledgeFactoryPacket, acknowledgeArgs))[
        "replayed"
      ],
    ).toBe(true);

    const storedEvidence = await world.t.run(async (ctx) => ({
      checker,
      revision: await ctx.db.get(
        revisionId as GenericId<"masterCardRevisions">,
      ),
      packet: await ctx.db.get(packetId as GenericId<"factoryPackets">),
      packetFiles: await ctx.db
        .query("factoryPacketFiles")
        .withIndex("by_orgId_factoryPacketId_masterCardFileId", (query) =>
          query
            .eq("orgId", world.orgA)
            .eq("factoryPacketId", packetId as GenericId<"factoryPackets">),
        )
        .collect(),
    }));
    expect(storedEvidence.revision).toMatchObject({
      status: "RELEASED",
      decidedByUserId: checker,
    });
    expect(storedEvidence.packet).toMatchObject({
      status: "ACKNOWLEDGED",
    });
    expect(storedEvidence.packet).not.toHaveProperty("customerOrderNumber");
    expect(storedEvidence.packet).not.toHaveProperty("specification");
    expect(storedEvidence.packet).not.toHaveProperty("approvedFileIds");
    expect(storedEvidence.packetFiles).toHaveLength(2);
    expect(storedEvidence.packetFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ masterCardFileId: expect.any(String) }),
      ]),
    );
    const packetPage = (await call(world, listFactoryPackets, {
      warehouseId: world.warehouses.alphaA,
    })) as Record<string, unknown>;
    expect(
      (
        (packetPage["value"] as Record<string, unknown>)["items"] as unknown[]
      )[0],
    ).toMatchObject({
      customerOrderNumber: "SO-JOURNEY-1",
      approvedFileIds: [expect.any(String), expect.any(String)],
      releaseEvidence: { releasedByUserId: checker },
      specification: expect.objectContaining(specification),
      quantity: 250,
    });

    const draftArgs = {
      requestId: "journey-next-revision",
      masterCardId: cardId,
      specification: {
        ...completeSpecification,
        internalLengthMm: 301,
      },
    };
    const drafted = value(
      await call(world, draftMasterCardRevision, draftArgs),
    );
    expect(
      value(await call(world, draftMasterCardRevision, draftArgs)),
    ).toMatchObject({ documentId: drafted["documentId"], replayed: true });
    expect(
      value(
        await call(world, draftMasterCardRevision, {
          ...draftArgs,
          specification: {
            ...draftArgs.specification,
            notes: "different payload",
          },
        }),
      ),
    ).toMatchObject({
      written: false,
      error: { code: "REQUEST_ARGUMENT_CONFLICT" },
    });

    const reuseOrderId = value(
      await call(world, createCustomerOrder, {
        requestId: "journey-reuse-order",
        orderNumber: "SO-JOURNEY-REUSE",
        customerId,
      }),
    )["documentId"] as string;
    const reuseLineId = value(
      await call(world, addCustomerOrderLine, {
        requestId: "journey-reuse-line",
        customerOrderId: reuseOrderId,
        lineNumber: 1,
        customerProductCode: "JRN-BOX-1",
        specification: completeSpecification,
        orderedQuantity: 25,
      }),
    )["documentId"] as string;
    value(
      await call(world, releaseCustomerOrder, {
        requestId: "journey-reuse-release",
        customerOrderId: reuseOrderId,
      }),
    );
    await routeForProduction(world, reuseLineId, "JOURNEY-REUSE");
    const reusePacketId = value(
      await call(world, issueFactoryPacket, {
        requestId: "journey-reuse-packet",
        warehouseId: world.warehouses.alphaA,
        customerOrderLineId: reuseLineId,
      }),
    )["documentId"] as string;
    value(
      await call(world, acknowledgeFactoryPacket, {
        requestId: "journey-reuse-ack",
        warehouseId: world.warehouses.alphaA,
        factoryPacketId: reusePacketId,
      }),
    );
    const exactReuseEvidence = await world.t.run(async (ctx) => ({
      line: await ctx.db.get(reuseLineId as GenericId<"customerOrderLines">),
      packet: await ctx.db.get(reusePacketId as GenericId<"factoryPackets">),
      requests: await ctx.db
        .query("designRequests")
        .withIndex("by_orgId_customerOrderLineId", (query) =>
          query
            .eq("orgId", world.orgA)
            .eq(
              "customerOrderLineId",
              reuseLineId as GenericId<"customerOrderLines">,
            ),
        )
        .collect(),
    }));
    expect(exactReuseEvidence.line).toMatchObject({
      designSource: "EXISTING",
      status: "HANDED_OFF",
      masterCardRevisionId: revisionId,
    });
    expect(exactReuseEvidence.packet).toMatchObject({ status: "ACKNOWLEDGED" });
    expect(exactReuseEvidence.requests).toEqual([]);
  });

  it("fails submission and packet issue when an AVAILABLE blob was removed", async () => {
    const world = await createConvexInventoryWorld({}, { roleA: "ORG_ADMIN" });
    const seeded = await world.t.run(async (ctx) => {
      const customerId = await ctx.db.insert("customers", {
        orgId: world.orgA,
        code: "DEAD-BLOB",
        name: "Dead blob customer",
        status: "ACTIVE",
      });
      const cardId = await ctx.db.insert("masterCards", {
        orgId: world.orgA,
        cardNumber: "MC-DEAD-BLOB",
        customerId,
        customerProductCode: "DEAD-BLOB",
        designKey: "DEAD-BLOB",
        name: "Dead blob card",
        status: "ACTIVE",
      });
      const draftRevisionId = await ctx.db.insert("masterCardRevisions", {
        orgId: world.orgA,
        masterCardId: cardId,
        revisionNumber: 1,
        status: "DRAFT",
        specification: completeSpecification,
        designKey: "DEAD-BLOB",
        authoredByUserId: world.userA,
      });
      const releasedRevisionId = await ctx.db.insert("masterCardRevisions", {
        orgId: world.orgA,
        masterCardId: cardId,
        revisionNumber: 2,
        status: "RELEASED",
        specification: completeSpecification,
        designKey: "DEAD-BLOB",
        authoredByUserId: world.userA,
        submittedByUserId: world.userA,
        decidedByUserId: world.userA,
        decidedAt: 1,
      });
      const storageId = await ctx.storage.store(
        new Blob(["removed after verification"], { type: "application/pdf" }),
      );
      for (const revisionId of [draftRevisionId, releasedRevisionId]) {
        await ctx.db.insert("masterCardFiles", {
          orgId: world.orgA,
          masterCardRevisionId: revisionId,
          fileKey: "DIELINE-1",
          fileName: "removed.pdf",
          kind: "DIELINE",
          contentType: "application/pdf",
          byteSize: 26,
          contentDigest: "b".repeat(64),
          storageId,
          verifiedAt: 1,
          storageState: "AVAILABLE",
          attachedByUserId: world.userA,
        });
      }
      const orderId = await ctx.db.insert("customerOrders", {
        orgId: world.orgA,
        orderNumber: "SO-DEAD-BLOB",
        customerId,
        status: "RELEASED",
        orderedAt: 1,
      });
      const lineId = await ctx.db.insert("customerOrderLines", {
        orgId: world.orgA,
        customerOrderId: orderId,
        lineNumber: 1,
        customerProductCode: "DEAD-BLOB",
        specification: completeSpecification,
        designKey: "DEAD-BLOB",
        designSource: "EXISTING",
        status: "DESIGN_READY",
        orderedQuantity: 10,
        masterCardRevisionId: releasedRevisionId,
      });
      await ctx.storage.delete(storageId);
      return { draftRevisionId, lineId };
    });

    expect(
      value(
        await call(world, submitMasterCardRevision, {
          requestId: "dead-blob-submit",
          masterCardRevisionId: seeded.draftRevisionId,
        }),
      ),
    ).toMatchObject({
      written: false,
      error: { reason: "FILE_NOT_RETRIEVABLE" },
    });
    await routeForProduction(world, seeded.lineId, "DEAD-BLOB");
    expect(
      value(
        await call(world, issueFactoryPacket, {
          requestId: "dead-blob-packet",
          warehouseId: world.warehouses.alphaA,
          customerOrderLineId: seeded.lineId,
        }),
      ),
    ).toMatchObject({
      written: false,
      error: { reason: "FILE_NOT_RETRIEVABLE" },
    });
  });

  it("finds the best similar release beyond the first lexical product-code page", async () => {
    const world = await createConvexInventoryWorld({}, { roleA: "ORG_ADMIN" });
    const seeded = await world.t.run(async (ctx) => {
      const customerId = await ctx.db.insert("customers", {
        orgId: world.orgA,
        code: "SIMILAR",
        name: "Similarity customer",
        status: "ACTIVE",
      });
      const orderId = await ctx.db.insert("customerOrders", {
        orgId: world.orgA,
        orderNumber: "SO-SIMILAR",
        customerId,
        status: "DRAFT",
        orderedAt: 1,
      });
      const lineId = await ctx.db.insert("customerOrderLines", {
        orgId: world.orgA,
        customerOrderId: orderId,
        lineNumber: 1,
        customerProductCode: "REQUESTED",
        specification,
        designKey: "RSC|300x200x150|KA125/C/KA125|C2",
        designSource: "NEW",
        status: "AWAITING_DESIGN",
        orderedQuantity: 10,
      });
      const designRequestId = await ctx.db.insert("designRequests", {
        orgId: world.orgA,
        requestNumber: "DR-SIMILAR",
        customerOrderLineId: lineId,
        status: "OPEN",
        priority: "NORMAL",
      });
      let expectedRevisionId = "";
      for (let index = 0; index < 25; index += 1) {
        const exact = index === 24;
        const candidate = exact
          ? specification
          : {
              ...specification,
              internalLengthMm: 500 + index,
              boardGrade: `OTHER-${index}`,
            };
        const cardId = await ctx.db.insert("masterCards", {
          orgId: world.orgA,
          cardNumber: `MC-SIM-${String(index).padStart(2, "0")}`,
          customerId,
          customerProductCode: exact
            ? "ZZZ-BEST-MATCH"
            : `AAA-${String(index).padStart(2, "0")}`,
          designKey: exact
            ? "RSC|300x200x150|KA125/C/KA125|C2"
            : `SIM-${index}`,
          name: `Similarity candidate ${index}`,
          status: "ACTIVE",
        });
        const revisionId = await ctx.db.insert("masterCardRevisions", {
          orgId: world.orgA,
          masterCardId: cardId,
          revisionNumber: 1,
          status: "RELEASED",
          specification: candidate,
          designKey: `SIM-${index}`,
          authoredByUserId: world.userA,
          decidedByUserId: world.userA,
          decidedAt: 1,
        });
        await ctx.db.patch("masterCards", cardId, {
          releasedRevisionId: revisionId,
        });
        if (exact) expectedRevisionId = revisionId;
      }
      return { designRequestId, expectedRevisionId };
    });
    const outcome = await call(world, listSimilarReleasedDesigns, {
      designRequestId: seeded.designRequestId,
    });
    expect(outcome["ok"]).toBe(true);
    const candidates = outcome["value"] as readonly Record<string, unknown>[];
    expect(candidates[0]).toMatchObject({
      masterCardRevisionId: seeded.expectedRevisionId,
      customerProductCode: "ZZZ-BEST-MATCH",
      score: 1,
    });
  });

  it("expires completed upload capabilities and cleans unattached storage in bounded batches", async () => {
    const world = await createConvexInventoryWorld({}, { roleA: "ORG_ADMIN" });
    const seeded = await world.t.run(async (ctx) => {
      const customerId = await ctx.db.insert("customers", {
        orgId: world.orgA,
        code: "CLEANUP",
        name: "Cleanup customer",
        status: "ACTIVE",
      });
      const cardId = await ctx.db.insert("masterCards", {
        orgId: world.orgA,
        cardNumber: "MC-CLEANUP",
        customerId,
        customerProductCode: "CLEANUP",
        designKey: "CLEANUP",
        name: "Cleanup card",
        status: "ACTIVE",
      });
      const revisionId = await ctx.db.insert("masterCardRevisions", {
        orgId: world.orgA,
        masterCardId: cardId,
        revisionNumber: 1,
        status: "DRAFT",
        specification,
        designKey: "CLEANUP",
        authoredByUserId: world.userA,
      });
      const storageId = await ctx.storage.store(new Blob(["expired orphan"]));
      const grantId = await ctx.db.insert("masterCardUploadGrants", {
        orgId: world.orgA,
        masterCardRevisionId: revisionId,
        authorizedByUserId: world.userA,
        expiresAt: Date.now() - 1,
        uploadStartedAt: Date.now() - 10,
        consumedStorageId: storageId,
        consumedAt: Date.now() - 5,
      });
      return { revisionId, storageId, grantId };
    });
    expect(
      await world.t.run(async (ctx) =>
        (claimMasterCardUploadGrant as unknown as RuntimeFunction)._handler(
          ctx as GenericMutationCtx<DataModel>,
          { grantId: seeded.grantId },
        ),
      ),
    ).toBeNull();
    value(
      await call(world, authorizeMasterCardFileUpload, {
        masterCardRevisionId: seeded.revisionId,
      }),
    );
    const cleaned = await world.t.run(async (ctx) => ({
      grant: await ctx.db.get(seeded.grantId),
      storage: await ctx.db.system.get("_storage", seeded.storageId),
    }));
    expect(cleaned).toEqual({ grant: null, storage: null });
  });
});
