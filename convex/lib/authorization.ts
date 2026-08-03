/**
 * Authorization enforcement kernel — the decision sequence that turns a resolved
 * tenant context into an audited permit or refusal.
 *
 * Status: **enforcement kernel plus audit record.** This module owns the
 * declaration contract every public Convex function must satisfy, the bounded
 * lookups an authorization decision may perform, the assembly of those facts into
 * the input of the pure evaluator in [`permissions.ts`](./permissions.ts), the one
 * public denial payload, and the append-only audit row. It performs no read of its
 * own: every fact arrives through `AuthorizationFactLookups`, whose Convex
 * implementation is [`authorizationLookupsConvex.ts`](./authorizationLookupsConvex.ts).
 * The wrapper that calls all of this is
 * [`tenantFunctions.ts`](./tenantFunctions.ts).
 *
 * The split is the same one `tenantContext.ts` makes, for the same reason: a
 * decision sequence that can only run inside a Convex transaction can only be
 * tested inside one, and the branches worth testing hardest — a lookup that
 * answers with another tenant's row, a role that was archived between two reads, a
 * step-up event whose timestamp is in the future — are precisely the ones a real
 * database will not produce on demand.
 *
 * What this module decides, and where it comes from:
 *
 * 1. **A declaration is mandatory and code-owned** (`INV-0006-01`,
 *    `INV-0006-02`). `assertAuthorizationDeclaration` runs when a function is
 *    *registered* — module evaluation, before any request — so an unknown code, a
 *    `PLATFORM` code, a warehouse-scoped permission with no warehouse selector, or
 *    a contextual policy with nothing to decide is a load-time failure rather than
 *    a request that quietly succeeds.
 * 2. **Every fact is read from the active tenant, `orgId` first and bounded**
 *    (`INV-0002-02`, `INV-0002-04`). The lookup port cannot express a scan: each
 *    method either answers at most one document from an exact index read, or a
 *    bounded window of the newest rows of one index.
 * 3. **Every returned row is re-verified** (`orgId`, and the membership, role, and
 *    user IDs it references). An index should make a mismatch impossible; a mismatch
 *    is therefore evidence that the answer did not come from the range that was
 *    asked for, and it denies.
 * 4. **The evaluator is not re-implemented.** `evaluateAuthorization` in
 *    `permissions.ts` owns the ordered fail-closed policy — membership period,
 *    grant, warehouse scope, entitlement, threshold, maker-checker, step-up — and
 *    this module's job is to hand it facts it did not have to trust.
 * 5. **Support grants are not an input** (`INV-0006-08`). There is no branch here
 *    that reads `supportGrants`, and no fact this module can produce that would let
 *    an actor act outside the organization their membership names. Cross-tenant
 *    support access remains schema-ready and disabled (`ADR-0006` §7).
 * 6. **A device is correlation, never capability** (`ADR-0006` §8). A resolved
 *    device ID is recorded on the audit row and is not an input to the decision;
 *    an unknown installation ID denies nothing, because granting nothing cannot be
 *    denied.
 *
 * Deliberately **not** decided here:
 *
 * - **Threshold and maker-checker values.** No policy table exists yet (§5 Q26).
 *   Those facts arrive through a server-side callback the wrapper invokes with the
 *   trusted context, and this module only sanitizes what the callback returned:
 *   a browser field of the same name is not accepted anywhere (`INV-0006-06`).
 * - **The step-up freshness window as tenant configuration.** `STEP_UP_MAX_AGE_MS`
 *   is code-owned until the policy configuration slice lands (`RG-030`).
 * - **Where the audit row is written.** This module builds and appends it; whether
 *   the surrounding transaction can commit it is the execution model's decision,
 *   and `tenantFunctions.ts` documents the three answers (mutation, action
 *   preflight, query).
 *
 * Baseline: [PROJECT_PLAN.md](../../PROJECT_PLAN.md) §6.1, §7.1, §12;
 * [ADR-0006](../../docs/adr/0006-authorization-and-support-access.md);
 * [permission catalogue](../../docs/permissions.md) §1, §4.
 */
import type { DocumentByName } from "convex/server";
import type { GenericId } from "convex/values";

import type { DataModel } from "../schema";
import {
  PERMISSIONS_BY_CODE,
  evaluateAuthorization,
  type AuthorizationDecision,
  type AuthorizationInput,
  type PermissionDefinition,
} from "./permissions";
import type { TenantTableName } from "./schemaPolicy";
import type {
  MembershipDocument,
  MembershipId,
  MembershipWarehouseDocument,
  OrganizationId,
  UserId,
  WarehouseId,
} from "./tenantContext";
import { TENANT_TABLE_NAMES, type TenantDocumentAccess } from "./tenantDb";
import type { AuditOutcome, DenialReason } from "./validators";

