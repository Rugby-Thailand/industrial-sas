import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";
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
  pageResult,
  pageRequestOf,
} from "../lib/listEnvelope";
import { mutationWithOrg, queryWithOrg } from "../lib/tenantFunctions";
import { boxSpecification, factoryPacketStatus } from "../lib/validators";
import {
  refusal,
  writeContextOf,
  writeOutcomeValidator,
  written,
} from "../lib/writeEnvelope";
import { MAX_FILES_PER_REVISION } from "../model/orderToShip/masterCardFile";
import {
  checkPacketAcknowledgement,
  checkPacketCancellation,
  checkPacketIssue,
} from "../model/orderToShip/factoryPacket";

export const PRODUCTION_PACKET_OPERATIONS = Object.freeze({
  issuePacket: "production.packet.issue",
  acknowledgePacket: "production.packet.acknowledge",
  cancelPacket: "production.packet.cancel",
  accessApprovedFile: "production.packet.accessApprovedFile",
});

const FILE_ACCESS_GRANT_LIFETIME_MS = 5 * 60 * 1_000;

type PacketDocument = Doc<"factoryPackets">;
type LineDocument = Doc<"customerOrderLines">;
type PacketFileDocument = Doc<"factoryPacketFiles">;
type RoutedFulfillmentLineDocument = Doc<"fulfillmentLines">;
type OrderDocument = Doc<"customerOrders">;
type RevisionDocument = Doc<"masterCardRevisions">;
type FileDocument = Doc<"masterCardFiles">;

const packetNumberUniqueness = (
  packetNumber: string,
): readonly UniquenessCheck[] => [
  {
    field: "packetNumber",
    index: "by_orgId_packetNumber",
    equality: [{ field: "packetNumber", value: packetNumber }],
  },
];

const linePacketUniqueness = (
  customerOrderLineId: string,
): readonly UniquenessCheck[] => [
  {
    field: "customerOrderLineId",
    index: "by_orgId_customerOrderLineId",
    equality: [{ field: "customerOrderLineId", value: customerOrderLineId }],
  },
];

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
    const routedLine = await ctx.tenantDb
      .byIndex<RoutedFulfillmentLineDocument>(
        "fulfillmentLines",
        "by_orgId_customerOrderLineId",
        [{ field: "customerOrderLineId", value: args.customerOrderLineId }],
      )
      .unique();
    if (
      routedLine === null ||
      routedLine.warehouseId !== args.warehouseId ||
      routedLine.routeDecision !== "PRODUCTION" ||
      routedLine.productionShortageBaseMinorUnits === undefined ||
      routedLine.productionShortageBaseMinorUnits <= 0
    ) {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "customerOrderLineId",
        reason: "PRODUCTION_ROUTE_REQUIRED",
      });
    }
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
      const uploadThingVerified =
        file.uploadThingKey !== undefined && file.verifiedAt !== undefined;
      if (
        !uploadThingVerified &&
        (file.storageId === undefined ||
          (await ctx.privateFiles.inspect(file.storageId)) === null)
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
        fulfillmentLineId: routedLine._id,
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

    return pageResult(items, page);
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
    const file = await ctx.tenantDb.get<FileDocument>(
      "masterCardFiles",
      args.masterCardFileId,
    );
    if (
      file === null ||
      file.storageState !== "AVAILABLE" ||
      (file.storageId === undefined && file.uploadThingKey === undefined)
    ) {
      return {
        granted: false as const,
        error: { code: "FILE_NOT_RETRIEVABLE", field: "masterCardFileId" },
      };
    }
    const siteUrl = process.env.CONVEX_SITE_URL;
    if (
      file.storageId !== undefined &&
      (await ctx.privateFiles.createDownloadUrl(file.storageId)) === null
    ) {
      return {
        granted: false as const,
        error: { code: "FILE_NOT_RETRIEVABLE", field: "masterCardFileId" },
      };
    }
    if (
      file.storageId !== undefined &&
      (siteUrl === undefined || siteUrl.trim().length === 0)
    ) {
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
      warehouseId: args.warehouseId,
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
      url:
        file.uploadThingKey !== undefined
          ? `/api/private-files/uploadthing?scope=production&warehouseId=${encodeURIComponent(args.warehouseId)}&grantId=${encodeURIComponent(grantId)}`
          : `${siteUrl!.replace(/\/$/, "")}/private-master-card-file?grantId=${encodeURIComponent(grantId)}`,
      expiresAt,
    };
  },
});
