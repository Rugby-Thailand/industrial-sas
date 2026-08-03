/**
 * Tenant-bound registration paths for every public Convex function, and the one
 * place authorization is enforced.
 *
 * Every public function in this repository is registered through `queryWithOrg`,
 * `mutationWithOrg`, or `actionWithOrg`. `scripts/verify-tenant-boundary.mjs`
 * fails the build if any other production Convex module names a registration
 * builder, and — since T07b — if any of these three is called without a
 * code-owned, non-`PLATFORM` `permissionCode` literal. There is therefore no
 * public entry point that is authenticated but unauthorized (`INV-0006-01`).
 *
 * ### What one request does
 *
 * 1. **Mint a request ID** server-side. The caller cannot supply or influence it
 *    (plan §7.4); every denial and every audit row quotes it.
 * 2. **Resolve the tenant** through `resolveTenantContext` — verified identity,
 *    active-organization claim, mirrored actor, active membership, and (when the
 *    definition selects one) a warehouse proved to exist, belong to this tenant, be
 *    `ACTIVE`, and be inside the membership's scope.
 * 3. **Authorize** by reading the actor's authorization facts from the active
 *    tenant only (`authorizationLookupsConvex.ts`), running the server-side context
 *    policy when the permission has one, and handing the result to the ordered
 *    fail-closed evaluator in `permissions.ts`.
 * 4. **Audit the attempt** — allowed or denied — where the execution model can
 *    commit it (see below).
 * 5. **Run the handler** only if the decision allowed it, with a context that
 *    holds no raw database.
 *
 * ### Why a denial is a return value, not a throw
 *
 * A Convex mutation is one transaction: a row written and then a `throw` is a row
 * that never existed. An authorization denial that threw would therefore *delete
 * its own audit record*, and an audit trail that records only permitted attempts
 * cannot answer "who tried" — the question `INV-0006-10` exists for.
 *
 * So the three wrappers answer with a discriminated `TenantFunctionOutcome`:
 * `{ ok: true, value }` or `{ ok: false, denial }`. The denial branch lets the
 * transaction commit, which is what makes the `DENIED` row durable. Callers switch
 * on `ok`; nothing about the failure is thrown, so nothing about it can be lost by
 * rolling back.
 *
 * Per execution model, stated exactly:
 *
 * - **`mutationWithOrg`** — the decision and its audit row are written in the same
 *   transaction as the operation they guard (`INV-0006-03`). A denial commits the
 *   `DENIED` row and returns. An allowed attempt commits the `ALLOWED` row *and*
 *   the handler's writes together; if the handler throws, both roll back, so there
 *   is no audit row claiming an effect that did not happen.
 * - **`actionWithOrg`** — an action is not transactional and has no database, so
 *   authorization runs in an internal *mutation* preflight that commits its audit
 *   row before any external work begins. The action then either returns the denial
 *   or runs the handler. A preflight that threw would roll its own row back, which
 *   is why it returns its verdict too.
 * - **`queryWithOrg`** — a Convex query cannot write, so **an authorization
 *   attempt on a query produces no audit row.** That is a real observability gap,
 *   not an oversight: denied reads are not recorded, so "who tried to read this"
 *   is unanswerable from `auditEvents` today. The decision is still enforced, and
 *   still returns the same generic denial. Closing the gap needs a write-capable
 *   path for read attempts — an action or scheduled sink that a query cannot
 *   invoke — and is tracked as gate `RG-071` (docs/release-gates.md) together with
 *   the sink obligation in
 *   [INT-05](../../docs/integration-contracts/observability-port.md).
 *
 * ### What a caller cannot influence
 *
 * `orgId`, the actor, the permission code, the entitlement key, the audit target
 * table, the request ID, the step-up window, and the threshold and maker-checker
 * facts are all server-owned. The only client-influenced inputs are the selected
 * warehouse (revalidated before it is used, and only read by a `WAREHOUSE`-scoped
 * decision), the audit target ID (recorded only after this tenant is proved to own
 * it), and the device installation ID (correlation only — it resolves an
 * organization-bound device row and grants nothing, `ADR-0006` §8).
 *
 * Baseline: [PROJECT_PLAN.md](../../PROJECT_PLAN.md) §6.1, §6.2, §7.4, §12;
 * [ADR-0001](../../docs/adr/0001-multi-tenant-saas-and-identity-ownership.md),
 * [ADR-0002](../../docs/adr/0002-convex-tenant-boundary-and-index-discipline.md),
 * [ADR-0006](../../docs/adr/0006-authorization-and-support-access.md).
 */
