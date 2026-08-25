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

export const STEP_UP_MAX_AGE_MS = 10 * 60 * 1000;

export const MEMBERSHIP_ROLE_LIMIT = 32;

export const STEP_UP_EVENT_LIMIT = 16;

export const MAX_ENTITLEMENT_KEY_LENGTH = 64;

export const MAX_INSTALLATION_ID_LENGTH = 128;

export const MAX_POLICY_REFERENCE_LENGTH = 128;

export const AUTHORIZATION_DENIAL_MESSAGE =
  "This request was denied. Quote the request ID when asking for help.";

export const AUTHORIZATION_DENIAL_CODE = "AUTHORIZATION_DENIED";

export interface PublicAuthorizationDenial {
  readonly kind: "AUTHORIZATION_DENIED";
  readonly code: typeof AUTHORIZATION_DENIAL_CODE;
  readonly requestId: string;
  readonly message: string;
}

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

export type TenantFunctionKind = "query" | "mutation" | "action";

export interface AuthorizationDeclaration {
  readonly permissionCode: string;

  readonly targetTable: string;

  readonly hasWarehouseSelector: boolean;

  readonly hasPolicy: boolean;

  readonly entitlementKey?: string;
}

/** A declaration that cannot be enforced, raised at registration time. */
export class AuthorizationDeclarationError extends Error {
  override readonly name = "AuthorizationDeclarationError";
}

export function assertAuthorizationDeclaration(
  kind: TenantFunctionKind,
  declaration: AuthorizationDeclaration,
): PermissionDefinition {
  const { permissionCode, targetTable, entitlementKey } = declaration;

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

export function usableInstallationId(value: unknown): string | null {
  return isBoundedKey(value, MAX_INSTALLATION_ID_LENGTH) ? value : null;
}

export interface AuthorizationFactLookups {
  readonly findMembership: (input: {
    readonly orgId: OrganizationId;
    readonly userId: UserId;
  }) => Promise<MembershipDocument | null>;

  readonly listMembershipRoles: (input: {
    readonly orgId: OrganizationId;
    readonly membershipId: MembershipId;
    readonly limit: number;
  }) => Promise<readonly MembershipRoleDocument[]>;

  readonly findRole: (input: {
    readonly orgId: OrganizationId;
    readonly roleId: RoleId;
  }) => Promise<RoleDocument | null>;

  readonly findRolePermission: (input: {
    readonly orgId: OrganizationId;
    readonly roleId: RoleId;
    readonly permissionCode: string;
  }) => Promise<RolePermissionDocument | null>;

  readonly findMembershipWarehouse: (input: {
    readonly orgId: OrganizationId;
    readonly membershipId: MembershipId;
    readonly warehouseId: WarehouseId;
  }) => Promise<MembershipWarehouseDocument | null>;

  readonly findEntitlement: (input: {
    readonly orgId: OrganizationId;
    readonly key: string;
  }) => Promise<EntitlementDocument | null>;

  readonly listRecentSessionEvents: (input: {
    readonly orgId: OrganizationId;
    readonly userId: UserId;
    readonly notBefore: number;
    readonly limit: number;
  }) => Promise<readonly SessionsAuditDocument[]>;

  readonly findDeviceByInstallationId: (input: {
    readonly orgId: OrganizationId;
    readonly installationId: string;
  }) => Promise<DeviceDocument | null>;
}

export interface ResolveAuthorizationFactsInput {
  readonly permission: PermissionDefinition;

  readonly orgId: OrganizationId;

  readonly actorUserId: UserId;

  readonly membershipId: MembershipId;

  readonly targetWarehouseId?: WarehouseId;

  readonly entitlementKey?: string;
  readonly now: number;
  readonly lookups: AuthorizationFactLookups;
}

export interface AuthorizationFacts {
  readonly membership: MembershipDocument;

  readonly granted: boolean;

  readonly warehouseIds: ReadonlySet<string>;
  readonly entitlementRequired: boolean;
  readonly entitlementEnabled: boolean;

  readonly reverifiedAt?: number;
}

export type AuthorizationFactsResult =
  | { readonly ok: true; readonly facts: AuthorizationFacts }
  | { readonly ok: false; readonly reason: DenialReason };

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

export interface AuthorizationPolicyFacts {
  readonly thresholdExceeded?: boolean;

  readonly thresholdApproved?: boolean;

  readonly makerUserId?: string;

  readonly approvalSatisfied?: boolean;
}

export const NO_AUTHORIZATION_POLICY_FACTS: AuthorizationPolicyFacts =
  Object.freeze({});

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

export interface DecideAuthorizationInput {
  readonly permission: PermissionDefinition;
  readonly actorUserId: UserId;
  readonly facts: AuthorizationFacts;
  readonly policy: AuthorizationPolicyFacts;

  readonly targetWarehouseId?: WarehouseId;
  readonly now: number;
}

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

export interface AuthorizationAuditInput {
  readonly requestId: string;
  readonly occurredAt: number;
  readonly actorUserId: UserId;
  readonly permissionCode: string;
  readonly entityTable: TenantTableName;

  readonly entityId?: string;

  readonly warehouseId?: WarehouseId;

  readonly deviceId?: DeviceId;
  readonly outcome: AuditOutcome;

  readonly denialReason?: DenialReason;
}

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

export async function appendAuthorizationAudit(
  tenantDb: TenantDocumentAccess,
  input: AuthorizationAuditInput,
): Promise<void> {
  await tenantDb.insert("auditEvents", authorizationAuditRow(input));
}
