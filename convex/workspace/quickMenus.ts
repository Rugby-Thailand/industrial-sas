/**
 * Home quick-menu pins, per member and organization.
 *
 * Shared catalog, bounds and payload types: `model/home/quickMenu.ts`.
 * All three functions sit behind the restricted OR gate of the module entry
 * permissions, so any member who can reach Home can read and save pins;
 * which keys are pinnable is decided per key from live grants.
 */
import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import {
  checkIdempotency,
  fingerprintArguments,
  writeIdempotencyRecord,
  type IdempotencyRecord,
} from "../lib/idempotency";
import { grantedPermissionsAmong } from "../lib/navigationGrants";
import {
  mutationWithOrg,
  queryWithOrg,
  type TenantFunctionContext,
} from "../lib/tenantFunctions";
import {
  HOME_ELIGIBILITY_PERMISSIONS,
  MAX_QUICK_MENU_VERSION,
  QUICK_MENU_PERMISSION_CODES,
  QUICK_MENU_REQUEST_ID,
  availableQuickMenuKeys,
  defaultPinnedKeys,
  isQuickMenuKey,
  pinnedKeysProblem,
  type QuickMenuCurrent,
  type QuickMenuKey,
  type QuickMenuReceiptStatus,
  type QuickMenuSaveRefusalCode,
  type QuickMenuSaveResult,
} from "../model/home/quickMenu";

type Preference = Doc<"homeQuickMenuPreferences">;
const TABLE = "homeQuickMenuPreferences" as const;
const OPERATION = "home.quickMenu.save";

const clerkScopeValidator = v.object({
  clerkOrgId: v.string(),
  clerkUserId: v.string(),
});

const scopedReadArgs = {
  expectedClerkScope: v.optional(clerkScopeValidator),
  readRetryAttempt: v.optional(v.number()),
};

const scopedReadPreconditions = {
  expectedClerkScope: (args: { expectedClerkScope?: ClerkScope }) =>
    args.expectedClerkScope,
  readRetryAttempt: (args: { readRetryAttempt?: number }) =>
    args.readRetryAttempt,
};

type ClerkScope = { clerkOrgId: string; clerkUserId: string };

const commandArgs = {
  requestId: v.string(),
  expectedClerkScope: clerkScopeValidator,
  expectedActorUserId: v.string(),
  expectedVersion: v.number(),
  pinnedKeys: v.array(v.string()),
};

const commandPreconditions = {
  expectedClerkScope: (args: { expectedClerkScope: ClerkScope }) =>
    args.expectedClerkScope,
  expectedActorUserId: (args: { expectedActorUserId: string }) =>
    args.expectedActorUserId,
};

export const clerkScopeOf = (ctx: TenantFunctionContext): ClerkScope => ({
  clerkOrgId: ctx.tenant.organization.clerkOrganizationId,
  clerkUserId: ctx.tenant.actor.clerkUserId,
});

async function preferenceOf(
  ctx: TenantFunctionContext,
): Promise<Preference | null> {
  return await ctx.tenantDb
    .byIndex<Preference>(TABLE, "by_orgId_userId", [
      { field: "userId", value: ctx.tenant.actor._id },
    ])
    .unique();
}

async function availableKeys(
  ctx: TenantFunctionContext,
): Promise<QuickMenuKey[]> {
  return availableQuickMenuKeys(
    await grantedPermissionsAmong(ctx, QUICK_MENU_PERMISSION_CODES),
  );
}

/** Static bounds shared by `save` and `receiptStatus`; reads nothing. */
function commandProblem(args: {
  requestId: string;
  expectedVersion: number;
  pinnedKeys: readonly string[];
}): { code: QuickMenuSaveRefusalCode; reason?: string } | null {
  if (!QUICK_MENU_REQUEST_ID.test(args.requestId))
    return { code: "REQUEST_ID_INVALID" };
  if (!Number.isSafeInteger(args.expectedVersion) || args.expectedVersion < 0)
    return { code: "VERSION_INVALID" };
  const problem = pinnedKeysProblem(args.pinnedKeys);
  if (problem !== null) return { code: "PINNED_KEYS_INVALID", reason: problem };
  return null;
}

