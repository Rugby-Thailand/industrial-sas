import {
  HR_PERMISSION,
  HR_PERMISSION_CODES,
  type HrPermissionCode,
} from "../model/authorization/navigationPermissions";
import type { DenialReason, MembershipScopeMode } from "./validators";

export { HR_PERMISSION, HR_PERMISSION_CODES, type HrPermissionCode };

export interface PermissionDefinition {
  readonly code: string;
  readonly scope: "ORG" | "WAREHOUSE" | "PLATFORM";
  readonly requiresStepUp: boolean;
  readonly requiresMakerChecker: boolean;
  readonly requiresThreshold: boolean;
}

type Flags = readonly ("STEP_UP" | "MAKER_CHECKER" | "THRESHOLD")[];

const permission = (
  code: string,
  scope: PermissionDefinition["scope"],
  flags: Flags = [],
): PermissionDefinition =>
  Object.freeze({
    code,
    scope,
    requiresStepUp: flags.includes("STEP_UP"),
    requiresMakerChecker: flags.includes("MAKER_CHECKER"),
    requiresThreshold: flags.includes("THRESHOLD"),
  });

export const PERMISSION_CATALOGUE = Object.freeze([
  permission("masterData.warehouse.read", "ORG"),
  permission("masterData.storageLayout.read", "WAREHOUSE"),
  permission("masterData.storageLayout.manage", "WAREHOUSE"),
  permission("masterData.storageLayout.activate", "WAREHOUSE"),
  ...HR_PERMISSION_CODES.map((code) => permission(code, "ORG")),
]);
export const PERMISSIONS_BY_CODE: ReadonlyMap<string, PermissionDefinition> =
  new Map(PERMISSION_CATALOGUE.map((entry) => [entry.code, entry]));
export interface DefaultRoleDefinition {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly permissionCodes: readonly string[];
}
/**
 * The planner grants, listed explicitly. Deriving them from the whole
 * catalogue would hand every future permission (including private HR data)
 * to warehouse managers.
 */
export const PLANNER_PERMISSION_CODES: readonly string[] = Object.freeze([
  "masterData.warehouse.read",
  "masterData.storageLayout.read",
  "masterData.storageLayout.manage",
  "masterData.storageLayout.activate",
]);
export const HR_ADMIN_PERMISSION_CODES: readonly HrPermissionCode[] =
  HR_PERMISSION_CODES;
export const DEFAULT_ROLES: readonly DefaultRoleDefinition[] = Object.freeze([
  {
    key: "ORG_ADMIN",
    name: "Organization administrator",
    description: "Manages building and storage plans and HR attendance.",
    permissionCodes: [
      ...PLANNER_PERMISSION_CODES,
      ...HR_ADMIN_PERMISSION_CODES,
    ],
  },
  {
    key: "WAREHOUSE_MANAGER",
    name: "Warehouse manager",
    description: "Manages plans in assigned warehouses.",
    permissionCodes: PLANNER_PERMISSION_CODES,
  },
  {
    key: "HR_EMPLOYEE",
    name: "HR employee",
    description: "Records and reviews their own attendance.",
    permissionCodes: [HR_PERMISSION.selfAccess],
  },
  {
    key: "HR_SUPERVISOR",
    name: "HR supervisor",
    description: "Reviews attendance of assigned direct reports.",
    permissionCodes: [HR_PERMISSION.selfAccess, HR_PERMISSION.teamReview],
  },
  {
    key: "HR_ADMIN",
    name: "HR administrator",
    description: "Maintains HR setup and closes attendance periods.",
    permissionCodes: HR_ADMIN_PERMISSION_CODES,
  },
  {
    key: "SUPERVISOR",
    name: "Supervisor",
    description: "Views plans in assigned warehouses.",
    permissionCodes: [
      "masterData.warehouse.read",
      "masterData.storageLayout.read",
    ],
  },
]);

export interface AuthorizationInput {
  readonly permissionCode: string;
  readonly actorUserId: string;
  readonly membershipStatus: "ACTIVE" | "SUSPENDED" | "REVOKED";
  readonly membershipEffectiveFrom: number;
  readonly membershipEffectiveTo?: number;
  readonly scopeMode: MembershipScopeMode;
  readonly warehouseIds: ReadonlySet<string>;
  readonly targetWarehouseId?: string;
  readonly grantedPermissionCodes: ReadonlySet<string>;
  readonly now: number;
  readonly reverifiedAt?: number;
  readonly maxStepUpAgeMs: number;
  readonly makerUserId?: string;
  readonly approvalSatisfied?: boolean;
  readonly thresholdExceeded?: boolean;
  readonly thresholdApproved?: boolean;
  readonly entitlementRequired?: boolean;
  readonly entitlementEnabled?: boolean;
}

export type AuthorizationDecision =
  | { readonly allowed: true; readonly permission: PermissionDefinition }
  | {
      readonly allowed: false;
      readonly permission?: PermissionDefinition;
      readonly reason: DenialReason;
    };

const denied = (
  reason: DenialReason,
  permissionDefinition?: PermissionDefinition,
): AuthorizationDecision => ({
  allowed: false,
  reason,
  ...(permissionDefinition === undefined
    ? {}
    : { permission: permissionDefinition }),
});

export function evaluateAuthorization(
  input: AuthorizationInput,
): AuthorizationDecision {
  const definition = PERMISSIONS_BY_CODE.get(input.permissionCode);
  if (definition === undefined || definition.scope === "PLATFORM") {
    return denied("NO_PERMISSION");
  }
  if (
    input.membershipStatus !== "ACTIVE" ||
    input.now < input.membershipEffectiveFrom ||
    (input.membershipEffectiveTo !== undefined &&
      input.now >= input.membershipEffectiveTo)
  ) {
    return denied("INACTIVE_MEMBERSHIP", definition);
  }
  if (!input.grantedPermissionCodes.has(definition.code)) {
    return denied("NO_PERMISSION", definition);
  }
  if (
    definition.scope === "WAREHOUSE" &&
    (input.targetWarehouseId === undefined ||
      (input.scopeMode === "WAREHOUSE_SCOPED" &&
        !input.warehouseIds.has(input.targetWarehouseId)))
  ) {
    return denied("OUT_OF_WAREHOUSE_SCOPE", definition);
  }
  if (input.entitlementRequired && !input.entitlementEnabled) {
    return denied("ENTITLEMENT_DISABLED", definition);
  }
  if (
    definition.requiresThreshold &&
    (input.thresholdExceeded === undefined ||
      (input.thresholdExceeded && !input.thresholdApproved))
  ) {
    return denied("THRESHOLD_EXCEEDED", definition);
  }
  if (
    definition.requiresMakerChecker &&
    (!input.approvalSatisfied ||
      input.makerUserId === undefined ||
      input.makerUserId === input.actorUserId)
  ) {
    return denied("APPROVAL_REQUIRED", definition);
  }
  if (
    definition.requiresStepUp &&
    (input.reverifiedAt === undefined ||
      input.reverifiedAt > input.now ||
      input.now - input.reverifiedAt > input.maxStepUpAgeMs)
  ) {
    return denied("REVERIFICATION_REQUIRED", definition);
  }
  return { allowed: true, permission: definition };
}

for (const role of DEFAULT_ROLES) {
  for (const code of role.permissionCodes) {
    const definition = PERMISSIONS_BY_CODE.get(code);
    if (definition === undefined || definition.scope === "PLATFORM") {
      throw new Error(
        `Default role ${role.key} contains an invalid permission.`,
      );
    }
  }
}