/* -------------------------------------------------------------------------- */
/* Schema-derived types (no generated code)                                    */
/* -------------------------------------------------------------------------- */

export type MembershipRoleDocument = DocumentByName<
  DataModel,
  "membershipRoles"
>;
export type RoleDocument = DocumentByName<DataModel, "roles">;
export type RolePermissionDocument = DocumentByName<
  DataModel,
  "rolePermissions"
>;
export type EntitlementDocument = DocumentByName<DataModel, "entitlements">;
export type SessionsAuditDocument = DocumentByName<DataModel, "sessionsAudit">;
export type DeviceDocument = DocumentByName<DataModel, "devices">;

export type RoleId = GenericId<"roles">;
export type DeviceId = GenericId<"devices">;

/* -------------------------------------------------------------------------- */
/* Bounds                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * How fresh a Clerk reverification must be for a step-up permission
 * (`INV-0006-07`).
 *
 * Code-owned, not tenant configuration: the policy-value slice does not exist
 * (§5 Q26, `RG-030`), and a window read from a table nobody writes would be a
 * window an unseeded tenant does not have. Ten minutes is short enough that a
 * privileged action cannot ride a shift-long handheld session and long enough to
 * complete one multi-step privileged flow (`ADR-0006` §6).
 */
export const STEP_UP_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * The most `membershipRoles` rows one decision will consider.
 *
 * A bound is safe in one direction only, and this is the safe direction:
 * considering fewer roles can deny an actor who should have been allowed, and can
 * never allow one who should have been denied. A membership past the bound is
 * therefore a false denial to investigate, not a hole. Thirty-two is far above
 * the eight seeded roles (`docs/permissions.md` §3) and far below anything that
 * would make this read expensive.
 */
export const MEMBERSHIP_ROLE_LIMIT = 32;

/**
 * The most `sessionsAudit` rows a step-up freshness check will read.
 *
 * `sessionsAudit` has no index on `eventType` (`convex/schema.ts`), so the newest
 * step-up event cannot be selected directly: the read is a bounded window of the
 * newest events *inside the freshness window*, and the step-up rows are picked out
 * of it in memory. An actor who generated more than this many session events
 * inside the window can therefore be denied for lack of evidence that exists —
 * fail-closed, and recorded as an obligation rather than hidden (`RG-030`).
 */
export const STEP_UP_EVENT_LIMIT = 16;

/** Length bound on a code-owned entitlement key (`entitlements.key`). */
export const MAX_ENTITLEMENT_KEY_LENGTH = 64;

/**
 * Length bound on the opaque installation ID a client may present.
 *
 * The same bound `tenantContext.ts` puts on a provider reference, and for the
 * same reason: a hostile client must not be able to turn a correlation value into
 * an unbounded lookup argument. It is not a format check — the value is minted by
 * the installed PWA and authenticates nothing.
 */
export const MAX_INSTALLATION_ID_LENGTH = 128;

/**
 * Length bound on a document reference a policy callback may return.
 *
 * A `users` ID is far shorter. The bound exists so a policy that computed its
 * answer from a corrupt row cannot hand the evaluator an unbounded string to
 * compare the actor against.
 */
export const MAX_POLICY_REFERENCE_LENGTH = 128;

/* -------------------------------------------------------------------------- */
/* Public denial                                                               */
/* -------------------------------------------------------------------------- */

/** The single message any authorization denial may show a caller. */
export const AUTHORIZATION_DENIAL_MESSAGE =
  "This request was denied. Quote the request ID when asking for help.";

/**
 * The one code an authorization denial carries.
 *
 * Deliberately *not* the `DenialReason`. "No permission", "out of warehouse
 * scope", "approval required", and "reverification required" are exactly the
 * distinctions `docs/permissions.md` §4.6 wants an *operator* to have, and exactly
 * the distinctions a caller must not be able to enumerate: the difference between
 * `OUT_OF_WAREHOUSE_SCOPE` and `NO_PERMISSION` tells an unauthorized caller which
 * of its guesses about another tenant's shape was closer. The reason survives on
 * the audit row, keyed by the request ID the caller is told to quote
 * (`INV-0002-07`, `INV-0006-10`).
 *
 * Surfacing the reason to an authorized operator is a later, permissioned read of
 * `auditEvents` through `admin.audit.read`, not a wider error payload.
 */
export const AUTHORIZATION_DENIAL_CODE = "AUTHORIZATION_DENIED";

