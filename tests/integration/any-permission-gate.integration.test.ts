import { describe, expect, it } from "vitest";

import "../fixtures/policy-fixture-permissions";
import {
  AuthorizationDeclarationError,
  assertAnyAuthorizationDeclaration,
} from "../../convex/lib/authorization";
import { queryWithOrg } from "../../convex/lib/tenantFunctions";
import { HOME_ELIGIBILITY_PERMISSIONS } from "../../convex/model/home/quickMenu";

const base = {
  permissionCodes: ["hr.self.access", "aiUsage.read"],
  targetTable: "homeQuickMenuPreferences",
  hasWarehouseSelector: false,
  hasPolicy: false,
} as const;

describe("restricted anyPermissionCodes declaration", () => {
  it("accepts plain ORG codes in declaration order", () => {
    expect(
      assertAnyAuthorizationDeclaration("mutation", {
        ...base,
        permissionCodes: HOME_ELIGIBILITY_PERMISSIONS,
      }).map(({ code }) => code),
    ).toEqual([...HOME_ELIGIBILITY_PERMISSIONS]);
  });

  it.each([
    ["an action", "action", {}],
    ["a warehouse selector", "query", { hasWarehouseSelector: true }],
    ["a policy", "mutation", { hasPolicy: true }],
    ["an entitlement", "query", { entitlementKey: "home" }],
    ["no codes", "query", { permissionCodes: [] }],
    [
      "a duplicate",
      "query",
      { permissionCodes: ["aiUsage.read", "aiUsage.read"] },
    ],
    ["an unknown code", "query", { permissionCodes: ["home.unknown"] }],
    [
      "a WAREHOUSE code",
      "query",
      { permissionCodes: ["masterData.storageLayout.read"] },
    ],
    ["a PLATFORM code", "query", { permissionCodes: ["platform.tenant.read"] }],
    [
      "an ORG step-up code",
      "mutation",
      { permissionCodes: ["fixture.organization.update"] },
    ],
    [
      "an ORG threshold code",
      "mutation",
      { permissionCodes: ["fixture.orgThreshold.approve"] },
    ],
    [
      "an ORG maker-checker code",
      "mutation",
      { permissionCodes: ["fixture.orgMakerChecker.approve"] },
    ],
    ["a non-tenant table", "query", { targetTable: "users" }],
  ] as const)("rejects %s", (_label, kind, override) => {
    expect(() =>
      assertAnyAuthorizationDeclaration(kind, { ...base, ...override }),
    ).toThrow(AuthorizationDeclarationError);
  });

  it("requires exactly one of permissionCode and anyPermissionCodes at registration", () => {
    const handler = async () => null;
    expect(() =>
      queryWithOrg({
        permissionCode: "aiUsage.read",
        anyPermissionCodes: ["hr.self.access"],
        target: { table: "homeQuickMenuPreferences" },
        handler,
      } as never),
    ).toThrow(AuthorizationDeclarationError);
    expect(() =>
      queryWithOrg({
        target: { table: "homeQuickMenuPreferences" },
        handler,
      } as never),
    ).toThrow(AuthorizationDeclarationError);
  });
});
