/**
 * Factory packets — the one document that crosses from the office to the floor.
 *
 * Status: **implemented** (Phase 5A).
 *
 * ### Why the packet stores references and the query returns a projection
 *
 * A packet stores the order-line and released-revision identifiers. Its read
 * model resolves the order, immutable revision, and approved-file junction rows
 * inside the server and returns one floor-facing object. Production users still
 * call only a production function and gain no engineering endpoint permission.
 *
 * That is what makes the release gate hold. `PRODUCTION_PLANNER` and
 * `WAREHOUSE_MANAGER` carry no `engineering.*` permission whatsoever, so a
 * production screen physically cannot render a draft revision: there is no
 * function it may call that returns one. The production query performs the
 * authoritative join only after its own permission and tenant checks.
 *
 * This keeps the operational tables in third normal form: order identity and
 * quantity live on the order/line, revision metadata lives on the revision, and
 * the repeating approved-file set lives in `factoryPacketFiles`.
 *
 * ### Why quantity is derived and never an argument
 *
 * `checkPacketIssue` takes the quantity from `line.orderedQuantity`. A packet
 * whose quantity could be typed in would let a planner commit the factory to a
 * different number of boxes than the customer ordered, with nothing anywhere
 * recording that the two had diverged. Over- and under-runs are a factory-order
 * concern (`WF-02`, Phase 5B) and will be modelled as their own quantities
 * against this one, not as a free-text override of it.
 *
 * ### Why issuing is warehouse-scoped and everything upstream is not
 *
 * `production.packet.*` is `WAREHOUSE`-scoped, so a planner at one site cannot
 * issue work to another. Sales and engineering are `ORG`-scoped because an order
 * and a design belong to the tenant, not to a building. `warehouseId` naming a
 * production site is provisional — `WF-03` is open — and is the honest smallest
 * thing that works, because the scope machinery already understands warehouses.
 */
import { v } from "convex/values";

import {
  CODE_FIELD,
  appendDomainAudit,
  createMasterDataRow,
  insertedFields,
  normalizeField,
  replayTenantWriteIfPresent,
  updateMasterDataRow,
  type UniquenessCheck,
} from "../lib/masterDataStore";
import {
  listArgs,
  pageOf,
  pageOptions,
  pageRefusal,
  pageRequestOf,
} from "../lib/listEnvelope";
import { mutationWithOrg, queryWithOrg } from "../lib/tenantFunctions";
import type { TenantOrgId } from "../lib/tenantDb";
import { boxSpecification, factoryPacketStatus } from "../lib/validators";
import {
  refusal,
  writeContextOf,
  writeOutcomeValidator,
  written,
} from "../lib/writeEnvelope";
import type { CustomerOrderLineState } from "../model/orderToShip/customerOrder";
import type { DesignSpecification } from "../model/orderToShip/designSpecification";
import { MAX_FILES_PER_REVISION } from "../model/orderToShip/masterCardFile";
import {
  checkPacketAcknowledgement,
  checkPacketCancellation,
  checkPacketIssue,
} from "../model/orderToShip/factoryPacket";

/* -------------------------------------------------------------------------- */
/* Operations                                                                  */
/* -------------------------------------------------------------------------- */

export const PRODUCTION_PACKET_OPERATIONS = Object.freeze({
  issuePacket: "production.packet.issue",
  acknowledgePacket: "production.packet.acknowledge",
  cancelPacket: "production.packet.cancel",
  accessApprovedFile: "production.packet.accessApprovedFile",
});

const FILE_ACCESS_GRANT_LIFETIME_MS = 5 * 60 * 1_000;

/* -------------------------------------------------------------------------- */
/* Documents                                                                   */
/* -------------------------------------------------------------------------- */

interface PacketDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly warehouseId: string;
  readonly packetNumber: string;
  readonly customerOrderLineId: string;
  readonly masterCardRevisionId: string;
  readonly status: "ISSUED" | "ACKNOWLEDGED" | "CANCELLED";
  readonly issuedByUserId: string;
  readonly acknowledgedByUserId?: string;
  readonly acknowledgedAt?: number;
}

