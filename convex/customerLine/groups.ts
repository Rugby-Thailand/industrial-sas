import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import { grantedPermissionsAmong } from "../lib/navigationGrants";
import { CUSTOMER_LINE_PERMISSION } from "../lib/permissions";
import {
  mutationWithOrg,
  queryWithOrg,
  type TenantFunctionContext,
} from "../lib/tenantFunctions";
import { NAVIGATION_PERMISSION } from "../model/authorization/navigationPermissions";
import {
  CAPABILITY_GRANTS,
  isLiveEnrollment,
  LIMITS,
  projectConnection,
  projectContact,
  projectGroup,
  projectQuestion,
  replyBlocker,
  type Connection,
  type Contact,
  type Group,
  type Question,
} from "./policy";
import { connectionState } from "./schema";
import { deliverReplyReference } from "./transportReferences";
import {
  connectionView,
  contactView,
  groupView,
  mutationResult,
  pageOf,
  questionView,
} from "./validators";

const refused = (code: string) => ({ code });
const MAX_CONTACT_NAME = 80;

async function holds(
  ctx: TenantFunctionContext,
  codes: readonly string[],
): Promise<boolean> {
  const granted = await grantedPermissionsAmong(ctx, codes);
  return codes.every((code) => granted.includes(code));
}

async function primaryConnection(
  ctx: TenantFunctionContext,
): Promise<Connection | null> {
  const rows = await ctx.tenantDb
    .byIndex<Connection>("customerLineConnections", "by_orgId_primary", [
      { field: "primary", value: true },
    ])
    .take(2);
  // More than one primary is a broken invariant; show none rather than guess.
  return rows.length === 1 ? rows[0]! : null;
}

/** The group, only as the live or historical row of the primary OA. */
async function primaryGroup(
  ctx: TenantFunctionContext,
  groupId: string,
): Promise<{ group: Group; connection: Connection } | null> {
  const [group, connection] = await Promise.all([
    ctx.tenantDb.get<Group>("customerLineGroups", groupId),
    primaryConnection(ctx),
  ]);
  if (group === null || connection === null) return null;
  if (group.connectionId !== connection._id || !group.current) return null;
  return { group, connection };
}

async function customerName(
  ctx: TenantFunctionContext,
  customerId: Id<"customers"> | undefined,
): Promise<string | undefined> {
  if (customerId === undefined) return undefined;
  const customer = await ctx.tenantDb.get<Doc<"customers">>(
    "customers",
    customerId,
  );
  return customer?.name;
}

const readGate = {
  permissionCode: CUSTOMER_LINE_PERMISSION.read,
  target: { table: "customerLineGroups" },
} as const;

export const viewer = queryWithOrg({
  permissionCode: NAVIGATION_PERMISSION.customers,
  target: { table: "customerLineGroups" },
  args: {},
  returns: v.object({
    canRead: v.boolean(),
    canManageGroups: v.boolean(),
    canSend: v.boolean(),
    canManageConnection: v.boolean(),
  }),
  handler: async (ctx) => {
    const granted = new Set<string>(
      await grantedPermissionsAmong(ctx, [
        CUSTOMER_LINE_PERMISSION.read,
        CUSTOMER_LINE_PERMISSION.manageGroups,
        CUSTOMER_LINE_PERMISSION.send,
        CUSTOMER_LINE_PERMISSION.manageConnection,
      ]),
    );
    const canRead = granted.has(CUSTOMER_LINE_PERMISSION.read);
    return {
      canRead,
      canManageGroups:
        canRead && granted.has(CUSTOMER_LINE_PERMISSION.manageGroups),
      canSend: canRead && granted.has(CUSTOMER_LINE_PERMISSION.send),
      canManageConnection: granted.has(
        CUSTOMER_LINE_PERMISSION.manageConnection,
      ),
    };
  },
});

const emptyPage = { page: [], continueCursor: null };

