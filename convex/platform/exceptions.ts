/**
 * Shared task exceptions: operator observation, retained evidence, and a
 * maker-checker supervisor decision (`FF-P1-03`).
 */
import { v } from "convex/values";

import {
  checkIdempotency,
  fingerprintArguments,
  sha256Hex,
  writeIdempotencyRecord,
} from "../lib/idempotency";
import type { TenantOrgId } from "../lib/tenantDb";
import {
  mutationWithOrg,
  queryWithOrg,
  type TenantFunctionContext,
  type TenantPolicyContext,
} from "../lib/tenantFunctions";
import {
  operatorTaskExceptionDisposition,
  operatorTaskExceptionStatus,
} from "../lib/validators";
import { refusal, writeErrorValidator } from "../lib/writeEnvelope";
import { makeJobPageRequest } from "../model/inventory/jobPage";

export const WORK_EXCEPTION_OPERATIONS = Object.freeze({
  report: "work.exception.report",
  resolve: "work.exception.resolve",
});

interface TaskDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly warehouseId: string;
  readonly status: string;
  readonly claimedByUserId?: string;
  readonly leaseExpiresAt?: number;
}

interface ReasonDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly code: string;
  readonly name: string;
  readonly status: string;
}

interface ExceptionDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly warehouseId: string;
  readonly operatorTaskId: string;
  readonly reasonCodeId: string;
  readonly reasonCode: string;
  readonly reasonName: string;
  readonly summary: string;
  readonly evidence: string;
  readonly proposedDisposition: "RESUME" | "REASSIGN" | "STOP" | "ESCALATE";
  readonly proposedRecoveryAction: string;
  readonly status: "OPEN" | "RESOLVED" | "WITHDRAWN";
  readonly reportedByUserId: string;
  readonly reportedAt: number;
  readonly finalDisposition?: "RESUME" | "REASSIGN" | "STOP" | "ESCALATE";
  readonly recoveryAction?: string;
  readonly approverNote?: string;
  readonly resolvedByUserId?: string;
  readonly resolvedAt?: number;
}

const writeOutcomeValidator = v.union(
  v.object({
    written: v.literal(true),
    documentId: v.string(),
    replayed: v.boolean(),
  }),
  v.object({ written: v.literal(false), error: writeErrorValidator }),
);

const exceptionRowValidator = v.object({
  operatorTaskExceptionId: v.id("operatorTaskExceptions"),
  operatorTaskId: v.id("operatorTasks"),
  warehouseId: v.id("warehouses"),
  reasonCodeId: v.id("reasonCodes"),
  reasonCode: v.string(),
  reasonName: v.string(),
  summary: v.string(),
  evidence: v.string(),
  proposedDisposition: operatorTaskExceptionDisposition,
  proposedRecoveryAction: v.string(),
  status: operatorTaskExceptionStatus,
  reportedByUserId: v.id("users"),
  reportedAt: v.number(),
  finalDisposition: v.optional(operatorTaskExceptionDisposition),
  recoveryAction: v.optional(v.string()),
  approverNote: v.optional(v.string()),
  resolvedByUserId: v.optional(v.id("users")),
  resolvedAt: v.optional(v.number()),
});

const normalizeRequired = (
  value: string,
  field: string,
  maxLength: number,
):
  | { readonly ok: true; readonly value: string }
  | {
      readonly ok: false;
      readonly error: { readonly code: string; readonly field: string };
    } => {
  const normalized = value.trim().normalize("NFC");
  if (normalized.length === 0) {
    return { ok: false, error: { code: "REQUIRED", field } };
  }
  if (normalized.length > maxLength) {
    return { ok: false, error: { code: "TOO_LONG", field } };
  }
  return { ok: true, value: normalized };
};

async function loadTask(
  ctx: TenantFunctionContext,
  operatorTaskId: string,
  warehouseId: string,
): Promise<TaskDocument | null> {
  const task = await ctx.tenantDb.get<TaskDocument>(
    "operatorTasks",
    operatorTaskId,
  );
  return task === null || task.warehouseId !== warehouseId ? null : task;
}

