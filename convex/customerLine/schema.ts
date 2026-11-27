import { defineTable } from "convex/server";
import { v } from "convex/values";

import { byOrg, tenantFields } from "../lib/tenantTable";

/**
 * Customer LINE group integration.
 *
 * Every row is scoped to the connection (one LINE Official Account) it came
 * from, so a second OA never reroutes another OA's groups or replies. A group
 * row is one *enrollment*: the span between a signed bot join and the next
 * leave. A rejoin creates a new pending row and retires the old one, so stale
 * approvals, queued replies and contacts cannot carry over.
 *
 * Raw LINE identifiers (`lineGroupId`, `lineUserId`) and sealed provider
 * material never leave the backend; public queries project sanitized rows.
 */
export const connectionState = v.union(
  v.literal("setup"),
  v.literal("active"),
  v.literal("disconnected"),
);
export const groupState = v.union(
  v.literal("pending"),
  v.literal("active"),
  v.literal("paused"),
  v.literal("disconnected"),
);
export const providerDeparture = v.union(
  v.literal("pending"),
  v.literal("left"),
  v.literal("failed"),
);
export const contactVerification = v.union(
  v.literal("none"),
  v.literal("verified"),
  v.literal("revoked"),
);
export const questionState = v.union(
  v.literal("open"),
  v.literal("queued"),
  v.literal("accepted"),
  v.literal("failed"),
  v.literal("unknown"),
  v.literal("canceled"),
);

export const customerLineTables = {
  customerLineConnections: defineTable(
    tenantFields({
      botUserId: v.string(),
      basicId: v.string(),
      name: v.string(),
      state: connectionState,
      /** The single OA the first-release staff UI shows. */
      primary: v.boolean(),
      /** Opaque, stable webhook route; reused when the same bot reconnects. */
      webhookKey: v.string(),
      /** Bumped on every reconnect/disconnect so in-flight work goes stale. */
      revision: v.number(),
      /** Sealed by transport; absent while disconnected. */
      sealedVerifier: v.optional(v.string()),
      sealedSender: v.optional(v.string()),
      identityVerifiedAt: v.number(),
      webhookVerifiedAt: v.optional(v.number()),
      testSentAt: v.optional(v.number()),
      updatedAt: v.number(),
      updatedByUserId: v.id("users"),
    }),
  )
    .index("by_orgId_primary", byOrg("primary"))
    .index("by_orgId_botUserId", byOrg("botUserId"))
    .index("by_orgId_webhookKey", byOrg("webhookKey")),
  customerLineGroups: defineTable(
    tenantFields({
      connectionId: v.id("customerLineConnections"),
      lineGroupId: v.string(),
      /** Latest enrollment for this LINE group on this OA. */
      current: v.boolean(),
      name: v.string(),
      state: groupState,
      customerId: v.optional(v.id("customers")),
      version: v.number(),
      joinedAt: v.number(),
      leftAt: v.optional(v.number()),
      providerDeparture: v.optional(providerDeparture),
      /** Signed event clock of the latest lifecycle change. */
      lifecycleAt: v.number(),
      lastActivityAt: v.number(),
      approvedAt: v.optional(v.number()),
      approvedByUserId: v.optional(v.id("users")),
      contactCount: v.number(),
      updatedAt: v.number(),
    }),
  )
    .index(
      "by_orgId_connectionId_lineGroupId",
      byOrg("connectionId", "lineGroupId"),
    )
    .index(
      "by_orgId_connectionId_current_lastActivityAt",
      byOrg("connectionId", "current", "lastActivityAt"),
    )
    .index(
      "by_orgId_connectionId_customerId_current_lastActivityAt",
      byOrg("connectionId", "customerId", "current", "lastActivityAt"),
    ),
  customerLineContacts: defineTable(
    tenantFields({
      groupId: v.id("customerLineGroups"),
      lineUserId: v.string(),
      /** Per-enrollment sequence; also the list order. */
      ordinal: v.number(),
      name: v.string(),
      verification: contactVerification,
      present: v.boolean(),
      presenceAt: v.number(),
      verifiedAt: v.optional(v.number()),
      verifiedByUserId: v.optional(v.id("users")),
    }),
  )
    .index("by_orgId_groupId_lineUserId", byOrg("groupId", "lineUserId"))
    .index("by_orgId_groupId_ordinal", byOrg("groupId", "ordinal")),
  customerLineQuestions: defineTable(
    tenantFields({
      groupId: v.id("customerLineGroups"),
      contactId: v.optional(v.id("customerLineContacts")),
      messageId: v.string(),
      text: v.string(),
      senderLabel: v.string(),
      createdAt: v.number(),
      state: questionState,
      replyText: v.optional(v.string()),
      /** One stable provider retry key per question; never regenerated. */
      retryKey: v.optional(v.string()),
      queuedAt: v.optional(v.number()),
      queuedByUserId: v.optional(v.id("users")),
      /** Group version at queue time; any later group change cancels. */
      queuedGroupVersion: v.optional(v.number()),
      /** OA revision at queue time; a reconnect invalidates the reply. */
      queuedConnectionRevision: v.optional(v.number()),
      /** Customer version at queue time; archive→restore cannot revive it. */
      queuedCustomerVersion: v.optional(v.number()),
      leaseId: v.optional(v.string()),
      leaseExpiresAt: v.optional(v.number()),
      attempts: v.number(),
      acceptedRequestId: v.optional(v.string()),
      finishedAt: v.optional(v.number()),
    }),
  )
    .index("by_orgId_groupId_createdAt", byOrg("groupId", "createdAt"))
    .index("by_orgId_groupId_state", byOrg("groupId", "state"))
    .index("by_orgId_groupId_messageId", byOrg("groupId", "messageId")),
  /** Signed-event idempotency and unsend tombstones, per connection. */
  customerLineEvents: defineTable(
    tenantFields({
      connectionId: v.id("customerLineConnections"),
      eventId: v.string(),
      receivedAt: v.number(),
      unsentMessageId: v.optional(v.string()),
    }),
  )
    .index("by_orgId_connectionId_eventId", byOrg("connectionId", "eventId"))
    .index(
      "by_orgId_connectionId_unsentMessageId",
      byOrg("connectionId", "unsentMessageId"),
    ),
};

/**
 * Global webhook routing. A route resolves an opaque webhook key (or a bot
 * user ID) to exactly one owning organization; the connection itself is then
 * read under that owner's tenant prefix and cross-checked.
 */
export const customerLineGlobalTables = {
  customerLineRoutes: defineTable({
    webhookKey: v.string(),
    botUserId: v.string(),
    ownerOrganizationId: v.id("organizations"),
    connectionId: v.id("customerLineConnections"),
  })
    .index("by_webhookKey", ["webhookKey"])
    .index("by_botUserId", ["botUserId"]),
};
