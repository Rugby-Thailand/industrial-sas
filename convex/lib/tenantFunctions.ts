/** Tenant-bound registration paths for every public Convex query and mutation. */
import {
  mutationGeneric,
  queryGeneric,
  type ArgsArrayForOptionalValidator,
  type ArgsArrayToObject,
  type DefaultArgsForOptionalValidator,
  type GenericMutationCtx,
  type GenericQueryCtx,
  type RegisteredMutation,
  type RegisteredQuery,
  type ReturnValueForOptionalValidator,
  type UserIdentity,
} from "convex/server";
import {
  ConvexError,
  type PropertyValidators,
  type Validator,
  type Value,
} from "convex/values";

import type { DataModel } from "../schema";
import {
  resolveTenantContext,
  toPublicDenial,
  type ActiveTenantContext,
  type WarehouseId,
} from "./tenantContext";
import { createConvexTenantContextLookups } from "./tenantContextLookups";
import {
  createTenantDocumentAccess,
  TenantDbError,
  type TenantDocumentAccess,
} from "./tenantDb";
import {
  createMutationTenantStorage,
  createQueryTenantStorage,
} from "./tenantStorage";

type FunctionValidator =
  PropertyValidators | Validator<unknown, "required", string> | void;

/** The complete capability set a tenant feature handler receives. */
export interface TenantFunctionContext {
  readonly requestId: string;
  readonly identity: UserIdentity;
  readonly tenant: ActiveTenantContext;
  readonly tenantDb: TenantDocumentAccess;
}

export interface PublicTenantFunctionFailure {
  readonly [key: string]: Value | undefined;
  readonly code: string;
  readonly requestId: string;
}

type TenantFunctionDefinition<
  ArgsValidator extends FunctionValidator,
  ReturnsValidator extends FunctionValidator,
  ReturnValue,
  OneOrZeroArgs extends ArgsArrayForOptionalValidator<ArgsValidator>,
> = {
  readonly args?: ArgsValidator;
  readonly returns?: ReturnsValidator;
  /** Selects the warehouse to revalidate, when this operation is warehouse-bound. */
  readonly warehouseId?: (args: OneOrZeroArgs[0]) => WarehouseId | undefined;
  readonly handler: (
    ctx: TenantFunctionContext,
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

async function runTenantHandler<Args extends readonly unknown[], ReturnValue>(
  rawContext: RawTenantContext,
  args: Args,
  warehouseId: ((args: Args[0]) => WarehouseId | undefined) | undefined,
  storageFactory: StorageFactory,
  handler: (ctx: TenantFunctionContext, ...args: Args) => ReturnValue,
): Promise<Awaited<ReturnValue>> {
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
    const narrowed = Object.freeze({
      requestId,
      identity: identity!,
      tenant: resolved.context,
      tenantDb,
    });

    return await handler(narrowed, ...args);
  } catch (error) {
    if (error instanceof SafeTenantFunctionFailure) {
      throw new ConvexError(error.data);
    }
    if (error instanceof TenantDbError) {
      // Spread rather than passed straight through: `PublicTenantDbError` is an
      // interface, so it has no implicit index signature and is not a `Value`.
      // The spread keeps `toPublic()` as the single conversion seam, so a field
      // added or redacted there still reaches the client through this throw.
      throw new ConvexError({ ...error.toPublic() });
    }
    throw new ConvexError(internalFailure(requestId));
  }
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
): RegisteredQuery<"public", ArgsArrayToObject<OneOrZeroArgs>, ReturnValue> {
  return queryGeneric<
    ArgsValidator,
    ReturnsValidator,
    ReturnValue,
    OneOrZeroArgs
  >({
    ...(definition.args === undefined ? {} : { args: definition.args }),
    ...(definition.returns === undefined
      ? {}
      : { returns: definition.returns }),
    handler: (ctx, ...args) =>
      runTenantHandler(
        ctx,
        args,
        definition.warehouseId,
        (raw, requestId) =>
          createQueryTenantStorage(
            raw as GenericQueryCtx<DataModel>,
            requestId,
          ),
        definition.handler,
      ) as ReturnValue,
  });
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
): RegisteredMutation<"public", ArgsArrayToObject<OneOrZeroArgs>, ReturnValue> {
  return mutationGeneric<
    ArgsValidator,
    ReturnsValidator,
    ReturnValue,
    OneOrZeroArgs
  >({
    ...(definition.args === undefined ? {} : { args: definition.args }),
    ...(definition.returns === undefined
      ? {}
      : { returns: definition.returns }),
    handler: (ctx, ...args) =>
      runTenantHandler(
        ctx,
        args,
        definition.warehouseId,
        (raw, requestId) =>
          createMutationTenantStorage(
            raw as GenericMutationCtx<DataModel>,
            requestId,
          ),
        definition.handler,
      ) as ReturnValue,
  });
}
