import { v, type Validator } from "convex/values";

import {
  connectionState,
  groupState,
  providerDeparture,
  questionState,
} from "./schema";

/** Sanitized public projections: no raw LINE IDs and no sealed material. */
export const groupView = v.object({
  _id: v.id("customerLineGroups"),
  name: v.string(),
  state: groupState,
  customerId: v.optional(v.id("customers")),
  customerName: v.optional(v.string()),
  version: v.number(),
  lastActivityAt: v.number(),
  providerDeparture: v.optional(providerDeparture),
});

export const questionView = v.object({
  _id: v.id("customerLineQuestions"),
  text: v.string(),
  senderLabel: v.string(),
  createdAt: v.number(),
  state: questionState,
  replyText: v.optional(v.string()),
});

export const contactView = v.object({
  _id: v.id("customerLineContacts"),
  name: v.string(),
  state: v.union(
    v.literal("observed"),
    v.literal("verified"),
    v.literal("revoked"),
    v.literal("left"),
  ),
});

export const connectionView = v.object({
  _id: v.id("customerLineConnections"),
  name: v.string(),
  basicId: v.string(),
  state: connectionState,
  webhookPath: v.string(),
  identityVerifiedAt: v.number(),
  webhookVerifiedAt: v.optional(v.number()),
  testSentAt: v.optional(v.number()),
});

export const pageOf = <Item extends Validator<unknown, "required", string>>(
  item: Item,
) =>
  v.object({
    page: v.array(item),
    continueCursor: v.union(v.string(), v.null()),
  });

/** `null` on success; otherwise a stable, safe refusal code. */
export const mutationResult = v.union(v.null(), v.object({ code: v.string() }));

/** Normalized signed LINE event, produced by transport after verification. */
export const lineEvent = v.object({
  eventId: v.string(),
  timestamp: v.number(),
  groupId: v.string(),
  type: v.union(
    v.literal("join"),
    v.literal("leave"),
    v.literal("memberJoined"),
    v.literal("memberLeft"),
    v.literal("message"),
    v.literal("unsend"),
  ),
  senderId: v.optional(v.string()),
  memberIds: v.optional(v.array(v.string())),
  messageId: v.optional(v.string()),
  text: v.optional(v.string()),
  /** True only when LINE's mention metadata marks this bot (`isSelf`). */
  mentionsSelf: v.optional(v.boolean()),
  groupName: v.optional(v.string()),
});
