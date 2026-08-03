/**
 * Closed value validators for the tenant security schema.
 *
 * Status: **schema foundation only.** These validators are referenced by
 * `convex/schema.ts`. No Convex function, wrapper, or policy evaluator consumes
 * them yet.
 *
 * Why closed unions rather than `v.string()`: a status, locale, currency, scope
 * mode, support access mode, or device type is a decision surface. An open
 * string lets a caller invent a state that no policy handles, and a schema
 * migration is the only way to notice. Every set below is enumerable, so a test
 * can read its members (`VUnion.members`) and assert the set has not silently
 * grown.
 *
 * Single-member unions (`currency`) are deliberate: they stay closed, and
 * adding a member later is a visible one-line diff rather than a type change.
 *
 * Vocabulary follows the [domain glossary](../../docs/domain-glossary.md).
 * Identifiers are English (D-06); Thai belongs in UI copy and bilingual master
 * data only.
 */
import { v, type Infer } from "convex/values";

/* -------------------------------------------------------------------------- */
/* Tenancy and identity                                                        */
/* -------------------------------------------------------------------------- */

/** Lifecycle of a tenant (`G-001`). Mirrored from onboarding, not from Clerk. */
export const organizationStatus = v.union(
  v.literal("ACTIVE"),
  v.literal("SUSPENDED"),
  v.literal("CLOSED"),
);
export type OrganizationStatus = Infer<typeof organizationStatus>;

/**
 * Lifecycle of a mirrored Clerk user (`G-003`). Clerk owns the account; this is
 * only the mirror's view of whether the person is still usable as an actor.
 */
export const userStatus = v.union(
  v.literal("ACTIVE"),
  v.literal("DEACTIVATED"),
);
export type UserStatus = Infer<typeof userStatus>;

/**
 * Lifecycle of a membership (`G-004`). `REVOKED` is terminal: revocation must be
 * observable locally so a request can fail closed without calling Clerk
 * (`INV-0001-03`).
 */
export const membershipStatus = v.union(
  v.literal("ACTIVE"),
  v.literal("SUSPENDED"),
  v.literal("REVOKED"),
);
export type MembershipStatus = Infer<typeof membershipStatus>;

/**
 * Whether a membership acts across the whole organization or only in the
 * warehouses named by its `membershipWarehouses` rows (`G-007`, §5 Q13).
 *
 * This is an explicit mode rather than "empty warehouse set means all", because
 * an accidentally empty set must deny, not escalate.
 */
export const membershipScopeMode = v.union(
  v.literal("ORG_WIDE"),
  v.literal("WAREHOUSE_SCOPED"),
);
export type MembershipScopeMode = Infer<typeof membershipScopeMode>;

/* -------------------------------------------------------------------------- */
/* Authorization                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The scope a permission code is decided in
 * ([catalogue](../../docs/permissions.md) §2).
 *
 * `WAREHOUSE` is the catalogue's `WH` column: the target warehouse participates
 * in the decision. `PLATFORM` codes are never granted to a tenant role.
 */
export const permissionScope = v.union(
  v.literal("ORG"),
  v.literal("WAREHOUSE"),
  v.literal("PLATFORM"),
);
export type PermissionScope = Infer<typeof permissionScope>;

/** Lifecycle of a tenant-editable role (`G-005`). Roles are archived, not deleted. */
export const roleStatus = v.union(v.literal("ACTIVE"), v.literal("ARCHIVED"));
export type RoleStatus = Infer<typeof roleStatus>;

/* -------------------------------------------------------------------------- */
/* Warehouses and devices                                                      */
/* -------------------------------------------------------------------------- */

/** Lifecycle of a warehouse (`G-020`). Minimal: this slice needs it for scope only. */
export const warehouseStatus = v.union(
  v.literal("ACTIVE"),
  v.literal("INACTIVE"),
);
export type WarehouseStatus = Infer<typeof warehouseStatus>;

/**
 * Form factor of a registered device (`G-013`, D-02, D-03). A device is context
 * recorded on transactions, never an authorization subject.
 */
export const deviceType = v.union(
  v.literal("HANDHELD"),
  v.literal("WORKSTATION"),
  v.literal("TABLET"),
);
export type DeviceType = Infer<typeof deviceType>;

/** Lifecycle of a registered device. Retired devices keep their audit history. */
export const deviceStatus = v.union(v.literal("ACTIVE"), v.literal("RETIRED"));
export type DeviceStatus = Infer<typeof deviceStatus>;

/* -------------------------------------------------------------------------- */
/* Audit, denial, and idempotency                                              */
/* -------------------------------------------------------------------------- */

/**
 * What kind of actor is credited with an event (`G-012`). `PLATFORM_SUPPORT`
 * exists so support access is attributable, and it is only reachable under an
 * enabled support grant, which ships disabled (`ADR-0006` §7).
 */
export const actorKind = v.union(
  v.literal("USER"),
  v.literal("SYSTEM"),
  v.literal("PLATFORM_SUPPORT"),
);
export type ActorKind = Infer<typeof actorKind>;

