import { v, type Infer, type VLiteral } from "convex/values";

type LiteralValidators<Values extends readonly string[]> = {
  -readonly [Index in keyof Values]: VLiteral<Values[Index], "required">;
};

const literalUnion = <const Values extends readonly [string, ...string[]]>(
  ...values: Values
) => {
  const members = values.map((value) =>
    v.literal(value),
  ) as unknown as LiteralValidators<Values>;
  return v.union(...members);
};

export const organizationStatus = literalUnion("ACTIVE", "SUSPENDED", "CLOSED");
export type OrganizationStatus = Infer<typeof organizationStatus>;

export const userStatus = literalUnion("ACTIVE", "DEACTIVATED");
export type UserStatus = Infer<typeof userStatus>;

export const membershipStatus = literalUnion("ACTIVE", "SUSPENDED", "REVOKED");
export type MembershipStatus = Infer<typeof membershipStatus>;

export const membershipScopeMode = literalUnion("ORG_WIDE", "WAREHOUSE_SCOPED");
export type MembershipScopeMode = Infer<typeof membershipScopeMode>;

export const permissionScope = literalUnion("ORG", "WAREHOUSE", "PLATFORM");

export const roleStatus = literalUnion("ACTIVE", "ARCHIVED");

export const warehouseStatus = literalUnion("ACTIVE", "INACTIVE");
export type WarehouseStatus = Infer<typeof warehouseStatus>;

export const deviceType = literalUnion("HANDHELD", "WORKSTATION", "TABLET");

export const deviceStatus = literalUnion("ACTIVE", "RETIRED");

export const actorKind = literalUnion("USER", "SYSTEM", "PLATFORM_SUPPORT");

export const auditOutcome = literalUnion("ALLOWED", "DENIED");
export type AuditOutcome = Infer<typeof auditOutcome>;

export const denialReason = literalUnion(
  "NO_PERMISSION",
  "OUT_OF_WAREHOUSE_SCOPE",
  "THRESHOLD_EXCEEDED",
  "APPROVAL_REQUIRED",
  "REVERIFICATION_REQUIRED",
  "ENTITLEMENT_DISABLED",
  "INACTIVE_MEMBERSHIP",
);
export type DenialReason = Infer<typeof denialReason>;

export const idempotencyStatus = literalUnion(
  "IN_PROGRESS",
  "SUCCEEDED",
  "FAILED",
);

export const sessionsAuditEventType = literalUnion(
  "SIGN_IN",
  "SIGN_OUT",
  "ORGANIZATION_SWITCH",
  "STEP_UP_VERIFIED",
  "STEP_UP_DENIED",
  "SESSION_REVOKED",
);

export const supportGrantStatus = literalUnion(
  "REQUESTED",
  "APPROVED",
  "ACTIVE",
  "REJECTED",
  "EXPIRED",
  "REVOKED",
);

export const supportAccessMode = literalUnion("READ_ONLY", "READ_WRITE");

export const locale = literalUnion("th", "en");

const currency = literalUnion("THB");

export const organizationSettings = v.object({
  timezone: v.string(),
  locale,
  currency,

  serialTrackingEnabled: v.boolean(),

  mixedContentEnabled: v.boolean(),

  consignedStockEnabled: v.boolean(),

  negativeAvailableAllowed: v.boolean(),

  supportGrantsEnabled: v.boolean(),
});
export type OrganizationSettings = Infer<typeof organizationSettings>;

export const masterDataStatus = literalUnion("ACTIVE", "INACTIVE");

export const storageLayoutStatus = literalUnion("DRAFT", "ACTIVE", "ARCHIVED");

export const locationType = literalUnion(
  "NAMED_STORAGE",
  "DOCK",
  "STAGING",
  "RACK_BIN",
  "FLOOR_BLOCK",
  "QUARANTINE",
  "OVERFLOW",
);
