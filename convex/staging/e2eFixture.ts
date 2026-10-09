import { v } from "convex/values";

import type { Id, TableNames } from "../_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import { seedAuthorizationForOrganization } from "../lib/authorizationSeedConvex";

/**
 * Each trusted staging run owns a Clerk user and two exactly named organizations.
 * Wait for verified mirrors, prepare, test, clean backend data, then delete those
 * Clerk identities. Mirror rows/watermarks remain for real deletion events;
 * global permissions remain. No function is public or accepts a target/key.
 */
export const E2E_FIXTURE_CONFIRMATION = "CI_STAGING_E2E_FIXTURE_V1";
export const STAGING_E2E_DEPLOYMENTS: readonly string[] = [
  "befitting-stoat-208",
];
const REFUSED_DEPLOYMENTS: readonly string[] = ["greedy-cardinal-537"];
export const E2E_ORGANIZATION_PREFIX = "CI E2E ";
export const FORBIDDEN_WAREHOUSE_CODE = "E2E-FORBIDDEN";
export const OTHER_TENANT_WAREHOUSE_CODE = "E2E-OTHER";
const RUN_ID = /^[a-z0-9][a-z0-9-]{5,39}$/;
const MAX_CLEANUP_BATCH = 200;
const MIN_STALE_AGE_MS = 60 * 60 * 1000;

export class E2eFixtureRefusal extends Error {
  override readonly name = "E2eFixtureRefusal";
}
function assertRunId(runId: string) {
  if (!RUN_ID.test(runId)) throw new E2eFixtureRefusal("Invalid run ID.");
}
export function organizationName(runId: string, kind: "primary" | "other") {
  assertRunId(runId);
  return `${E2E_ORGANIZATION_PREFIX}${runId} ${kind}`;
}
export function userDisplayName(runId: string) {
  assertRunId(runId);
  return `${E2E_ORGANIZATION_PREFIX}${runId} actor`;
}
export function runWarehouseCode(runId: string): string {
  assertRunId(runId);
  return `E2E-${runId.toUpperCase()}`;
}

/** Reads the deployment's own built-in URL, never a caller-selected URL. */
export function assertE2eFixtureTarget(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const url = (env.CONVEX_CLOUD_URL ?? "").trim();
  const marker = (env.E2E_FIXTURE_TARGET ?? "").trim();
  const cloud = /^https:\/\/([a-z0-9-]+)\.convex\.cloud\/?$/.exec(url);
  if (cloud) {
    const deployment = cloud[1]!;
    if (REFUSED_DEPLOYMENTS.includes(deployment)) {
      throw new E2eFixtureRefusal("E2E fixtures never run on production.");
    }
    if (!STAGING_E2E_DEPLOYMENTS.includes(deployment)) {
      throw new E2eFixtureRefusal(
        "Deployment is not an allow-listed staging target.",
      );
    }
    if (marker !== deployment) {
      throw new E2eFixtureRefusal(
        "E2E_FIXTURE_TARGET does not name this deployment.",
      );
    }
    return deployment;
  }
  if (
    /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(url) &&
    marker === "local"
  )
    return "local";
  throw new E2eFixtureRefusal(
    "E2E fixtures require the marked staging deployment.",
  );
}