interface LineDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly customerOrderId: string;
  readonly lineNumber: number;
  readonly status: CustomerOrderLineState["status"];
  readonly orderedQuantity: number;
  readonly masterCardRevisionId?: string;
}

interface PacketFileDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly factoryPacketId: string;
  readonly masterCardFileId: string;
}

interface OrderDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly orderNumber: string;
  readonly customerId: string;
  readonly status: string;
  readonly customerReference?: string;
}

interface RevisionDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly revisionNumber: number;
  readonly status: string;
  readonly specification: DesignSpecification;
  readonly decidedByUserId?: string;
  readonly decidedAt?: number;
  readonly decisionNote?: string;
}

interface FileDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly storageState: string;
  readonly storageId?: string;
}

/** `(orgId, packetNumber)`: a packet number is unique per organization. */
const packetNumberUniqueness = (
  packetNumber: string,
): readonly UniquenessCheck[] => [
  {
    field: "packetNumber",
    index: "by_orgId_packetNumber",
    equality: [{ field: "packetNumber", value: packetNumber }],
  },
];

/**
 * `(orgId, customerOrderLineId)`: one packet per line.
 *
 * Without it, two planners issuing the same line concurrently would each get a
 * packet, and the line would be built twice — the expensive kind of duplicate,
 * because it is made of board.
 */
const linePacketUniqueness = (
  customerOrderLineId: string,
): readonly UniquenessCheck[] => [
  {
    field: "customerOrderLineId",
    index: "by_orgId_customerOrderLineId",
    equality: [{ field: "customerOrderLineId", value: customerOrderLineId }],
  },
];

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Hand one order line to a production site.
 *
 * The packet and the line's `HANDED_OFF` status are written in one transaction.
 * A packet whose line still said `DESIGN_READY` would be issuable again; a line
 * marked handed off with no packet would be work that vanished between sales and
 * the floor.
 *
 * `packetNumber` is derived from the order number and line number rather than
 * supplied, so the same request produces the same number and the uniqueness
 * contract has something stable to refuse against. It is also the number a
 * person reads back over a radio, and deriving it means it always matches the
 * order it came from.
 */
