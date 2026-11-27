import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import {
  actorHoldsAll,
  CAPABILITY_GRANTS,
  confirmActor,
  isLiveEnrollment,
  LIMITS,
  projectConnection,
  replyBlocker,
  trustedActor,
  type Connection,
  type Group,
  type Question,
} from "./policy";
import { deliverReplyReference } from "./transportReferences";
import { connectionView, lineEvent } from "./validators";

/**
 * Internal seam between transport (signature checks, provider calls) and the
 * core. Every handler re-derives its organization from persisted, verified
 * rows or from the authenticated identity; caller-supplied org, actor and
 * route fields are only ever compared against those, never trusted.
 */

const LINE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const WEBHOOK_KEY =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isLineId = (value: unknown): value is string =>
  typeof value === "string" && LINE_ID.test(value);
const isClock = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const label = (value: string | undefined, fallback: string, max: number) => {
  const clean = value
    ?.replace(/[\p{Cc}\p{Cf}]/gu, "")
    .trim()
    .slice(0, max);
  return clean ? clean : fallback;
};

export const findConnection = internalQuery({
  args: { webhookKey: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("customerLineConnections"),
      botUserId: v.string(),
      secretCiphertext: v.string(),
      tokenCiphertext: v.optional(v.string()),
      state: v.union(v.literal("setup"), v.literal("active")),
      revision: v.number(),
    }),
  ),
  handler: async (ctx, { webhookKey }) => {
    if (!WEBHOOK_KEY.test(webhookKey)) return null;
    const route = await ctx.db
      .query("customerLineRoutes")
      .withIndex("by_webhookKey", (q) => q.eq("webhookKey", webhookKey))
      .unique();
    if (route === null) return null;
    const [connection, organization] = await Promise.all([
      ctx.db.get("customerLineConnections", route.connectionId),
      ctx.db.get("organizations", route.ownerOrganizationId),
    ]);
    if (
      connection === null ||
      organization?.status !== "ACTIVE" ||
      connection.orgId !== route.ownerOrganizationId ||
      connection.webhookKey !== webhookKey ||
      connection.botUserId !== route.botUserId ||
      connection.state === "disconnected" ||
      connection.sealedVerifier === undefined
    )
      return null;
    return {
      _id: connection._id,
      botUserId: connection.botUserId,
      secretCiphertext: connection.sealedVerifier,
      ...(connection.sealedSender === undefined
        ? {}
        : { tokenCiphertext: connection.sealedSender }),
      state: connection.state,
      revision: connection.revision,
    };
  },
});

const trustedActorView = v.union(
  v.null(),
  v.object({ orgId: v.id("organizations"), actorId: v.id("users") }),
);

/** Run with the authenticated action caller; both grants are required. */
export const authorizeConnection = internalQuery({
  args: {},
  returns: trustedActorView,
  handler: async (ctx) => trustedActor(ctx, CAPABILITY_GRANTS.manageConnection),
});

const claimedActor = { orgId: v.string(), actorId: v.string() };

async function primaries(ctx: QueryCtx, orgId: Id<"organizations">) {
  return ctx.db
    .query("customerLineConnections")
    .withIndex("by_orgId_primary", (q) =>
      q.eq("orgId", orgId).eq("primary", true),
    )
    .take(10);
}

