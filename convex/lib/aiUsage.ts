import { makeFunctionReference, type GenericActionCtx } from "convex/server";
import type { DataModel } from "../schema";
import type { Id } from "../_generated/dataModel";
import type {
  AiUsageRecorder,
  Feature,
  UsageFinish,
} from "../model/aiUsage/usage";
import { responseUsage } from "./providerUsage";

/**
 * Tenant-scoped AI usage recording for an authorized action. The scope comes
 * from the authorization preflight; handlers choose only the feature and
 * model. `begin` is durable before any provider request; `finish` retries
 * only the database write, never the billable request, and `finish` and
 * `abandon` each settle within {@link ACCOUNTING_WRITE_BUDGET_MS}.
 */
export type AiUsagePort = AiUsageRecorder;
type Scope = {
  orgId: Id<"organizations">;
  actorUserId: Id<"users">;
  warehouseId?: Id<"warehouses">;
  operationId: string;
};
const beginRef = makeFunctionReference<
  "mutation",
  Scope & { feature: Feature; requestedModel: string; attemptNo: number },
  Id<"aiUsageEvents">
>("aiUsage/internal:begin");
const finishRef = makeFunctionReference<
  "mutation",
  {
    orgId: Id<"organizations">;
    operationId: string;
    attemptNo: number;
    result: UsageFinish;
  },
  null
>("aiUsage/internal:finish");
const abandonRef = makeFunctionReference<
  "mutation",
  { orgId: Id<"organizations">; operationId: string; attemptNo: number },
  null
>("aiUsage/internal:abandon");

/** Database writes one finalization may make; never a provider request. */
export const FINALIZE_ATTEMPTS = 3;

/**
 * The finite accounting budget of one finish or abandon, retries and their
 * back-off included. It is separate from, and runs after, the provider
 * deadline: no inference starts in it. Each database wait is bounded by
 * what is left of it, so a mutation that never settles cannot hold the
 * action. A write that is still unconfirmed when the budget ends may commit
 * later (finish is idempotent); otherwise the pending row expires to
 * `INTERRUPTED` with unknown cost and the logged record allows recovery.
 */
export const ACCOUNTING_WRITE_BUDGET_MS = 5_000;

const TIMED_OUT = Symbol("timed-out");

/** A timer-driven budget; never extended by clock readings. */
function writeBudget(ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  /** `work`'s outcome, or TIMED_OUT once the budget ends. Never throws. */
  const within = <T>(
    work: () => Promise<T>,
  ): Promise<{ ok: true; value: T } | { ok: false } | typeof TIMED_OUT> => {
    if (controller.signal.aborted) return Promise.resolve(TIMED_OUT);
    return new Promise((resolve) => {
      const onAbort = () => resolve(TIMED_OUT);
      controller.signal.addEventListener("abort", onAbort, { once: true });
      let pending: Promise<T>;
      try {
        pending = work();
      } catch {
        pending = Promise.reject(new Error("AI_USAGE_WRITE_FAILED"));
      }
      pending.then(
        (value) => {
          controller.signal.removeEventListener("abort", onAbort);
          resolve({ ok: true, value });
        },
        () => {
          controller.signal.removeEventListener("abort", onAbort);
          resolve({ ok: false });
        },
      );
    });
  };
  return {
    within,
    get expired() {
      return controller.signal.aborted;
    },
    dispose: () => clearTimeout(timer),
  };
}

/**
 * The static operator record of an attempt whose finalization could not be
 * confirmed. Whitelisted billing metadata only: no image, prompt, query,
 * model output, provider body or credential. `providerGenerationId` is what
 * `aiUsage/recovery:attempt` needs to reconcile the paid response.
 * `writeOutcome` is `REJECTED` when every write failed, or `UNCONFIRMED`
 * when the accounting budget ended with a write still outstanding (it may
 * still commit; recovery then answers `CURRENT`).
 */
export function finalizeFailedRecord(
  scope: Pick<Scope, "orgId" | "operationId">,
  feature: Feature | undefined,
  attemptNo: number,
  result: UsageFinish,
  writeOutcome: "REJECTED" | "UNCONFIRMED" = "REJECTED",
) {
  return {
    event: "aiUsage.finalizeFailed",
    orgId: scope.orgId,
    operationId: scope.operationId,
    attemptNo,
    feature: feature ?? null,
    writeOutcome,
    status: result.status,
    httpStatus: result.httpStatus ?? null,
    billingStatus: result.billingStatus,
    usageSource: result.usageSource,
    providerGenerationId: result.providerGenerationId ?? null,
    actualModel: result.actualModel ?? null,
    costUsdNano: result.costUsdNano ?? null,
    inputUnitCount: result.inputUnitCount ?? null,
    outputUnitCount: result.outputUnitCount ?? null,
    totalUnitCount: result.totalUnitCount ?? null,
  };
}

export function createAiUsagePort(
  ctx: Pick<GenericActionCtx<DataModel>, "runMutation">,
  scope: Scope,
  budgetMs: number = ACCOUNTING_WRITE_BUDGET_MS,
): AiUsagePort {
  let feature: Feature | undefined;
  return Object.freeze({
    begin: async (
      chosen: Feature,
      requestedModel: string,
      attemptNo: number,
    ) => {
      feature = chosen;
      await ctx.runMutation(beginRef, {
        ...scope,
        feature: chosen,
        requestedModel,
        attemptNo,
      });
    },
    finish: async (attemptNo: number, result: UsageFinish) => {
      const budget = writeBudget(budgetMs);
      let writeOutcome: "REJECTED" | "UNCONFIRMED" = "REJECTED";
      try {
        for (let retry = 0; retry < FINALIZE_ATTEMPTS; retry++) {
          const written = await budget.within(() =>
            ctx.runMutation(finishRef, {
              orgId: scope.orgId,
              operationId: scope.operationId,
              attemptNo,
              result,
            }),
          );
          if (written === TIMED_OUT) {
            writeOutcome = "UNCONFIRMED";
            break;
          }
          if (written.ok) return;
          if (retry < FINALIZE_ATTEMPTS - 1) {
            const waited = await budget.within(
              () =>
                new Promise<void>((resolve) =>
                  setTimeout(resolve, 100 * (retry + 1)),
                ),
            );
            if (waited === TIMED_OUT) break;
          }
        }
      } finally {
        budget.dispose();
      }
      console.error(
        JSON.stringify(
          finalizeFailedRecord(scope, feature, attemptNo, result, writeOutcome),
        ),
      );
    },
    abandon: async (attemptNo: number) => {
      const budget = writeBudget(budgetMs);
      try {
        // Unwritten or unconfirmed, the pending row expires to INTERRUPTED;
        // no request was sent.
        await budget.within(() =>
          ctx.runMutation(abandonRef, {
            orgId: scope.orgId,
            operationId: scope.operationId,
            attemptNo,
          }),
        );
      } finally {
        budget.dispose();
      }
    },
    responseUsage,
  });
}
