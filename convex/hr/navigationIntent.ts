/**
 * AI Search for HR navigation: one model request that classifies a query
 * into an allowlisted intent, then deterministic grounding.
 *
 * The action never reads HR records and sends none to the provider: only the
 * query and page flags (see `convex/model/search/provider.ts`; transport in
 * `convex/lib/searchProvider.ts`). The client
 * resolves the grounded intent through the ordinary protected HR queries,
 * which apply the same site, reporting-line and self-review rules as the
 * pages. Search must keep working without this action, so every failure is
 * a typed answer, never a thrown error.
 */
import { v } from "convex/values";

import { HR_PERMISSION } from "../lib/permissions";
import { requestSearchIntent } from "../lib/searchProvider";
import { actionWithOrg } from "../lib/tenantFunctions";
import { timezoneOffsetMinutes, toLocal } from "../model/hr/calendar";
import {
  groundIntent,
  parseContextFlags,
  validQuery,
} from "../model/search/intent";

/** Per actor; persisted in `actionQuotas` by the authorization preflight. */
export const AI_SEARCH_RATE_LIMIT = Object.freeze({
  key: "hr.search.ai",
  limit: 20,
  windowMs: 10 * 60_000,
});

export const interpret = actionWithOrg({
  args: {
    query: v.string(),
    context: v.object({
      page: v.union(
        v.literal("hr.review"),
        v.literal("hr.employees"),
        v.literal("hr.period"),
        v.literal("hr.day"),
        v.null(),
      ),
      employee: v.boolean(),
      date: v.boolean(),
      period: v.boolean(),
    }),
  },
  returns: v.any(),
  permissionCode: HR_PERMISSION.selfAccess,
  target: { table: "hrEmployees" },
  rateLimit: AI_SEARCH_RATE_LIMIT,
  handler: async (ctx, args) => {
    if (!validQuery(args.query))
      return { ok: false as const, code: "QUERY_INVALID" };
    if (ctx.quota === undefined || !ctx.quota.allowed)
      return {
        ok: false as const,
        code: "RATE_LIMITED",
        retryAfterMs: ctx.quota?.retryAfterMs ?? AI_SEARCH_RATE_LIMIT.windowMs,
      };
    // Search uses its own model setting; the job-ticket OCR model is not
    // reused without an evaluation for Thai navigation.
    const apiKey = process.env.OPENROUTER_API_KEY?.trim();
    const model = process.env.OPENROUTER_SEARCH_MODEL?.trim();
    if (!apiKey || !model)
      return { ok: false as const, code: "AI_UNAVAILABLE" };

    const offset = timezoneOffsetMinutes(
      ctx.tenant.organization.settings.timezone,
    );
    const today = offset.ok ? toLocal(Date.now(), offset.value).date : null;
    const context = parseContextFlags(args.context);
    const answer = await requestSearchIntent({
      apiKey,
      model,
      query: args.query,
      context,
      usage: ctx.aiUsage,
    }).catch(() => ({ ok: false as const, error: "AI_UNAVAILABLE" as const }));
    if (!answer.ok) {
      // Status only: the query and provider text are never logged.
      console.warn("AI search unavailable", answer.error);
      return { ok: false as const, code: answer.error };
    }
    return {
      ok: true as const,
      today,
      intent: groundIntent(answer.value, {
        query: args.query,
        today,
        context,
      }),
    };
  },
});