export const saveConnection = internalMutation({
  args: {
    ...claimedActor,
    botUserId: v.string(),
    basicId: v.string(),
    name: v.string(),
    secretCiphertext: v.string(),
    tokenCiphertext: v.string(),
    webhookKey: v.string(),
    primary: v.optional(v.boolean()),
  },
  returns: v.union(
    v.object({ ok: v.literal(true), connection: connectionView }),
    v.object({ ok: v.literal(false), code: v.string() }),
  ),
  handler: async (ctx, args) => {
    const refuse = (code: string) => ({ ok: false as const, code });
    const actor = await confirmActor(
      ctx,
      args,
      CAPABILITY_GRANTS.manageConnection,
    );
    if (actor === null) return refuse("FORBIDDEN");
    if (
      !isLineId(args.botUserId) ||
      !WEBHOOK_KEY.test(args.webhookKey) ||
      args.secretCiphertext.length === 0 ||
      args.tokenCiphertext.length === 0 ||
      args.secretCiphertext.length > 4096 ||
      args.tokenCiphertext.length > 4096
    )
      return refuse("INVALID_CONNECTION");
    const { orgId, actorId } = actor;
    const primary = args.primary ?? true;
    const now = Date.now();
    const route = await ctx.db
      .query("customerLineRoutes")
      .withIndex("by_botUserId", (q) => q.eq("botUserId", args.botUserId))
      .unique();
    // One owner per bot: another organization's OA is never adopted.
    if (route !== null && route.ownerOrganizationId !== orgId)
      return refuse("BOT_CLAIMED");
    const fields = {
      name: label(args.name, "LINE Official Account", LIMITS.groupName),
      basicId: label(args.basicId, "", 64),
      sealedVerifier: args.secretCiphertext,
      sealedSender: args.tokenCiphertext,
      state: "setup" as const,
      primary,
      identityVerifiedAt: now,
      updatedAt: now,
      updatedByUserId: actorId,
    };
    let connectionId: Id<"customerLineConnections">;
    if (route !== null) {
      // Same bot: keep its stable route and its groups; require fresh proof.
      const existing = await ctx.db.get(
        "customerLineConnections",
        route.connectionId,
      );
      if (existing === null || existing.orgId !== orgId)
        return refuse("ROUTE_BROKEN");
      if (existing.primary && !primary) return refuse("PRIMARY_ACCOUNT");
      await ctx.db.patch("customerLineConnections", existing._id, {
        ...fields,
        webhookVerifiedAt: undefined,
        testSentAt: undefined,
        revision: existing.revision + 1,
      });
      connectionId = existing._id;
    } else {
      const taken = await ctx.db
        .query("customerLineRoutes")
        .withIndex("by_webhookKey", (q) => q.eq("webhookKey", args.webhookKey))
        .first();
      if (taken !== null) return refuse("ROUTE_TAKEN");
      connectionId = await ctx.db.insert("customerLineConnections", {
        orgId,
        botUserId: args.botUserId,
        webhookKey: args.webhookKey,
        revision: 1,
        ...fields,
      });
      await ctx.db.insert("customerLineRoutes", {
        webhookKey: args.webhookKey,
        botUserId: args.botUserId,
        ownerOrganizationId: orgId,
        connectionId,
      });
    }
    // A replaced OA keeps its groups and jobs but can no longer send.
    for (const other of primary ? await primaries(ctx, orgId) : []) {
      if (other._id === connectionId) continue;
      await ctx.db.patch("customerLineConnections", other._id, {
        primary: false,
        ...(other.state === "disconnected"
          ? {}
          : {
              state: "disconnected" as const,
              revision: other.revision + 1,
              sealedVerifier: undefined,
              sealedSender: undefined,
            }),
        updatedAt: now,
        updatedByUserId: actorId,
      });
    }
    const saved = await ctx.db.get("customerLineConnections", connectionId);
    return { ok: true as const, connection: projectConnection(saved!) };
  },
});

async function latestEnrollment(
  ctx: QueryCtx,
  connection: Connection,
  lineGroupId: string,
): Promise<Group | null> {
  return ctx.db
    .query("customerLineGroups")
    .withIndex("by_orgId_connectionId_lineGroupId", (q) =>
      q
        .eq("orgId", connection.orgId)
        .eq("connectionId", connection._id)
        .eq("lineGroupId", lineGroupId),
    )
    .order("desc")
    .first();
}

