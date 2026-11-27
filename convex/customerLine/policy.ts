import type { GenericDatabaseReader, UserIdentity } from "convex/server";

import type { Doc, Id } from "../_generated/dataModel";
import {
  decideAuthorization,
  NO_AUTHORIZATION_POLICY_FACTS,
  resolveAuthorizationFacts,
} from "../lib/authorization";
import { createConvexAuthorizationLookups } from "../lib/authorizationLookupsConvex";
import {
  CUSTOMER_LINE_PERMISSION,
  PERMISSIONS_BY_CODE,
} from "../lib/permissions";
import { resolveTenantContext } from "../lib/tenantContext";
import { createConvexTenantContextLookups } from "../lib/tenantContextLookups";
import { NAVIGATION_PERMISSION } from "../model/authorization/navigationPermissions";
import type { DataModel } from "../schema";

export const LIMITS = Object.freeze({
  page: 50,
  events: 100,
  memberIds: 100,
  questionText: 2000,
  replyText: 2000,
  groupName: 100,
  lineId: 64,
  /** One provider attempt plus its single same-key retry fits in a lease. */
  leaseMs: 60_000,
  /** LINE keeps a retry key for 24h; stay well inside it. */
  retryWindowMs: 23 * 60 * 60 * 1000,
  attempts: 4,
});

export const WEBHOOK_PATH_PREFIX = "/webhooks/customer-line/";

/** Grants each LINE capability needs, always together with customer read. */
export const CAPABILITY_GRANTS = Object.freeze({
  read: [NAVIGATION_PERMISSION.customers, CUSTOMER_LINE_PERMISSION.read],
  manageGroups: [
    NAVIGATION_PERMISSION.customers,
    CUSTOMER_LINE_PERMISSION.read,
    CUSTOMER_LINE_PERMISSION.manageGroups,
  ],
  send: [
    NAVIGATION_PERMISSION.customers,
    CUSTOMER_LINE_PERMISSION.read,
    CUSTOMER_LINE_PERMISSION.send,
  ],
  manageConnection: [
    NAVIGATION_PERMISSION.customers,
    CUSTOMER_LINE_PERMISSION.manageConnection,
  ],
} as const);

type Reader = GenericDatabaseReader<DataModel>;

/**
 * Whether a persisted actor still holds every code right now: active
 * organization, user and membership, through an active role. Used where no
 * caller identity exists (the send worker) or to recheck a stale grant.
 */
export async function actorHoldsAll(
  db: Reader,
  orgId: Id<"organizations">,
  actorUserId: Id<"users">,
  codes: readonly string[],
  now = Date.now(),
): Promise<boolean> {
  const [organization, user] = await Promise.all([
    db.get("organizations", orgId),
    db.get("users", actorUserId),
  ]);
  if (organization?.status !== "ACTIVE" || user?.status !== "ACTIVE")
    return false;
  const requestId = crypto.randomUUID();
  const lookups = createConvexAuthorizationLookups({ db }, requestId);
  const membership = await lookups.findMembership({
    orgId,
    userId: actorUserId,
  });
  if (membership === null) return false;
  for (const code of codes) {
    const permission = PERMISSIONS_BY_CODE.get(code);
    if (permission === undefined || permission.scope !== "ORG") return false;
    const facts = await resolveAuthorizationFacts({
      permission,
      orgId,
      actorUserId,
      membershipId: membership._id,
      now,
      lookups,
    });
    if (!facts.ok) return false;
    const decision = decideAuthorization({
      permission,
      actorUserId,
      facts: facts.facts,
      policy: NO_AUTHORIZATION_POLICY_FACTS,
      now,
    });
    if (!decision.allowed) return false;
  }
  return true;
}

export interface TrustedActor {
  readonly orgId: Id<"organizations">;
  readonly actorId: Id<"users">;
}

/**
 * The caller's active organization and actor, from the authenticated
 * identity only, when they hold every code. Never trusts client fields.
 */