const ownershipArgs = {
  confirmation: v.literal(E2E_FIXTURE_CONFIRMATION),
  runId: v.string(),
  clerkOrganizationId: v.string(),
  otherClerkOrganizationId: v.string(),
  clerkUserId: v.string(),
  clerkMembershipId: v.string(),
};
interface Ownership {
  readonly runId: string;
  readonly clerkOrganizationId: string;
  readonly otherClerkOrganizationId: string;
  readonly clerkUserId: string;
  readonly clerkMembershipId: string;
}
function verifiedMirror(row: {
  clerkLastEventId?: string;
  clerkLastEventAt?: number;
  clerkLastEventTimestamp?: number;
}) {
  return (
    typeof row.clerkLastEventId === "string" &&
    row.clerkLastEventId.trim().length > 0 &&
    Number.isSafeInteger(row.clerkLastEventAt) &&
    row.clerkLastEventAt! >= 0 &&
    Number.isSafeInteger(row.clerkLastEventTimestamp) &&
    row.clerkLastEventTimestamp! >= row.clerkLastEventAt! &&
    row.clerkLastEventTimestamp! <= Date.now() + 5 * 60 * 1000
  );
}
async function ownedOrganization(
  ctx: Pick<QueryCtx, "db">,
  clerkOrganizationId: string,
  expectedName: string,
) {
  const rows = await ctx.db
    .query("organizations")
    .withIndex("by_clerkOrganizationId", (q) =>
      q.eq("clerkOrganizationId", clerkOrganizationId),
    )
    .take(2);
  const row = rows.length === 1 ? rows[0]! : null;
  return row !== null &&
    row.clerkOrganizationId === clerkOrganizationId &&
    row.name === expectedName &&
    row.status === "ACTIVE" &&
    verifiedMirror(row)
    ? row
    : null;
}
/** These checks establish mirror readiness, not independent JWT signing proof. */
async function readOwnedIdentities(ctx: Pick<QueryCtx, "db">, args: Ownership) {
  assertRunId(args.runId);
  const primary = await ownedOrganization(
    ctx,
    args.clerkOrganizationId,
    organizationName(args.runId, "primary"),
  );
  const other = await ownedOrganization(
    ctx,
    args.otherClerkOrganizationId,
    organizationName(args.runId, "other"),
  );
  const users = await ctx.db
    .query("users")
    .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", args.clerkUserId))
    .take(2);
  const candidate = users.length === 1 ? users[0]! : null;
  const user =
    candidate !== null &&
    candidate.clerkUserId === args.clerkUserId &&
    candidate.displayName === userDisplayName(args.runId) &&
    candidate.status === "ACTIVE" &&
    verifiedMirror(candidate)
      ? candidate
      : null;
  const memberships =
    primary === null || user === null
      ? []
      : (
          await Promise.all(
            (["ACTIVE", "SUSPENDED"] as const).map((status) =>
              ctx.db
                .query("memberships")
                .withIndex("by_orgId_status_userId", (q) =>
                  q
                    .eq("orgId", primary._id)
                    .eq("status", status)
                    .eq("userId", user._id),
                )
                .take(2),
            ),
          )
        ).flat();
  const current = memberships.length === 1 ? memberships[0]! : null;
  const membership =
    current !== null &&
    current.orgId === primary?._id &&
    current.userId === user?._id &&
    current.clerkMembershipId === args.clerkMembershipId &&
    current.status === "ACTIVE" &&
    current.effectiveFrom <= Date.now() &&
    (current.effectiveTo === undefined || current.effectiveTo > Date.now()) &&
    verifiedMirror(current)
      ? current
      : null;
  return { primary, other, user, membership };
}
async function requireOwnedIdentities(
  ctx: Pick<QueryCtx, "db">,
  args: Ownership,
) {
  const owned = await readOwnedIdentities(ctx, args);
  if (
    owned.primary === null ||
    owned.other === null ||
    owned.user === null ||
    owned.membership === null ||
    owned.primary._id === owned.other._id
  )
    throw new E2eFixtureRefusal("Exact run identities are not ready or owned.");
  return {
    primary: owned.primary,
    other: owned.other,
    user: owned.user,
    membership: owned.membership,
  };
}
function warehouseNames(runId: string) {
  return {
    run: `${E2E_ORGANIZATION_PREFIX}${runId} warehouse`,
    forbidden: `${E2E_ORGANIZATION_PREFIX}${runId} forbidden warehouse`,
    other: `${E2E_ORGANIZATION_PREFIX}${runId} other warehouse`,
  };
}
async function ensureWarehouse(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
  code: string,
  name: string,
) {
  const existing = await ctx.db
    .query("warehouses")
    .withIndex("by_orgId_code", (q) => q.eq("orgId", orgId).eq("code", code))
    .unique();
  if (existing !== null) {
    if (existing.name !== name || existing.status !== "ACTIVE") {
      throw new E2eFixtureRefusal(
        "Existing warehouse is not this run's fixture.",
      );
    }
    return existing._id;
  }
  return await ctx.db.insert("warehouses", {
    orgId,
    code,
    name,
    status: "ACTIVE",
  });
}

