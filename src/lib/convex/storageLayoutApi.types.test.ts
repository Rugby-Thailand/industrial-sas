import type { FunctionArgs, FunctionReturnType } from "convex/server";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { api } from "../../../convex/_generated/api";
import type { tenantDocument } from "../../../convex/lib/tenantDocument";
import type { storageLayoutRefs } from "./storageLayoutApi";
import { typedClientRef } from "./clientRef";
import { describe, expectTypeOf, it } from "vitest";

import type { LayoutReadiness, LayoutReadinessIssue } from "./storageLayoutApi";

// Compile-time pilot contract (checked by `pnpm typecheck`): the readiness
// client type is inferred from the explicit backend result validator, not a
// mirrored DTO or `any`.
describe("layout readiness client type", () => {
  it("is the exact validated result union", () => {
    expectTypeOf<LayoutReadiness>().not.toBeAny();
    expectTypeOf<LayoutReadiness>().toEqualTypeOf<
      | { readonly found: false }
      | {
          readonly found: true;
          readonly status: "DRAFT" | "ACTIVE" | "ARCHIVED";
          readonly version: number;
          readonly zoneCount: number;
          readonly ready: boolean;
          readonly issues: readonly LayoutReadinessIssue[];
        }
    >();
    expectTypeOf<LayoutReadinessIssue>().toEqualTypeOf<{
      readonly code: string;
      readonly blocking: boolean;
      readonly floorNumber?: number;
      readonly zoneCode?: string;
      readonly zoneLabel?: string;
      readonly field?: string;
    }>();
  });
});

it("retains table identity at the validated feature interface and persistence read", () => {
  type Args = FunctionArgs<typeof storageLayoutRefs.readiness>;
  expectTypeOf<Id<"storageBuildings">>().toExtend<Args["buildingId"]>();
  expectTypeOf<string>().toExtend<Args["buildingId"]>(); // unvalidated URL text
  expectTypeOf<Id<"storageZones">>().not.toExtend<Args["buildingId"]>();
  expectTypeOf<Id<"storageBuildings">>().not.toExtend<Args["warehouseId"]>();
  type Archive = FunctionArgs<typeof storageLayoutRefs.archiveZone>;
  expectTypeOf<Id<"storageBuildings">>().not.toExtend<Archive["zoneId"]>();
  type BuildingRead = typeof tenantDocument<"storageBuildings">;
  expectTypeOf<
    Awaited<ReturnType<BuildingRead>>
  >().toEqualTypeOf<Doc<"storageBuildings"> | null>();
  expectTypeOf<Id<"warehouses">>().not.toExtend<Parameters<BuildingRead>[2]>();
  const _attachment = typedClientRef(
    api.finishedGoods.attachments.createIntent,
  );
  type Outcome = FunctionReturnType<typeof _attachment>;
  type Value = Extract<Outcome, { ok: true }>["value"];
  expectTypeOf<
    Extract<Value, { readonly assetId: unknown }>["assetId"]
  >().toEqualTypeOf<Id<"jobTicketAssets">>();
});