async function cancelQueued(ctx: MutationCtx, group: Group, now: number) {
  const queued = await ctx.db
    .query("customerLineQuestions")
    .withIndex("by_orgId_groupId_state", (q) =>
      q.eq("orgId", group.orgId).eq("groupId", group._id).eq("state", "queued"),
    )
    .take(LIMITS.page);
  for (const question of queued) {
    if (question.leaseExpiresAt !== undefined && question.leaseExpiresAt > now)
      continue;
    await ctx.db.patch("customerLineQuestions", question._id, {
      state: question.attempts > 0 ? "unknown" : "canceled",
      leaseId: undefined,
      leaseExpiresAt: undefined,
      finishedAt: now,
    });
  }
}

type LineEvent = typeof lineEvent.type;

async function onJoin(ctx: MutationCtx, connection: Connection, e: LineEvent) {
  const latest = await latestEnrollment(ctx, connection, e.groupId);
  const now = Date.now();
  if (latest !== null) {
    if (e.timestamp <= (latest.leftAt ?? latest.lifecycleAt)) return "stale";
    if (latest.leftAt === undefined) {
      // A newer join while we believed the bot present: the leave was lost.
      await ctx.db.patch("customerLineGroups", latest._id, {
        leftAt: e.timestamp,
        state: "disconnected",
        providerDeparture: "left",
        version: latest.version + 1,
        lifecycleAt: e.timestamp,
        updatedAt: now,
      });
      await cancelQueued(ctx, latest, now);
    }
    await ctx.db.patch("customerLineGroups", latest._id, { current: false });
  }
  // Pending enrollments keep metadata only: no members, no conversation.
  await ctx.db.insert("customerLineGroups", {
    orgId: connection.orgId,
    connectionId: connection._id,
    lineGroupId: e.groupId,
    current: true,
    name: label(e.groupName, "LINE group", LIMITS.groupName),
    state: "pending",
    version: 1,
    joinedAt: e.timestamp,
    lifecycleAt: e.timestamp,
    lastActivityAt: e.timestamp,
    contactCount: 0,
    updatedAt: now,
  });
  return "applied";
}

async function onLeave(ctx: MutationCtx, connection: Connection, e: LineEvent) {
  const latest = await latestEnrollment(ctx, connection, e.groupId);
  if (
    latest === null ||
    latest.leftAt !== undefined ||
    e.timestamp < latest.lifecycleAt
  )
    return "stale";
  const now = Date.now();
  await ctx.db.patch("customerLineGroups", latest._id, {
    leftAt: e.timestamp,
    state: "disconnected",
    providerDeparture: "left",
    version: latest.version + 1,
    lifecycleAt: e.timestamp,
    updatedAt: now,
  });
  await cancelQueued(ctx, latest, now);
  return "applied";
}

/** A live, approved enrollment that this event belongs to, if any. */
async function approvedEnrollment(
  ctx: QueryCtx,
  connection: Connection,
  e: LineEvent,
): Promise<Group | null> {
  const group = await latestEnrollment(ctx, connection, e.groupId);
  if (
    group === null ||
    !isLiveEnrollment(group) ||
    e.timestamp < Math.max(group.joinedAt, group.approvedAt ?? 0) ||
    (group.state !== "active" && group.state !== "paused")
  )
    return null;
  return group;
}

function contactBy(ctx: QueryCtx, group: Group, lineUserId: string) {
  return ctx.db
    .query("customerLineContacts")
    .withIndex("by_orgId_groupId_lineUserId", (q) =>
      q
        .eq("orgId", group.orgId)
        .eq("groupId", group._id)
        .eq("lineUserId", lineUserId),
    )
    .unique();
}

