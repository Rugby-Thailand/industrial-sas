/** Internal-only due worker. Organization and publisher come from the saved job. */
import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { resolveTenantContext } from "../lib/tenantContext";
import { createConvexTenantContextLookups } from "../lib/tenantContextLookups";
import { createTenantDocumentAccess } from "../lib/tenantDb";
import { createMutationTenantStorage } from "../lib/tenantStorage";
import { createMemberDirectory } from "../lib/memberDirectory";
import { createPrivateFileStorage } from "../lib/privateFileStorage";
import { HR_PERMISSION, PERMISSIONS_BY_CODE } from "../lib/permissions";
import {
  resolveAuthorizationFacts,
  decideAuthorization,
  NO_AUTHORIZATION_POLICY_FACTS,
} from "../lib/authorization";
import { createConvexAuthorizationLookups } from "../lib/authorizationLookupsConvex";
import type { TenantFunctionContext } from "../lib/tenantFunctions";
import { publishAnnouncement, canManageAnnouncement } from "./announcements";
import { hrCommand } from "./shared";

async function publisherContext(
  raw: MutationCtx,
  row: Doc<"hrAnnouncements">,
  requestId: string,
): Promise<TenantFunctionContext | null> {
  const actor = row.scheduledByUserId
    ? await raw.db.get(row.scheduledByUserId)
    : null;
  const organization = await raw.db.get(row.orgId);
  if (!actor || !organization) return null;
  // This is a persisted delegation, never a client identity or fresh-auth claim.
  const identity = {
    subject: actor.clerkUserId,
    org_id: organization.clerkOrganizationId,
    tokenIdentifier: `announcement-scheduler:${row._id}`,
    issuer: "internal-announcement-scheduler",
  };
  const resolved = await resolveTenantContext({
    requestId,
    identity,
    lookups: createConvexTenantContextLookups(raw, requestId),
  });
  if (!resolved.ok || resolved.context.organization._id !== row.orgId)
    return null;
  const permission = PERMISSIONS_BY_CODE.get(HR_PERMISSION.adminManage);
  if (!permission || permission.requiresStepUp) return null;
  const tenant = resolved.context;
  const facts = await resolveAuthorizationFacts({
    permission,
    orgId: row.orgId,
    actorUserId: actor._id,
    membershipId: tenant.membership._id,
    now: Date.now(),
    lookups: createConvexAuthorizationLookups(raw, requestId),
  });
  if (
    !facts.ok ||
    !decideAuthorization({
      permission,
      actorUserId: actor._id,
      facts: facts.facts,
      policy: NO_AUTHORIZATION_POLICY_FACTS,
      now: Date.now(),
    }).allowed
  )
    return null;
  return {
    requestId,
    identity,
    tenant,
    permission,
    tenantDb: createTenantDocumentAccess(
      { orgId: row.orgId, requestId },
      createMutationTenantStorage(raw, requestId),
    ),
    members: createMemberDirectory(raw.db, row.orgId),
    privateFiles: createPrivateFileStorage(raw.storage),
    scheduler: raw.scheduler,
  };
}
export const publishDue = internalMutation({
  args: {
    announcementId: v.id("hrAnnouncements"),
    expectedVersion: v.number(),
  },
  returns: v.any(),
  handler: async (raw, args) => {
    const row = await raw.db.get(args.announcementId);
    if (
      !row ||
      row.status !== "SCHEDULED" ||
      row.version !== args.expectedVersion ||
      row.publishAt === undefined ||
      row.publishAt > Date.now() ||
      row.scheduleError
    )
      return { skipped: true };
    const requestId = `annsched-${row._id}-${row.version}`;
    const ctx = await publisherContext(raw, row, requestId);
    let error = "SCHEDULE_PUBLISHER_UNAVAILABLE";
    if (ctx && (await canManageAnnouncement(ctx, row))) {
      const result = await hrCommand(ctx, {
        operation: "hr.announcements.scheduledPublish",
        requestId,
        payload: { announcementId: row._id, version: row.version },
        table: "hrAnnouncements",
        replay: async () => null,
        run: () => publishAnnouncement(ctx, row),
      });
      if (result.written) return { published: true };
      error = result.error.code;
    }
    // A business refusal remains visible to HR and requires explicit recovery.
    await raw.db.patch(row._id, {
      scheduleError: error,
      scheduleFailedAt: Date.now(),
      version: row.version + 1,
      updatedAt: Date.now(),
    });
    await raw.db.insert("auditEvents", {
      orgId: row.orgId,
      occurredAt: Date.now(),
      actorKind: "SYSTEM",
      actorPlatformRef: "announcement-scheduler",
      action: "hr.announcements.scheduledPublish",
      entityTable: "hrAnnouncements",
      entityId: row._id,
      outcome: "DENIED",
      requestId,
      changes: [{ field: "scheduleError", to: error }],
    });
    return { published: false, code: error };
  },
});
