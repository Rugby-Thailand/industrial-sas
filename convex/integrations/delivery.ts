import { v, type GenericId } from "convex/values";

import { sha256Hex } from "../lib/idempotency";
import {
  mutationWithOrg,
  queryWithOrg,
  type TenantFunctionContext,
} from "../lib/tenantFunctions";
import type { TenantDocumentAccess, TenantOrgId } from "../lib/tenantDb";
import {
  integrationAdapterKind,
  integrationAdapterStatus,
} from "../lib/validators";
import { refusal, writeOutcomeValidator, written } from "../lib/writeEnvelope";
import {
  claimDelivery,
  recordDeliveryResult,
  retryDeadLetter,
  type DeliveryState,
} from "../model/integrations/delivery";

const MAX_ADAPTERS = 40;
const MAX_STATE_COUNT = 20;
const LEASE_MS = 60_000;

interface AdapterRow {
  readonly _id: GenericId<"integrationAdapters">;
  readonly orgId: TenantOrgId;
  readonly code: string;
  readonly displayName: string;
  readonly kind: "WEBHOOK" | "ERP" | "EMAIL" | "LINE" | "PRINTER";
  readonly status: "ENABLED" | "DEGRADED" | "DISABLED";
  readonly configurationKey: string;
  readonly lastSuccessAt?: number;
  readonly lastFailureAt?: number;
  readonly lastFailureCode?: string;
  readonly updatedAt: number;
}

interface MessageRow extends DeliveryState {
  readonly _id: GenericId<"integrationOutboxMessages">;
  readonly orgId: TenantOrgId;
  readonly eventKey: string;
  readonly adapterId: GenericId<"integrationAdapters">;
  readonly eventType: string;
  readonly schemaVersion: number;
  readonly sourceTable: string;
  readonly sourceId: string;
  readonly payloadJson: string;
  readonly payloadDigest: string;
  readonly createdAt: number;
  readonly claimedAt?: number;
  readonly claimRequestId?: string;
  readonly resultRequestId?: string;
}

const deliveryStateOf = (message: MessageRow): DeliveryState => ({
  status: message.status,
  attemptCount: message.attemptCount,
  availableAt: message.availableAt,
  ...(message.leaseExpiresAt === undefined
    ? {}
    : { leaseExpiresAt: message.leaseExpiresAt }),
  ...(message.deliveredAt === undefined
    ? {}
    : { deliveredAt: message.deliveredAt }),
  ...(message.lastFailureCode === undefined
    ? {}
    : { lastFailureCode: message.lastFailureCode }),
});

export async function enqueueOutboxMessage(input: {
  readonly tenantDb: TenantDocumentAccess;
  readonly adapterId: GenericId<"integrationAdapters">;
  readonly eventKey: string;
  readonly eventType: string;
  readonly schemaVersion: number;
  readonly sourceTable: string;
  readonly sourceId: string;
  readonly payloadJson: string;
  readonly now: number;
}): Promise<{ readonly messageId: string; readonly replayed: boolean }> {
  const existing = await input.tenantDb
    .byIndex<MessageRow>("integrationOutboxMessages", "by_orgId_eventKey", [
      { field: "eventKey", value: input.eventKey },
    ])
    .first();
  const digest = await sha256Hex(input.payloadJson);
  if (existing !== null) {
    if (
      existing.adapterId !== input.adapterId ||
      existing.eventType !== input.eventType ||
      existing.payloadDigest !== digest
    ) {
      throw new Error(
        "Integration event key was reused with different content.",
      );
    }
    return { messageId: existing._id, replayed: true };
  }
  const messageId = await input.tenantDb.insert("integrationOutboxMessages", {
    eventKey: input.eventKey,
    adapterId: input.adapterId,
    eventType: input.eventType,
    schemaVersion: input.schemaVersion,
    sourceTable: input.sourceTable,
    sourceId: input.sourceId,
    payloadJson: input.payloadJson,
    payloadDigest: digest,
    status: "PENDING",
    attemptCount: 0,
    availableAt: input.now,
    createdAt: input.now,
  });
  return { messageId, replayed: false };
}

const healthRowValidator = v.object({
  adapterId: v.id("integrationAdapters"),
  code: v.string(),
  displayName: v.string(),
  kind: integrationAdapterKind,
  status: integrationAdapterStatus,
  pending: v.number(),
  retrying: v.number(),
  delivering: v.number(),
  deadLetter: v.number(),
  lastSuccessAt: v.optional(v.number()),
  lastFailureAt: v.optional(v.number()),
  lastFailureCode: v.optional(v.string()),
  complete: v.boolean(),
});

