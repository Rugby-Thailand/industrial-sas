import { describe, expect, it } from "vitest";

import {
  STEP_UP_APPROVAL_TTL_MS,
  decideStepUpConsumption,
  decideStepUpGrant,
  normalizeStepUpReason,
  type StoredStepUpApproval,
} from "./stepUp";

const NOW = 1_700_000_000_000;

const grantInput = {
  operation: "work.evidence.implausibleQuantity",
  targetRef: "task_1",
  operatorUserId: "user_operator",
  approverUserId: "user_supervisor",
  deviceId: "device_1",
  decision: "APPROVED" as const,
  reason: "counted twice with me watching",
  now: NOW,
};

const stored: StoredStepUpApproval = {
  approvalId: "approval_1",
  operation: "work.evidence.implausibleQuantity",
  targetRef: "task_1",
  operatorUserId: "user_operator",
  approverUserId: "user_supervisor",
  deviceId: "device_1",
  decision: "APPROVED",
  expiresAt: NOW + STEP_UP_APPROVAL_TTL_MS,
};

describe("granting", () => {
  it("mints an approval bound to operation, target, operator, and device", () => {
    const grant = decideStepUpGrant(grantInput);
    expect(grant.ok && grant.value).toEqual({
      operation: "work.evidence.implausibleQuantity",
      targetRef: "task_1",
      operatorUserId: "user_operator",
      approverUserId: "user_supervisor",
      deviceId: "device_1",
      decision: "APPROVED",
      reason: "counted twice with me watching",
      grantedAt: NOW,
      expiresAt: NOW + STEP_UP_APPROVAL_TTL_MS,
    });
  });

  it("refuses an approver approving their own work", () => {
    const grant = decideStepUpGrant({
      ...grantInput,
      approverUserId: "user_operator",
    });
    expect(!grant.ok && grant.error.code).toBe("APPROVER_IS_OPERATOR");
  });

  it("refuses an operation outside the approvable set", () => {
    const grant = decideStepUpGrant({
      ...grantInput,
      operation: "inventory.transaction.reverse",
    });
    expect(!grant.ok && grant.error.code).toBe("OPERATION_NOT_APPROVABLE");
  });

  it("requires a device, so a decision can be placed", () => {
    const grant = decideStepUpGrant({ ...grantInput, deviceId: "" });
    expect(!grant.ok && grant.error.code).toBe("DEVICE_REQUIRED");
  });

  it("requires a target", () => {
    const grant = decideStepUpGrant({ ...grantInput, targetRef: "" });
    expect(!grant.ok && grant.error.code).toBe("TARGET_REQUIRED");
  });

  it("requires a reason and bounds it", () => {
    expect(decideStepUpGrant({ ...grantInput, reason: " " }).ok).toBe(false);
    expect(normalizeStepUpReason("x".repeat(241)).ok).toBe(false);
  });

  it("records a rejection as evidence rather than discarding it", () => {
    const grant = decideStepUpGrant({ ...grantInput, decision: "REJECTED" });
    expect(grant.ok && grant.value.decision).toBe("REJECTED");
  });
});

describe("consuming", () => {
  const attempt = {
    operation: "work.evidence.implausibleQuantity",
    targetRef: "task_1",
    operatorUserId: "user_operator",
    deviceId: "device_1",
    now: NOW,
  };

  it("spends a matching approval once", () => {
    const use = decideStepUpConsumption({ approval: stored, ...attempt });
    expect(use.ok && use.value).toEqual({
      approvalId: "approval_1",
      approverUserId: "user_supervisor",
      consumedAt: NOW,
    });
  });

  it("refuses a missing approval", () => {
    const use = decideStepUpConsumption({ approval: null, ...attempt });
    expect(!use.ok && use.error.code).toBe("APPROVAL_NOT_FOUND");
  });

  it("refuses an approval minted for another task", () => {
    const use = decideStepUpConsumption({
      approval: { ...stored, targetRef: "task_2" },
      ...attempt,
    });
    expect(!use.ok && use.error.code).toBe("APPROVAL_TARGET_MISMATCH");
  });

  it("refuses an approval another operator was given", () => {
    const use = decideStepUpConsumption({
      approval: { ...stored, operatorUserId: "user_other" },
      ...attempt,
    });
    expect(!use.ok && use.error.code).toBe("APPROVAL_OPERATOR_MISMATCH");
  });

  it("refuses an approval minted on another device", () => {
    const use = decideStepUpConsumption({
      approval: { ...stored, deviceId: "device_2" },
      ...attempt,
    });
    expect(!use.ok && use.error.code).toBe("APPROVAL_DEVICE_MISMATCH");
  });

  it("refuses an approval for a different operation", () => {
    const use = decideStepUpConsumption({
      approval: { ...stored, operation: "work.task.reassign" },
      ...attempt,
    });
    expect(!use.ok && use.error.code).toBe("APPROVAL_OPERATION_MISMATCH");
  });

  it("refuses a rejected decision", () => {
    const use = decideStepUpConsumption({
      approval: { ...stored, decision: "REJECTED" },
      ...attempt,
    });
    expect(!use.ok && use.error.code).toBe("APPROVAL_REJECTED");
  });

  it("refuses an expired approval", () => {
    const use = decideStepUpConsumption({
      approval: { ...stored, expiresAt: NOW },
      ...attempt,
    });
    expect(!use.ok && use.error.code).toBe("APPROVAL_EXPIRED");
  });

  it("refuses a second use, so possession is never a reusable scope", () => {
    const use = decideStepUpConsumption({
      approval: { ...stored, consumedAt: NOW - 1 },
      ...attempt,
    });
    expect(!use.ok && use.error.code).toBe("APPROVAL_ALREADY_CONSUMED");
  });
});
