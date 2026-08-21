/**
 * Supervisor step-up, granted on the operator's own device (`FF-P1-11`, plan §4
 * invariant 19).
 *
 * The rules are `convex/model/platform/stepUp.ts`; the consumption is
 * `convex/platform/tasks.ts`. What happens here is the mint, and the two things
 * that make it safe are both enforced by machinery this repository already
 * owns rather than by anything invented for this module:
 *
 * - **Freshness.** `work.stepUp.approve` carries `STEP_UP`, so the existing
 *   evaluator refuses unless Clerk reverified *the approver* inside the
 *   step-up window (`INV-0006-07`). The supervisor proves who they are on the
 *   handheld in their hand; the operator's session is untouched.
 * - **No self-approval.** The same permission carries `MAKER_CHECKER`, and the
 *   policy hands the *operator* to the evaluator as the maker, so an approver
 *   who is the operator is denied with the ordinary `APPROVAL_REQUIRED` reason
 *   and the ordinary audit row. The domain's `APPROVER_IS_OPERATOR` refusal is
 *   a second, independent check rather than the only one.
 *
 * What this mutation does **not** do is give the browser anything reusable. It
 * returns a document ID whose every property is checked again at consumption:
 * operation, target, operator, device, expiry, and single use. Possession of it
 * cannot be spent on a second entry, on another task, on another device, or by
 * another person — which is the difference between an approval and an
 * elevation.
 */
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
    /** When the approval dies, so the screen can show a countdown, not a promise. */
    expiresAt: v.number(),
    decision: stepUpDecision,
  }),
  v.object({ written: v.literal(false), error: writeErrorValidator }),
);

/**
 * Approve — or refuse — one blocked action, on the operator's device.
 *
 * The device is resolved from the installation ID the operator's browser
 * reports, through this organization's own index. A client-supplied device
 * document ID is never accepted: the point of binding the approval to a device
 * is that it cannot be spent on a different one, and a caller who could name
 * any device could name the one they were about to move to.
 */
export const approveOnDevice = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    /** The operator who will spend it. Never the approver. */
    operatorUserId: v.id("users"),
    /** The task the approval is about. */
    operatorTaskId: v.id("operatorTasks"),
    /** The operator device this is being decided on. */
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

    /*
     * The operator must be a member of this tenant. `users` is global, so a
     * plausible ID from another tenant would otherwise resolve to a person this
     * supervisor has no standing to approve for.
     */
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

    /*
     * A transport retry must resolve to the approval already minted. Without
     * this record, one supervisor tap could become several independently
     * spendable approvals when the acknowledgement is lost, defeating the
     * single-use guarantee even though each individual row is consumed once.
     */
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
