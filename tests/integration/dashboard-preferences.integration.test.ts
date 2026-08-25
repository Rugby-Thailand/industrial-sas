import { makeFunctionReference } from "convex/server";
import type { GenericId } from "convex/values";
import { describe, expect, it } from "vitest";

import type { TenantFunctionOutcome } from "../../convex/lib/tenantFunctions";
import type {
  DashboardActionId,
  DashboardSelectionErrorCode,
} from "../../convex/model/reporting/dashboardPreferences";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTestModuleMap,
} from "../fixtures/convex-tenant-world";

interface PreferencePayload {
  readonly pageKey: "OWNER_DASHBOARD";
  readonly presetVersion: number;
  readonly customized: boolean;
  readonly selectedActionIds: readonly DashboardActionId[];
  readonly availableActionIds: readonly DashboardActionId[];
  readonly updatedAt?: number;
}

type PreferenceWriteResult =
  | {
      readonly accepted: true;
      readonly preference: PreferencePayload;
    }
  | {
      readonly accepted: false;
      readonly code: DashboardSelectionErrorCode;
    };

const MODULES: ConvexTestModuleMap = {
  "../convex/reporting/dashboardPreferences.ts": () =>
    import("../../convex/reporting/dashboardPreferences"),
};

const readRef = makeFunctionReference<
  "query",
  { warehouseId: GenericId<"warehouses"> },
  TenantFunctionOutcome<PreferencePayload>
>("reporting/dashboardPreferences:readPreferences");

const updateRef = makeFunctionReference<
  "mutation",
  {
    warehouseId: GenericId<"warehouses">;
    actionIds: string[];
  },
  TenantFunctionOutcome<PreferenceWriteResult>
>("reporting/dashboardPreferences:updatePreferences");

const resetRef = makeFunctionReference<
  "mutation",
  { warehouseId: GenericId<"warehouses"> },
  TenantFunctionOutcome<PreferencePayload>
>("reporting/dashboardPreferences:resetPreferences");

const identity = (org: "a" | "b") => ({
  subject: "user_fixture_a",
  org_id: `org_fixture_${org}`,
});

const allowed = <Value>(outcome: TenantFunctionOutcome<Value>): Value => {
  if (!outcome.ok) {
    throw new Error(`Expected allowed outcome: ${JSON.stringify(outcome)}`);
  }
  return outcome.value;
};

describe("dashboard preferences", () => {
  it("stores a personal selection in the active tenant membership only", async () => {
    const world = await createConvexTenantWorld(MODULES);
    await seedConvexAuthorization(world);

    const initialB = allowed(
      await world.t
        .withIdentity(identity("b"))
        .query(readRef, { warehouseId: world.warehouses.alphaB }),
    );
    expect(initialB.customized).toBe(false);
    expect(initialB.selectedActionIds.length).toBeGreaterThan(0);

    const saved = allowed(
      await world.t.withIdentity(identity("b")).mutation(updateRef, {
        warehouseId: world.warehouses.alphaB,
        actionIds: ["INVENTORY_HEALTH", "CUSTOMER_ORDERS"],
      }),
    );
    expect(saved).toMatchObject({
      accepted: true,
      preference: {
        customized: true,
        selectedActionIds: ["INVENTORY_HEALTH", "CUSTOMER_ORDERS"],
      },
    });

    const rereadB = allowed(
      await world.t
        .withIdentity(identity("b"))
        .query(readRef, { warehouseId: world.warehouses.alphaB }),
    );
    expect(rereadB.selectedActionIds).toEqual([
      "INVENTORY_HEALTH",
      "CUSTOMER_ORDERS",
    ]);

    const readA = allowed(
      await world.t
        .withIdentity(identity("a"))
        .query(readRef, { warehouseId: world.warehouses.alphaA }),
    );
    expect(readA.customized).toBe(false);
    expect(readA.selectedActionIds).not.toEqual(rereadB.selectedActionIds);
  });

  it("rejects invalid selections without changing the stored preference", async () => {
    const world = await createConvexTenantWorld(MODULES);
    await seedConvexAuthorization(world);

    const rejected = allowed(
      await world.t.withIdentity(identity("b")).mutation(updateRef, {
        warehouseId: world.warehouses.alphaB,
        actionIds: ["REMOVED_ACTION"],
      }),
    );
    expect(rejected).toEqual({ accepted: false, code: "UNKNOWN_ACTION" });

    const read = allowed(
      await world.t
        .withIdentity(identity("b"))
        .query(readRef, { warehouseId: world.warehouses.alphaB }),
    );
    expect(read.customized).toBe(false);
  });

  it("resets to the latest permitted owner preset", async () => {
    const world = await createConvexTenantWorld(MODULES);
    await seedConvexAuthorization(world);

    await world.t.withIdentity(identity("b")).mutation(updateRef, {
      warehouseId: world.warehouses.alphaB,
      actionIds: ["INVENTORY_HEALTH"],
    });
    const reset = allowed(
      await world.t
        .withIdentity(identity("b"))
        .mutation(resetRef, { warehouseId: world.warehouses.alphaB }),
    );
    expect(reset.customized).toBe(false);
    expect(reset.selectedActionIds.length).toBeGreaterThan(1);
    expect(reset.updatedAt).toBeUndefined();
  });
});