import {
  actionGeneric,
  internalMutationGeneric,
  makeFunctionReference,
  mutationGeneric,
  queryGeneric,
  type ArgsArrayForOptionalValidator,
  type ArgsArrayToObject,
  type DefaultArgsForOptionalValidator,
  type GenericActionCtx,
  type GenericMutationCtx,
  type GenericQueryCtx,
  type RegisteredAction,
  type RegisteredMutation,
  type RegisteredQuery,
  type ReturnValueForOptionalValidator,
  type UserIdentity,
} from "convex/server";
import {
  ConvexError,
  v,
  type PropertyValidators,
  type Validator,
  type Value,
} from "convex/values";

import type { DataModel } from "../schema";
import {
  AUTHORIZATION_DENIAL_CODE,
  AUTHORIZATION_DENIAL_MESSAGE,
  NO_AUTHORIZATION_POLICY_FACTS,
  appendAuthorizationAudit,
  assertAuthorizationDeclaration,
  decideAuthorization,
  resolveAuthorizationFacts,
  sanitizeAuthorizationPolicyFacts,
  toPublicAuthorizationDenial,
  usableInstallationId,
  type AuthorizationPolicyFacts,
  type DeviceId,
  type PublicAuthorizationDenial,
  type TenantFunctionKind,
} from "./authorization";
import { createConvexAuthorizationLookups } from "./authorizationLookupsConvex";
import type { PermissionDefinition } from "./permissions";
import type { TenantTableName } from "./schemaPolicy";
import {
  TENANT_CONTEXT_DENIAL_CODES,
  TENANT_CONTEXT_DENIAL_MESSAGE,
  resolveTenantContext,
  toPublicDenial,
  type ActiveTenantContext,
  type OrganizationId,
  type WarehouseId,
} from "./tenantContext";
import { createConvexTenantContextLookups } from "./tenantContextLookups";
import {
  createTenantDocumentAccess,
  TENANT_DB_ERROR_CODES,
  TenantDbError,
  type TenantDocumentAccess,
} from "./tenantDb";
import {
  createMutationTenantStorage,
  createQueryTenantStorage,
} from "./tenantStorage";
import type { DenialReason } from "./validators";

type FunctionValidator =
  PropertyValidators | Validator<unknown, "required", string> | void;

/** The complete capability set a tenant feature handler receives. */
export interface TenantFunctionContext {
  readonly requestId: string;
  readonly identity: UserIdentity;
  readonly tenant: ActiveTenantContext;
  readonly tenantDb: TenantDocumentAccess;
  /** The catalogue definition this call was authorized against. */
  readonly permission: PermissionDefinition;
}

/** Actions receive identity and tenancy, never database or raw Convex runners. */
export interface TenantActionFunctionContext {
  readonly requestId: string;
  readonly identity: UserIdentity;
  readonly tenant: ActiveTenantContext;
  readonly permission: PermissionDefinition;
}

/** What a context policy is given: trusted tenancy, and a bound database. */
export interface TenantPolicyContext {
  readonly requestId: string;
  readonly tenant: ActiveTenantContext;
  readonly tenantDb: TenantDocumentAccess;
  readonly permission: PermissionDefinition;
  /** The clock the decision is made against, so a policy cannot use its own. */
  readonly now: number;
}

export interface PublicTenantFunctionFailure {
  readonly [key: string]: Value | undefined;
  readonly code: string;
  readonly requestId: string;
}

/**
 * What a public tenant function answers with.
 *
 * A value or a denial, never a thrown denial — see the module note. `requestId` is
 * on both branches because a caller that succeeded still needs the correlation ID
 * to report a problem with what it got back.
 */
export type TenantFunctionOutcome<Value> =
  | { readonly ok: true; readonly requestId: string; readonly value: Value }
  | {
      readonly ok: false;
      readonly requestId: string;
      readonly denial: PublicAuthorizationDenial;
    };

/**
 * The audit target of an operation: a tenant table, and optionally a document in
 * it selected from the arguments.
 *
 * The table is a code-owned constant, checked at registration. The ID is a
 * selector, and what it returns is *verified* before it is recorded — the wrapper
 * reads the document through the tenant-bound accessor and records the ID only if
 * this tenant owns it, so an audit row can never name another tenant's document
 * (`INV-0002-03`).
 */
export interface TenantFunctionTarget<Args> {
  readonly table: TenantTableName;
  readonly id?: (args: Args) => string | undefined;
}

type TenantFunctionDefinition<
  ArgsValidator extends FunctionValidator,
  ReturnsValidator extends FunctionValidator,
  ReturnValue,
  OneOrZeroArgs extends ArgsArrayForOptionalValidator<ArgsValidator>,