export const issueFactoryPacket = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    customerOrderLineId: v.id("customerOrderLines"),
  },
  returns: writeOutcomeValidator,
  permissionCode: "production.packet.issue",
  target: {
    table: "customerOrderLines",
    id: ({ customerOrderLineId }) => customerOrderLineId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const line = await ctx.tenantDb.get<LineDocument>(
      "customerOrderLines",
      args.customerOrderLineId,
    );
    if (line === null) {
      return refusal({ code: "NOT_FOUND", table: "customerOrderLines" });
    }

    const warehouse = await ctx.tenantDb.get("warehouses", args.warehouseId);
    if (warehouse === null) {
      return refusal({ code: "REFERENCE_NOT_FOUND", field: "warehouseId" });
    }

    const order = await ctx.tenantDb.get<OrderDocument>(
      "customerOrders",
      line.customerOrderId,
    );
    if (order === null) {
      return refusal({ code: "REFERENCE_NOT_FOUND", field: "customerOrderId" });
    }

    /*
     * An unpinned line is refused here rather than by the kernel, because there
     * is no revision to hand the kernel: the check it would make is the reason
     * this read has nothing to read. The refusal names the same field the
     * kernel's would.
     */
    if (line.masterCardRevisionId === undefined) {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "masterCardRevisionId",
        reason: "NOT_PINNED",
      });
    }

    const revision = await ctx.tenantDb.get<RevisionDocument>(
      "masterCardRevisions",
      line.masterCardRevisionId,
    );
    if (revision === null) {
      return refusal({
        code: "REFERENCE_NOT_FOUND",
        field: "masterCardRevisionId",
      });
    }
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "factoryPackets",
      operation: PRODUCTION_PACKET_OPERATIONS.issuePacket,
      requestId: args.requestId,
      fingerprint: {
        operation: PRODUCTION_PACKET_OPERATIONS.issuePacket,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
        customerOrderLineId: args.customerOrderLineId,
        masterCardRevisionId: revision._id,
      },
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);
    if (
      revision.decidedByUserId === undefined ||
      revision.decidedAt === undefined
    ) {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "releaseEvidence",
        reason: "RELEASE_EVIDENCE_MISSING",
      });
    }

    const approvedFiles = await ctx.tenantDb
      .byIndex<FileDocument>(
        "masterCardFiles",
        "by_orgId_masterCardRevisionId_fileKey",
        [
          {
            field: "masterCardRevisionId",
            value: line.masterCardRevisionId,
          },
        ],
      )
      .take(MAX_FILES_PER_REVISION + 1);
    if (approvedFiles.length > MAX_FILES_PER_REVISION) {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "approvedFileIds",
        reason: "FILE_LIMIT_EXCEEDED",
      });
    }
    const approvedFileIds: string[] = [];
    for (const file of approvedFiles) {
      if (file.storageState !== "AVAILABLE") continue;
      if (
        file.storageId === undefined ||
        (await ctx.privateFiles.inspect(file.storageId)) === null
      ) {
        return refusal({
          code: "PRECONDITION_FAILED",
          field: "approvedFileIds",
          reason: "FILE_NOT_RETRIEVABLE",
        });
      }
      approvedFileIds.push(file._id);
    }
    if (approvedFileIds.length === 0) {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "approvedFileIds",
        reason: "NO_RETRIEVABLE_APPROVED_FILES",
      });
    }

    const issue = checkPacketIssue({
      line,
      order,
      revision: {
        revisionId: revision._id,
        status: revision.status,
      },
    });
    if (!issue.ok) return refusal(issue.error);

    const packetNumber = normalizeField(
      "packetNumber",
      `${order.orderNumber}-${line.lineNumber}`,
      CODE_FIELD,
    );
    if (!packetNumber.ok) return refusal(packetNumber.error);

    const context = writeContextOf(ctx, {
      table: "factoryPackets",
      operation: PRODUCTION_PACKET_OPERATIONS.issuePacket,
      requestId: args.requestId,
      warehouseId: args.warehouseId,
    });

    const outcome = await createMasterDataRow({
      ...context,
      fingerprint: {
        operation: PRODUCTION_PACKET_OPERATIONS.issuePacket,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
        customerOrderLineId: args.customerOrderLineId,
        masterCardRevisionId: issue.value.pin.masterCardRevisionId,
      },
      uniqueness: [
        ...packetNumberUniqueness(packetNumber.value),
        ...linePacketUniqueness(args.customerOrderLineId),
      ],
      document: {
        warehouseId: args.warehouseId,
        packetNumber: packetNumber.value,
        customerOrderLineId: args.customerOrderLineId,
        masterCardRevisionId: issue.value.pin.masterCardRevisionId,
        status: issue.value.status,
        issuedByUserId: context.actorUserId,
      },
    });

    if (!outcome.ok) return refusal(outcome.error);

    if (!outcome.value.replayed) {
      for (const masterCardFileId of approvedFileIds) {
        await ctx.tenantDb.insert("factoryPacketFiles", {
          factoryPacketId: outcome.value.documentId,
          masterCardFileId,
        });
      }
      await ctx.tenantDb.patch("customerOrderLines", line._id, {
        status: "HANDED_OFF",
      });
      await appendDomainAudit(context, {
        entityTable: "customerOrderLines",
        entityId: line._id,
        changes: [{ field: "status", from: line.status, to: "HANDED_OFF" }],
      });
    }

    return written(outcome.value);
  },
});

/**
 * Record that the factory has the packet.
 *
 * The one signal that the hand-off completed. Until it arrives, a planner
 * looking at an `ISSUED` packet knows the paper may still be on a desk, which is
 * the difference between chasing the printer and chasing the shop floor.
 */
