/**
 * Fixture-only permission definitions for the authorization pipeline tests.
 *
 * The shipping catalogue (`convex/lib/permissions.ts`) currently defines only
 * the storage-planner codes, none of which require step-up, maker-checker or a
 * threshold. The enforcement layers for those flags still ship in
 * `evaluateAuthorization`, `assertAuthorizationDeclaration` and the tenant
 * wrappers, so these tests register clearly-named `fixture.*` codes that
 * exercise every layer. Importing this module mutates the in-memory map for the
 * importing test file only (Vitest isolates each file's module graph); the
 * product catalogue, default roles and generated API are unchanged.
 *
 * Import this module before any code that registers a tenant function.
 */
import {
  PERMISSIONS_BY_CODE,
  type PermissionDefinition,
} from "../../convex/lib/permissions";
import {
  seedConvexAuthorization,
  type ConvexAuthorizationOptions,
  type ConvexAuthorizationWorld,
  type ConvexTenantWorld,
} from "./convex-tenant-world";

type Flag = "STEP_UP" | "MAKER_CHECKER" | "THRESHOLD";

const definition = (
  code: string,
  scope: PermissionDefinition["scope"],
  flags: readonly Flag[] = [],
): PermissionDefinition =>
  Object.freeze({
    code,
    scope,
    requiresStepUp: flags.includes("STEP_UP"),
    requiresMakerChecker: flags.includes("MAKER_CHECKER"),
    requiresThreshold: flags.includes("THRESHOLD"),
  });

export const FIXTURE_PERMISSIONS = Object.freeze([
  definition("fixture.audit.read", "ORG"),
  definition("fixture.device.manage", "ORG"),
  definition("fixture.organization.update", "ORG", ["STEP_UP"]),
  definition("fixture.warehouse.manage", "ORG", ["STEP_UP"]),
  definition("fixture.receipt.post", "WAREHOUSE"),
  definition("fixture.label.print", "WAREHOUSE"),
  definition("fixture.task.override", "WAREHOUSE", ["THRESHOLD"]),
  definition("fixture.statusChange.submit", "WAREHOUSE"),
  definition("fixture.statusChange.approve", "WAREHOUSE", ["MAKER_CHECKER"]),
  definition("fixture.transaction.reverse", "WAREHOUSE", [
    "THRESHOLD",
    "MAKER_CHECKER",
    "STEP_UP",
  ]),
  definition("fixture.negativeStock.override", "WAREHOUSE", [
    "STEP_UP",
    "MAKER_CHECKER",
  ]),
  definition("platform.tenant.read", "PLATFORM"),
  definition("platform.tenant.write", "PLATFORM", ["MAKER_CHECKER"]),
]);

/**
 * Fixture grants for the seeded roles, mirroring the pre-cleanup role matrix
 * the recovered suites were written against. `VIEWER` is a fixture role with
 * no grants, used to prove denial and cross-tenant non-inheritance.
 */
export const FIXTURE_AUTHORIZATION_OPTIONS: ConvexAuthorizationOptions =
  Object.freeze({
    extraRoles: [{ key: "VIEWER", permissionCodes: [] }],
    extraGrants: {
      ORG_ADMIN: [
        "fixture.audit.read",
        "fixture.device.manage",
        "fixture.organization.update",
        "fixture.warehouse.manage",
        "fixture.receipt.post",
        "fixture.label.print",
        "fixture.task.override",
        "fixture.statusChange.submit",
        "fixture.statusChange.approve",
        "fixture.transaction.reverse",
        "fixture.negativeStock.override",
      ],
      WAREHOUSE_MANAGER: [
        "fixture.audit.read",
        "fixture.device.manage",
        "fixture.receipt.post",
        "fixture.label.print",
        "fixture.task.override",
        "fixture.statusChange.submit",
        "fixture.statusChange.approve",
        "fixture.transaction.reverse",
      ],
      SUPERVISOR: [
        "fixture.audit.read",
        "fixture.receipt.post",
        "fixture.label.print",
        "fixture.task.override",
        "fixture.statusChange.submit",
        "fixture.statusChange.approve",
      ],
    },
  });

export async function seedFixtureAuthorization(
  world: ConvexTenantWorld,
  options: ConvexAuthorizationOptions = {},
): Promise<ConvexAuthorizationWorld> {
  return await seedConvexAuthorization(world, {
    ...FIXTURE_AUTHORIZATION_OPTIONS,
    ...options,
  });
}

const writable = PERMISSIONS_BY_CODE as Map<string, PermissionDefinition>;
for (const entry of FIXTURE_PERMISSIONS) {
  if (writable.has(entry.code) && writable.get(entry.code) !== entry) {
    throw new Error(`Fixture permission ${entry.code} shadows a real code.`);
  }
  writable.set(entry.code, entry);
}