> = {
  readonly args?: ArgsValidator;
  readonly returns?: ReturnsValidator;
  /** The code-owned permission this operation requires (`INV-0006-01`). */
  readonly permissionCode: string;
  /** What the audit row names as the target of the attempt. */
  readonly target: TenantFunctionTarget<OneOrZeroArgs[0]>;
  /** A code-owned entitlement key this operation additionally requires (D-30). */
  readonly entitlementKey?: string;
  /** Selects the warehouse to revalidate, when this operation is warehouse-bound. */
  readonly warehouseId?: (args: OneOrZeroArgs[0]) => WarehouseId | undefined;
  /** Selects the opaque device installation ID, for correlation only. */
  readonly installationId?: (args: OneOrZeroArgs[0]) => string | undefined;
  /**
   * Computes threshold and maker-checker facts server-side, from the trusted
   * context and database. Required for a permission that needs them, refused for
   * one that does not (`INV-0006-06`).
   */
  readonly policy?: (
    ctx: TenantPolicyContext,
    ...args: OneOrZeroArgs
  ) => AuthorizationPolicyFacts | Promise<AuthorizationPolicyFacts>;
  readonly handler: (
    ctx: TenantFunctionContext,
    ...args: OneOrZeroArgs
  ) => ReturnValue;
};

type TenantActionDefinition<
  ArgsValidator extends FunctionValidator,
  ReturnsValidator extends FunctionValidator,
  ReturnValue,
  OneOrZeroArgs extends ArgsArrayForOptionalValidator<ArgsValidator>,
> = Omit<
  TenantFunctionDefinition<
    ArgsValidator,
    ReturnsValidator,
    ReturnValue,
    OneOrZeroArgs
  >,
  "handler" | "policy"
> & {
  readonly handler: (
    ctx: TenantActionFunctionContext,
    ...args: OneOrZeroArgs
  ) => ReturnValue;
};

type RawTenantContext =
  GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>;

type StorageFactory = (
  ctx: RawTenantContext,
  requestId: string,
) => Parameters<typeof createTenantDocumentAccess>[1];

class SafeTenantFunctionFailure extends Error {
  readonly data: Value;

  constructor(data: Value) {
    super("Tenant function denied the request.");
    this.name = "SafeTenantFunctionFailure";
    this.data = data;
  }
}

/** Mint a UUIDv7 without accepting correlation data from the caller. */
export function mintRequestId(now = Date.now()): string {
  if (!Number.isSafeInteger(now) || now < 0 || now > 0xffffffffffff) {
    throw new Error("Cannot mint a request ID from this clock value.");
  }

  const bytes = new Uint8Array(16);
  const random = new Uint8Array(10);
  crypto.getRandomValues(random);

  let timestamp = now;
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = timestamp % 256;
    timestamp = Math.floor(timestamp / 256);
  }
  bytes[6] = 0x70 | (random[0]! & 0x0f);
  bytes[7] = random[1]!;
  bytes[8] = 0x80 | (random[2]! & 0x3f);
  for (let index = 9; index < 16; index += 1) {
    bytes[index] = random[index - 6]!;
  }

  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function internalFailure(requestId: string): PublicTenantFunctionFailure {
  return Object.freeze({ code: "INTERNAL_ERROR", requestId });
}

function publicDatabaseFailure(error: TenantDbError): Value {
  return { ...error.toPublic() };
}

function isSafePreflightFailure(data: Value, requestId: string): boolean {
  if (data === null || Array.isArray(data) || typeof data !== "object") {
    return false;
  }
  if (Object.getPrototypeOf(data) !== Object.prototype) return false;
  const record = data as { readonly [key: string]: Value | undefined };
  if (record.requestId !== requestId || typeof record.code !== "string") {
    return false;
  }

  const keys = Object.keys(record).sort();
  const databaseFailure =
    keys.join(",") === "code,requestId" &&
    (TENANT_DB_ERROR_CODES as readonly string[]).includes(record.code);
  const contextFailure =
    keys.join(",") === "code,kind,message,requestId" &&
    record.kind === "TENANT_CONTEXT_DENIED" &&
    record.message === TENANT_CONTEXT_DENIAL_MESSAGE &&
    (TENANT_CONTEXT_DENIAL_CODES as readonly string[]).includes(record.code);
  return databaseFailure || contextFailure;
}

/* -------------------------------------------------------------------------- */
/* Return validators                                                           */
/* -------------------------------------------------------------------------- */

/** The declared shape of a public denial, so the envelope validates truthfully. */
const denialValidator = v.object({
  kind: v.literal("AUTHORIZATION_DENIED"),
  code: v.literal(AUTHORIZATION_DENIAL_CODE),
  requestId: v.string(),
  message: v.literal(AUTHORIZATION_DENIAL_MESSAGE),
});