async function onMembers(
  ctx: MutationCtx,
  connection: Connection,
  e: LineEvent,
) {
  const group = await approvedEnrollment(ctx, connection, e);
  const members = e.memberIds ?? [];
  if (group === null || members.length > LIMITS.memberIds) return "ignored";
  const present = e.type === "memberJoined";
  // Presence only: a roster is never built from member events.
  for (const lineUserId of members) {
    if (!isLineId(lineUserId)) continue;
    const contact = await contactBy(ctx, group, lineUserId);
    if (contact === null || e.timestamp <= contact.presenceAt) continue;
    await ctx.db.patch("customerLineContacts", contact._id, {
      present,
      presenceAt: e.timestamp,
      ...(!present && contact.verification === "verified"
        ? {
            verification: "revoked" as const,
            verifiedAt: undefined,
            verifiedByUserId: undefined,
          }
        : {}),
    });
  }
  return "applied";
}

async function onMessage(
  ctx: MutationCtx,
  connection: Connection,
  e: LineEvent,
) {
  // Only an explicit mention of this bot, in an active approved group, is
  // intake. Ordinary conversation text is never stored.
  if (connection.state !== "active" || e.mentionsSelf !== true)
    return "ignored";
  const text = e.text?.trim();
  if (!text || !isLineId(e.messageId) || !isLineId(e.senderId))
    return "ignored";
  const group = await approvedEnrollment(ctx, connection, e);
  if (group === null || group.state !== "active") return "ignored";
  const unsent = await ctx.db
    .query("customerLineEvents")
    .withIndex("by_orgId_connectionId_unsentMessageId", (q) =>
      q
        .eq("orgId", connection.orgId)
        .eq("connectionId", connection._id)
        .eq("unsentMessageId", e.messageId),
    )
    .first();
  if (unsent !== null) return "ignored";
  const duplicate = await ctx.db
    .query("customerLineQuestions")
    .withIndex("by_orgId_groupId_messageId", (q) =>
      q
        .eq("orgId", group.orgId)
        .eq("groupId", group._id)
        .eq("messageId", e.messageId!),
    )
    .first();
  if (duplicate !== null) return "duplicate";
  let contact = await contactBy(ctx, group, e.senderId);
  if (
    contact?.verification === "revoked" ||
    (contact && !contact.present && e.timestamp <= contact.presenceAt)
  )
    return "ignored";
  if (contact === null) {
    const ordinal = group.contactCount + 1;
    const contactId = await ctx.db.insert("customerLineContacts", {
      orgId: group.orgId,
      groupId: group._id,
      lineUserId: e.senderId,
      ordinal,
      name: `LINE member ${ordinal}`,
      verification: "none",
      present: true,
      presenceAt: e.timestamp,
    });
    await ctx.db.patch("customerLineGroups", group._id, {
      contactCount: ordinal,
    });
    contact = (await ctx.db.get("customerLineContacts", contactId))!;
  } else if (!contact.present && e.timestamp > contact.presenceAt) {
    await ctx.db.patch("customerLineContacts", contact._id, {
      present: true,
      presenceAt: e.timestamp,
    });
  }
  await ctx.db.insert("customerLineQuestions", {
    orgId: group.orgId,
    groupId: group._id,
    contactId: contact._id,
    messageId: e.messageId,
    text: text.slice(0, LIMITS.questionText),
    senderLabel: contact.name,
    createdAt: e.timestamp,
    state: "open",
    attempts: 0,
  });
  if (e.timestamp > group.lastActivityAt)
    await ctx.db.patch("customerLineGroups", group._id, {
      lastActivityAt: e.timestamp,
    });
  return "applied";
}