export const prepare = internalMutation({
  args: ownershipArgs,
  returns: v.object({
    runWarehouseId: v.id("warehouses"),
    forbiddenWarehouseId: v.id("warehouses"),
    otherTenantWarehouseId: v.id("warehouses"),
  }),
  handler: async (ctx, args) => {
    assertE2eFixtureTarget();
    const { primary, other, membership } = await requireOwnedIdentities(
      ctx,
      args,
    );
    const names = warehouseNames(args.runId);
    const runWarehouseId = await ensureWarehouse(
      ctx,
      primary._id,
      runWarehouseCode(args.runId),
      names.run,
    );
    const scope = await ctx.db
      .query("membershipWarehouses")
      .withIndex("by_orgId_membershipId_warehouseId", (q) =>
        q.eq("orgId", primary._id).eq("membershipId", membership._id),
      )
      .take(2);
    if (
      scope.length > 1 ||
      scope.some((row) => row.warehouseId !== runWarehouseId)
    ) {
      throw new E2eFixtureRefusal(
        "Run identity has unrelated warehouse scope.",
      );
    }
    await seedAuthorizationForOrganization(ctx, primary._id);
    await seedAuthorizationForOrganization(ctx, other._id);
    const role = await ctx.db
      .query("roles")
      .withIndex("by_orgId_key", (q) =>
        q.eq("orgId", primary._id).eq("key", "WAREHOUSE_MANAGER"),
      )
      .unique();
    if (role === null)
      throw new Error("Seeded WAREHOUSE_MANAGER role missing.");
    const grant = await ctx.db
      .query("membershipRoles")
      .withIndex("by_orgId_membershipId_roleId", (q) =>
        q
          .eq("orgId", primary._id)
          .eq("membershipId", membership._id)
          .eq("roleId", role._id),
      )
      .unique();
    if (grant === null)
      await ctx.db.insert("membershipRoles", {
        orgId: primary._id,
        membershipId: membership._id,
        roleId: role._id,
        grantedAt: Date.now(),
      });
    if (membership.scopeMode !== "WAREHOUSE_SCOPED") {
      await ctx.db.patch("memberships", membership._id, {
        scopeMode: "WAREHOUSE_SCOPED",
      });
    }
    if (scope.length === 0)
      await ctx.db.insert("membershipWarehouses", {
        orgId: primary._id,
        membershipId: membership._id,
        warehouseId: runWarehouseId,
      });
    const forbiddenWarehouseId = await ensureWarehouse(
      ctx,
      primary._id,
      FORBIDDEN_WAREHOUSE_CODE,
      names.forbidden,
    );
    const otherTenantWarehouseId = await ensureWarehouse(
      ctx,
      other._id,
      OTHER_TENANT_WAREHOUSE_CODE,
      names.other,
    );
    return { runWarehouseId, forbiddenWarehouseId, otherTenantWarehouseId };
  },
});

/** Each index starts with the exact organization and warehouse pair. */
const WAREHOUSE_TABLES: readonly (readonly [TableNames, string])[] = [
  ["finishedGoodsMoves", "by_orgId_warehouseId_status"],
  ["finishedGoodsScanAssignments", "by_orgId_warehouseId"],
  ["finishedGoodsJobScans", "by_orgId_warehouseId_createdAt"],
  ["finishedGoodsPlacements", "by_orgId_warehouseId_positionCode"],
  ["finishedGoodsPallets", "by_orgId_warehouseId_code"],
  ["finishedGoodsBatches", "by_orgId_warehouseId_productId_updatedAt"],
  ["finishedGoodsProductSummaries", "by_orgId_warehouseId"],
  ["finishedGoodsSummaryReadiness", "by_orgId_warehouseId"],
  ["finishedGoodsCounters", "by_orgId_warehouseId"],
  ["finishedGoodsProducts", "by_orgId_warehouseId_sku"],
  ["storagePositions", "by_orgId_warehouseId_code"],
  ["storageZones", "by_orgId_warehouseId_code"],
  ["storageFloors", "by_orgId_warehouseId_buildingId_floorNumber"],
  ["storageBuildings", "by_orgId_warehouseId_code"],
  ["locations", "by_orgId_warehouseId_code"],
  ["devices", "by_orgId_warehouseId_status"],
  ["membershipWarehouses", "by_orgId_warehouseId"],
];
/** Exact run-owned organizations; no expiry is assumed. */
const OWNED_ORGANIZATION_TABLES: readonly (readonly [TableNames, string])[] = [
  ["auditEvents", "by_orgId_occurredAt"],
  ["idempotencyRecords", "by_orgId_expiresAt"],
  ["membershipRoles", "by_orgId_membershipId_roleId"],
  ["membershipWarehouses", "by_orgId_membershipId_warehouseId"],
  ["rolePermissions", "by_orgId_roleId_permissionCode"],
  ["roles", "by_orgId_key"],
  ["entitlements", "by_orgId_key"],
];
type CleanupRange = { eq: (field: string, value: unknown) => CleanupRange };
type CleanupDb = {
  query: (table: string) => {
    withIndex: (
      index: string,
      range: (q: CleanupRange) => CleanupRange,
    ) => {
      take: (
        n: number,
      ) => Promise<{ _id: string; orgId: string; [field: string]: unknown }[]>;
    };
  };
  delete: (table: string, id: string) => Promise<void>;
};