export const listGroups = queryWithOrg({
  ...readGate,
  args: { customerId: v.optional(v.string()), cursor: v.optional(v.string()) },
  returns: pageOf(groupView),
  handler: async (ctx, { customerId, cursor }) => {
    if (!(await holds(ctx, CAPABILITY_GRANTS.read))) return emptyPage;
    const connection = await primaryConnection(ctx);
    if (connection === null) return emptyPage;
    let customer: Doc<"customers"> | null = null;
    if (customerId !== undefined) {
      customer = await ctx.tenantDb.get<Doc<"customers">>(
        "customers",
        customerId,
      );
      // Archived customers expose no LINE groups in their overview.
      if (customer === null || customer.status !== "ACTIVE") return emptyPage;
    }
    const result = await (
      customer === null
        ? ctx.tenantDb.byIndex<Group>(
            "customerLineGroups",
            "by_orgId_connectionId_current_lastActivityAt",
            [
              { field: "connectionId", value: connection._id },
              { field: "current", value: true },
            ],
          )
        : ctx.tenantDb.byIndex<Group>(
            "customerLineGroups",
            "by_orgId_connectionId_customerId_current_lastActivityAt",
            [
              { field: "connectionId", value: connection._id },
              { field: "customerId", value: customer._id },
              { field: "current", value: true },
            ],
          )
    ).page({ limit: LIMITS.page, cursor, order: "desc" });
    const names = new Map<string, string | undefined>();
    const page = [];
    for (const group of result.page) {
      // A customer filter shows only approved enrollments of that customer.
      if (customer !== null && group.state === "pending") continue;
      const id = group.customerId;
      if (id !== undefined && !names.has(id))
        names.set(id, await customerName(ctx, id));
      page.push(
        projectGroup(group, id === undefined ? undefined : names.get(id)),
      );
    }
    return {
      page,
      continueCursor: result.isDone ? null : result.continueCursor,
    };
  },
});

/** Recent unassigned joins for the customer-specific connect flow. */
export const listPendingGroups = queryWithOrg({
  permissionCode: CUSTOMER_LINE_PERMISSION.manageGroups,
  target: { table: "customerLineGroups" },
  args: { cursor: v.optional(v.string()) },
  returns: pageOf(groupView),
  handler: async (ctx, { cursor }) => {
    if (!(await holds(ctx, CAPABILITY_GRANTS.manageGroups))) return emptyPage;
    const connection = await primaryConnection(ctx);
    if (connection?.state !== "active") return emptyPage;
    const result = await ctx.tenantDb
      .byIndex<Group>(
        "customerLineGroups",
        "by_orgId_connectionId_state_current_lastActivityAt",
        [
          { field: "connectionId", value: connection._id },
          { field: "state", value: "pending" },
          { field: "current", value: true },
        ],
      )
      .page({ limit: LIMITS.page, cursor, order: "desc" });
    return {
      page: result.page.map((group) => projectGroup(group)),
      continueCursor: result.isDone ? null : result.continueCursor,
    };
  },
});

export const getGroup = queryWithOrg({
  ...readGate,
  args: { groupId: v.string() },
  returns: v.union(v.null(), groupView),
  handler: async (ctx, { groupId }) => {
    if (!(await holds(ctx, CAPABILITY_GRANTS.read))) return null;
    const found = await primaryGroup(ctx, groupId);
    if (found === null) return null;
    return projectGroup(
      found.group,
      await customerName(ctx, found.group.customerId),
    );
  },
});

export const listQuestions = queryWithOrg({
  ...readGate,
  args: { groupId: v.string(), cursor: v.optional(v.string()) },
  returns: pageOf(questionView),
  handler: async (ctx, { groupId, cursor }) => {
    if (!(await holds(ctx, CAPABILITY_GRANTS.read))) return emptyPage;
    const found = await primaryGroup(ctx, groupId);
    // A pending enrollment has no conversation content.
    if (found === null || found.group.state === "pending") return emptyPage;
    const result = await ctx.tenantDb
      .byIndex<Question>(
        "customerLineQuestions",
        "by_orgId_groupId_createdAt",
        [{ field: "groupId", value: found.group._id }],
      )
      .page({ limit: LIMITS.page, cursor, order: "desc" });
    return {
      page: result.page.map(projectQuestion),
      continueCursor: result.isDone ? null : result.continueCursor,
    };
  },
});

export const listContacts = queryWithOrg({
  ...readGate,
  args: { groupId: v.string(), cursor: v.optional(v.string()) },
  returns: pageOf(contactView),
  handler: async (ctx, { groupId, cursor }) => {
    if (!(await holds(ctx, CAPABILITY_GRANTS.read))) return emptyPage;
    const found = await primaryGroup(ctx, groupId);
    if (found === null || found.group.state === "pending") return emptyPage;
    const result = await ctx.tenantDb
      .byIndex<Contact>("customerLineContacts", "by_orgId_groupId_ordinal", [
        { field: "groupId", value: found.group._id },
      ])
      .page({ limit: LIMITS.page, cursor });
    return {
      page: result.page.map(projectContact),
      continueCursor: result.isDone ? null : result.continueCursor,
    };
  },
});

