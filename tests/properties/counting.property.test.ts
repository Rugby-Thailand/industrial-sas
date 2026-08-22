import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  captureCountEntry,
  projectCountTaskForViewer,
} from "../../convex/model/counting/countLifecycle";
import { assessCountVariance } from "../../convex/model/counting/reconciliationPolicy";
import { makeItemUomProfile } from "../../convex/model/uom/itemUom";
import { makeRatio } from "../../convex/model/uom/ratio";

function expectOk<T>(result: { ok: true; value: T } | { ok: false }): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("expected success");
  return result.value;
}

describe("counting properties", () => {
  it("movement-aware variance always equals physical minus snapshot and movements", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000_000 }),
        fc.integer({ min: -100_000_000, max: 100_000_000 }),
        fc.integer({ min: 0, max: 1_000_000_000 }),
        (snapshot, movement, physical) => {
          const assessment = expectOk(
            assessCountVariance({
              systemSnapshotBaseMinorUnits: snapshot,
              inCountMovementBaseMinorUnits: movement,
              physicalBaseMinorUnits: physical,
              unitValueMinorUnits: 1,
              itemClass: "C",
              policy: {
                quantityThresholdBaseMinorUnits: Number.MAX_SAFE_INTEGER,
                valueThresholdMinorUnits: Number.MAX_SAFE_INTEGER,
                highRiskItemClasses: [],
              },
            }),
          );
          expect(assessment.expectedBaseMinorUnits).toBe(snapshot + movement);
          expect(assessment.varianceBaseMinorUnits).toBe(
            physical - snapshot - movement,
          );
        },
      ),
    );
  });

  it("a blind operator projection never contains system or movement fields", () => {
    fc.assert(
      fc.property(
        fc.integer(),
        fc.integer(),
        fc.option(fc.integer(), { nil: undefined }),
        fc.constantFrom("COUNTER" as const, "RECOUNTER" as const),
        (snapshot, movement, firstCount, role) => {
          const view = expectOk(
            projectCountTaskForViewer({
              source: {
                taskId: "task_1",
                locationId: "location_1",
                visibility: "BLIND",
                systemSnapshotBaseMinorUnits: snapshot,
                movementBaseMinorUnits: movement,
                ...(firstCount === undefined
                  ? {}
                  : { firstCountBaseMinorUnits: firstCount }),
              },
              role,
            }),
          );
          expect(Object.hasOwn(view, "systemSnapshotBaseMinorUnits")).toBe(
            false,
          );
          expect(Object.hasOwn(view, "movementBaseMinorUnits")).toBe(false);
          if (role === "RECOUNTER") {
            expect(Object.hasOwn(view, "firstCountBaseMinorUnits")).toBe(false);
          }
        },
      ),
    );
  });

  it("exact case conversion preserves integer base-minor quantities", () => {
    const ratio = expectOk(makeRatio(12, 1));
    const profile = expectOk(
      makeItemUomProfile({
        itemKey: "item_1",
        baseUom: "PCS",
        alternates: [{ uom: "CASE", toBase: ratio }],
      }),
    );
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        (entryMinorUnits) => {
          const captured = expectOk(
            captureCountEntry({
              itemKey: "item_1",
              profile,
              entryUom: "CASE",
              entryMinorUnits,
            }),
          );
          expect(captured.baseQuantity).toEqual({
            uom: "PCS",
            minorUnits: entryMinorUnits * 12,
          });
        },
      ),
    );
  });
});