/** Actor-namespaced, so one member's request ID never answers another's. */
const operationOf = (ctx: TenantFunctionContext) =>
  `${OPERATION}:${ctx.tenant.actor._id}`;

const requestHashOf = async (
  ctx: TenantFunctionContext,
  args: { requestId: string; expectedVersion: number; pinnedKeys: string[] },
) =>
  await fingerprintArguments({
    requestId: args.requestId,
    actorUserId: ctx.tenant.actor._id,
    expectedVersion: args.expectedVersion,
    pinnedKeys: args.pinnedKeys,
  });

/**
 * The receipt digest binds the five inputs that cannot change after the
 * write, so a replay verifies without reading the (possibly superseded)
 * preference row.
 */
async function receiptHashOf(input: {
  actorUserId: string;
  documentId: string;
  version: number;
  pinnedKeys: readonly string[];
}): Promise<string | null> {
  const hash = await fingerprintArguments({
    actorUserId: input.actorUserId,
    table: TABLE,
    documentId: input.documentId,
    version: input.version,
    pinnedKeys: [...input.pinnedKeys],
  });
  return hash.ok ? hash.value : null;
}

/** The verified receipt for this actor and request, or why there is none. */
async function verifiedReceipt(
  ctx: TenantFunctionContext,
  args: { requestId: string; expectedVersion: number; pinnedKeys: string[] },
): Promise<
  | { kind: "FRESH" }
  | { kind: "CONFLICT" }
  | { kind: "UNVERIFIABLE" }
  | { kind: "CONFIRMED"; documentId: string; version: number }
> {
  const requestHash = await requestHashOf(ctx, args);
  if (!requestHash.ok) return { kind: "CONFLICT" };
  const decision = await checkIdempotency({
    tenantDb: ctx.tenantDb,
    operation: operationOf(ctx),
    requestId: args.requestId,
    requestHash: requestHash.value,
  });
  if (!decision.ok) return { kind: "CONFLICT" };
  if (decision.value.kind === "FRESH") return { kind: "FRESH" };
  const record: IdempotencyRecord = decision.value.record;
  const version = args.expectedVersion + 1;
  if (
    record.status !== "SUCCEEDED" ||
    record.actorUserId !== ctx.tenant.actor._id ||
    record.resultRef === undefined
  )
    return { kind: "UNVERIFIABLE" };
  const expected = await receiptHashOf({
    actorUserId: ctx.tenant.actor._id,
    documentId: record.resultRef,
    version,
    pinnedKeys: args.pinnedKeys,
  });
  return expected !== null && expected === record.resultHash
    ? { kind: "CONFIRMED", documentId: record.resultRef, version }
    : { kind: "UNVERIFIABLE" };
}

export const current = queryWithOrg({
  args: scopedReadArgs,
  returns: v.any(),
  anyPermissionCodes: HOME_ELIGIBILITY_PERMISSIONS,
  preconditions: scopedReadPreconditions,
  target: { table: TABLE },
  handler: async (ctx): Promise<QuickMenuCurrent> => {
    const [available, stored] = await Promise.all([
      availableKeys(ctx),
      preferenceOf(ctx),
    ]);
    const allowed = new Set(available);
    return {
      clerkScope: clerkScopeOf(ctx),
      actorUserId: ctx.tenant.actor._id,
      availableKeys: available,
      pinnedKeys:
        stored === null
          ? defaultPinnedKeys(available)
          : stored.pinnedKeys.filter(
              (key): key is QuickMenuKey =>
                isQuickMenuKey(key) && allowed.has(key),
            ),
      customized: stored !== null,
      version: stored?.version ?? 0,
      maxVersion: MAX_QUICK_MENU_VERSION,
    };
  },
});

