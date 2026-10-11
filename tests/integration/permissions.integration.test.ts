import "../fixtures/policy-fixture-permissions";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_ROLES,
  PERMISSION_CATALOGUE,
  evaluateAuthorization,
  type AuthorizationInput,
} from "../../convex/lib/permissions";

/**
 * The shipping catalogue and role matrix, written out literally. A change to
 * either is a reviewed authorization change (CODEOWNERS covers this file and
 * `convex/lib/permissions.ts`), never a silent side effect.
 */
const SHIPPING_CATALOGUE = [
  ["masterData.warehouse.read", "ORG"],
  ["masterData.storageLayout.read", "WAREHOUSE"],
  ["masterData.storageLayout.manage", "WAREHOUSE"],
  ["masterData.storageLayout.activate", "WAREHOUSE"],
  ["aiUsage.read", "ORG"],
  ["aiUsage.configure", "ORG"],
  ["hr.self.access", "ORG"],
  ["hr.team.review", "ORG"],
  ["hr.admin.manage", "ORG"],
  ["hr.period.close", "ORG"],
  ["hr.period.export", "ORG"],
] as const;
const PLANNER = SHIPPING_CATALOGUE.slice(0, 4).map(([code]) => code);
const HR = SHIPPING_CATALOGUE.slice(6).map(([code]) => code);

const SHIPPING_ROLES: Record<string, readonly string[]> = {
  ORG_ADMIN: [...PLANNER, ...HR, "aiUsage.read", "aiUsage.configure"],
  WAREHOUSE_MANAGER: PLANNER,
  HR_EMPLOYEE: ["hr.self.access"],
  HR_SUPERVISOR: ["hr.self.access", "hr.team.review"],
  HR_ADMIN: HR,
  SUPERVISOR: ["masterData.warehouse.read", "masterData.storageLayout.read"],
};

const base = (
  overrides: Partial<AuthorizationInput> = {},
): AuthorizationInput => ({
  permissionCode: "masterData.storageLayout.manage",
  actorUserId: "user_actor",
  membershipStatus: "ACTIVE",
  membershipEffectiveFrom: 0,
  scopeMode: "WAREHOUSE_SCOPED",
  warehouseIds: new Set(["warehouse_a"]),
  targetWarehouseId: "warehouse_a",
  grantedPermissionCodes: new Set(["masterData.storageLayout.manage"]),
  now: 10_000,
  maxStepUpAgeMs: 5_000,
  ...overrides,
});