export const getPrimaryConnection = queryWithOrg({
  permissionCode: CUSTOMER_LINE_PERMISSION.manageConnection,
  target: { table: "customerLineConnections" },
  args: {},
  returns: v.union(v.null(), connectionView),
  handler: async (ctx) => {
    if (!(await holds(ctx, CAPABILITY_GRANTS.manageConnection))) return null;
    const connection = await primaryConnection(ctx);
    return connection === null ? null : projectConnection(connection);
  },
});

/** Readiness and invite handle for staff without connection grants. */
export const getPrimaryConnectionSummary = queryWithOrg({
  ...readGate,
  args: {},
  returns: v.union(
    v.null(),
    v.object({ name: v.string(), basicId: v.string(), state: connectionState }),
  ),
  handler: async (ctx) => {
    if (!(await holds(ctx, CAPABILITY_GRANTS.read))) return null;
    const connection = await primaryConnection(ctx);
    return connection === null
      ? null
      : {
          name: connection.name,
          basicId: connection.basicId,
          state: connection.state,
        };
  },
});

/** Stop queued replies that have not been handed to transport. */
async function cancelQueuedReplies(
  ctx: TenantFunctionContext,
  groupId: Id<"customerLineGroups">,
  now: number,
) {
  const queued = await ctx.tenantDb
    .byIndex<Question>("customerLineQuestions", "by_orgId_groupId_state", [
      { field: "groupId", value: groupId },
      { field: "state", value: "queued" },
    ])
    .take(LIMITS.page);
  for (const question of queued) {
    // A leased reply is stopped by the version gate in `authorizeReply`.
    if (question.leaseExpiresAt !== undefined && question.leaseExpiresAt > now)
      continue;
    await ctx.tenantDb.patch("customerLineQuestions", question._id, {
      state: question.attempts > 0 ? "unknown" : "canceled",
      leaseId: undefined,
      leaseExpiresAt: undefined,
      finishedAt: now,
    });
  }
}

const manageGroupsGate = {
  permissionCode: CUSTOMER_LINE_PERMISSION.manageGroups,
  returns: mutationResult,
} as const;
const targetGroup = {
  table: "customerLineGroups",
  id: ({ groupId }: { groupId: string }) => groupId,
} as const;

export const approveGroup = mutationWithOrg({
  ...manageGroupsGate,
  target: targetGroup,
  args: {
    groupId: v.string(),
    customerId: v.string(),
    expectedVersion: v.number(),
    confirmed: v.literal(true),
  },
  handler: async (ctx, { groupId, customerId, expectedVersion }) => {
    if (!(await holds(ctx, CAPABILITY_GRANTS.manageGroups)))
      return refused("FORBIDDEN");
    const found = await primaryGroup(ctx, groupId);
    if (found === null || !isLiveEnrollment(found.group))
      return refused("GROUP_STALE");
    const { group, connection } = found;
    if (group.version !== expectedVersion) return refused("VERSION_CONFLICT");
    if (group.state !== "pending") return refused("GROUP_NOT_PENDING");
    if (connection.state !== "active") return refused("CONNECTION_NOT_READY");
    const customer = await ctx.tenantDb.get<Doc<"customers">>(
      "customers",
      customerId,
    );
    if (customer === null || customer.status !== "ACTIVE")
      return refused("CUSTOMER_UNAVAILABLE");
    const now = Date.now();
    await ctx.tenantDb.patch("customerLineGroups", group._id, {
      state: "active",
      customerId: customer._id,
      version: group.version + 1,
      approvedAt: now,
      approvedByUserId: ctx.tenant.actor._id,
      updatedAt: now,
    });
    return null;
  },
});