/** A Convex validator, as distinct from a bare map of field validators. */
function isValidator(
  value: PropertyValidators | Validator<unknown, "required", string>,
): value is Validator<unknown, "required", string> {
  return "isConvexValidator" in value;
}

/**
 * Wrap a definition's `returns` validator in the outcome envelope.
 *
 * Necessary because the envelope is what the function actually answers with: a
 * declared validator describing only the success value would reject every denial
 * at the boundary, which is a denial turning into an internal error.
 */
function outcomeReturns(
  returns: PropertyValidators | Validator<unknown, "required", string>,
): Validator<unknown, "required", string> {
  const value = isValidator(returns) ? returns : v.object(returns);
  return v.union(
    v.object({ ok: v.literal(true), requestId: v.string(), value }),
    v.object({
      ok: v.literal(false),
      requestId: v.string(),
      denial: denialValidator,
    }),
  ) as unknown as Validator<unknown, "required", string>;
}

/* -------------------------------------------------------------------------- */
/* Authorization                                                               */
/* -------------------------------------------------------------------------- */

/** Everything the wrapper needs to authorize one call, resolved at registration. */
interface AuthorizationSpec<Args extends readonly unknown[]> {
  readonly permission: PermissionDefinition;
  readonly target: TenantFunctionTarget<Args[0]>;
  readonly entitlementKey?: string;
  readonly installationId?: (args: Args[0]) => string | undefined;
  readonly policy?: (
    ctx: TenantPolicyContext,
    ...args: Args
  ) => AuthorizationPolicyFacts | Promise<AuthorizationPolicyFacts>;
}

/**
 * Decide one request and record the attempt.
 *
 * `audit` is `false` only for a query, which cannot write; every other caller
 * passes `true` and the row is committed by the surrounding transaction. The
 * decision is identical either way — the audit row is evidence, never the check.
 *
 * A policy callback that throws contributes no facts. That is deliberately not a
 * pass-through of the error: the permission that has a policy is by construction
 * one that requires threshold or maker-checker facts, so absent facts deny with
 * the reason the audit row needs, and a broken policy cannot become an allowed
 * request.
 */
async function authorizeTenantRequest<Args extends readonly unknown[]>(input: {
  readonly rawContext: RawTenantContext;
  readonly requestId: string;
  readonly tenant: ActiveTenantContext;
  readonly tenantDb: TenantDocumentAccess;
  readonly spec: AuthorizationSpec<Args>;
  readonly args: Args;
  readonly audit: boolean;
}): Promise<boolean> {
  const { rawContext, requestId, tenant, tenantDb, spec, args, audit } = input;
  const now = Date.now();
  const orgId = tenant.organization._id;
  const actorUserId = tenant.actor._id;
  // The warehouse the *server* resolved and revalidated, never the argument the
  // caller sent: `resolveTenantContext` proved existence, ownership, status, and
  // membership scope before this line (`INV-0006-04`).
  const targetWarehouseId = tenant.warehouse?._id;
  const lookups = createConvexAuthorizationLookups(rawContext, requestId);
  const permission = spec.permission;

  // Both of these exist only to fill in the audit row, so they are not read on a
  // path that cannot write one. Neither is an input to the decision: a device
  // grants nothing, and a target is what the attempt was aimed at.
  const deviceId = audit
    ? await resolveDeviceCorrelation({
        lookups,
        orgId,
        installationId: spec.installationId?.(args[0]),
      })
    : undefined;
  const entityId = audit
    ? await verifiedTargetId({
        tenantDb,
        table: spec.target.table,
        id: spec.target.id?.(args[0]),
      })
    : undefined;

  const facts = await resolveAuthorizationFacts({
    permission,
    orgId,
    actorUserId,
    membershipId: tenant.membership._id,
    ...(targetWarehouseId === undefined ? {} : { targetWarehouseId }),
    ...(spec.entitlementKey === undefined
      ? {}
      : { entitlementKey: spec.entitlementKey }),
    now,
    lookups,
  });

  let reason: DenialReason | undefined;
  if (!facts.ok) {
    reason = facts.reason;
  } else {
    let policyFacts = NO_AUTHORIZATION_POLICY_FACTS;
    if (spec.policy !== undefined) {
      try {
        policyFacts = sanitizeAuthorizationPolicyFacts(
          await spec.policy(
            Object.freeze({ requestId, tenant, tenantDb, permission, now }),
            ...args,
          ),
        );
      } catch {
        policyFacts = NO_AUTHORIZATION_POLICY_FACTS;
      }
    }
    const decision = decideAuthorization({
      permission,
      actorUserId,
      facts: facts.facts,
      policy: policyFacts,
      ...(targetWarehouseId === undefined ? {} : { targetWarehouseId }),
      now,
    });
    reason = decision.allowed ? undefined : decision.reason;
  }

  if (audit) {
    await appendAuthorizationAudit(tenantDb, {
      requestId,
      occurredAt: now,
      actorUserId,
      permissionCode: permission.code,
      entityTable: spec.target.table,
      ...(entityId === undefined ? {} : { entityId }),
      ...(targetWarehouseId === undefined
        ? {}
        : { warehouseId: targetWarehouseId }),
      ...(deviceId === undefined ? {} : { deviceId }),
      outcome: reason === undefined ? "ALLOWED" : "DENIED",
      ...(reason === undefined ? {} : { denialReason: reason }),
    });
  }

  return reason === undefined;
}