async function onUnsend(
  ctx: MutationCtx,
  connection: Connection,
  e: LineEvent,
) {
  if (!isLineId(e.messageId)) return "ignored";
  const enrollments = await ctx.db
    .query("customerLineGroups")
    .withIndex("by_orgId_connectionId_lineGroupId", (q) =>
      q
        .eq("orgId", connection.orgId)
        .eq("connectionId", connection._id)
        .eq("lineGroupId", e.groupId),
    )
    .order("desc")
    .take(10);
  const now = Date.now();
  for (const group of enrollments) {
    const question = await ctx.db
      .query("customerLineQuestions")
      .withIndex("by_orgId_groupId_messageId", (q) =>
        q
          .eq("orgId", group.orgId)
          .eq("groupId", group._id)
          .eq("messageId", e.messageId!),
      )
      .first();
    if (question === null) continue;
    if (
      question.state === "open" ||
      question.state === "failed" ||
      question.state === "canceled"
    ) {
      await ctx.db.delete("customerLineQuestions", question._id);
    } else {
      const leased =
        question.leaseExpiresAt !== undefined && question.leaseExpiresAt > now;
      await ctx.db.patch("customerLineQuestions", question._id, {
        text: "",
        ...(question.state === "queued" && !leased
          ? {
              state: question.attempts > 0 ? "unknown" : "canceled",
              leaseId: undefined,
              leaseExpiresAt: undefined,
              finishedAt: now,
            }
          : {}),
      });
    }
  }
  return "applied";
}

export const acceptEvents = internalMutation({
  args: {
    connectionId: v.string(),
    revision: v.number(),
    destination: v.string(),
    events: v.array(lineEvent),
  },
  returns: v.object({
    status: v.union(v.literal("ok"), v.literal("stale")),
    applied: v.number(),
    skipped: v.number(),
  }),
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("customerLineConnections", args.connectionId);
    const connection = id === null ? null : await ctx.db.get(id);
    if (
      connection === null ||
      connection.revision !== args.revision ||
      connection.botUserId !== args.destination ||
      connection.state === "disconnected" ||
      connection.sealedVerifier === undefined ||
      args.events.length > LIMITS.events
    )
      return { status: "stale" as const, applied: 0, skipped: 0 };
    const now = Date.now();
    // Any signed delivery, including LINE's empty verify ping, proves the route.
    if (connection.webhookVerifiedAt === undefined)
      await ctx.db.patch("customerLineConnections", connection._id, {
        webhookVerifiedAt: now,
      });
    let applied = 0;
    let skipped = 0;
    for (const e of args.events) {
      if (
        typeof e.eventId !== "string" ||
        e.eventId.length === 0 ||
        e.eventId.length > 128 ||
        !isClock(e.timestamp) ||
        !isLineId(e.groupId) ||
        (e.text !== undefined && e.text.length > 10_000)
      ) {
        skipped += 1;
        continue;
      }
      const seen = await ctx.db
        .query("customerLineEvents")
        .withIndex("by_orgId_connectionId_eventId", (q) =>
          q
            .eq("orgId", connection.orgId)
            .eq("connectionId", connection._id)
            .eq("eventId", e.eventId),
        )
        .first();
      if (seen !== null) {
        skipped += 1;
        continue;
      }
      await ctx.db.insert("customerLineEvents", {
        orgId: connection.orgId,
        connectionId: connection._id,
        eventId: e.eventId,
        receivedAt: now,
        ...(e.type === "unsend" && isLineId(e.messageId)
          ? { unsentMessageId: e.messageId }
          : {}),
      });
      const outcome =
        e.type === "join"
          ? await onJoin(ctx, connection, e)
          : e.type === "leave"
            ? await onLeave(ctx, connection, e)
            : e.type === "message"
              ? await onMessage(ctx, connection, e)
              : e.type === "unsend"
                ? await onUnsend(ctx, connection, e)
                : await onMembers(ctx, connection, e);
      if (outcome === "applied") applied += 1;
      else skipped += 1;
    }
    return { status: "ok" as const, applied, skipped };
  },
});

