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
import {
  createPrivateFileStorage,
  type PrivateFileStoragePort,
} from "./privateFileStorage";
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

type IsAny<Value> = 0 extends 1 & Value ? true : false;

// Concrete validators define the public contract; v.any() keeps handler inference.
type RegisteredReturn<ReturnsValidator extends FunctionValidator, ReturnValue> =
  IsAny<Awaited<ReturnValueForOptionalValidator<ReturnsValidator>>> extends true
    ? Awaited<ReturnValue>
    : Awaited<ReturnValueForOptionalValidator<ReturnsValidator>>;

export interface TenantFunctionContext {
  readonly requestId: string;
  readonly identity: UserIdentity;
  readonly tenant: ActiveTenantContext;
  readonly tenantDb: TenantDocumentAccess;
  readonly privateFiles: PrivateFileStoragePort;

  readonly permission: PermissionDefinition;
}

export interface TenantActionFunctionContext {
  readonly requestId: string;
  readonly identity: UserIdentity;
  readonly tenant: ActiveTenantContext;
  readonly permission: PermissionDefinition;
}

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

export type TenantFunctionOutcome<Value> =
  | { readonly ok: true; readonly requestId: string; readonly value: Value }
  | {
      readonly ok: false;
      readonly requestId: string;
      readonly denial: PublicAuthorizationDenial;
    };

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

  readonly permissionCode: string;

  readonly target: TenantFunctionTarget<OneOrZeroArgs[0]>;

  readonly entitlementKey?: string;

  readonly warehouseId?: (args: OneOrZeroArgs[0]) => WarehouseId | undefined;

  readonly installationId?: (args: OneOrZeroArgs[0]) => string | undefined;

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

const denialValidator = v.object({
  kind: v.literal("AUTHORIZATION_DENIED"),
  code: v.literal(AUTHORIZATION_DENIAL_CODE),
  requestId: v.string(),
  message: v.literal(AUTHORIZATION_DENIAL_MESSAGE),
});

function isValidator(
  value: PropertyValidators | Validator<unknown, "required", string>,
): value is Validator<unknown, "required", string> {
  return "isConvexValidator" in value;
}

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
      privateFiles: createPrivateFileStorage(
        rawContext.storage,
        async (storageId) => {
          const metadata = await rawContext.db.system.get(
            "_storage",
            storageId,
          );
          return metadata === null
            ? null
            : {
                sha256: metadata.sha256,
                size: metadata.size,
                contentType: metadata.contentType ?? null,
              };
        },
      ),
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
      throw new ConvexError(publicDatabaseFailure(error));
    }
    throw new ConvexError(internalFailure(requestId));
  }
}

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
  TenantFunctionOutcome<RegisteredReturn<ReturnsValidator, ReturnValue>>
> {
  const spec = authorizationSpecOf<OneOrZeroArgs>("query", definition);

  return queryGeneric<
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
    TenantFunctionOutcome<RegisteredReturn<ReturnsValidator, ReturnValue>>
  >;
}

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
  TenantFunctionOutcome<RegisteredReturn<ReturnsValidator, ReturnValue>>
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
    TenantFunctionOutcome<RegisteredReturn<ReturnsValidator, ReturnValue>>
  >;
}

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
  TenantFunctionOutcome<RegisteredReturn<ReturnsValidator, ReturnValue>>
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
    TenantFunctionOutcome<RegisteredReturn<ReturnsValidator, ReturnValue>>
  >;
}