async function cleanupOwned(
  ctx: MutationCtx,
  args: { readonly runId: string; readonly limit?: number },
  owners: {
    readonly primary?: Id<"organizations">;
    readonly other?: Id<"organizations">;
  },
) {
  assertRunId(args.runId);
  if (!Number.isSafeInteger(args.limit ?? 100) || (args.limit ?? 100) < 1) {
    throw new E2eFixtureRefusal("Cleanup limit must be a positive integer.");
  }
  const limit = Math.min(args.limit ?? 100, MAX_CLEANUP_BATCH);
  const names = warehouseNames(args.runId);
  const ownedTargets: {
    orgId: Id<"organizations">;
    expected: Map<string, string>;
  }[] = [];
  if (owners.primary !== undefined)
    ownedTargets.push({
      orgId: owners.primary,
      expected: new Map([
        [runWarehouseCode(args.runId), names.run],
        [FORBIDDEN_WAREHOUSE_CODE, names.forbidden],
      ]),
    });
  if (owners.other !== undefined)
    ownedTargets.push({
      orgId: owners.other,
      expected: new Map([[OTHER_TENANT_WAREHOUSE_CODE, names.other]]),
    });
  const warehouses = [];
  for (const target of ownedTargets) {
    const rows = await ctx.db
      .query("warehouses")
      .withIndex("by_orgId_code", (q) => q.eq("orgId", target.orgId))
      .take(4);
    if (
      rows.length > target.expected.size ||
      rows.some((row) => target.expected.get(row.code) !== row.name)
    ) {
      throw new E2eFixtureRefusal(
        "Run organization contains unrelated warehouses.",
      );
    }
    warehouses.push(...rows);
  }
  const db = ctx.db as unknown as CleanupDb;
  let deleted = 0;
  const remaining = () => limit - deleted;
  const purge = async (
    table: TableNames,
    index: string,
    orgId: Id<"organizations">,
    fields: Readonly<Record<string, unknown>> = {},
  ) => {
    const rows = await db
      .query(table)
      .withIndex(index, (q) =>
        Object.entries(fields).reduce(
          (range, [field, value]) => range.eq(field, value),
          q.eq("orgId", orgId),
        ),
      )
      .take(remaining());
    if (
      rows.some(
        (row) =>
          row.orgId !== orgId ||
          Object.entries(fields).some(([field, value]) => row[field] !== value),
      )
    ) {
      throw new E2eFixtureRefusal("Cleanup index returned unrelated rows.");
    }
    for (const row of rows) {
      await db.delete(table, row._id);
      deleted += 1;
    }
  };
  for (const warehouse of warehouses) {
    const { orgId } = warehouse;
    const warehouseId = warehouse._id;
    // Exhausted batches stop before deleting any unchecked parent.
    const pallets = await ctx.db
      .query("finishedGoodsPallets")
      .withIndex("by_orgId_warehouseId_code", (q) =>
        q.eq("orgId", orgId).eq("warehouseId", warehouseId),
      )
      .take(remaining());
    for (const pallet of pallets) {
      await purge(
        "finishedGoodsUnitContributions",
        "by_orgId_palletId",
        orgId,
        { palletId: pallet._id },
      );
      if (remaining() === 0) return { deleted, done: false };
    }
    const batches = await ctx.db
      .query("finishedGoodsBatches")
      .withIndex("by_orgId_warehouseId_productId_updatedAt", (q) =>
        q.eq("orgId", orgId).eq("warehouseId", warehouseId),
      )
      .take(remaining());
    for (const batch of batches) {
      await purge(
        "finishedGoodsBatchRevisions",
        "by_orgId_batchId_revision",
        orgId,
        { batchId: batch._id },
      );
      if (remaining() === 0) return { deleted, done: false };
    }
    const buildings = await ctx.db
      .query("storageBuildings")
      .withIndex("by_orgId_warehouseId_code", (q) =>
        q.eq("orgId", orgId).eq("warehouseId", warehouseId),
      )
      .take(remaining());
    for (const building of buildings) {
      await purge(
        "storageFloorReservedBlocks",
        "by_orgId_buildingId_floorId",
        orgId,
        { buildingId: building._id },
      );
      if (remaining() === 0) return { deleted, done: false };
    }
    for (const [table, index] of WAREHOUSE_TABLES) {
      await purge(table, index, orgId, { warehouseId });
      if (remaining() === 0) return { deleted, done: false };
    }
    await ctx.db.delete("warehouses", warehouseId);
    deleted += 1;
    if (remaining() === 0) return { deleted, done: false };
  }
  for (const { orgId } of ownedTargets) {
    for (const [table, index] of OWNED_ORGANIZATION_TABLES) {
      await purge(table, index, orgId);
      if (remaining() === 0) return { deleted, done: false };
    }
  }
  // Verified mirrors intentionally await real Clerk deletion events. All other
  // fixture business/auth/audit/idempotency rows are gone before `done: true`.
  return { deleted, done: true };
}

