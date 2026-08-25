/**
 * The drift guard between the shared operator screens and the operations the
 * server posts under.
 *
 * Function *names* no longer need a guard: `src/lib/convex/platformApi.ts`
 * builds every reference from committed Convex codegen, so a rename or a
 * changed argument is a type error rather than "function not found" on a
 * handheld. What codegen cannot check is the classification catalogue, which is
 * an independent table keyed by operation string.
 */
import { describe, expect, it } from "vitest";

import * as devices from "../../convex/platform/devices";
import * as exceptions from "../../convex/platform/exceptions";
import * as taskFiles from "../../convex/platform/taskFiles";
import * as tasks from "../../convex/platform/tasks";
import { COMMAND_CLASSIFICATIONS } from "../../convex/model/platform/commandClassification";

describe("the platform client contract", () => {
  it("keeps the unconsumed device-seen operation a public mutation", () => {
    expect(devices.recordDeviceSeen.isPublic).toBe(true);
    expect(devices.recordDeviceSeen.isMutation).toBe(true);
  });

  it("classifies every operation the shared task module posts under", () => {
    /*
     * The classification is what the browser consults before it offers a
     * control (`FF-P1-12`). An operation the server posts under but the
     * catalogue has never heard of would be blocked by the unknown-operation
     * default — safe, but the operator would be told "not classified" instead
     * of why.
     */
    const classified = new Set(
      COMMAND_CLASSIFICATIONS.map((definition) => definition.operation),
    );
    for (const operation of Object.values(tasks.WORK_OPERATIONS)) {
      expect(classified.has(operation), operation).toBe(true);
    }
    for (const operation of Object.values(
      exceptions.WORK_EXCEPTION_OPERATIONS,
    )) {
      expect(classified.has(operation), operation).toBe(true);
    }
    for (const operation of Object.values(taskFiles.TASK_FILE_OPERATIONS)) {
      expect(classified.has(operation), operation).toBe(true);
    }
    expect(classified.has("platform.device.seen")).toBe(true);
  });
});