/** The payload of an authorization denial as a client may see it. */
export interface PublicAuthorizationDenial {
  readonly kind: "AUTHORIZATION_DENIED";
  readonly code: typeof AUTHORIZATION_DENIAL_CODE;
  readonly requestId: string;
  readonly message: string;
}

/** The only sanctioned way to make an authorization denial public. */
export function toPublicAuthorizationDenial(
  requestId: string,
): PublicAuthorizationDenial {
  return Object.freeze({
    kind: "AUTHORIZATION_DENIED" as const,
    code: AUTHORIZATION_DENIAL_CODE,
    requestId,
    message: AUTHORIZATION_DENIAL_MESSAGE,
  });
}

/* -------------------------------------------------------------------------- */
/* Declaration contract                                                        */
/* -------------------------------------------------------------------------- */

/** Which registration path a declaration was made on. */
export type TenantFunctionKind = "query" | "mutation" | "action";

/**
 * What a public function must declare about its own authorization, reduced to the
 * facts this module can check without seeing the handler.
 *
 * `hasWarehouseSelector` and `hasPolicy` are booleans rather than the callbacks
 * themselves: this module checks that the wiring exists, and the wrapper owns
 * calling it. Keeping the callbacks out means the check is exercisable from a test
 * that does not have to build a Convex context.
 */
export interface AuthorizationDeclaration {
  /** A code from the code-owned catalogue. Never a tenant-supplied string. */
  readonly permissionCode: string;
  /** The tenant table the audit row names as the target. */
  readonly targetTable: string;
  /** Whether the definition selects a warehouse for the server to revalidate. */
  readonly hasWarehouseSelector: boolean;
  /** Whether the definition supplies a server-side context-policy callback. */
  readonly hasPolicy: boolean;
  /** A code-owned entitlement key this operation additionally requires (D-30). */
  readonly entitlementKey?: string;
}

/** A declaration that cannot be enforced, raised at registration time. */
export class AuthorizationDeclarationError extends Error {
  override readonly name = "AuthorizationDeclarationError";
}

/**
 * Resolve a declaration to the catalogue definition it names, or refuse to
 * register the function at all.
 *
 * Every refusal below is a bug in this repository's own code — a caller cannot
 * reach this function — so the messages name the problem plainly. They run at
 * module evaluation, which is the earliest moment available without a compiler
 * plugin: `import`ing the module that registers the function is enough to fail,
 * so a mis-declared function cannot be deployed, called, or tested green.
 *
 * The rules, and why each is a refusal rather than a runtime denial:
 *
 * 1. **Unknown code** — a code the catalogue does not define can never be granted
 *    by a role, so every call would deny. That is a permanently dead function, and
 *    a typo is the likeliest cause.
 * 2. **`PLATFORM` code** — platform codes are never granted to a tenant role
 *    (`INV-0006-02`) and the evaluator refuses them; declaring one on a tenant
 *    function is a category error, not a policy.
 * 3. **Warehouse permission with no selector** — the evaluator denies a
 *    `WAREHOUSE` decision with no target (`INV-0006-04`), so the function would be
 *    dead. Requiring the selector makes the target *server-revalidated* rather
 *    than absent.
 * 4. **Contextual policy with no callback** — a threshold or maker-checker
 *    permission whose facts nobody computes denies every call. Requiring the
 *    callback is what keeps `INV-0006-06` a real check instead of an accidental
 *    total refusal.
 * 5. **Callback with no policy to decide** — a policy on a permission that needs
 *    neither threshold nor maker-checker is code that looks like enforcement and
 *    is never read.
 * 6. **Contextual policy on an action** — an action has no transaction, so its
 *    facts are computed in the internal preflight *mutation*, which is registered
 *    by name and cannot receive a closure. Rather than accept a callback it would
 *    silently ignore, `actionWithOrg` refuses the permission outright; such an
 *    operation belongs in a mutation that the action calls.
 * 7. **Unknown target table** — the audit row's `entityTable` must name a tenant
 *    table, so an entity history read is an `orgId`-first index range and a target
 *    ID can be ownership-checked before it is recorded.
 * 8. **Unusable entitlement key** — a blank, padded, or unbounded key cannot
 *    match a seeded row, so the capability would be permanently disabled.
 */