export const save = mutationWithOrg({
  args: commandArgs,
  returns: v.any(),
  anyPermissionCodes: HOME_ELIGIBILITY_PERMISSIONS,
  preconditions: commandPreconditions,
  target: { table: TABLE },
  handler: async (ctx, args): Promise<QuickMenuSaveResult> => {
    const refuse = (
      code: QuickMenuSaveRefusalCode,
      extra: { reason?: string; currentVersion?: number } = {},
    ): QuickMenuSaveResult => ({ ok: false, code, ...extra });

    const problem = commandProblem(args);
    if (problem !== null)
      return refuse(
        problem.code,
        problem.reason === undefined ? {} : { reason: problem.reason },
      );
    const pinnedKeys = args.pinnedKeys as QuickMenuKey[];

    // Replay before version, cap and grant checks: an answered request keeps
    // its answer even after a later save or a grant change.
    const receipt = await verifiedReceipt(ctx, args);
    if (receipt.kind === "CONFLICT") return refuse("REQUEST_ARGUMENT_CONFLICT");
    if (receipt.kind === "UNVERIFIABLE") return refuse("REPLAY_UNVERIFIABLE");
    if (receipt.kind === "CONFIRMED")
      return {
        ok: true,
        replayed: true,
        documentId: receipt.documentId,
        version: receipt.version,
        pinnedKeys,
      };

    if (args.expectedVersion >= MAX_QUICK_MENU_VERSION)
      return refuse("VERSION_LIMIT");
    const stored = await preferenceOf(ctx);
    const storedVersion = stored?.version ?? 0;
    if (storedVersion !== args.expectedVersion)
      return refuse("VERSION_STALE", { currentVersion: storedVersion });
    const allowed = new Set(await availableKeys(ctx));
    const unavailable = pinnedKeys.find((key) => !allowed.has(key));
    if (unavailable !== undefined)
      return refuse("PIN_NOT_AVAILABLE", { reason: unavailable });

    const now = Date.now();
    const version = args.expectedVersion + 1;
    let documentId: string;
    if (stored === null) {
      documentId = await ctx.tenantDb.insert(TABLE, {
        userId: ctx.tenant.actor._id,
        pinnedKeys,
        version,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      documentId = stored._id;
      await ctx.tenantDb.patch(TABLE, documentId, {
        pinnedKeys,
        version,
        updatedAt: now,
      });
    }
    const requestHash = await requestHashOf(ctx, args);
    const resultHash = await receiptHashOf({
      actorUserId: ctx.tenant.actor._id,
      documentId,
      version,
      pinnedKeys,
    });
    // Both were computed above for the same inputs; failing here rolls back.
    if (!requestHash.ok || resultHash === null)
      throw new Error("Quick-menu receipt could not be fingerprinted.");
    await writeIdempotencyRecord({
      tenantDb: ctx.tenantDb,
      operation: operationOf(ctx),
      requestId: args.requestId,
      requestHash: requestHash.value,
      resultRef: documentId,
      resultHash,
      actorUserId: ctx.tenant.actor._id,
      now,
    });
    return { ok: true, replayed: false, documentId, version, pinnedKeys };
  },
});

/**
 * Whether a save committed, for a client that lost its answer. A pure read:
 * no audit row, no write, and no version cap, so a lost MAX - 1 → MAX save
 * is still confirmable.
 */
export const receiptStatus = queryWithOrg({
  args: commandArgs,
  returns: v.any(),
  anyPermissionCodes: HOME_ELIGIBILITY_PERMISSIONS,
  preconditions: commandPreconditions,
  target: { table: TABLE },
  handler: async (ctx, args): Promise<QuickMenuReceiptStatus> => {
    if (commandProblem(args) !== null) return { status: "INVALID_INPUT" };
    const receipt = await verifiedReceipt(ctx, args);
    switch (receipt.kind) {
      case "FRESH":
        return { status: "NOT_FOUND" };
      case "CONFIRMED":
        return {
          status: "CONFIRMED",
          documentId: receipt.documentId,
          version: receipt.version,
        };
      default:
        return { status: "CONFLICT" };
    }
  },
});