/** Setup test for the selected OA with signed webhook evidence. */
async function connectionTestTarget(
  ctx: QueryCtx,
  orgId: Id<"organizations">,
  connectionId: string,
  groupId: string,
) {
  const cid = ctx.db.normalizeId("customerLineConnections", connectionId);
  const gid = ctx.db.normalizeId("customerLineGroups", groupId);
  if (cid === null || gid === null) return null;
  const [connection, group] = await Promise.all([
    ctx.db.get(cid),
    ctx.db.get(gid),
  ]);
  if (
    connection === null ||
    group === null ||
    connection.orgId !== orgId ||
    group.orgId !== orgId ||
    connection.state === "disconnected" ||
    connection.sealedSender === undefined ||
    connection.webhookVerifiedAt === undefined ||
    group.connectionId !== connection._id ||
    !isLiveEnrollment(group) ||
    group.state !== "pending"
  )
    return null;
  return { connection, group, sealedSender: connection.sealedSender };
}

const testArgs = {
  ...claimedActor,
  connectionId: v.string(),
  groupId: v.string(),
};

export const readConnectionTest = internalQuery({
  args: testArgs,
  returns: v.union(
    v.null(),
    v.object({
      to: v.string(),
      tokenCiphertext: v.string(),
      revision: v.number(),
      groupVersion: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const actor = await confirmActor(
      ctx,
      args,
      CAPABILITY_GRANTS.manageConnection,
    );
    if (actor === null) return null;
    const target = await connectionTestTarget(
      ctx,
      actor.orgId,
      args.connectionId,
      args.groupId,
    );
    if (target === null) return null;
    return {
      to: target.group.lineGroupId,
      tokenCiphertext: target.sealedSender,
      revision: target.connection.revision,
      groupVersion: target.group.version,
    };
  },
});

export const finishConnectionTest = internalMutation({
  args: { ...testArgs, revision: v.number(), groupVersion: v.number() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const actor = await confirmActor(
      ctx,
      args,
      CAPABILITY_GRANTS.manageConnection,
    );
    if (actor === null) return false;
    const target = await connectionTestTarget(
      ctx,
      actor.orgId,
      args.connectionId,
      args.groupId,
    );
    if (
      target === null ||
      target.connection.revision !== args.revision ||
      target.group.version !== args.groupVersion
    )
      return false;
    await ctx.db.patch("customerLineConnections", target.connection._id, {
      testSentAt: Date.now(),
      state: "active",
    });
    return true;
  },
});

/** Why a queued reply may not be sent now, or null when it may. */
async function sendBlocker(
  ctx: QueryCtx,
  question: Question,
): Promise<string | null> {
  if (!question.text) return "QUESTION_UNSENT";
  const group = await ctx.db.get("customerLineGroups", question.groupId);
  if (group === null || group.orgId !== question.orgId) return "GROUP_STALE";
  const [connection, customer] = await Promise.all([
    ctx.db.get("customerLineConnections", group.connectionId),
    group.customerId === undefined
      ? null
      : ctx.db.get("customers", group.customerId),
  ]);
  const blocker = replyBlocker(group, connection, customer);
  if (blocker !== null) return blocker;
  if (group.version !== question.queuedGroupVersion) return "GROUP_CHANGED";
  // A reconnect, even of the same bot, never inherits replies queued before it.
  if (connection!.revision !== question.queuedConnectionRevision)
    return "CONNECTION_CHANGED";
  if (customer!.version !== question.queuedCustomerVersion)
    return "CUSTOMER_CHANGED";
  if (
    question.queuedByUserId === undefined ||
    !(await actorHoldsAll(
      ctx.db,
      question.orgId,
      question.queuedByUserId,
      CAPABILITY_GRANTS.send,
    ))
  )
    return "FORBIDDEN";
  return null;
}

export const claimReply = internalMutation({
  args: { questionId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      to: v.string(),
      tokenCiphertext: v.string(),
      text: v.string(),
      retryKey: v.string(),
      leaseId: v.string(),
    }),
  ),
  handler: async (ctx, { questionId }) => {
    const id = ctx.db.normalizeId("customerLineQuestions", questionId);
    const question = id === null ? null : await ctx.db.get(id);
    if (
      question === null ||
      question.state !== "queued" ||
      question.replyText === undefined ||
      question.retryKey === undefined ||
      question.queuedAt === undefined
    )
      return null;
    const now = Date.now();
    if (question.leaseExpiresAt !== undefined && question.leaseExpiresAt > now)
      return null;
    // An earlier attempt may have reached LINE; never resolve that as failed.
    const close = (state: "canceled" | "unknown") =>
      ctx.db.patch("customerLineQuestions", question._id, {
        state: question.attempts > 0 ? "unknown" : state,
        leaseId: undefined,
        leaseExpiresAt: undefined,
        finishedAt: now,
      });
    if (
      question.attempts >= LIMITS.attempts ||
      now - question.queuedAt > LIMITS.retryWindowMs
    ) {
      await close("unknown");
      return null;
    }
    if ((await sendBlocker(ctx, question)) !== null) {
      await close("canceled");
      return null;
    }
    const group = (await ctx.db.get("customerLineGroups", question.groupId))!;
    const connection = (await ctx.db.get(
      "customerLineConnections",
      group.connectionId,
    ))!;
    const leaseId = crypto.randomUUID();
    await ctx.db.patch("customerLineQuestions", question._id, {
      leaseId,
      leaseExpiresAt: now + LIMITS.leaseMs,
      attempts: question.attempts + 1,
    });
    // Recover an abandoned lease even if action execution stops after claiming.
    await ctx.scheduler.runAfter(LIMITS.leaseMs, deliverReplyReference, {
      questionId: question._id,
    });
    return {
      to: group.lineGroupId,
      tokenCiphertext: connection.sealedSender!,
      text: question.replyText,
      retryKey: question.retryKey,
      leaseId,
    };
  },
});