export const listIntegrationHealth = queryWithOrg({
  args: {},
  returns: v.object({
    adapters: v.array(healthRowValidator),
    complete: v.boolean(),
    asOf: v.number(),
  }),
  permissionCode: "integration.health.read",
  target: { table: "integrationAdapters" },
  handler: async (ctx) => {
    const adapters = await ctx.tenantDb
      .byIndex<AdapterRow>("integrationAdapters", "by_orgId_status_code", [])
      .page({ limit: MAX_ADAPTERS + 1 });
    const rows = await Promise.all(
      adapters.page.slice(0, MAX_ADAPTERS).map(async (adapter) => {
        const counts = await Promise.all(
          (["PENDING", "RETRY_WAIT", "DELIVERING", "DEAD_LETTER"] as const).map(
            async (status) =>
              await ctx.tenantDb
                .byIndex<MessageRow>(
                  "integrationOutboxMessages",
                  "by_orgId_adapterId_status_availableAt",
                  [
                    { field: "adapterId", value: adapter._id },
                    { field: "status", value: status },
                  ],
                )
                .take(MAX_STATE_COUNT + 1),
          ),
        );
        return {
          adapterId: adapter._id,
          code: adapter.code,
          displayName: adapter.displayName,
          kind: adapter.kind,
          status: adapter.status,
          pending: Math.min(counts[0]!.length, MAX_STATE_COUNT),
          retrying: Math.min(counts[1]!.length, MAX_STATE_COUNT),
          delivering: Math.min(counts[2]!.length, MAX_STATE_COUNT),
          deadLetter: Math.min(counts[3]!.length, MAX_STATE_COUNT),
          ...(adapter.lastSuccessAt === undefined
            ? {}
            : { lastSuccessAt: adapter.lastSuccessAt }),
          ...(adapter.lastFailureAt === undefined
            ? {}
            : { lastFailureAt: adapter.lastFailureAt }),
          ...(adapter.lastFailureCode === undefined
            ? {}
            : { lastFailureCode: adapter.lastFailureCode }),
          complete: counts.every((items) => items.length <= MAX_STATE_COUNT),
        };
      }),
    );
    return {
      adapters: rows,
      complete:
        adapters.page.length <= MAX_ADAPTERS &&
        rows.every((row) => row.complete),
      asOf: Date.now(),
    };
  },
});

export const registerAdapter = mutationWithOrg({
  args: {
    requestId: v.string(),
    code: v.string(),
    displayName: v.string(),
    kind: integrationAdapterKind,
    configurationKey: v.string(),
  },
  returns: writeOutcomeValidator,
  permissionCode: "integration.adapter.manage",
  target: { table: "integrationAdapters" },
  handler: async (ctx, args) => {
    const code = args.code.trim().toUpperCase();
    const displayName = args.displayName.trim();
    const configurationKey = args.configurationKey.trim();
    if (!/^[A-Z][A-Z0-9_-]{1,39}$/.test(code)) {
      return refusal({ code: "FIELD_INVALID", field: "code" });
    }
    if (displayName.length < 2 || displayName.length > 120) {
      return refusal({ code: "FIELD_INVALID", field: "displayName" });
    }
    if (!/^[A-Z][A-Z0-9_]{2,79}$/.test(configurationKey)) {
      return refusal({ code: "FIELD_INVALID", field: "configurationKey" });
    }
    const existing = await ctx.tenantDb
      .byIndex<AdapterRow>("integrationAdapters", "by_orgId_code", [
        { field: "code", value: code },
      ])
      .first();
    if (existing !== null) {
      return existing.kind === args.kind &&
        existing.configurationKey === configurationKey
        ? written({ documentId: existing._id, replayed: true })
        : refusal({ code: "DUPLICATE_KEY", field: "code" });
    }
    const id = await ctx.tenantDb.insert("integrationAdapters", {
      code,
      displayName,
      kind: args.kind,
      status: "DISABLED",
      configurationKey,
      updatedByUserId: ctx.tenant.actor._id,
      updatedAt: Date.now(),
    });
    return written({ documentId: id, replayed: false });
  },
});

export const setAdapterStatus = mutationWithOrg({
  args: {
    requestId: v.string(),
    adapterId: v.id("integrationAdapters"),
    status: v.union(v.literal("ENABLED"), v.literal("DISABLED")),
  },
  returns: writeOutcomeValidator,
  permissionCode: "integration.adapter.manage",
  target: { table: "integrationAdapters", id: ({ adapterId }) => adapterId },
  handler: async (ctx, args) => {
    const adapter = await ctx.tenantDb.get<AdapterRow>(
      "integrationAdapters",
      args.adapterId,
    );
    if (adapter === null)
      return refusal({ code: "NOT_FOUND", table: "integrationAdapters" });
    if (adapter.status === args.status) {
      return written({ documentId: adapter._id, replayed: true });
    }
    await ctx.tenantDb.patch("integrationAdapters", adapter._id, {
      status: args.status,
      updatedByUserId: ctx.tenant.actor._id,
      updatedAt: Date.now(),
    });
    return written({ documentId: adapter._id, replayed: false });
  },
});