/** One task's exception history, including resolved decisions. */
export const listTaskExceptions = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    operatorTaskId: v.id("operatorTasks"),
    maxPageSize: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      items: v.array(exceptionRowValidator),
      nextCursor: v.union(v.string(), v.null()),
      complete: v.boolean(),
    }),
    v.object({ ok: v.literal(false), error: v.object({ code: v.string() }) }),
  ),
  permissionCode: "work.task.read",
  target: {
    table: "operatorTasks",
    id: ({ operatorTaskId }) => operatorTaskId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    if ((await loadTask(ctx, args.operatorTaskId, args.warehouseId)) === null) {
      return { ok: false as const, error: { code: "NOT_FOUND" } };
    }
    const request = makeJobPageRequest({
      ...(args.maxPageSize === undefined
        ? {}
        : { maxPageSize: args.maxPageSize }),
      ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
    });
    if (!request.ok) {
      return { ok: false as const, error: { code: request.error.code } };
    }
    const page = await ctx.tenantDb
      .byIndex<ExceptionDocument>(
        "operatorTaskExceptions",
        "by_orgId_operatorTaskId_reportedAt",
        [{ field: "operatorTaskId", value: args.operatorTaskId }],
      )
      .page({
        limit: request.value.maxPageSize,
        ...(request.value.cursor === null
          ? {}
          : { cursor: request.value.cursor }),
      });
    return {
      ok: true as const,
      items: page.page.map((row) => ({
        operatorTaskExceptionId: row._id as never,
        operatorTaskId: row.operatorTaskId as never,
        warehouseId: row.warehouseId as never,
        reasonCodeId: row.reasonCodeId as never,
        reasonCode: row.reasonCode,
        reasonName: row.reasonName,
        summary: row.summary,
        evidence: row.evidence,
        proposedDisposition: row.proposedDisposition,
        proposedRecoveryAction: row.proposedRecoveryAction,
        status: row.status,
        reportedByUserId: row.reportedByUserId as never,
        reportedAt: row.reportedAt,
        ...(row.finalDisposition === undefined
          ? {}
          : { finalDisposition: row.finalDisposition }),
        ...(row.recoveryAction === undefined
          ? {}
          : { recoveryAction: row.recoveryAction }),
        ...(row.approverNote === undefined
          ? {}
          : { approverNote: row.approverNote }),
        ...(row.resolvedByUserId === undefined
          ? {}
          : { resolvedByUserId: row.resolvedByUserId as never }),
        ...(row.resolvedAt === undefined ? {} : { resolvedAt: row.resolvedAt }),
      })),
      nextCursor: page.isDone ? null : page.continueCursor,
      complete: page.isDone,
    };
  },
});

/** Report a problem while the actor still owns the live task lease. */
export const reportTaskException = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    operatorTaskId: v.id("operatorTasks"),
    reasonCodeId: v.id("reasonCodes"),
    summary: v.string(),
    evidence: v.string(),
    proposedDisposition: operatorTaskExceptionDisposition,
    proposedRecoveryAction: v.string(),
  },
  returns: writeOutcomeValidator,
  permissionCode: "work.exception.report",
  target: {
    table: "operatorTasks",
    id: ({ operatorTaskId }) => operatorTaskId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const summary = normalizeRequired(args.summary, "summary", 500);
    if (!summary.ok) return refusal(summary.error);
    const evidence = normalizeRequired(args.evidence, "evidence", 2_000);
    if (!evidence.ok) return refusal(evidence.error);
    const recovery = normalizeRequired(
      args.proposedRecoveryAction,
      "proposedRecoveryAction",
      1_000,
    );
    if (!recovery.ok) return refusal(recovery.error);

    const fingerprint = await fingerprintArguments({
      operatorTaskId: args.operatorTaskId,
      reasonCodeId: args.reasonCodeId,
      summary: summary.value,
      evidence: evidence.value,
      proposedDisposition: args.proposedDisposition,
      proposedRecoveryAction: recovery.value,
    });
    if (!fingerprint.ok) return refusal({ code: fingerprint.error.code });
    const replay = await checkIdempotency({
      tenantDb: ctx.tenantDb,
      operation: WORK_EXCEPTION_OPERATIONS.report,
      requestId: args.requestId,
      requestHash: fingerprint.value,
    });
    if (!replay.ok) return refusal({ code: replay.error.code });
    if (replay.value.kind === "REPLAY") {
      const original = replay.value.record.resultRef;
      const row =
        original === undefined
          ? null
          : await ctx.tenantDb.get<ExceptionDocument>(
              "operatorTaskExceptions",
              original,
            );
      if (
        row === null ||
        row.operatorTaskId !== args.operatorTaskId ||
        row.reportedByUserId !== ctx.tenant.actor._id
      ) {
        return refusal({ code: "REPLAY_UNRESOLVABLE" });
      }
      return { written: true as const, documentId: original!, replayed: true };
    }

    const task = await loadTask(ctx, args.operatorTaskId, args.warehouseId);
    if (task === null) return refusal({ code: "NOT_FOUND" });
    const now = Date.now();
    if (task.status !== "CLAIMED") {
      return refusal({ code: "TASK_NOT_CLAIMED" });
    }
    if (task.claimedByUserId !== ctx.tenant.actor._id) {
      return refusal({ code: "TASK_NOT_HELD_BY_ACTOR" });
    }
    if (task.leaseExpiresAt === undefined || task.leaseExpiresAt <= now) {
      return refusal({ code: "TASK_LEASE_EXPIRED" });
    }
    const reason = await ctx.tenantDb.get<ReasonDocument>(
      "reasonCodes",
      args.reasonCodeId,
    );
    if (reason === null || reason.status !== "ACTIVE") {
      return refusal({ code: "REFERENCE_NOT_FOUND", field: "reasonCodeId" });
    }

    const exceptionId = await ctx.tenantDb.insert("operatorTaskExceptions", {
      warehouseId: args.warehouseId,
      operatorTaskId: args.operatorTaskId,
      reasonCodeId: args.reasonCodeId,
      reasonCode: reason.code,
      reasonName: reason.name,
      summary: summary.value,
      evidence: evidence.value,
      proposedDisposition: args.proposedDisposition,
      proposedRecoveryAction: recovery.value,
      status: "OPEN",
      reportedByUserId: ctx.tenant.actor._id,
      reportedAt: now,
    });
    await writeIdempotencyRecord({
      tenantDb: ctx.tenantDb,
      operation: WORK_EXCEPTION_OPERATIONS.report,
      requestId: args.requestId,
      requestHash: fingerprint.value,
      resultRef: exceptionId,
      resultHash: await sha256Hex(exceptionId),
      actorUserId: ctx.tenant.actor._id,
      now,
    });
    return { written: true as const, documentId: exceptionId, replayed: false };
  },
});