/** Whether the audited attempt was permitted. Denials are audited too (`INV-0006-10`). */
export const auditOutcome = v.union(v.literal("ALLOWED"), v.literal("DENIED"));
export type AuditOutcome = Infer<typeof auditOutcome>;

/**
 * Why an attempt was denied ([catalogue](../../docs/permissions.md) §4.6).
 *
 * The reasons are distinguished because an operator needs to know which one
 * applies: "ask for the permission", "you are at the wrong site", "get an
 * approval", "reverify". Collapsing them into one message is a support cost.
 */
export const denialReason = v.union(
  v.literal("NO_PERMISSION"),
  v.literal("OUT_OF_WAREHOUSE_SCOPE"),
  v.literal("THRESHOLD_EXCEEDED"),
  v.literal("APPROVAL_REQUIRED"),
  v.literal("REVERIFICATION_REQUIRED"),
  v.literal("ENTITLEMENT_DISABLED"),
  v.literal("INACTIVE_MEMBERSHIP"),
);
export type DenialReason = Infer<typeof denialReason>;

/**
 * State of an idempotency record (§5 Q30, Q35). `IN_PROGRESS` is recorded before
 * the effect so a concurrent replay can be rejected rather than duplicated.
 */
export const idempotencyStatus = v.union(
  v.literal("IN_PROGRESS"),
  v.literal("SUCCEEDED"),
  v.literal("FAILED"),
);
export type IdempotencyStatus = Infer<typeof idempotencyStatus>;

/* -------------------------------------------------------------------------- */
/* Session audit                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Security-relevant session events recorded in `sessionsAudit` alongside — never
 * instead of — Clerk's own session state (§7.1, §5 Q16).
 *
 * `STEP_UP_VERIFIED` and `STEP_UP_DENIED` exist so step-up freshness
 * (`INV-0006-07`) has an auditable history on shared handhelds.
 */
export const sessionsAuditEventType = v.union(
  v.literal("SIGN_IN"),
  v.literal("SIGN_OUT"),
  v.literal("ORGANIZATION_SWITCH"),
  v.literal("STEP_UP_VERIFIED"),
  v.literal("STEP_UP_DENIED"),
  v.literal("SESSION_REVOKED"),
);
export type SessionsAuditEventType = Infer<typeof sessionsAuditEventType>;

/* -------------------------------------------------------------------------- */
/* Support access                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Lifecycle of a support grant (`G-010`, `ADR-0006` §7).
 *
 * There is no `PERMANENT` state and no state that outlives `expiresAt`:
 * `ACTIVE` is only reachable with an expiry in the future, and expiry is a
 * transition, not an absence of one.
 */
export const supportGrantStatus = v.union(
  v.literal("REQUESTED"),
  v.literal("APPROVED"),
  v.literal("ACTIVE"),
  v.literal("REJECTED"),
  v.literal("EXPIRED"),
  v.literal("REVOKED"),
);
export type SupportGrantStatus = Infer<typeof supportGrantStatus>;

/**
 * What a support grant may do. `READ_ONLY` is the default; `READ_WRITE` requires
 * two distinct platform approvals plus tenant approval (`INV-0006-09`).
 */
export const supportAccessMode = v.union(
  v.literal("READ_ONLY"),
  v.literal("READ_WRITE"),
);
export type SupportAccessMode = Infer<typeof supportAccessMode>;

/* -------------------------------------------------------------------------- */
/* Organization configuration                                                  */
/* -------------------------------------------------------------------------- */

/** Interface locale: Thai first, English fallback (D-06, B-10). */
export const locale = v.union(v.literal("th"), v.literal("en"));
export type Locale = Infer<typeof locale>;

/** Currency. MVP is single-currency per organization, THB (D-07). */
export const currency = v.union(v.literal("THB"));
export type Currency = Infer<typeof currency>;

/**
 * Organization configuration (§7.1).
 *
 * Every capability flag is a *capability*, not a preference: each one is `false`
 * by default and each one unlocks behaviour the MVP deliberately does not ship
 * (D-09, D-10, D-11, D-12, `ADR-0006` §7). Defaults live in
 * `organizationDefaults.ts` so "safe" is asserted in one place.
 *
 * `timezone` is an IANA name and stays an open string: adding a second Thai or
 * regional site is configuration, not a decision surface (D-05). Business dates
 * are derived from it (`G-105`), never from the UTC date.
 */
export const organizationSettings = v.object({
  timezone: v.string(),
  locale,
  currency,
  /** `LOT_SERIAL` tracking. Schema-ready, flows disabled (D-09). */
  serialTrackingEnabled: v.boolean(),
  /** Mixed SKU/lot handling-unit content (D-10). */
  mixedContentEnabled: v.boolean(),
  /** Client-owned / consigned stock as a bucket dimension (D-11). */
  consignedStockEnabled: v.boolean(),
  /** Negative `AVAILABLE` balances. Forbidden unless explicitly enabled (D-12). */
  negativeAvailableAllowed: v.boolean(),
  /** Cross-tenant support grants. Disabled by organization policy (`ADR-0006` §7). */
  supportGrantsEnabled: v.boolean(),
});
export type OrganizationSettings = Infer<typeof organizationSettings>;