/**
 * Resolve the device an installation ID names, for correlation only.
 *
 * Never a client-supplied `devices` document ID: the only accepted input is the
 * opaque installation value the PWA mints, and it is resolved through the
 * organization's own index, so a value belonging to another tenant resolves to
 * nothing. A missing or unusable value costs the row its `deviceId` and changes no
 * decision (`ADR-0006` §8).
 */
async function resolveDeviceCorrelation(input: {
  readonly lookups: ReturnType<typeof createConvexAuthorizationLookups>;
  readonly orgId: OrganizationId;
  readonly installationId: string | undefined;
}): Promise<DeviceId | undefined> {
  const installationId = usableInstallationId(input.installationId);
  if (installationId === null) return undefined;
  const device = await input.lookups.findDeviceByInstallationId({
    orgId: input.orgId,
    installationId,
  });
  return device === null ? undefined : device._id;
}

/**
 * Narrow a selected target ID to one this tenant provably owns, or `undefined`.
 *
 * The read is the tenant-bound accessor's, so absent, malformed, and foreign are
 * one answer. An audit row therefore names either a document of this tenant or no
 * document at all — never an ID the caller made up, and never an ID that would
 * confirm the existence of another tenant's row.
 */
async function verifiedTargetId(input: {
  readonly tenantDb: TenantDocumentAccess;
  readonly table: TenantTableName;
  readonly id: string | undefined;
}): Promise<string | undefined> {
  const { tenantDb, table, id } = input;
  if (id === undefined || id.length === 0) return undefined;
  const document = await tenantDb.get(table, id);
  return document === null ? undefined : id;
}

/* -------------------------------------------------------------------------- */
/* Query and mutation                                                         */
/* -------------------------------------------------------------------------- */

async function runTenantHandler<Args extends readonly unknown[], ReturnValue>(
  rawContext: RawTenantContext,
  args: Args,
  warehouseId: ((args: Args[0]) => WarehouseId | undefined) | undefined,
  spec: AuthorizationSpec<Args>,
  storageFactory: StorageFactory,
  audit: boolean,
  handler: (ctx: TenantFunctionContext, ...args: Args) => ReturnValue,
): Promise<TenantFunctionOutcome<Awaited<ReturnValue>>> {
  const requestId = mintRequestId();

  try {
    const identity = await rawContext.auth.getUserIdentity();
    const selectedWarehouse = warehouseId?.(args[0]);
    const resolved = await resolveTenantContext({
      requestId,
      identity,
      lookups: createConvexTenantContextLookups(rawContext, requestId),
      ...(selectedWarehouse === undefined
        ? {}
        : { warehouseId: selectedWarehouse }),
    });

    if (!resolved.ok) {
      throw new SafeTenantFunctionFailure(toPublicDenial(resolved.denial));
    }

    const tenantDb = createTenantDocumentAccess(
      { orgId: resolved.context.organization._id, requestId },
      storageFactory(rawContext, requestId),
    );

    const allowed = await authorizeTenantRequest({
      rawContext,
      requestId,
      tenant: resolved.context,
      tenantDb,
      spec,
      args,
      audit,
    });
    if (!allowed) {
      return Object.freeze({
        ok: false as const,
        requestId,
        denial: toPublicAuthorizationDenial(requestId),
      });
    }

    const narrowed = Object.freeze({
      requestId,
      identity: identity!,
      tenant: resolved.context,
      tenantDb,
      permission: spec.permission,
    });

    return Object.freeze({
      ok: true as const,
      requestId,
      value: (await handler(narrowed, ...args)) as Awaited<ReturnValue>,
    });
  } catch (error) {
    if (error instanceof SafeTenantFunctionFailure) {
      throw new ConvexError(error.data);
    }
    if (error instanceof TenantDbError) {
      // Spread rather than passed straight through: `PublicTenantDbError` is an
      // interface, so it has no implicit index signature and is not a `Value`.
      // The spread keeps `toPublic()` as the single conversion seam, so a field
      // added or redacted there still reaches the client through this throw.
      throw new ConvexError(publicDatabaseFailure(error));
    }
    throw new ConvexError(internalFailure(requestId));
  }
}

