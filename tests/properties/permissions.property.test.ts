/**
 * Property tier — the two claims about authorization that hold for every input
 * rather than for a chosen fixture (ADR-0006 verification).
 *
 * Both are written so a passing run cannot be vacuous. The scope case decides
 * whether the target is one the membership holds, so the generator is guaranteed
 * to produce allowed *and* denied `before` decisions — asserted at the end, because
 * "adding a warehouse never removes access" is trivially true if access was never
 * granted. The catalogue case draws from the whole catalogue plus invented codes.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_ROLES,
  PERMISSIONS_BY_CODE,
  PERMISSION_CATALOGUE,
  evaluateAuthorization,
  type AuthorizationInput,
} from "../../convex/lib/permissions";

const warehouseId = fc.stringMatching(/^wh_[a-z]{1,8}$/);

const scoped = (
  warehouses: readonly string[],
  target: string,
): AuthorizationInput => ({
  permissionCode: "receiving.receipt.post",
  actorUserId: "user_actor",
  membershipStatus: "ACTIVE",
  membershipEffectiveFrom: 0,
  scopeMode: "WAREHOUSE_SCOPED",
  warehouseIds: new Set(warehouses),
  targetWarehouseId: target,
  grantedPermissionCodes: new Set(["receiving.receipt.post"]),
  now: 1,
  maxStepUpAgeMs: 0,
});

describe("warehouse scope resolution", () => {
  it("is monotone: adding a warehouse never removes access, and adding the target grants it", () => {
    const outcomes = new Set<boolean>();

    fc.assert(
      fc.property(
        fc.uniqueArray(warehouseId, { minLength: 1, maxLength: 20 }),
        fc.nat(),
        fc.boolean(),
        warehouseId,
        (warehouses, index, targetIsHeld, added) => {
          const target = targetIsHeld
            ? warehouses[index % warehouses.length]!
            : "wh_outside";
          const held = warehouses.filter(
            (candidate) => candidate !== "wh_outside",
          );

          const before = evaluateAuthorization(scoped(held, target));
          outcomes.add(before.allowed);

          // Monotonicity: a warehouse chosen independently of the target is added.
          if (before.allowed) {
            expect(
              evaluateAuthorization(scoped([...held, added], target)),
            ).toMatchObject({ allowed: true });
          }
          // Adding the target itself always grants, whatever was held before.
          expect(
            evaluateAuthorization(scoped([...held, target], target)),
          ).toMatchObject({ allowed: true });
          return true;
        },
      ),
      { seed: 20260803, numRuns: 300 },
    );

    expect([...outcomes].sort()).toEqual([false, true]);
  });
});

describe("role composition over the code-owned catalogue", () => {
  const tenantCodes = PERMISSION_CATALOGUE.filter(
    ({ scope }) => scope !== "PLATFORM",
  ).map(({ code }) => code);

  it("never grants a code absent from the catalogue and never a platform code", () => {
    for (const role of DEFAULT_ROLES) {
      for (const code of role.permissionCodes) {
        expect(tenantCodes).toContain(code);
        expect(PERMISSIONS_BY_CODE.get(code)?.scope).not.toBe("PLATFORM");
      }
    }
  });

  it("denies every code a composition does not hold, catalogued or invented", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constantFrom(...PERMISSION_CATALOGUE.map(({ code }) => code)),
          fc.stringMatching(/^invented\.[a-z]{1,8}\.[a-z]{1,8}$/),
        ),
        (permissionCode) => {
          expect(
            evaluateAuthorization({
              ...scoped(["wh_a"], "wh_a"),
              permissionCode,
              grantedPermissionCodes: new Set(),
            }),
          ).toMatchObject({ allowed: false });
          return true;
        },
      ),
      { seed: 20260803, numRuns: 300 },
    );
  });
});