export const setGroupState = mutationWithOrg({
  ...manageGroupsGate,
  returns: v.union(mutationResult, v.object({ groupId: v.string() })),
  target: targetGroup,
  args: {
    groupId: v.string(),
    expectedVersion: v.number(),
    state: v.union(
      v.literal("active"),
      v.literal("paused"),
      v.literal("disconnected"),
      v.literal("pending"),
    ),
  },
  handler: async (ctx, { groupId, expectedVersion, state }) => {
    if (!(await holds(ctx, CAPABILITY_GRANTS.manageGroups)))
      return refused("FORBIDDEN");
    const found = await primaryGroup(ctx, groupId);
    // A provider leave or rejoin retires the enrollment: nothing to change.
    if (found === null || !isLiveEnrollment(found.group))
      return refused("GROUP_STALE");
    const { group, connection } = found;
    if (group.version !== expectedVersion) return refused("VERSION_CONFLICT");
    // A staff-disconnected group the bot is still in may only restart as a
    // fresh enrollment; a provider leave already failed the live check above.
    if (group.state === "disconnected" && state !== "pending")
      return refused("GROUP_DISCONNECTED");
    if (group.state === state && state !== "pending") return null;
    const now = Date.now();
    const base = { version: group.version + 1, updatedAt: now };
    if (state === "active") {
      // Resume only; approval goes through `approveGroup`.
      if (group.state !== "paused") return refused("INVALID_TRANSITION");
      const customer = await ctx.tenantDb.get<Doc<"customers">>(
        "customers",
        group.customerId ?? "",
      );
      if (customer === null || customer.status !== "ACTIVE")
        return refused("CUSTOMER_UNAVAILABLE");
      await ctx.tenantDb.patch("customerLineGroups", group._id, {
        ...base,
        state,
      });
      return null;
    }
    if (state === "paused" && group.state !== "active")
      return refused("INVALID_TRANSITION");
    if (state === "pending") {
      if (group.state === "pending") return null;
      if (connection.state === "disconnected")
        return refused("CONNECTION_NOT_READY");
      // Reapproval is a fresh enrollment: the retired row keeps its customer,
      // questions and contacts, none of which the new approval can reach.
      await ctx.tenantDb.patch("customerLineGroups", group._id, {
        ...base,
        current: false,
      });
      const newGroupId = await ctx.tenantDb.insert("customerLineGroups", {
        connectionId: group.connectionId,
        lineGroupId: group.lineGroupId,
        current: true,
        name: group.name,
        state: "pending",
        version: 1,
        joinedAt: group.joinedAt,
        lifecycleAt: group.lifecycleAt,
        lastActivityAt: now,
        contactCount: 0,
        updatedAt: now,
      });
      await cancelQueuedReplies(ctx, group._id, now);
      return { groupId: newGroupId };
    }
    // No provider leave is sent in this release; `providerDeparture` is set
    // only by a signed LINE leave. Staff remove the bot in LINE themselves.
    await ctx.tenantDb.patch("customerLineGroups", group._id, {
      ...base,
      state,
    });
    await cancelQueuedReplies(ctx, group._id, now);
    return null;
  },
});

export const setContact = mutationWithOrg({
  ...manageGroupsGate,
  target: targetGroup,
  args: {
    groupId: v.string(),
    contactId: v.string(),
    verified: v.boolean(),
    name: v.optional(v.string()),
  },
  handler: async (ctx, { groupId, contactId, verified, name }) => {
    if (!(await holds(ctx, CAPABILITY_GRANTS.manageGroups)))
      return refused("FORBIDDEN");
    const found = await primaryGroup(ctx, groupId);
    if (found === null || !isLiveEnrollment(found.group))
      return refused("GROUP_STALE");
    if (found.group.state === "pending" || found.group.state === "disconnected")
      return refused("GROUP_NOT_ACTIVE");
    const contact = await ctx.tenantDb.get<Contact>(
      "customerLineContacts",
      contactId,
    );
    if (contact === null || contact.groupId !== found.group._id)
      return refused("CONTACT_NOT_FOUND");
    // Only someone currently in the group can be confirmed; revoking a
    // departed contact stays allowed.
    if (verified && !contact.present) return refused("CONTACT_LEFT");
    const trimmed = name?.trim().replace(/\s+/g, " ");
    if (
      trimmed !== undefined &&
      (trimmed.length === 0 || trimmed.length > MAX_CONTACT_NAME)
    )
      return refused("INVALID_NAME");
    // Verification names a person staff confirmed; a LINE label is no proof.
    if (verified && trimmed === undefined) return refused("NAME_REQUIRED");
    await ctx.tenantDb.patch("customerLineContacts", contact._id, {
      verification: verified ? "verified" : "revoked",
      ...(trimmed === undefined ? {} : { name: trimmed }),
      ...(verified
        ? { verifiedAt: Date.now(), verifiedByUserId: ctx.tenant.actor._id }
        : { verifiedAt: undefined, verifiedByUserId: undefined }),
    });
    return null;
  },
});