export function assertAuthorizationDeclaration(
  kind: TenantFunctionKind,
  declaration: AuthorizationDeclaration,
): PermissionDefinition {
  const { permissionCode, targetTable, entitlementKey } = declaration;
  // Returns the error rather than throwing it, so every refusal below is a
  // `throw` the compiler can see terminating the branch.
  const refusal = (problem: string): AuthorizationDeclarationError =>
    new AuthorizationDeclarationError(
      `${kind}WithOrg cannot register "${String(permissionCode)}": ${problem}`,
    );

  if (typeof permissionCode !== "string" || permissionCode.length === 0) {
    throw refusal("a permission code is required (INV-0006-01).");
  }

  const definition = PERMISSIONS_BY_CODE.get(permissionCode);
  if (definition === undefined) {
    throw refusal("the code-owned catalogue does not define it (INV-0006-02).");
  }
  if (definition.scope === "PLATFORM") {
    throw refusal(
      "a PLATFORM code is never granted to a tenant role (ADR-0006 §7).",
    );
  }

  if (!TENANT_TABLE_NAMES.has(targetTable as TenantTableName)) {
    throw refusal(
      `"${String(targetTable)}" is not a tenant table, so the audit row ` +
        "could not name a target.",
    );
  }

  if (definition.scope === "WAREHOUSE" && !declaration.hasWarehouseSelector) {
    throw refusal(
      "a WAREHOUSE permission needs a warehouseId selector so the target is " +
        "server-revalidated (INV-0006-04).",
    );
  }

  const needsPolicy =
    definition.requiresThreshold || definition.requiresMakerChecker;
  if (needsPolicy && kind === "action") {
    throw refusal(
      "threshold and maker-checker facts are computed in a transaction; " +
        "register this operation as a mutation the action calls.",
    );
  }
  if (needsPolicy && !declaration.hasPolicy) {
    throw refusal(
      "a threshold or maker-checker permission needs a server-side policy " +
        "callback (INV-0006-06).",
    );
  }
  if (!needsPolicy && declaration.hasPolicy) {
    throw refusal(
      "this permission needs no threshold or maker-checker facts, so a " +
        "policy callback would never be read.",
    );
  }

  if (entitlementKey !== undefined && !isBoundedKey(entitlementKey)) {
    throw refusal("the entitlement key is blank, padded, or too long.");
  }

  return definition;
}

/** A usable exact-lookup key: non-empty, unpadded, and bounded. */
function isBoundedKey(
  value: unknown,
  maxLength = MAX_ENTITLEMENT_KEY_LENGTH,
): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value.trim() === value
  );
}

/**
 * Narrow a client-presented installation ID to something safe to look up, or
 * `null`.
 *
 * `null` is not a denial: a device grants nothing, so an unusable installation ID
 * costs the request its device correlation and nothing else.
 */
export function usableInstallationId(value: unknown): string | null {
  return isBoundedKey(value, MAX_INSTALLATION_ID_LENGTH) ? value : null;
}

/* -------------------------------------------------------------------------- */
/* Fact lookups                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The bounded reads an authorization decision is allowed to perform.
 *
 * Eight methods, every one of them `orgId`-first and bounded by construction.
 * There is no `db`, no table name, no predicate, and no way to express a
 * `.filter()`, a `.collect()`, or an unbounded `take` through this type
 * (`INV-0002-04`). Backing read for each, for the adapter that implements it:
 *
 * | Method                       | Backing read                                             |
 * | ---------------------------- | -------------------------------------------------------- |
 * | `findMembership`             | `memberships.by_orgId_userId`                            |
 * | `listMembershipRoles`        | `membershipRoles.by_orgId_membershipId_roleId` (prefix)  |
 * | `findRole`                   | document read, then `orgId` equality                     |
 * | `findRolePermission`         | `rolePermissions.by_orgId_roleId_permissionCode`         |
 * | `findMembershipWarehouse`    | `membershipWarehouses.by_orgId_membershipId_warehouseId` |
 * | `findEntitlement`            | `entitlements.by_orgId_key`                              |
 * | `listRecentSessionEvents`    | `sessionsAudit.by_orgId_userId_occurredAt` (desc window) |
 * | `findDeviceByInstallationId` | `devices.by_orgId_installationId`                        |
 */
export interface AuthorizationFactLookups {
  /** This actor's single membership in this organization, or `null`. */
  readonly findMembership: (input: {
    readonly orgId: OrganizationId;
    readonly userId: UserId;
  }) => Promise<MembershipDocument | null>;

  /** At most `limit` role grants of this membership. */
  readonly listMembershipRoles: (input: {
    readonly orgId: OrganizationId;
    readonly membershipId: MembershipId;
    readonly limit: number;
  }) => Promise<readonly MembershipRoleDocument[]>;

  /** The named role *within this organization*, or `null`. */
  readonly findRole: (input: {
    readonly orgId: OrganizationId;
    readonly roleId: RoleId;
  }) => Promise<RoleDocument | null>;

  /** The row granting this role this exact permission code, or `null`. */
  readonly findRolePermission: (input: {
    readonly orgId: OrganizationId;
    readonly roleId: RoleId;
    readonly permissionCode: string;
  }) => Promise<RolePermissionDocument | null>;