export const cleanup = internalMutation({
  args: { ...ownershipArgs, limit: v.optional(v.number()) },
  returns: v.object({ deleted: v.number(), done: v.boolean() }),
  handler: async (ctx, args) => {
    assertE2eFixtureTarget();
    const { primary, other } = await requireOwnedIdentities(ctx, args);
    return await cleanupOwned(ctx, args, {
      primary: primary._id,
      other: other._id,
    });
  },
});

/** Compensation for partially delivered identities; never relaxes prepare. */
export const cleanupPartial = internalMutation({
  args: {
    confirmation: v.literal(E2E_FIXTURE_CONFIRMATION),
    runId: v.string(),
    clerkOrganizationId: v.optional(v.string()),
    otherClerkOrganizationId: v.optional(v.string()),
    clerkUserId: v.optional(v.string()),
    clerkMembershipId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    deleted: v.number(),
    done: v.boolean(),
    mirrorsPending: v.number(),
  }),
  handler: async (ctx, args) => {
    assertE2eFixtureTarget();
    assertRunId(args.runId);
    const supplied = [
      args.clerkOrganizationId,
      args.otherClerkOrganizationId,
      args.clerkUserId,
      args.clerkMembershipId,
    ];
    if (
      supplied.some(
        (id) => id !== undefined && (id.trim() !== id || id.length === 0),
      ) ||
      (args.clerkOrganizationId !== undefined &&
        args.clerkOrganizationId === args.otherClerkOrganizationId)
    ) {
      throw new E2eFixtureRefusal("Partial cleanup identity IDs are invalid.");
    }
    let mirrorsPending = 0;
    let primaryTerminalTimestamp: number | undefined;
    let userTerminalTimestamp: number | undefined;
    const resolveOrg = async (
      id: string | undefined,
      kind: "primary" | "other",
    ) => {
      if (id === undefined) return undefined;
      const rows = await ctx.db
        .query("organizations")
        .withIndex("by_clerkOrganizationId", (q) =>
          q.eq("clerkOrganizationId", id),
        )
        .take(2);
      if (
        rows.length > 1 ||
        rows.some(
          (row) =>
            row.clerkOrganizationId !== id ||
            row.name !== organizationName(args.runId, kind),
        )
      ) {
        throw new E2eFixtureRefusal(
          "Partial cleanup organization is not owned by this run.",
        );
      }
      if (
        rows.length === 0 ||
        rows[0]!.status !== "CLOSED" ||
        !verifiedMirror(rows[0]!)
      )
        mirrorsPending += 1;
      else if (kind === "primary")
        primaryTerminalTimestamp = rows[0]!.clerkLastEventTimestamp!;
      return rows[0]?._id;
    };
    const primary = await resolveOrg(args.clerkOrganizationId, "primary");
    const other = await resolveOrg(args.otherClerkOrganizationId, "other");
    if (args.clerkUserId !== undefined) {
      const rows = await ctx.db
        .query("users")
        .withIndex("by_clerkUserId", (q) =>
          q.eq("clerkUserId", args.clerkUserId!),
        )
        .take(2);
      if (
        rows.length > 1 ||
        rows.some(
          (row) =>
            row.clerkUserId !== args.clerkUserId ||
            row.displayName !== userDisplayName(args.runId),
        )
      ) {
        throw new E2eFixtureRefusal(
          "Partial cleanup user is not owned by this run.",
        );
      }
      if (
        rows.length === 0 ||
        rows[0]!.status !== "DEACTIVATED" ||
        !verifiedMirror(rows[0]!)
      )
        mirrorsPending += 1;
      else userTerminalTimestamp = rows[0]!.clerkLastEventTimestamp!;
    }
    if (args.clerkMembershipId !== undefined) {
      if (
        args.clerkOrganizationId === undefined ||
        args.clerkUserId === undefined
      ) {
        throw new E2eFixtureRefusal(
          "Partial membership cleanup requires its owned organization and user IDs.",
        );
      }
      if (primary !== undefined) {
        const rows = await ctx.db
          .query("memberships")
          .withIndex("by_orgId_clerkMembershipId", (q) =>
            q
              .eq("orgId", primary)
              .eq("clerkMembershipId", args.clerkMembershipId!),
          )
          .take(2);
        if (rows.length > 1)
          throw new E2eFixtureRefusal("Partial membership is ambiguous.");
        for (const row of rows) {
          const user = await ctx.db.get("users", row.userId);
          if (
            row.orgId !== primary ||
            user === null ||
            user.clerkUserId !== args.clerkUserId ||
            user.displayName !== userDisplayName(args.runId)
          ) {
            throw new E2eFixtureRefusal(
              "Partial cleanup membership is not owned by this run.",
            );
          }
        }
        const member = rows[0];
        if (member !== undefined) {
          const current = (
            await Promise.all(
              (["ACTIVE", "SUSPENDED"] as const).map((status) =>
                ctx.db
                  .query("memberships")
                  .withIndex("by_orgId_status_userId", (q) =>
                    q
                      .eq("orgId", primary)
                      .eq("status", status)
                      .eq("userId", member.userId),
                  )
                  .take(2),
              ),
            )
          ).flat();
          if (current.length > 1)
            throw new E2eFixtureRefusal(
              "Partial membership current rows are ambiguous.",
            );
        }
        // Clerk parent deletion can omit membership.deleted. A retained exact
        // historical member is settled only by its own verified source clock
        // plus BOTH later signed terminal parents. Never synthesize a member
        // revocation or change a watermark; missing/legacy clocks stay pending.
        const verified = member !== undefined && verifiedMirror(member);
        const directlyRevoked = verified && member.status === "REVOKED";
        const terminalParents =
          verified &&
          primaryTerminalTimestamp !== undefined &&
          userTerminalTimestamp !== undefined &&
          primaryTerminalTimestamp >= member.clerkLastEventTimestamp! &&
          userTerminalTimestamp >= member.clerkLastEventTimestamp!;
        if (!directlyRevoked && !terminalParents) mirrorsPending += 1;
      } else mirrorsPending += 1;
    }
    const result = await cleanupOwned(ctx, args, {
      ...(primary === undefined ? {} : { primary }),
      ...(other === undefined ? {} : { other }),
    });
    return { ...result, mirrorsPending };
  },
});