/* -------------------------------------------------------------------------- */
/* Action preflight                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The authenticated, authorized, audited preflight used only by `actionWithOrg`.
 *
 * An internal **mutation**, not a query, for one reason: it must be able to commit
 * the audit row of an authorization attempt before the action does anything
 * external. Its own transaction commits when it returns — including when it
 * returns a denial — which is why a denial here is a value and not a throw.
 *
 * It re-validates the declaration it is handed rather than trusting the caller.
 * Only a Convex function can call an internal function, and the only caller is
 * `actionWithOrg` a few lines below, but "the only caller is correct" is a claim
 * with a shelf life; `assertAuthorizationDeclaration` is cheap and total.
 *
 * There is no `policy` parameter and no way to add one: a callback cannot cross a
 * function reference, so a threshold or maker-checker permission is refused on an
 * action outright (`authorization.ts`).
 */
export const actionAuthorizationPreflight = internalMutationGeneric({
  args: {
    requestId: v.string(),
    permissionCode: v.string(),
    targetTable: v.string(),
    targetId: v.optional(v.string()),
    warehouseId: v.optional(v.id("warehouses")),
    installationId: v.optional(v.string()),
    entitlementKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { requestId } = args;
    try {
      const permission = assertAuthorizationDeclaration("action", {
        permissionCode: args.permissionCode,
        targetTable: args.targetTable,
        hasWarehouseSelector: args.warehouseId !== undefined,
        hasPolicy: false,
        ...(args.entitlementKey === undefined
          ? {}
          : { entitlementKey: args.entitlementKey }),
      });

      const resolved = await resolveTenantContext({
        requestId,
        identity: await ctx.auth.getUserIdentity(),
        lookups: createConvexTenantContextLookups(ctx, requestId),
        ...(args.warehouseId === undefined
          ? {}
          : { warehouseId: args.warehouseId }),
      });
      if (!resolved.ok) throw new ConvexError(toPublicDenial(resolved.denial));

      const tenantDb = createTenantDocumentAccess(
        { orgId: resolved.context.organization._id, requestId },
        createMutationTenantStorage(ctx, requestId),
      );
      const allowed = await authorizeTenantRequest({
        rawContext: ctx,
        requestId,
        tenant: resolved.context,
        tenantDb,
        spec: {
          permission,
          target: {
            table: args.targetTable as TenantTableName,
            ...(args.targetId === undefined ? {} : { id: () => args.targetId }),
          },
          ...(args.entitlementKey === undefined
            ? {}
            : { entitlementKey: args.entitlementKey }),
          ...(args.installationId === undefined
            ? {}
            : { installationId: () => args.installationId }),
        },
        args: [undefined] as [undefined],
        audit: true,
      });

      return allowed
        ? { ok: true as const, context: resolved.context }
        : { ok: false as const };
    } catch (error) {
      if (error instanceof ConvexError) throw error;
      if (error instanceof TenantDbError) {
        throw new ConvexError(publicDatabaseFailure(error));
      }
      throw new ConvexError(internalFailure(requestId));
    }
  },
});

/** The verdict the preflight hands back to the action. */
type PreflightVerdict =
  | { readonly ok: true; readonly context: ActiveTenantContext }
  | { readonly ok: false };

const actionAuthorizationPreflightReference = makeFunctionReference<
  "mutation",
  {
    readonly requestId: string;
    readonly permissionCode: string;
    readonly targetTable: string;
    readonly targetId?: string;
    readonly warehouseId?: WarehouseId;
    readonly installationId?: string;
    readonly entitlementKey?: string;
  },
  PreflightVerdict
>("lib/tenantFunctions:actionAuthorizationPreflight");