  /** The explicit scope row granting this membership this warehouse, or `null`. */
  readonly findMembershipWarehouse: (input: {
    readonly orgId: OrganizationId;
    readonly membershipId: MembershipId;
    readonly warehouseId: WarehouseId;
  }) => Promise<MembershipWarehouseDocument | null>;

  /** This organization's entitlement row for an exact key, or `null`. */
  readonly findEntitlement: (input: {
    readonly orgId: OrganizationId;
    readonly key: string;
  }) => Promise<EntitlementDocument | null>;

  /**
   * At most `limit` of this actor's newest session-audit rows at or after
   * `notBefore`, newest first.
   */
  readonly listRecentSessionEvents: (input: {
    readonly orgId: OrganizationId;
    readonly userId: UserId;
    readonly notBefore: number;
    readonly limit: number;
  }) => Promise<readonly SessionsAuditDocument[]>;

  /** This organization's device for an opaque installation ID, or `null`. */
  readonly findDeviceByInstallationId: (input: {
    readonly orgId: OrganizationId;
    readonly installationId: string;
  }) => Promise<DeviceDocument | null>;
}

/** What fact resolution needs. No `orgId` from a caller: it comes from context. */
export interface ResolveAuthorizationFactsInput {
  readonly permission: PermissionDefinition;
  /** The resolved tenant (`ActiveTenantContext.organization._id`). */
  readonly orgId: OrganizationId;
  /** The verified actor (`ActiveTenantContext.actor._id`). */
  readonly actorUserId: UserId;
  /** The membership the context resolved for this actor and tenant. */
  readonly membershipId: MembershipId;
  /** The server-revalidated warehouse, when the operation targets one. */
  readonly targetWarehouseId?: WarehouseId;
  /** A code-owned entitlement key, when the operation requires one. */
  readonly entitlementKey?: string;
  readonly now: number;
  readonly lookups: AuthorizationFactLookups;
}

/** The facts a decision is made from, all of them re-verified against the tenant. */
export interface AuthorizationFacts {
  readonly membership: MembershipDocument;
  /** Whether an `ACTIVE` role of this membership grants the declared code. */
  readonly granted: boolean;
  /** The target warehouse, iff an explicit scope row was found for it. */
  readonly warehouseIds: ReadonlySet<string>;
  readonly entitlementRequired: boolean;
  readonly entitlementEnabled: boolean;
  /** The freshest usable reverification inside the window, when there is one. */
  readonly reverifiedAt?: number;
}

/**
 * Fact resolution either produces facts or fails closed with the reason the audit
 * row will carry.
 *
 * A short circuit rather than a fabricated fact: a membership row that has
 * disappeared or answers for another tenant is not "a suspended membership", and
 * writing it down as one would put a wrong reason in the audit trail an operator
 * reads.
 */
export type AuthorizationFactsResult =
  | { readonly ok: true; readonly facts: AuthorizationFacts }
  | { readonly ok: false; readonly reason: DenialReason };

/**
 * Resolve every authorization fact for one decision, from the active tenant only.
 *
 * The order is deliberate and each step is bounded:
 *
 * 1. **Membership**, re-read rather than trusted from the context, and matched on
 *    `_id`, `orgId`, and `userId`. The context proved the membership was `ACTIVE`;
 *    this read is what carries `effectiveFrom`/`effectiveTo` into the decision, so
 *    a period that has not started or has ended denies (`memberships`, plan §7.1).
 * 2. **Roles**, as a bounded prefix read, each row re-verified and each referenced
 *    role read and required to be this tenant's and `ACTIVE`. An `ARCHIVED` role
 *    grants nothing.
 * 3. **The grant**, as an *exact* three-term read per active role: `(orgId,
 *    roleId, permissionCode)`. The decision needs to know whether the declared
 *    code is granted, not what else the role can do, so enumerating a role's whole
 *    composition would read more to answer the same question. The first hit stops
 *    the loop. This is also why a tenant cannot invent a permission
 *    (`INV-0006-02`): the code being looked up is the one the function declared and
 *    the catalogue defines, so a `rolePermissions` row naming anything else is a
 *    row no read will ever ask for.
 * 4. **Warehouse scope**, only for a `WAREHOUSE_SCOPED` membership and only as the
 *    exact triple. `ORG_WIDE` is the schema's explicit all-warehouse mode, so an
 *    empty scope set denies rather than escalating (§5 Q13).
 * 5. **Entitlement**, only when the declaration names a key. An absent row is a
 *    disabled capability: a tenant cannot gain one through a missing seed
 *    (`INV-0001-07`).
 * 6. **Step-up evidence**, only when the permission requires it, as a bounded
 *    descending window at or after the freshness floor. A reverification stamped
 *    in the future is ignored rather than trusted.
 */
