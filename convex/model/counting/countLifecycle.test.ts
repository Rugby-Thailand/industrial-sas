import { describe, expect, it } from "vitest";

import { makeItemUomProfile } from "../uom/itemUom";
import { makeRatio } from "../uom/ratio";
import {
  availableCountTask,
  captureCountEntry,
  decideCountAttemptDiscard,
  decideCountPlanCompletion,
  decideCountPlanRelease,
  decideCountTaskRecount,
  decideCountTaskStart,
  decideCountTaskSubmission,
  makeCountPlan,
  projectCountTaskForViewer,
  recordCountPlanProgress,
} from "./countLifecycle";

const NOW = 1_700_000_000_000;

function expectOk<T>(result: { ok: true; value: T } | { ok: false }): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("expected success");
  return result.value;
}

describe("count plan lifecycle", () => {
  it("requires an unexpired freeze and completes only at zero unresolved variance", () => {
    const draft = expectOk(
      makeCountPlan({
        scope: "CYCLE",
        visibility: "BLIND",
        movementPolicy: "FROZEN",
        createdByUserId: "supervisor_1",
        taskCount: 2,
        freezeExpiresAt: NOW + 60_000,
      }),
    );
    const released = expectOk(
      decideCountPlanRelease({
        state: draft,
        actorUserId: "supervisor_1",
        now: NOW,
      }),
    );
    const reconciling = expectOk(
      recordCountPlanProgress({
        state: released,
        completedTaskCount: 2,
        varianceTaskCount: 1,
      }),
    );
    expect(reconciling.status).toBe("RECONCILING");
    const blocked = decideCountPlanCompletion({
      state: reconciling,
      actorUserId: "supervisor_1",
      now: NOW + 1,
    });
    expect(!blocked.ok && blocked.error.code).toBe("VARIANCES_UNRESOLVED");

    const clear = expectOk(
      recordCountPlanProgress({
        state: reconciling,
        completedTaskCount: 2,
        varianceTaskCount: 0,
      }),
    );
    expect(
      expectOk(
        decideCountPlanCompletion({
          state: clear,
          actorUserId: "supervisor_1",
          now: NOW + 2,
        }),
      ).status,
    ).toBe("COMPLETED");
  });

  it("refuses to release an expired frozen plan", () => {
    const draft = expectOk(
      makeCountPlan({
        scope: "FULL",
        visibility: "BLIND",
        movementPolicy: "FROZEN",
        createdByUserId: "supervisor_1",
        taskCount: 1,
        freezeExpiresAt: NOW,
      }),
    );
    const result = decideCountPlanRelease({
      state: draft,
      actorUserId: "supervisor_1",
      now: NOW,
    });
    expect(!result.ok && result.error.code).toBe("FREEZE_EXPIRED");
  });
});

describe("count task and recount", () => {
  it("submits a first count and hands a recount to a different counter", () => {
    const counting = expectOk(
      decideCountTaskStart({
        state: availableCountTask(),
        actorUserId: "counter_1",
      }),
    );
    const submitted = expectOk(
      decideCountTaskSubmission({
        state: counting,
        actorUserId: "counter_1",
        entryCount: 4,
        now: NOW,
      }),
    );
    const recount = expectOk(
      decideCountTaskRecount({
        state: submitted,
        actorUserId: "supervisor_1",
        reason: "outside tolerance",
        now: NOW + 1,
      }),
    );
    const sameCounter = decideCountTaskStart({
      state: recount,
      actorUserId: "counter_1",
    });
    expect(!sameCounter.ok && sameCounter.error.code).toBe(
      "RECOUNT_MUST_USE_DIFFERENT_COUNTER",
    );
    expect(
      expectOk(
        decideCountTaskStart({ state: recount, actorUserId: "counter_2" }),
      ).status,
    ).toBe("RECOUNTING");
  });

  it("returns a discarded partial attempt to the queue with a reason", () => {
    const counting = expectOk(
      decideCountTaskStart({
        state: availableCountTask(),
        actorUserId: "counter_1",
      }),
    );
    const discarded = expectOk(
      decideCountAttemptDiscard({
        state: { ...counting, entryCount: 3 },
        actorUserId: "counter_1",
        reason: "wrong aisle",
        now: NOW,
      }),
    );
    expect(discarded).toMatchObject({
      status: "AVAILABLE",
      entryCount: 0,
      lastDiscardReason: "wrong aisle",
    });
  });
});

describe("count quantity and blind projection", () => {
  const profile = expectOk(
    makeItemUomProfile({
      itemKey: "item_1",
      baseUom: "PCS",
      alternates: [{ uom: "CASE", toBase: expectOk(makeRatio(12, 1)) }],
    }),
  );

  it("stores entry UOM and an exact base-UOM quantity", () => {
    expect(
      expectOk(
        captureCountEntry({
          itemKey: "item_1",
          profile,
          entryUom: "CASE",
          entryMinorUnits: 1_500,
        }),
      ),
    ).toEqual({
      itemKey: "item_1",
      entryUom: "CASE",
      entryMinorUnits: 1_500,
      baseQuantity: { uom: "PCS", minorUnits: 18_000 },
    });
  });

  const source = {
    taskId: "task_1",
    locationId: "location_1",
    visibility: "BLIND" as const,
    systemSnapshotBaseMinorUnits: 100_000,
    movementBaseMinorUnits: 5_000,
    firstCountBaseMinorUnits: 98_000,
    secondCountBaseMinorUnits: 99_000,
  };

  it("omits system quantities entirely for a blind counter", () => {
    const view = expectOk(
      projectCountTaskForViewer({ source, role: "COUNTER" }),
    );
    expect("systemSnapshotBaseMinorUnits" in view).toBe(false);
    expect("movementBaseMinorUnits" in view).toBe(false);
    expect(JSON.stringify(view)).not.toContain("100000");
  });

  it("never reveals the first count to a recounter, even in visible mode", () => {
    const view = expectOk(
      projectCountTaskForViewer({
        source: { ...source, visibility: "VISIBLE" },
        role: "RECOUNTER",
      }),
    );
    expect(view.systemSnapshotBaseMinorUnits).toBe(100_000);
    expect("firstCountBaseMinorUnits" in view).toBe(false);
  });

  it("gives reconciliation evidence to a supervisor", () => {
    const view = expectOk(
      projectCountTaskForViewer({ source, role: "SUPERVISOR" }),
    );
    expect(view).toMatchObject({
      systemSnapshotBaseMinorUnits: 100_000,
      movementBaseMinorUnits: 5_000,
      firstCountBaseMinorUnits: 98_000,
      secondCountBaseMinorUnits: 99_000,
    });
  });
});