export async function trustedActor(
  ctx: {
    readonly db: Reader;
    readonly auth: { getUserIdentity(): Promise<UserIdentity | null> };
  },
  codes: readonly string[],
): Promise<TrustedActor | null> {
  const requestId = crypto.randomUUID();
  const resolved = await resolveTenantContext({
    requestId,
    identity: await ctx.auth.getUserIdentity(),
    lookups: createConvexTenantContextLookups(ctx, requestId),
  });
  if (!resolved.ok) return null;
  const orgId = resolved.context.organization._id;
  const actorId = resolved.context.actor._id;
  return (await actorHoldsAll(ctx.db, orgId, actorId, codes))
    ? { orgId, actorId }
    : null;
}

/** Recheck that a caller-claimed org/actor is the authenticated one. */
export async function confirmActor(
  ctx: Parameters<typeof trustedActor>[0],
  claimed: { readonly orgId: string; readonly actorId: string },
  codes: readonly string[],
): Promise<TrustedActor | null> {
  const actor = await trustedActor(ctx, codes);
  return actor !== null &&
    actor.orgId === claimed.orgId &&
    actor.actorId === claimed.actorId
    ? actor
    : null;
}

export type Connection = Doc<"customerLineConnections">;
export type Group = Doc<"customerLineGroups">;
export type Contact = Doc<"customerLineContacts">;
export type Question = Doc<"customerLineQuestions">;

/** An enrollment staff may still act on: the latest, and the bot is in it. */
export const isLiveEnrollment = (group: Group): boolean =>
  group.current && group.leftAt === undefined;

/**
 * Every condition for a reply to reach this group: the live enrollment of an
 * active OA that still owns it, approved for an active customer.
 */
export function replyBlocker(
  group: Group | null,
  connection: Connection | null,
  customer: Doc<"customers"> | null,
): string | null {
  if (group === null || !isLiveEnrollment(group)) return "GROUP_STALE";
  if (group.state !== "active") return "GROUP_NOT_ACTIVE";
  if (
    connection === null ||
    connection._id !== group.connectionId ||
    connection.orgId !== group.orgId ||
    connection.state !== "active" ||
    connection.sealedSender === undefined
  )
    return "CONNECTION_NOT_READY";
  if (
    customer === null ||
    customer._id !== group.customerId ||
    customer.orgId !== group.orgId ||
    customer.status !== "ACTIVE"
  )
    return "CUSTOMER_UNAVAILABLE";
  return null;
}

export function contactState(
  contact: Contact,
): "observed" | "verified" | "revoked" | "left" {
  if (!contact.present) return "left";
  if (contact.verification === "verified") return "verified";
  if (contact.verification === "revoked") return "revoked";
  return "observed";
}

export function projectGroup(group: Group, customerName?: string) {
  const approved = group.state !== "pending";
  return {
    _id: group._id,
    name: group.name,
    state: group.state,
    ...(approved && group.customerId !== undefined
      ? { customerId: group.customerId }
      : {}),
    ...(approved && customerName !== undefined ? { customerName } : {}),
    version: group.version,
    lastActivityAt: group.lastActivityAt,
    ...(group.providerDeparture === undefined
      ? {}
      : { providerDeparture: group.providerDeparture }),
  };
}

export function projectQuestion(question: Question) {
  return {
    _id: question._id,
    text: question.text,
    senderLabel: question.senderLabel,
    createdAt: question.createdAt,
    state: question.state,
    ...(question.replyText === undefined
      ? {}
      : { replyText: question.replyText }),
  };
}

export function projectContact(contact: Contact) {
  return { _id: contact._id, name: contact.name, state: contactState(contact) };
}

export function projectConnection(connection: Connection) {
  return {
    _id: connection._id,
    name: connection.name,
    basicId: connection.basicId,
    state: connection.state,
    webhookPath: `${WEBHOOK_PATH_PREFIX}${connection.webhookKey}`,
    identityVerifiedAt: connection.identityVerifiedAt,
    ...(connection.webhookVerifiedAt === undefined
      ? {}
      : { webhookVerifiedAt: connection.webhookVerifiedAt }),
    ...(connection.testSentAt === undefined
      ? {}
      : { testSentAt: connection.testSentAt }),
  };
}
