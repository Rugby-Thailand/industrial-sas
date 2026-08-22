/**
 * The drift guard between the browser and the Phase 1 shared-platform
 * functions.
 *
 * `src/lib/convex/platformApi.ts` names its functions with hand-written strings
 * because `convex/_generated/` is a git-ignored build artifact. The cost of
 * that choice is that a rename on the server would surface at run time, on a
 * handheld, as "function not found". This file pays that cost back: it imports
 * the real modules and fails the build the moment the names disagree.
 *
 * It also asserts the *kind* of each export. An export of the right name that
 * turned out to be a helper, an internal function, or a mutation where the
 * client expects a query would satisfy "it is defined" and still fail from a
 * browser.
 */
import { getFunctionName } from "convex/server";
import { describe, expect, it } from "vitest";

import * as devices from "../../convex/platform/devices";
import * as exceptions from "../../convex/platform/exceptions";
import * as stepUp from "../../convex/platform/stepUp";
import * as taskFiles from "../../convex/platform/taskFiles";
import * as tasks from "../../convex/platform/tasks";
import { COMMAND_CLASSIFICATIONS } from "../../convex/model/platform/commandClassification";
import {
  PLATFORM_FUNCTION_PATHS,
  approveOnDeviceRef,
  attachTaskFileRef,
  authorizeTaskFileUploadRef,
  bindDeviceInstallationRef,
  claimOperatorTaskRef,
  listDevicesRef,
  listTaskExceptionsRef,
  listTaskFilesRef,
  listOperatorTasksRef,
  recordDeviceSeenRef,
  recordTaskEvidenceRef,
  requestTaskFileAccessRef,
  reportTaskExceptionRef,
  resolveTaskExceptionRef,
  registerDeviceRef,
} from "../../src/lib/convex/platformApi";

interface RegisteredShape {
  readonly isQuery?: boolean;
  readonly isMutation?: boolean;
  readonly isPublic?: boolean;
}

const MODULES: Readonly<Record<string, Record<string, unknown>>> = {
  "platform/devices": devices as unknown as Record<string, unknown>,
  "platform/exceptions": exceptions as unknown as Record<string, unknown>,
  "platform/tasks": tasks as unknown as Record<string, unknown>,
  "platform/stepUp": stepUp as unknown as Record<string, unknown>,
  "platform/taskFiles": taskFiles as unknown as Record<string, unknown>,
};

const exportedAt = (path: string): RegisteredShape => {
  const [modulePath, exportName] = path.split(":");
  const found = MODULES[modulePath ?? ""];
  expect(found, path).toBeDefined();
  const value = found![exportName ?? ""] as RegisteredShape | undefined;
  expect(value, path).toBeDefined();
  return value!;
};

describe("the platform client contract", () => {
  it("names a public function that exists for every declared path", () => {
    for (const path of Object.values(PLATFORM_FUNCTION_PATHS)) {
      const registered = exportedAt(path);
      expect(registered.isPublic, path).toBe(true);
      expect(
        registered.isQuery === true || registered.isMutation === true,
        path,
      ).toBe(true);
    }
  });

  it("resolves each reference to the path the client declared", () => {
    expect(getFunctionName(listDevicesRef)).toBe(
      PLATFORM_FUNCTION_PATHS.listDevices,
    );
    expect(getFunctionName(registerDeviceRef)).toBe(
      PLATFORM_FUNCTION_PATHS.registerDevice,
    );
    expect(getFunctionName(bindDeviceInstallationRef)).toBe(
      PLATFORM_FUNCTION_PATHS.bindDeviceInstallation,
    );
    expect(getFunctionName(recordDeviceSeenRef)).toBe(
      PLATFORM_FUNCTION_PATHS.recordDeviceSeen,
    );
    expect(getFunctionName(listOperatorTasksRef)).toBe(
      PLATFORM_FUNCTION_PATHS.listOperatorTasks,
    );
    expect(getFunctionName(claimOperatorTaskRef)).toBe(
      PLATFORM_FUNCTION_PATHS.claimOperatorTask,
    );
    expect(getFunctionName(recordTaskEvidenceRef)).toBe(
      PLATFORM_FUNCTION_PATHS.recordTaskEvidence,
    );
    expect(getFunctionName(listTaskExceptionsRef)).toBe(
      PLATFORM_FUNCTION_PATHS.listTaskExceptions,
    );
    expect(getFunctionName(reportTaskExceptionRef)).toBe(
      PLATFORM_FUNCTION_PATHS.reportTaskException,
    );
    expect(getFunctionName(resolveTaskExceptionRef)).toBe(
      PLATFORM_FUNCTION_PATHS.resolveTaskException,
    );
    expect(getFunctionName(listTaskFilesRef)).toBe(
      PLATFORM_FUNCTION_PATHS.listTaskFiles,
    );
    expect(getFunctionName(authorizeTaskFileUploadRef)).toBe(
      PLATFORM_FUNCTION_PATHS.authorizeTaskFileUpload,
    );
    expect(getFunctionName(attachTaskFileRef)).toBe(
      PLATFORM_FUNCTION_PATHS.attachTaskFile,
    );
    expect(getFunctionName(requestTaskFileAccessRef)).toBe(
      PLATFORM_FUNCTION_PATHS.requestTaskFileAccess,
    );
    expect(getFunctionName(approveOnDeviceRef)).toBe(
      PLATFORM_FUNCTION_PATHS.approveOnDevice,
    );
  });

  it("keeps the reads queries and the writes mutations", () => {
    expect(exportedAt(PLATFORM_FUNCTION_PATHS.listDevices).isQuery).toBe(true);
    expect(exportedAt(PLATFORM_FUNCTION_PATHS.listOperatorTasks).isQuery).toBe(
      true,
    );
    expect(
      exportedAt(PLATFORM_FUNCTION_PATHS.listOperatorTaskEvidence).isQuery,
    ).toBe(true);
    expect(exportedAt(PLATFORM_FUNCTION_PATHS.listTaskExceptions).isQuery).toBe(
      true,
    );
    for (const path of [
      PLATFORM_FUNCTION_PATHS.registerDevice,
      PLATFORM_FUNCTION_PATHS.bindDeviceInstallation,
      PLATFORM_FUNCTION_PATHS.retireDevice,
      PLATFORM_FUNCTION_PATHS.claimOperatorTask,
      PLATFORM_FUNCTION_PATHS.recordTaskEvidence,
      PLATFORM_FUNCTION_PATHS.reportTaskException,
      PLATFORM_FUNCTION_PATHS.resolveTaskException,
      PLATFORM_FUNCTION_PATHS.authorizeTaskFileUpload,
      PLATFORM_FUNCTION_PATHS.attachTaskFile,
      PLATFORM_FUNCTION_PATHS.requestTaskFileAccess,
      PLATFORM_FUNCTION_PATHS.approveOnDevice,
    ]) {
      expect(exportedAt(path).isMutation, path).toBe(true);
    }
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
