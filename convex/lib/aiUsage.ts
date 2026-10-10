import { makeFunctionReference, type GenericActionCtx } from "convex/server";
import type { DataModel } from "../schema";
import type { Id } from "../_generated/dataModel";
import type { Feature, UsageFinish } from "../model/aiUsage/usage";

export interface AiUsagePort {
  begin(feature: Feature, model: string, attemptNo: number): Promise<void>;
  finish(attemptNo: number, result: UsageFinish): Promise<void>;
}
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
export function createAiUsagePort(
  ctx: GenericActionCtx<DataModel>,
  scope: Scope,
): AiUsagePort {
  return Object.freeze({
    begin: async (
      feature: Feature,
      requestedModel: string,
      attemptNo: number,
    ) => {
      await ctx.runMutation(beginRef, {
        ...scope,
        feature,
        requestedModel,
        attemptNo,
      });
    },
    finish: async (attemptNo: number, result: UsageFinish) => {
      for (let retry = 0; retry < 3; retry++) {
        try {
          await ctx.runMutation(finishRef, {
            orgId: scope.orgId,
            operationId: scope.operationId,
            attemptNo,
            result,
          });
          return;
        } catch {
          if (retry < 2)
            await new Promise((resolve) =>
              setTimeout(resolve, 100 * (retry + 1)),
            );
        }
      }
      console.error(
        JSON.stringify({
          event: "aiUsage.finalizeFailed",
          operationId: scope.operationId,
          attemptNo,
          status: result.status,
          billingStatus: result.billingStatus,
          costUsdNano: result.costUsdNano ?? null,
        }),
      );
    },
  });
}