/** A bounded stale check for this exact owned run, never shared-tenant sweeping. */
export const staleRuns = internalQuery({
  args: { ...ownershipArgs, olderThanMs: v.number() },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    assertE2eFixtureTarget();
    const { primary } = await requireOwnedIdentities(ctx, args);
    if (
      !Number.isSafeInteger(args.olderThanMs) ||
      args.olderThanMs < MIN_STALE_AGE_MS
    ) {
      throw new E2eFixtureRefusal(
        "Stale age must be an integer of at least one hour.",
      );
    }
    const rows = await ctx.db
      .query("warehouses")
      .withIndex("by_orgId_code", (q) =>
        q.eq("orgId", primary._id).eq("code", runWarehouseCode(args.runId)),
      )
      .take(2);
    return rows.length === 1 &&
      rows[0]!.name === warehouseNames(args.runId).run &&
      rows[0]!._creationTime < Date.now() - args.olderThanMs
      ? [args.runId]
      : [];
  },
});

export const identityStatus = internalQuery({
  args: ownershipArgs,
  returns: v.object({
    ready: v.boolean(),
    organizations: v.number(),
    user: v.boolean(),
    membership: v.boolean(),
  }),
  handler: async (ctx, args) => {
    assertE2eFixtureTarget();
    const { primary, other, user, membership } = await readOwnedIdentities(
      ctx,
      args,
    );
    return {
      ready:
        primary !== null &&
        other !== null &&
        primary._id !== other._id &&
        user !== null &&
        membership !== null,
      organizations: Number(primary !== null) + Number(other !== null),
      user: user !== null,
      membership: membership !== null,
    };
  },
});