export async function resolveAuthorizationFacts(
  input: ResolveAuthorizationFactsInput,
): Promise<AuthorizationFactsResult> {
  const {
    permission,
    orgId,
    actorUserId,
    membershipId,
    targetWarehouseId,
    entitlementKey,
    now,
    lookups,
  } = input;

  const deny = (reason: DenialReason): AuthorizationFactsResult =>
    Object.freeze({ ok: false as const, reason });

  /* -- membership --------------------------------------------------------- */

  const membership = await lookups.findMembership({
    orgId,
    userId: actorUserId,
  });
  if (
    membership === null ||
    membership._id !== membershipId ||
    membership.orgId !== orgId ||
    membership.userId !== actorUserId
  ) {
    return deny("INACTIVE_MEMBERSHIP");
  }

  /* -- roles and the grant ------------------------------------------------ */

  const roleGrants = await lookups.listMembershipRoles({
    orgId,
    membershipId,
    limit: MEMBERSHIP_ROLE_LIMIT,
  });
  if (!Array.isArray(roleGrants) || roleGrants.length > MEMBERSHIP_ROLE_LIMIT) {
    return deny("NO_PERMISSION");
  }

  let granted = false;
  for (const grant of roleGrants) {
    // A row that is not this tenant's, or not this membership's, means the index
    // answered outside the range it was asked for. Fail closed for the whole
    // decision rather than skipping the row: skipping would make a broken index
    // look like a slightly smaller role set.
    if (grant.orgId !== orgId || grant.membershipId !== membershipId) {
      return deny("NO_PERMISSION");
    }
    const role = await lookups.findRole({ orgId, roleId: grant.roleId });
    if (role === null) continue;
    if (role._id !== grant.roleId || role.orgId !== orgId) {
      return deny("NO_PERMISSION");
    }
    if (role.status !== "ACTIVE") continue;

    const rolePermission = await lookups.findRolePermission({
      orgId,
      roleId: role._id,
      permissionCode: permission.code,
    });
    if (rolePermission === null) continue;
    if (
      rolePermission.orgId !== orgId ||
      rolePermission.roleId !== role._id ||
      rolePermission.permissionCode !== permission.code
    ) {
      return deny("NO_PERMISSION");
    }
    granted = true;
    break;
  }

  /* -- warehouse scope ---------------------------------------------------- */

  const warehouseIds = new Set<string>();
  if (
    targetWarehouseId !== undefined &&
    membership.scopeMode === "WAREHOUSE_SCOPED"
  ) {
    const scope = await lookups.findMembershipWarehouse({
      orgId,
      membershipId,
      warehouseId: targetWarehouseId,
    });
    if (
      scope !== null &&
      scope.orgId === orgId &&
      scope.membershipId === membershipId &&
      scope.warehouseId === targetWarehouseId
    ) {
      warehouseIds.add(targetWarehouseId);
    }
  }

  /* -- entitlement -------------------------------------------------------- */

  let entitlementEnabled = false;
  if (entitlementKey !== undefined) {
    const entitlement = await lookups.findEntitlement({
      orgId,
      key: entitlementKey,
    });
    entitlementEnabled =
      entitlement !== null &&
      entitlement.orgId === orgId &&
      entitlement.key === entitlementKey &&
      entitlement.enabled;
  }

  /* -- step-up evidence --------------------------------------------------- */

  let reverifiedAt: number | undefined;
  if (permission.requiresStepUp) {
    const notBefore = now - STEP_UP_MAX_AGE_MS;
    const events = await lookups.listRecentSessionEvents({
      orgId,
      userId: actorUserId,
      notBefore,
      limit: STEP_UP_EVENT_LIMIT,
    });
    if (!Array.isArray(events) || events.length > STEP_UP_EVENT_LIMIT) {
      return deny("REVERIFICATION_REQUIRED");
    }
    for (const event of events) {
      if (
        event.orgId !== orgId ||
        event.userId !== actorUserId ||
        event.eventType !== "STEP_UP_VERIFIED" ||
        event.outcome !== "ALLOWED"
      ) {
        continue;
      }
      const stamp = event.reverifiedAt;
      if (
        typeof stamp !== "number" ||
        !Number.isFinite(stamp) ||
        stamp > now ||
        stamp < notBefore
      ) {
        continue;
      }
      if (reverifiedAt === undefined || stamp > reverifiedAt) {
        reverifiedAt = stamp;
      }
    }
  }

  return Object.freeze({
    ok: true as const,
    facts: Object.freeze({
      membership,
      granted,
      warehouseIds,
      entitlementRequired: entitlementKey !== undefined,
      entitlementEnabled,
      ...(reverifiedAt === undefined ? {} : { reverifiedAt }),
    }),
  });
}

