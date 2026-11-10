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