async function runTenantAction<Args extends readonly unknown[], ReturnValue>(
  rawContext: GenericActionCtx<DataModel>,
  args: Args,
  warehouseId: ((args: Args[0]) => WarehouseId | undefined) | undefined,
  spec: AuthorizationSpec<Args>,
  handler: (ctx: TenantActionFunctionContext, ...args: Args) => ReturnValue,
): Promise<TenantFunctionOutcome<Awaited<ReturnValue>>> {
  const requestId = mintRequestId();
  let identity: UserIdentity | null;
  let verdict: PreflightVerdict;

  try {
    identity = await rawContext.auth.getUserIdentity();
    const selectedWarehouse = warehouseId?.(args[0]);
    const selectedInstallation = spec.installationId?.(args[0]);
    const selectedTarget = spec.target.id?.(args[0]);
    verdict = await rawContext.runMutation(
      actionAuthorizationPreflightReference,
      {
        requestId,
        permissionCode: spec.permission.code,
        targetTable: spec.target.table,
        ...(selectedTarget === undefined ? {} : { targetId: selectedTarget }),
        ...(selectedWarehouse === undefined
          ? {}
          : { warehouseId: selectedWarehouse }),
        ...(selectedInstallation === undefined
          ? {}
          : { installationId: selectedInstallation }),
        ...(spec.entitlementKey === undefined
          ? {}
          : { entitlementKey: spec.entitlementKey }),
      },
    );
  } catch (error) {
    if (
      error instanceof ConvexError &&
      isSafePreflightFailure(error.data, requestId)
    ) {
      throw error;
    }
    throw new ConvexError(internalFailure(requestId));
  }

  if (identity === null) throw new ConvexError(internalFailure(requestId));
  if (!verdict.ok) {
    // The preflight's transaction has already committed the `DENIED` audit row.
    return Object.freeze({
      ok: false as const,
      requestId,
      denial: toPublicAuthorizationDenial(requestId),
    });
  }

  const narrowed = Object.freeze({
    requestId,
    identity,
    tenant: verdict.context,
    permission: spec.permission,
  });

  try {
    return Object.freeze({
      ok: true as const,
      requestId,
      value: (await handler(narrowed, ...args)) as Awaited<ReturnValue>,
    });
  } catch {
    throw new ConvexError(internalFailure(requestId));
  }
}

/* -------------------------------------------------------------------------- */
/* Registration                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Build the authorization spec of a definition, refusing to register it when the
 * declaration cannot be enforced.
 *
 * Runs at module evaluation. A mis-declared function therefore fails when its
 * module is imported — by a test, by `convex dev`, or by a deploy — rather than on
 * the first request that needed the check.
 */
function authorizationSpecOf<Args extends readonly unknown[]>(
  kind: TenantFunctionKind,
  definition: {
    readonly permissionCode: string;
    readonly target: TenantFunctionTarget<Args[0]>;
    readonly entitlementKey?: string;
    readonly warehouseId?: (args: Args[0]) => WarehouseId | undefined;
    readonly installationId?: (args: Args[0]) => string | undefined;
    readonly policy?: (
      ctx: TenantPolicyContext,
      ...args: Args
    ) => AuthorizationPolicyFacts | Promise<AuthorizationPolicyFacts>;
  },
): AuthorizationSpec<Args> {
  const permission = assertAuthorizationDeclaration(kind, {
    permissionCode: definition.permissionCode,
    targetTable: definition.target.table,
    hasWarehouseSelector: definition.warehouseId !== undefined,
    hasPolicy: definition.policy !== undefined,
    ...(definition.entitlementKey === undefined
      ? {}
      : { entitlementKey: definition.entitlementKey }),
  });

  return Object.freeze({
    permission,
    target: definition.target,
    ...(definition.entitlementKey === undefined
      ? {}
      : { entitlementKey: definition.entitlementKey }),
    ...(definition.installationId === undefined
      ? {}
      : { installationId: definition.installationId }),
    ...(definition.policy === undefined ? {} : { policy: definition.policy }),
  });
}

/**
 * The envelope validator for a definition's declared `returns`, or nothing.
 *
 * Separated so the three registration paths spread one expression instead of
 * repeating the cast that tells the compiler the runtime validator describes the
 * envelope while the generic still describes the inner value.
 */
function outcomeReturnsProperty<ReturnsValidator extends FunctionValidator>(
  returns: ReturnsValidator | undefined,
): { returns?: ReturnsValidator } {
  if (returns === undefined) return {};
  return {
    returns: outcomeReturns(
      returns as PropertyValidators | Validator<unknown, "required", string>,
    ) as unknown as ReturnsValidator,
  };
}

/** Register a public query whose handler cannot reach an unscoped database. */
export function queryWithOrg<
  ArgsValidator extends FunctionValidator,
  ReturnsValidator extends FunctionValidator,
  ReturnValue extends ReturnValueForOptionalValidator<ReturnsValidator> = never,
  OneOrZeroArgs extends ArgsArrayForOptionalValidator<ArgsValidator> =
    DefaultArgsForOptionalValidator<ArgsValidator>,