/* -------------------------------------------------------------------------- */
/* Context policies                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The contextual facts a server-side policy callback may contribute.
 *
 * Every field is a *decision about stored data*, computed inside the transaction
 * from the trusted tenant context — never a field the browser sent. That is the
 * whole point of the callback (`INV-0006-06`): a wrapper argument named
 * `thresholdApproved` would be a client-controlled permit.
 */
export interface AuthorizationPolicyFacts {
  /** Whether the server-computed value is above the configured threshold. */
  readonly thresholdExceeded?: boolean;
  /** Whether an approval exists for exceeding it. */
  readonly thresholdApproved?: boolean;
  /** The actor who submitted the item being approved (`INV-0006-05`). */
  readonly makerUserId?: string;
  /** Whether a distinct, recorded approval exists. */
  readonly approvalSatisfied?: boolean;
}

/** No facts at all: what a missing, failed, or unusable policy contributes. */
export const NO_AUTHORIZATION_POLICY_FACTS: AuthorizationPolicyFacts =
  Object.freeze({});

/**
 * Reduce whatever a policy callback returned to the four facts the evaluator
 * reads, dropping anything else.
 *
 * A policy is repository code, but it is also the one part of this path a feature
 * author writes, so its answer is narrowed rather than trusted: a stray key cannot
 * become an evaluator input, a string cannot pass as a boolean, and a truthy value
 * cannot pass as `true`. Anything unusable is simply absent, and absence denies
 * for a permission that requires the fact.
 */
export function sanitizeAuthorizationPolicyFacts(
  value: unknown,
): AuthorizationPolicyFacts {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return NO_AUTHORIZATION_POLICY_FACTS;
  }
  const record = value as Record<string, unknown>;
  const flag = (key: string): boolean | undefined =>
    typeof record[key] === "boolean" ? (record[key] as boolean) : undefined;

  const thresholdExceeded = flag("thresholdExceeded");
  const thresholdApproved = flag("thresholdApproved");
  const approvalSatisfied = flag("approvalSatisfied");
  const makerUserId = record["makerUserId"];

  return Object.freeze({
    ...(thresholdExceeded === undefined ? {} : { thresholdExceeded }),
    ...(thresholdApproved === undefined ? {} : { thresholdApproved }),
    ...(approvalSatisfied === undefined ? {} : { approvalSatisfied }),
    ...(isBoundedKey(makerUserId, MAX_POLICY_REFERENCE_LENGTH)
      ? { makerUserId }
      : {}),
  });
}

/* -------------------------------------------------------------------------- */
/* The decision                                                                */
/* -------------------------------------------------------------------------- */

/** Everything the pure evaluator needs, assembled from server-owned facts. */
export interface DecideAuthorizationInput {
  readonly permission: PermissionDefinition;
  readonly actorUserId: UserId;
  readonly facts: AuthorizationFacts;
  readonly policy: AuthorizationPolicyFacts;
  /** The server-revalidated warehouse; only a `WAREHOUSE` decision reads it. */
  readonly targetWarehouseId?: WarehouseId;
  readonly now: number;
}

/**
 * Decide, by handing the assembled facts to the pure evaluator.
 *
 * `targetWarehouseId` is passed only for a `WAREHOUSE`-scoped permission. An
 * `ORG` decision that ignored it would reach the same verdict — the evaluator
 * only reads the target under `WAREHOUSE` scope — but leaving it out means the
 * absence is visible here rather than inferred from another module: an
 * organization-wide decision cannot be steered by a warehouse the caller named.
 *
 * `grantedPermissionCodes` is the singleton set the exact grant read established,
 * not the actor's full composition. The evaluator asks one question of it — does
 * it contain the declared code — and building the full set would mean reading
 * every permission of every role to answer it.
 */