export const acknowledgeFactoryPacket = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    factoryPacketId: v.id("factoryPackets"),
  },
  returns: writeOutcomeValidator,
  permissionCode: "production.packet.acknowledge",
  target: {
    table: "factoryPackets",
    id: ({ factoryPacketId }) => factoryPacketId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const packet = await ctx.tenantDb.get<PacketDocument>(
      "factoryPackets",
      args.factoryPacketId,
    );
    if (packet === null) {
      return refusal({ code: "NOT_FOUND", table: "factoryPackets" });
    }
    /*
     * A packet belonging to another site is refused by field, not by silence.
     * The wrapper scoped the *permission* to `warehouseId`; this checks that the
     * document the caller named is actually at that site, which is a different
     * question and one the wrapper cannot answer without reading the row.
     */
    if (packet.warehouseId !== args.warehouseId) {
      return refusal({ code: "REFERENCE_NOT_FOUND", field: "warehouseId" });
    }

    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "factoryPackets",
      operation: PRODUCTION_PACKET_OPERATIONS.acknowledgePacket,
      requestId: args.requestId,
      fingerprint: {
        operation: PRODUCTION_PACKET_OPERATIONS.acknowledgePacket,
        requestId: args.requestId,
        factoryPacketId: args.factoryPacketId,
      },
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);

    const acknowledgement = checkPacketAcknowledgement(packet);
    if (!acknowledgement.ok) return refusal(acknowledgement.error);

    const context = writeContextOf(ctx, {
      table: "factoryPackets",
      operation: PRODUCTION_PACKET_OPERATIONS.acknowledgePacket,
      requestId: args.requestId,
      warehouseId: args.warehouseId,
    });

    const outcome = await updateMasterDataRow({
      ...context,
      documentId: args.factoryPacketId,
      fingerprint: {
        operation: PRODUCTION_PACKET_OPERATIONS.acknowledgePacket,
        requestId: args.requestId,
        factoryPacketId: args.factoryPacketId,
      },
      uniqueness: [],
      patch: {
        status: acknowledgement.value,
        acknowledgedByUserId: context.actorUserId,
        acknowledgedAt: context.now,
      },
    });

    return outcome.ok ? written(outcome.value) : refusal(outcome.error);
  },
});

/**
 * Withdraw a packet the factory has not picked up yet, releasing its line.
 *
 * Refused once acknowledged: material may already be cut, and a cancellation
 * that reached the system but not the floor would be worse than none — the line
 * would look re-issuable while a run of it was in progress.
 *
 * Cancelling returns the line to `DESIGN_READY`, which is the status it had
 * before the packet existed. Its pinned revision is untouched: nothing about the
 * design changed, only the decision to build it now.
 *
 * Guarded by `production.packet.issue` rather than a code of its own. Withdrawing
 * a packet nobody has picked up is the same authority as issuing it — it undoes
 * exactly what that permission did, and only while it can still be undone. A
 * separate `production.packet.cancel` would be a code every role that can issue
 * would have to hold anyway, which is a distinction the catalogue does not need
 * to carry.
 */
export const cancelFactoryPacket = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    factoryPacketId: v.id("factoryPackets"),
  },
  returns: writeOutcomeValidator,
  permissionCode: "production.packet.issue",
  target: {
    table: "factoryPackets",
    id: ({ factoryPacketId }) => factoryPacketId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const packet = await ctx.tenantDb.get<PacketDocument>(
      "factoryPackets",
      args.factoryPacketId,
    );
    if (packet === null) {
      return refusal({ code: "NOT_FOUND", table: "factoryPackets" });
    }
    if (packet.warehouseId !== args.warehouseId) {
      return refusal({ code: "REFERENCE_NOT_FOUND", field: "warehouseId" });
    }

    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "factoryPackets",
      operation: PRODUCTION_PACKET_OPERATIONS.cancelPacket,
      requestId: args.requestId,
      fingerprint: {
        operation: PRODUCTION_PACKET_OPERATIONS.cancelPacket,
        requestId: args.requestId,
        factoryPacketId: args.factoryPacketId,
      },
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);

    const cancellation = checkPacketCancellation(packet);
    if (!cancellation.ok) return refusal(cancellation.error);

    const context = writeContextOf(ctx, {
      table: "factoryPackets",
      operation: PRODUCTION_PACKET_OPERATIONS.cancelPacket,
      requestId: args.requestId,
      warehouseId: args.warehouseId,
    });

    const outcome = await updateMasterDataRow({
      ...context,
      documentId: args.factoryPacketId,
      fingerprint: {
        operation: PRODUCTION_PACKET_OPERATIONS.cancelPacket,
        requestId: args.requestId,
        factoryPacketId: args.factoryPacketId,
      },
      uniqueness: [],
      patch: { status: cancellation.value },
    });

    if (!outcome.ok) return refusal(outcome.error);

    if (!outcome.value.replayed) {
      const line = await ctx.tenantDb.get<LineDocument>(
        "customerOrderLines",
        packet.customerOrderLineId,
      );
      if (line !== null && line.status === "HANDED_OFF") {
        await ctx.tenantDb.patch("customerOrderLines", line._id, {
          status: "DESIGN_READY",
        });
        await appendDomainAudit(context, {
          entityTable: "customerOrderLines",
          entityId: line._id,
          changes: [
            { field: "status", from: "HANDED_OFF", to: "DESIGN_READY" },
          ],
        });
      }
    }

    return written(outcome.value);
  },
});

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