describe("code-owned permission policy", () => {
  it("ships exactly the reviewed catalogue, with no elevated flags", () => {
    expect(
      PERMISSION_CATALOGUE.map(({ code, scope }) => [code, scope]),
    ).toEqual(SHIPPING_CATALOGUE.map((row) => [...row]));
    for (const definition of PERMISSION_CATALOGUE) {
      expect(definition).toMatchObject({
        requiresStepUp: false,
        requiresMakerChecker: false,
        requiresThreshold: false,
      });
      expect(Object.isFrozen(definition)).toBe(true);
      expect(definition.code).toMatch(/^[a-z][A-Za-z]*(?:\.[a-z][A-Za-z]*)+$/);
    }
    expect(Object.isFrozen(PERMISSION_CATALOGUE)).toBe(true);
  });

  it("ships the reviewed default role matrix and grants no platform code", () => {
    expect(DEFAULT_ROLES.map(({ key }) => key)).toEqual(
      Object.keys(SHIPPING_ROLES),
    );
    for (const role of DEFAULT_ROLES) {
      expect(role.permissionCodes).toEqual(SHIPPING_ROLES[role.key]);
      expect(new Set(role.permissionCodes).size).toBe(
        role.permissionCodes.length,
      );
      expect(
        role.permissionCodes.every((code) => !code.startsWith("platform.")),
      ).toBe(true);
    }
  });

  it("fails closed for unknown, platform, inactive, ungranted, and foreign-warehouse access", () => {
    expect(
      evaluateAuthorization(
        base({ permissionCode: "invented.permission.use" }),
      ),
    ).toMatchObject({ allowed: false, reason: "NO_PERMISSION" });
    expect(
      evaluateAuthorization(base({ permissionCode: "platform.tenant.read" })),
    ).toMatchObject({ allowed: false, reason: "NO_PERMISSION" });
    expect(
      evaluateAuthorization(base({ membershipStatus: "REVOKED" })),
    ).toMatchObject({ allowed: false, reason: "INACTIVE_MEMBERSHIP" });
    expect(
      evaluateAuthorization(base({ membershipStatus: "SUSPENDED" })),
    ).toMatchObject({ allowed: false, reason: "INACTIVE_MEMBERSHIP" });
    expect(
      evaluateAuthorization(base({ membershipEffectiveFrom: 20_000 })),
    ).toMatchObject({ allowed: false, reason: "INACTIVE_MEMBERSHIP" });
    expect(
      evaluateAuthorization(base({ membershipEffectiveTo: 10_000 })),
    ).toMatchObject({ allowed: false, reason: "INACTIVE_MEMBERSHIP" });
    expect(
      evaluateAuthorization(base({ grantedPermissionCodes: new Set() })),
    ).toMatchObject({ allowed: false, reason: "NO_PERMISSION" });
    expect(
      evaluateAuthorization(base({ targetWarehouseId: "warehouse_b" })),
    ).toMatchObject({ allowed: false, reason: "OUT_OF_WAREHOUSE_SCOPE" });
    expect(evaluateAuthorization(base())).toMatchObject({ allowed: true });
  });

  it("does not let a supervisor manage a layout", () => {
    expect(
      evaluateAuthorization(
        base({
          grantedPermissionCodes: new Set(SHIPPING_ROLES.SUPERVISOR),
        }),
      ),
    ).toMatchObject({ allowed: false, reason: "NO_PERMISSION" });
  });

  it("still enforces the dormant threshold, maker-checker, step-up and entitlement layers", () => {
    // `fixture.transaction.reverse` is test-only (see
    // tests/fixtures/policy-fixture-permissions.ts); the layers ship today.
    const privileged = {
      permissionCode: "fixture.transaction.reverse",
      grantedPermissionCodes: new Set(["fixture.transaction.reverse"]),
      thresholdExceeded: true,
      thresholdApproved: true,
      approvalSatisfied: true,
      makerUserId: "user_maker",
      reverifiedAt: 9_000,
    } satisfies Partial<AuthorizationInput>;

    expect(evaluateAuthorization(base(privileged))).toMatchObject({
      allowed: true,
    });
    expect(
      evaluateAuthorization(base({ ...privileged, thresholdApproved: false })),
    ).toMatchObject({ allowed: false, reason: "THRESHOLD_EXCEEDED" });
    expect(
      evaluateAuthorization(base({ ...privileged, makerUserId: "user_actor" })),
    ).toMatchObject({ allowed: false, reason: "APPROVAL_REQUIRED" });
    expect(
      evaluateAuthorization(base({ ...privileged, reverifiedAt: 1_000 })),
    ).toMatchObject({ allowed: false, reason: "REVERIFICATION_REQUIRED" });
    expect(
      evaluateAuthorization(base({ ...privileged, reverifiedAt: 20_000 })),
    ).toMatchObject({ allowed: false, reason: "REVERIFICATION_REQUIRED" });
    expect(
      evaluateAuthorization(
        base({
          ...privileged,
          entitlementRequired: true,
          entitlementEnabled: false,
        }),
      ),
    ).toMatchObject({ allowed: false, reason: "ENTITLEMENT_DISABLED" });
  });

  it("permits organization-wide membership across warehouses but still needs a target", () => {
    expect(
      evaluateAuthorization(
        base({ scopeMode: "ORG_WIDE", targetWarehouseId: "any" }),
      ),
    ).toMatchObject({ allowed: true });
    const withoutTarget = base({ scopeMode: "ORG_WIDE" });
    Reflect.deleteProperty(withoutTarget, "targetWarehouseId");
    expect(evaluateAuthorization(withoutTarget)).toMatchObject({
      allowed: false,
      reason: "OUT_OF_WAREHOUSE_SCOPE",
    });
  });
});