export function decideAuthorization(
  input: DecideAuthorizationInput,
): AuthorizationDecision {
  const { permission, facts, policy, actorUserId, now } = input;
  const membership = facts.membership;
  const target =
    permission.scope === "WAREHOUSE" ? input.targetWarehouseId : undefined;

  const evaluatorInput: AuthorizationInput = {
    permissionCode: permission.code,
    actorUserId,
    membershipStatus: membership.status,
    membershipEffectiveFrom: membership.effectiveFrom,
    ...(membership.effectiveTo === undefined
      ? {}
      : { membershipEffectiveTo: membership.effectiveTo }),
    scopeMode: membership.scopeMode,
    warehouseIds: facts.warehouseIds,
    ...(target === undefined ? {} : { targetWarehouseId: target }),
    grantedPermissionCodes: facts.granted
      ? new Set([permission.code])
      : new Set<string>(),
    now,
    ...(facts.reverifiedAt === undefined
      ? {}
      : { reverifiedAt: facts.reverifiedAt }),
    maxStepUpAgeMs: STEP_UP_MAX_AGE_MS,
    entitlementRequired: facts.entitlementRequired,
    entitlementEnabled: facts.entitlementEnabled,
    ...(policy.thresholdExceeded === undefined
      ? {}
      : { thresholdExceeded: policy.thresholdExceeded }),
    ...(policy.thresholdApproved === undefined
      ? {}
      : { thresholdApproved: policy.thresholdApproved }),
    ...(policy.approvalSatisfied === undefined
      ? {}
      : { approvalSatisfied: policy.approvalSatisfied }),
    ...(policy.makerUserId === undefined
      ? {}
      : { makerUserId: policy.makerUserId }),
  };

  return evaluateAuthorization(evaluatorInput);
}

/* -------------------------------------------------------------------------- */
/* Audit                                                                       */
/* -------------------------------------------------------------------------- */

/** The authorization attempt as it is recorded, before the tenant is stamped on. */
export interface AuthorizationAuditInput {
  readonly requestId: string;
  readonly occurredAt: number;
  readonly actorUserId: UserId;
  readonly permissionCode: string;
  readonly entityTable: TenantTableName;
  /** A target this tenant was proved to own, when the operation named one. */
  readonly entityId?: string;
  /** The server-revalidated warehouse, when the operation is warehouse-bound. */
  readonly warehouseId?: WarehouseId;
  /** A correlated device, never an authorization subject (`ADR-0006` §8). */
  readonly deviceId?: DeviceId;
  readonly outcome: AuditOutcome;
  /** The closed reason, recorded only here — never in the public payload. */
  readonly denialReason?: DenialReason;
}

/** The `auditEvents` payload: no `orgId`, which the accessor derives and stamps. */
export type AuthorizationAuditRow = {
  readonly occurredAt: number;
  readonly actorKind: "USER";
  readonly actorUserId: UserId;
  readonly action: string;
  readonly permissionCode: string;
  readonly entityTable: string;
  readonly entityId?: string;
  readonly warehouseId?: WarehouseId;
  readonly outcome: AuditOutcome;
  readonly denialReason?: DenialReason;
  readonly requestId: string;
  readonly deviceId?: DeviceId;
};

/**
 * Build the audit row for one authorization attempt.
 *
 * `actorKind` is always `USER`: this row is written from the request path, which
 * requires a verified identity and a mirrored actor. `SYSTEM` belongs to scheduled
 * work and `PLATFORM_SUPPORT` to a support grant, and neither can reach this
 * function (`INV-0006-08`).
 *
 * `action` is the declared permission code. Two fields with one value looks
 * redundant and is not: `permissionCode` is what was *checked*, and `action` is
 * what was *attempted*. They diverge as soon as one code guards several
 * operations, which is why the schema keeps both — and why the default is stated
 * here rather than assumed at every call site.
 *
 * No `changes`, no payload, no argument echo: an authorization attempt records the
 * decision, and a diff of a write that did not happen would be a fabrication (§14).
 */
export function authorizationAuditRow(
  input: AuthorizationAuditInput,
): AuthorizationAuditRow {
  return Object.freeze({
    occurredAt: input.occurredAt,
    actorKind: "USER" as const,
    actorUserId: input.actorUserId,
    action: input.permissionCode,
    permissionCode: input.permissionCode,
    entityTable: input.entityTable,
    ...(input.entityId === undefined ? {} : { entityId: input.entityId }),
    ...(input.warehouseId === undefined
      ? {}
      : { warehouseId: input.warehouseId }),
    outcome: input.outcome,
    ...(input.denialReason === undefined
      ? {}
      : { denialReason: input.denialReason }),
    requestId: input.requestId,
    ...(input.deviceId === undefined ? {} : { deviceId: input.deviceId }),
  });
}

/**
 * Append one authorization attempt to `auditEvents`.
 *
 * Insert only. There is no update or delete path in this module, and
 * `scripts/verify-tenant-boundary.mjs` fails the build if any production Convex
 * file names `auditEvents` in a `patch`, `replace`, or `delete` — the append-only
 * merge gate in plan §12, enforced statically because Convex has no such
 * constraint.
 */
export async function appendAuthorizationAudit(
  tenantDb: TenantDocumentAccess,
  input: AuthorizationAuditInput,
): Promise<void> {
  await tenantDb.insert("auditEvents", authorizationAuditRow(input));
}