const packetValidator = v.object({
  factoryPacketId: v.id("factoryPackets"),
  warehouseId: v.id("warehouses"),
  packetNumber: v.string(),
  customerOrderLineId: v.id("customerOrderLines"),
  customerId: v.id("customers"),
  customerOrderNumber: v.string(),
  customerReference: v.optional(v.string()),
  masterCardRevisionId: v.id("masterCardRevisions"),
  revisionNumber: v.number(),
  specification: boxSpecification,
  approvedFileIds: v.array(v.id("masterCardFiles")),
  releaseEvidence: v.object({
    releasedByUserId: v.id("users"),
    releasedAt: v.number(),
    decisionNote: v.optional(v.string()),
  }),
  quantity: v.number(),
  status: factoryPacketStatus,
  issuedByUserId: v.id("users"),
  acknowledgedByUserId: v.optional(v.id("users")),
  acknowledgedAt: v.optional(v.number()),
});

/**
 * The packets at one site, in packet-number order.
 *
 * This remains the only query a production screen calls. The server joins each
 * bounded page to authoritative order-line, order, immutable revision, and file
 * junction rows; production roles still hold no engineering endpoint permission.
 */
export const listFactoryPackets = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    status: v.optional(factoryPacketStatus),
    ...listArgs,
  },
  returns: pageOf(packetValidator),
  permissionCode: "production.packet.read",
  target: { table: "factoryPackets" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const request = pageRequestOf(args);
    if (!request.ok) return pageRefusal(request.error.code);

    const page = await ctx.tenantDb
      .byIndex<PacketDocument>(
        "factoryPackets",
        "by_orgId_warehouseId_status_packetNumber",
        [
          { field: "warehouseId", value: args.warehouseId },
          ...(args.status === undefined
            ? []
            : [{ field: "status", value: args.status }]),
        ],
      )
      .page(pageOptions(request.value));

    const items = [];
    for (const packet of page.page) {
      const line = await ctx.tenantDb.get<LineDocument>(
        "customerOrderLines",
        packet.customerOrderLineId,
      );
      if (line === null) return pageRefusal("REFERENCE_NOT_FOUND");
      const order = await ctx.tenantDb.get<OrderDocument>(
        "customerOrders",
        line.customerOrderId,
      );
      if (order === null) return pageRefusal("REFERENCE_NOT_FOUND");
      const revision = await ctx.tenantDb.get<RevisionDocument>(
        "masterCardRevisions",
        packet.masterCardRevisionId,
      );
      if (
        revision === null ||
        revision.decidedByUserId === undefined ||
        revision.decidedAt === undefined
      ) {
        return pageRefusal("REFERENCE_NOT_FOUND");
      }
      const packetFiles = await ctx.tenantDb
        .byIndex<PacketFileDocument>(
          "factoryPacketFiles",
          "by_orgId_factoryPacketId_masterCardFileId",
          [{ field: "factoryPacketId", value: packet._id }],
        )
        .take(MAX_FILES_PER_REVISION);
      items.push({
        factoryPacketId: packet._id as never,
        warehouseId: packet.warehouseId as never,
        packetNumber: packet.packetNumber,
        customerOrderLineId: packet.customerOrderLineId as never,
        customerId: order.customerId as never,
        customerOrderNumber: order.orderNumber,
        ...(order.customerReference === undefined
          ? {}
          : { customerReference: order.customerReference }),
        masterCardRevisionId: packet.masterCardRevisionId as never,
        revisionNumber: revision.revisionNumber,
        specification: revision.specification as never,
        approvedFileIds: packetFiles.map(
          (association) => association.masterCardFileId as never,
        ),
        releaseEvidence: {
          releasedByUserId: revision.decidedByUserId as never,
          releasedAt: revision.decidedAt,
          ...(revision.decisionNote === undefined
            ? {}
            : { decisionNote: revision.decisionNote }),
        },
        quantity: line.orderedQuantity,
        status: packet.status as never,
        issuedByUserId: packet.issuedByUserId as never,
        ...(packet.acknowledgedByUserId === undefined
          ? {}
          : { acknowledgedByUserId: packet.acknowledgedByUserId as never }),
        ...(packet.acknowledgedAt === undefined
          ? {}
          : { acknowledgedAt: packet.acknowledgedAt }),
      });
    }

    return {
      ok: true as const,
      items,
      nextCursor: page.isDone ? null : page.continueCursor,
      complete: page.isDone,
    };
  },
});