/** Rechecked immediately before every provider attempt. */
export const authorizeReply = internalQuery({
  args: { questionId: v.string(), leaseId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { questionId, leaseId }) => {
    const id = ctx.db.normalizeId("customerLineQuestions", questionId);
    const question = id === null ? null : await ctx.db.get(id);
    const now = Date.now();
    if (
      question === null ||
      question.state !== "queued" ||
      question.leaseId !== leaseId ||
      question.leaseExpiresAt === undefined ||
      question.leaseExpiresAt <= now ||
      question.queuedAt === undefined ||
      now - question.queuedAt > LIMITS.retryWindowMs
    )
      return false;
    return (await sendBlocker(ctx, question)) === null;
  },
});

export const finishReply = internalMutation({
  args: {
    questionId: v.string(),
    leaseId: v.string(),
    state: v.union(
      v.literal("accepted"),
      v.literal("failed"),
      v.literal("unknown"),
    ),
    acceptedRequestId: v.optional(v.string()),
  },
  returns: v.boolean(),
  handler: async (ctx, { questionId, leaseId, state, acceptedRequestId }) => {
    const id = ctx.db.normalizeId("customerLineQuestions", questionId);
    const question = id === null ? null : await ctx.db.get(id);
    // Only the current lease holder settles the reply, even after expiry,
    // as long as no newer lease replaced it.
    if (
      question === null ||
      question.state !== "queued" ||
      question.leaseId !== leaseId
    )
      return false;
    // After an earlier attempt that may have reached LINE, a later failure
    // cannot rule out delivery: stay uncertain until LINE confirms acceptance.
    const settled =
      state === "failed" && question.attempts > 1 ? "unknown" : state;
    await ctx.db.patch("customerLineQuestions", question._id, {
      state: settled,
      leaseId: undefined,
      leaseExpiresAt: undefined,
      finishedAt: Date.now(),
      ...(state === "accepted" &&
      acceptedRequestId !== undefined &&
      acceptedRequestId.length <= 128
        ? { acceptedRequestId }
        : {}),
    });
    return true;
  },
});