async function resolutionPolicy(
  ctx: TenantPolicyContext,
  args: { readonly operatorTaskExceptionId: string },
): Promise<{
  readonly thresholdExceeded: boolean;
  readonly approvalSatisfied: boolean;
  readonly makerUserId?: string;
}> {
  const row = await ctx.tenantDb.get<ExceptionDocument>(
    "operatorTaskExceptions",
    args.operatorTaskExceptionId,
  );
  return row === null
    ? { thresholdExceeded: false, approvalSatisfied: false }
    : {
        thresholdExceeded: false,
        approvalSatisfied: true,
        makerUserId: row.reportedByUserId,
      };
}

/** Resolve an exception as a different actor, preserving proposal and decision. */
export const resolveTaskException = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    operatorTaskExceptionId: v.id("operatorTaskExceptions"),
    finalDisposition: operatorTaskExceptionDisposition,
    recoveryAction: v.string(),
    approverNote: v.optional(v.string()),
  },
  returns: writeOutcomeValidator,
  permissionCode: "work.exception.resolve",
  target: {
    table: "operatorTaskExceptions",
    id: ({ operatorTaskExceptionId }) => operatorTaskExceptionId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  policy: resolutionPolicy,
  handler: async (ctx, args) => {
    const recovery = normalizeRequired(
      args.recoveryAction,
      "recoveryAction",
      1_000,
    );
    if (!recovery.ok) return refusal(recovery.error);
    const approverNote =
      args.approverNote === undefined
        ? undefined
        : normalizeRequired(args.approverNote, "approverNote", 1_000);
    if (approverNote !== undefined && !approverNote.ok) {
      return refusal(approverNote.error);
    }
    const fingerprint = await fingerprintArguments({
      operatorTaskExceptionId: args.operatorTaskExceptionId,
      finalDisposition: args.finalDisposition,
      recoveryAction: recovery.value,
      approverNote: approverNote?.value ?? null,
    });
    if (!fingerprint.ok) return refusal({ code: fingerprint.error.code });
    const replay = await checkIdempotency({
      tenantDb: ctx.tenantDb,
      operation: WORK_EXCEPTION_OPERATIONS.resolve,
      requestId: args.requestId,
      requestHash: fingerprint.value,
    });
    if (!replay.ok) return refusal({ code: replay.error.code });
    if (replay.value.kind === "REPLAY") {
      const row = await ctx.tenantDb.get<ExceptionDocument>(
        "operatorTaskExceptions",
        args.operatorTaskExceptionId,
      );
      if (
        row === null ||
        row.status !== "RESOLVED" ||
        row.resolvedByUserId !== ctx.tenant.actor._id
      ) {
        return refusal({ code: "REPLAY_UNRESOLVABLE" });
      }
      return {
        written: true as const,
        documentId: args.operatorTaskExceptionId,
        replayed: true,
      };
    }
    const row = await ctx.tenantDb.get<ExceptionDocument>(
      "operatorTaskExceptions",
      args.operatorTaskExceptionId,
    );
    if (row === null || row.warehouseId !== args.warehouseId) {
      return refusal({ code: "NOT_FOUND" });
    }
    if (row.status !== "OPEN") {
      return refusal({ code: "EXCEPTION_NOT_OPEN" });
    }
    const now = Date.now();
    await ctx.tenantDb.patch(
      "operatorTaskExceptions",
      args.operatorTaskExceptionId,
      {
        status: "RESOLVED",
        finalDisposition: args.finalDisposition,
        recoveryAction: recovery.value,
        ...(approverNote === undefined
          ? {}
          : { approverNote: approverNote.value }),
        resolvedByUserId: ctx.tenant.actor._id,
        resolvedAt: now,
      },
    );
    await writeIdempotencyRecord({
      tenantDb: ctx.tenantDb,
      operation: WORK_EXCEPTION_OPERATIONS.resolve,
      requestId: args.requestId,
      requestHash: fingerprint.value,
      resultRef: args.operatorTaskExceptionId,
      resultHash: await sha256Hex(
        `${args.operatorTaskExceptionId}:${args.finalDisposition}`,
      ),
      actorUserId: ctx.tenant.actor._id,
      now,
    });
    return {
      written: true as const,
      documentId: args.operatorTaskExceptionId,
      replayed: false,
    };
  },
});
