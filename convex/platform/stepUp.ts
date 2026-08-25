import { v } from "convex/values";

import {
  checkIdempotency,
  fingerprintArguments,
  sha256Hex,
  writeIdempotencyRecord,
} from "../lib/idempotency";
import type { TenantOrgId } from "../lib/tenantDb";
import { refusal, writeErrorValidator } from "../lib/writeEnvelope";
import { mutationWithOrg } from "../lib/tenantFunctions";
import { stepUpDecision } from "../lib/validators";
import { decideStepUpGrant } from "../model/platform/stepUp";

import { IMPLAUSIBLE_QUANTITY_OPERATION, stepUpApprovalPolicy } from "./tasks";

interface TaskDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly warehouseId: string;
}

interface MembershipDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly status: string;
}

interface DeviceDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly status: string;
}

interface StepUpApprovalDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly decision: "APPROVED" | "REJECTED";
  readonly expiresAt: number;
}

export const STEP_UP_OPERATIONS = Object.freeze({
  approve: "work.stepUp.approve",
});

const approvalOutcomeValidator = v.union(
  v.object({
    written: v.literal(true),
    documentId: v.string(),
    replayed: v.boolean(),

    expiresAt: v.number(),
    decision: stepUpDecision,
  }),
  v.object({ written: v.literal(false), error: writeErrorValidator }),
);

export const approveOnDevice = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),

    operatorUserId: v.id("users"),

    operatorTaskId: v.id("operatorTasks"),

    installationId: v.string(),
    decision: stepUpDecision,
    reason: v.string(),
  },
  returns: approvalOutcomeValidator,
  permissionCode: "work.stepUp.approve",
  target: {
    table: "operatorTasks",
    id: ({ operatorTaskId }) => operatorTaskId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  installationId: ({ installationId }) => installationId,
  policy: stepUpApprovalPolicy,
  handler: async (ctx, args) => {
    const task = await ctx.tenantDb.get<TaskDocument>(
      "operatorTasks",
      args.operatorTaskId,
    );
    if (task === null || task.warehouseId !== args.warehouseId) {
      return refusal({ code: "NOT_FOUND", table: "operatorTasks" });
    }

    const membership = await ctx.tenantDb
      .byIndex<MembershipDocument & Record<string, never>>(
        "memberships",
        "by_orgId_userId",
        [{ field: "userId", value: args.operatorUserId }],
      )
      .first();
    if (membership === null || membership.status !== "ACTIVE") {
      return refusal({ code: "REFERENCE_NOT_FOUND", field: "operatorUserId" });
    }

    const device = await ctx.tenantDb
      .byIndex<DeviceDocument & Record<string, never>>(
        "devices",
        "by_orgId_installationId",
        [{ field: "installationId", value: args.installationId.trim() }],
      )
      .first();
    if (device === null || device.status !== "ACTIVE") {
      return refusal({ code: "REFERENCE_NOT_FOUND", field: "installationId" });
    }

    const grant = decideStepUpGrant({
      operation: IMPLAUSIBLE_QUANTITY_OPERATION,
      targetRef: args.operatorTaskId,
      operatorUserId: args.operatorUserId,
      approverUserId: ctx.tenant.actor._id,
      deviceId: device._id,
      decision: args.decision,
      reason: args.reason,
      now: Date.now(),
    });
    if (!grant.ok) {
      return refusal({ ...grant.error, table: "stepUpApprovals" });
    }

    const fingerprint = await fingerprintArguments({
      warehouseId: args.warehouseId,
      operatorUserId: grant.value.operatorUserId,
      operatorTaskId: args.operatorTaskId,
      deviceId: grant.value.deviceId,
      decision: grant.value.decision,
      reason: grant.value.reason,
    });
    if (!fingerprint.ok) {
      return refusal({ code: fingerprint.error.code, field: "requestId" });
    }
    const replay = await checkIdempotency({
      tenantDb: ctx.tenantDb,
      operation: STEP_UP_OPERATIONS.approve,
      requestId: args.requestId,
      requestHash: fingerprint.value,
    });
    if (!replay.ok) {
      return refusal({ code: replay.error.code, field: "requestId" });
    }
    if (replay.value.kind === "REPLAY") {
      const approvalId = replay.value.record.resultRef;
      if (approvalId === undefined) {
        return refusal({ code: "REPLAY_UNRESOLVABLE", field: "requestId" });
      }
      const approval = await ctx.tenantDb.get<StepUpApprovalDocument>(
        "stepUpApprovals",
        approvalId,
      );
      if (approval === null) {
        return refusal({ code: "REPLAY_UNRESOLVABLE", field: "requestId" });
      }
      return {
        written: true as const,
        documentId: approval._id,
        replayed: true,
        expiresAt: approval.expiresAt,
        decision: approval.decision,
      };
    }

    const approvalId = await ctx.tenantDb.insert("stepUpApprovals", {
      operation: grant.value.operation,
      targetRef: grant.value.targetRef,
      operatorUserId: grant.value.operatorUserId,
      approverUserId: grant.value.approverUserId,
      deviceId: grant.value.deviceId,
      decision: grant.value.decision,
      reason: grant.value.reason,
      grantedAt: grant.value.grantedAt,
      expiresAt: grant.value.expiresAt,
    });

    await writeIdempotencyRecord({
      tenantDb: ctx.tenantDb,
      operation: STEP_UP_OPERATIONS.approve,
      requestId: args.requestId,
      requestHash: fingerprint.value,
      resultRef: approvalId,
      resultHash: await sha256Hex(
        `${approvalId}:${grant.value.expiresAt}:${grant.value.decision}`,
      ),
      actorUserId: ctx.tenant.actor._id,
      deviceId: grant.value.deviceId,
      now: grant.value.grantedAt,
    });

    return {
      written: true as const,
      documentId: approvalId,
      replayed: false,
      expiresAt: grant.value.expiresAt,
      decision: grant.value.decision,
    };
  },
});