export const claimMessage = mutationWithOrg({
  args: {
    requestId: v.string(),
    messageId: v.id("integrationOutboxMessages"),
  },
  returns: writeOutcomeValidator,
  permissionCode: "integration.delivery.dispatch",
  target: {
    table: "integrationOutboxMessages",
    id: ({ messageId }) => messageId,
  },
  handler: async (ctx, args) => {
    const message = await ctx.tenantDb.get<MessageRow>(
      "integrationOutboxMessages",
      args.messageId,
    );
    if (message === null)
      return refusal({ code: "NOT_FOUND", table: "integrationOutboxMessages" });
    if (message.claimRequestId === args.requestId) {
      return written({ documentId: message._id, replayed: true });
    }
    const adapter = await ctx.tenantDb.get<AdapterRow>(
      "integrationAdapters",
      message.adapterId,
    );
    if (adapter === null || adapter.status === "DISABLED") {
      return refusal({ code: "ADAPTER_DISABLED" });
    }
    const now = Date.now();
    const next = claimDelivery(deliveryStateOf(message), now, LEASE_MS);
    if (!next.ok) return refusal({ code: next.error.code });
    await ctx.tenantDb.patch("integrationOutboxMessages", message._id, {
      ...next.value,
      claimedAt: now,
      claimRequestId: args.requestId,
    });
    return written({ documentId: message._id, replayed: false });
  },
});

export const recordDeliveryOutcome = mutationWithOrg({
  args: {
    requestId: v.string(),
    messageId: v.id("integrationOutboxMessages"),
    correlationId: v.string(),
    outcome: v.union(
      v.literal("DELIVERED"),
      v.literal("RETRYABLE_FAILURE"),
      v.literal("PERMANENT_FAILURE"),
    ),
    errorCode: v.optional(v.string()),
    responseStatus: v.optional(v.number()),
  },
  returns: writeOutcomeValidator,
  permissionCode: "integration.delivery.dispatch",
  target: {
    table: "integrationOutboxMessages",
    id: ({ messageId }) => messageId,
  },
  handler: async (ctx, args) => {
    const message = await ctx.tenantDb.get<MessageRow>(
      "integrationOutboxMessages",
      args.messageId,
    );
    if (message === null)
      return refusal({ code: "NOT_FOUND", table: "integrationOutboxMessages" });
    if (message.resultRequestId === args.requestId) {
      return written({ documentId: message._id, replayed: true });
    }
    const now = Date.now();
    const failureCode = args.errorCode?.trim();
    const next = recordDeliveryResult(
      deliveryStateOf(message),
      args.outcome,
      now,
      failureCode,
    );
    if (!next.ok) return refusal({ code: next.error.code });
    await ctx.tenantDb.insert("integrationDeliveryAttempts", {
      messageId: message._id,
      adapterId: message.adapterId,
      attemptNumber: message.attemptCount,
      correlationId: args.correlationId.trim().slice(0, 128),
      outcome: args.outcome,
      startedAt: message.claimedAt ?? now,
      finishedAt: now,
      ...(failureCode === undefined || failureCode.length === 0
        ? {}
        : { errorCode: failureCode.slice(0, 80) }),
      ...(args.responseStatus === undefined
        ? {}
        : { responseStatus: args.responseStatus }),
      actorUserId: ctx.tenant.actor._id,
    });
    await ctx.tenantDb.patch("integrationOutboxMessages", message._id, {
      ...next.value,
      resultRequestId: args.requestId,
    });
    await ctx.tenantDb.patch("integrationAdapters", message.adapterId, {
      status: args.outcome === "DELIVERED" ? "ENABLED" : "DEGRADED",
      ...(args.outcome === "DELIVERED"
        ? { lastSuccessAt: now }
        : {
            lastFailureAt: now,
            lastFailureCode: failureCode ?? "PROVIDER_FAILURE",
          }),
      updatedByUserId: ctx.tenant.actor._id,
      updatedAt: now,
    });
    return written({ documentId: message._id, replayed: false });
  },
});

export const retryMessage = mutationWithOrg({
  args: {
    requestId: v.string(),
    messageId: v.id("integrationOutboxMessages"),
  },
  returns: writeOutcomeValidator,
  permissionCode: "integration.delivery.retry",
  target: {
    table: "integrationOutboxMessages",
    id: ({ messageId }) => messageId,
  },
  handler: async (ctx: TenantFunctionContext, args) => {
    const message = await ctx.tenantDb.get<MessageRow>(
      "integrationOutboxMessages",
      args.messageId,
    );
    if (message === null)
      return refusal({ code: "NOT_FOUND", table: "integrationOutboxMessages" });
    if (message.resultRequestId === args.requestId) {
      return written({ documentId: message._id, replayed: true });
    }
    const next = retryDeadLetter(deliveryStateOf(message), Date.now());
    if (!next.ok) return refusal({ code: next.error.code });
    await ctx.tenantDb.patch("integrationOutboxMessages", message._id, {
      ...next.value,
      resultRequestId: args.requestId,
    });
    return written({ documentId: message._id, replayed: false });
  },
});
