import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_ROLES,
  PERMISSION_CATALOGUE,
  evaluateAuthorization,
  type AuthorizationInput,
} from "../../convex/lib/permissions";

function documentedCatalogue() {
  const section = readFileSync("docs/permissions.md", "utf8")
    .split("## 2. Catalogue")[1]!
    .split("## 3. Seeded default roles")[0]!;
  return section
    .split("\n")
    .filter((line) => /^\| `[^`]+`/.test(line))
    .map((line) => {
      const cells = line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim().replaceAll("`", ""));
      const flags = cells[3]!.toLowerCase();
      return {
        code: cells[0],
        scope: cells[1] === "WH" ? "WAREHOUSE" : cells[1],
        requiresStepUp: flags.includes("step-up"),
        requiresMakerChecker:
          flags.includes("maker-checker") ||
          flags.includes("two-person") ||
          flags.includes("two approvals"),
        requiresThreshold: flags.includes("threshold"),
      };
    });
}

function documentedRoleMappings() {
  const section = readFileSync("docs/permissions.md", "utf8")
    .split("### 3.1 Default mapping")[1]!
    .split("## 4. Policy semantics")[0]!;
  const keys = DEFAULT_ROLES.map(({ key }) => key);
  const mappings = new Map(keys.map((key) => [key, [] as string[]]));
  for (const line of section.split("\n").filter((row) => /^\| `/.test(row))) {
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim().replaceAll("`", ""));
    keys.forEach((key, index) => {
      if (cells[index + 1] === "Y") mappings.get(key)!.push(cells[0]!);
    });
  }
  return mappings;
}

const base = (
  overrides: Partial<AuthorizationInput> = {},
): AuthorizationInput => ({
  permissionCode: "receiving.receipt.post",
  actorUserId: "user_actor",
  membershipStatus: "ACTIVE",
  membershipEffectiveFrom: 0,
  scopeMode: "WAREHOUSE_SCOPED",
  warehouseIds: new Set(["warehouse_a"]),
  targetWarehouseId: "warehouse_a",
  grantedPermissionCodes: new Set(["receiving.receipt.post"]),
  now: 10_000,
  maxStepUpAgeMs: 5_000,
  ...overrides,
});

describe("code-owned permission policy", () => {
  it("matches every catalogue row and policy flag documented for the pilot", () => {
    expect(PERMISSION_CATALOGUE).toEqual(documentedCatalogue());
    expect(new Set(PERMISSION_CATALOGUE.map(({ code }) => code)).size).toBe(
      PERMISSION_CATALOGUE.length,
    );
    for (const { code } of PERMISSION_CATALOGUE) {
      expect(code).toMatch(/^[a-z][A-Za-z]*(?:\.[a-z][A-Za-z]*)+$/);
    }
  });

  it("matches the documented default role matrix and grants no platform code", () => {
    const documented = documentedRoleMappings();
    for (const role of DEFAULT_ROLES) {
      expect(role.permissionCodes).toEqual(documented.get(role.key));
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
      evaluateAuthorization(base({ grantedPermissionCodes: new Set() })),
    ).toMatchObject({ allowed: false, reason: "NO_PERMISSION" });
    expect(
      evaluateAuthorization(base({ targetWarehouseId: "warehouse_b" })),
    ).toMatchObject({ allowed: false, reason: "OUT_OF_WAREHOUSE_SCOPE" });
  });

  it("enforces threshold, maker-checker, step-up, and entitlement layers", () => {
    const privileged = {
      permissionCode: "inventory.transaction.reverse",
      grantedPermissionCodes: new Set(["inventory.transaction.reverse"]),
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