>(
  definition: TenantFunctionDefinition<
    ArgsValidator,
    ReturnsValidator,
    ReturnValue,
    OneOrZeroArgs
  >,
): RegisteredQuery<
  "public",
  ArgsArrayToObject<OneOrZeroArgs>,
  TenantFunctionOutcome<Awaited<ReturnValue>>
> {
  const spec = authorizationSpecOf<OneOrZeroArgs>("query", definition);

  return queryGeneric<
    ArgsValidator,
    ReturnsValidator,
    ReturnValue,
    OneOrZeroArgs
  >({
    ...(definition.args === undefined ? {} : { args: definition.args }),
    // The declared validator describes the envelope, which is what the function
    // answers with; the generic still describes the handler's own value.
    ...outcomeReturnsProperty<ReturnsValidator>(definition.returns),
    handler: (ctx, ...args) =>
      runTenantHandler(
        ctx,
        args,
        definition.warehouseId,
        spec,
        (raw, requestId) =>
          createQueryTenantStorage(
            raw as GenericQueryCtx<DataModel>,
            requestId,
          ),
        // A Convex query cannot write, so a query attempt is not audited. See the
        // module note and `RG-071`.
        false,
        definition.handler,
      ) as unknown as ReturnValue,
  }) as unknown as RegisteredQuery<
    "public",
    ArgsArrayToObject<OneOrZeroArgs>,
    TenantFunctionOutcome<Awaited<ReturnValue>>
  >;
}

/** Register a public mutation whose writes are tenant-owned and same-transaction. */
export function mutationWithOrg<
  ArgsValidator extends FunctionValidator,
  ReturnsValidator extends FunctionValidator,
  ReturnValue extends ReturnValueForOptionalValidator<ReturnsValidator> = never,
  OneOrZeroArgs extends ArgsArrayForOptionalValidator<ArgsValidator> =
    DefaultArgsForOptionalValidator<ArgsValidator>,
>(
  definition: TenantFunctionDefinition<
    ArgsValidator,
    ReturnsValidator,
    ReturnValue,
    OneOrZeroArgs
  >,
): RegisteredMutation<
  "public",
  ArgsArrayToObject<OneOrZeroArgs>,
  TenantFunctionOutcome<Awaited<ReturnValue>>
> {
  const spec = authorizationSpecOf<OneOrZeroArgs>("mutation", definition);

  return mutationGeneric<
    ArgsValidator,
    ReturnsValidator,
    ReturnValue,
    OneOrZeroArgs
  >({
    ...(definition.args === undefined ? {} : { args: definition.args }),
    ...outcomeReturnsProperty<ReturnsValidator>(definition.returns),
    handler: (ctx, ...args) =>
      runTenantHandler(
        ctx,
        args,
        definition.warehouseId,
        spec,
        (raw, requestId) =>
          createMutationTenantStorage(
            raw as GenericMutationCtx<DataModel>,
            requestId,
          ),
        true,
        definition.handler,
      ) as unknown as ReturnValue,
  }) as unknown as RegisteredMutation<
    "public",
    ArgsArrayToObject<OneOrZeroArgs>,
    TenantFunctionOutcome<Awaited<ReturnValue>>
  >;
}

/** Register a public action after an audited, same-identity internal preflight. */
export function actionWithOrg<
  ArgsValidator extends FunctionValidator,
  ReturnsValidator extends FunctionValidator,
  ReturnValue extends ReturnValueForOptionalValidator<ReturnsValidator> = never,
  OneOrZeroArgs extends ArgsArrayForOptionalValidator<ArgsValidator> =
    DefaultArgsForOptionalValidator<ArgsValidator>,
>(
  definition: TenantActionDefinition<
    ArgsValidator,
    ReturnsValidator,
    ReturnValue,
    OneOrZeroArgs
  >,
): RegisteredAction<
  "public",
  ArgsArrayToObject<OneOrZeroArgs>,
  TenantFunctionOutcome<Awaited<ReturnValue>>
> {
  const spec = authorizationSpecOf<OneOrZeroArgs>("action", definition);

  return actionGeneric<
    ArgsValidator,
    ReturnsValidator,
    ReturnValue,
    OneOrZeroArgs
  >({
    ...(definition.args === undefined ? {} : { args: definition.args }),
    ...outcomeReturnsProperty<ReturnsValidator>(definition.returns),
    handler: (ctx, ...args) =>
      runTenantAction(
        ctx,
        args,
        definition.warehouseId,
        spec,
        definition.handler,
      ) as unknown as ReturnValue,
  }) as unknown as RegisteredAction<
    "public",
    ArgsArrayToObject<OneOrZeroArgs>,
    TenantFunctionOutcome<Awaited<ReturnValue>>
  >;
}
