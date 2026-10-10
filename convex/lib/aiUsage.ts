import { makeFunctionReference, type GenericActionCtx } from "convex/server";
import type { DataModel } from "../schema";
import type { Id } from "../_generated/dataModel";
import type {
  AiUsageRecorder,
  Feature,
  UsageFinish,
} from "../model/aiUsage/usage";

/**
 * Tenant-scoped AI usage recording for an authorized action. The scope comes
 * from the authorization preflight; handlers choose only the feature and
 * model. `begin` is durable before any provider request; `finish` retries
 * only the database write, never the billable request.
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

export const FINALIZE_ATTEMPTS = 3;

/**
 * The static operator record of an attempt whose finalization could not be
 * written. Whitelisted billing metadata only: no image, prompt, query, model
 * output, provider body or credential. `providerGenerationId` is what
 * `aiUsage/recovery:attempt` needs to reconcile the paid response.
 */
export function finalizeFailedRecord(
  scope: Pick<Scope, "orgId" | "operationId">,
  feature: Feature | undefined,
  attemptNo: number,
  result: UsageFinish,
) {
  return {
    event: "aiUsage.finalizeFailed",
    orgId: scope.orgId,
    operationId: scope.operationId,
    attemptNo,
    feature: feature ?? null,
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
      for (let retry = 0; retry < FINALIZE_ATTEMPTS; retry++) {
        try {
          await ctx.runMutation(finishRef, {
            orgId: scope.orgId,
            operationId: scope.operationId,
            attemptNo,
            result,
          });
          return;
        } catch {
          if (retry < FINALIZE_ATTEMPTS - 1)
            await new Promise((resolve) =>
              setTimeout(resolve, 100 * (retry + 1)),
            );
        }
      }
      console.error(
        JSON.stringify(finalizeFailedRecord(scope, feature, attemptNo, result)),
      );
    },
    abandon: async (attemptNo: number) => {
      try {
        await ctx.runMutation(abandonRef, {
          orgId: scope.orgId,
          operationId: scope.operationId,
          attemptNo,
        });
      } catch {
        // The pending row expires to INTERRUPTED; no request was sent.
      }
    },
  });
}