export const queueReply = mutationWithOrg({
  permissionCode: CUSTOMER_LINE_PERMISSION.send,
  returns: mutationResult,
  target: targetGroup,
  args: {
    groupId: v.string(),
    questionId: v.string(),
    text: v.string(),
    confirmedAudience: v.literal(true),
  },
  handler: async (ctx, { groupId, questionId, text }) => {
    if (!(await holds(ctx, CAPABILITY_GRANTS.send)))
      return refused("FORBIDDEN");
    const reply = text.trim();
    if (reply.length === 0 || reply.length > LIMITS.replyText)
      return refused("INVALID_TEXT");
    const found = await primaryGroup(ctx, groupId);
    const customer =
      found?.group.customerId === undefined
        ? null
        : await ctx.tenantDb.get<Doc<"customers">>(
            "customers",
            found.group.customerId,
          );
    const blocker = replyBlocker(
      found?.group ?? null,
      found?.connection ?? null,
      customer,
    );
    if (blocker !== null) return refused(blocker);
    const { group, connection } = found!;
    const question = await ctx.tenantDb.get<Question>(
      "customerLineQuestions",
      questionId,
    );
    // A reply always goes to the group the question came from.
    if (question === null || question.groupId !== group._id || !question.text)
      return refused("QUESTION_NOT_FOUND");
    const now = Date.now();
    if (question.state === "unknown") {
      // Same key and same text only, so a delivered reply is never doubled.
      if (
        question.replyText !== reply ||
        question.queuedAt === undefined ||
        now - question.queuedAt > LIMITS.retryWindowMs
      )
        return refused("DELIVERY_UNCERTAIN");
    } else if (question.state !== "open" && question.state !== "failed") {
      return refused("QUESTION_NOT_OPEN");
    }
    const sameSeries = question.state === "unknown";
    await ctx.tenantDb.patch("customerLineQuestions", question._id, {
      state: "queued",
      replyText: reply,
      retryKey: question.retryKey ?? crypto.randomUUID(),
      queuedAt: sameSeries ? question.queuedAt! : now,
      queuedByUserId: ctx.tenant.actor._id,
      queuedGroupVersion: group.version,
      queuedConnectionRevision: connection.revision,
      queuedCustomerVersion: customer!.version,
      leaseId: undefined,
      leaseExpiresAt: undefined,
      finishedAt: undefined,
      ...(sameSeries ? {} : { attempts: 0 }),
    });
    const delivery = { questionId: question._id };
    await ctx.scheduler!.runAfter(0, deliverReplyReference, delivery);
    // Retry dispatch independently in case the first action fails before claiming.
    await ctx.scheduler!.runAfter(
      LIMITS.leaseMs,
      deliverReplyReference,
      delivery,
    );
    return null;
  },
});

export const disconnectConnection = mutationWithOrg({
  permissionCode: CUSTOMER_LINE_PERMISSION.manageConnection,
  returns: mutationResult,
  target: {
    table: "customerLineConnections",
    id: ({ connectionId }: { connectionId: string }) => connectionId,
  },
  args: { connectionId: v.string() },
  handler: async (ctx, { connectionId }) => {
    if (!(await holds(ctx, CAPABILITY_GRANTS.manageConnection)))
      return refused("FORBIDDEN");
    const connection = await ctx.tenantDb.get<Connection>(
      "customerLineConnections",
      connectionId,
    );
    if (connection === null) return refused("CONNECTION_NOT_FOUND");
    if (connection.state === "disconnected") return null;
    // Groups keep their history and approval; nothing is sent until a
    // reconnect proves the webhook and a test send again.
    await ctx.tenantDb.patch("customerLineConnections", connection._id, {
      state: "disconnected",
      revision: connection.revision + 1,
      sealedVerifier: undefined,
      sealedSender: undefined,
      webhookVerifiedAt: undefined,
      testSentAt: undefined,
      updatedAt: Date.now(),
      updatedByUserId: ctx.tenant.actor._id,
    });
    return null;
  },
});