const packetFileAccessValidator = v.union(
  v.object({
    granted: v.literal(true),
    url: v.string(),
    expiresAt: v.number(),
  }),
  v.object({
    granted: v.literal(false),
    error: v.object({
      code: v.string(),
      field: v.optional(v.string()),
      reason: v.optional(v.string()),
    }),
  }),
);

/** Mint an audited one-use download for a file pinned into this packet. */
export const requestFactoryPacketFileAccess = mutationWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    factoryPacketId: v.id("factoryPackets"),
    masterCardFileId: v.id("masterCardFiles"),
  },
  returns: packetFileAccessValidator,
  permissionCode: "production.packet.read",
  target: {
    table: "factoryPackets",
    id: ({ factoryPacketId }) => factoryPacketId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const packet = await ctx.tenantDb.get<PacketDocument>(
      "factoryPackets",
      args.factoryPacketId,
    );
    if (packet === null || packet.warehouseId !== args.warehouseId) {
      return {
        granted: false as const,
        error: { code: "NOT_FOUND", field: "masterCardFileId" },
      };
    }
    const approval = await ctx.tenantDb
      .byIndex<PacketFileDocument>(
        "factoryPacketFiles",
        "by_orgId_factoryPacketId_masterCardFileId",
        [
          { field: "factoryPacketId", value: args.factoryPacketId },
          { field: "masterCardFileId", value: args.masterCardFileId },
        ],
      )
      .first();
    if (approval === null) {
      return {
        granted: false as const,
        error: { code: "NOT_FOUND", field: "masterCardFileId" },
      };
    }
    const file = await ctx.tenantDb.get<
      FileDocument & { readonly storageId?: string }
    >("masterCardFiles", args.masterCardFileId);
    if (
      file === null ||
      file.storageState !== "AVAILABLE" ||
      file.storageId === undefined ||
      (await ctx.privateFiles.createDownloadUrl(file.storageId)) === null
    ) {
      return {
        granted: false as const,
        error: { code: "FILE_NOT_RETRIEVABLE", field: "masterCardFileId" },
      };
    }
    const siteUrl = process.env.CONVEX_SITE_URL;
    if (siteUrl === undefined || siteUrl.trim().length === 0) {
      return {
        granted: false as const,
        error: { code: "FILE_GATEWAY_NOT_CONFIGURED" },
      };
    }
    const context = writeContextOf(ctx, {
      table: "masterCardFileAccessGrants",
      operation: PRODUCTION_PACKET_OPERATIONS.accessApprovedFile,
      requestId: ctx.requestId,
    });
    const expiresAt = context.now + FILE_ACCESS_GRANT_LIFETIME_MS;
    const document = {
      masterCardFileId: args.masterCardFileId,
      issuedToUserId: context.actorUserId,
      expiresAt,
    };
    const grantId = await ctx.tenantDb.insert(
      "masterCardFileAccessGrants",
      document,
    );
    await appendDomainAudit(context, {
      entityTable: "masterCardFileAccessGrants",
      entityId: grantId,
      changes: insertedFields(document),
    });
    return {
      granted: true as const,
      url: `${siteUrl.replace(/\/$/, "")}/private-master-card-file?grantId=${encodeURIComponent(grantId)}`,
      expiresAt,
    };
  },
});
