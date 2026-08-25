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
