/**
 * The OpenRouter transport behind AI Search: one HTTP request with a hard
 * deadline, plus its durable usage accounting.
 *
 * The request body and the reading of the answer are pure and live in
 * `convex/model/search/provider.ts`; this adapter owns everything that is
 * not — `fetch`, the abort timer and the usage recorder's begin/finish.
 */
import {
  UNKNOWN_USAGE,
  type AiUsageRecorder,
  type UsageFinish,
} from "../model/aiUsage/usage";
import type { IntentContextFlags, ModelIntent } from "../model/search/intent";
import {
  readSearchIntentResponse,
  searchIntentRequestBody,
} from "../model/search/provider";
import { fail, type Result } from "../model/result";

export const OPENROUTER_CHAT_URL =
  "https://openrouter.ai/api/v1/chat/completions";
export const SEARCH_TIMEOUT_MS = 12_000;

export type ProviderFailure = "AI_UNAVAILABLE" | "AI_TIMEOUT" | "AI_UNREADABLE";

/**
 * Exactly one request with a hard deadline; no retry and no logging of text.
 *
 * The deadline starts once the usage recorder has acknowledged `begin`, and
 * `finish` is awaited on every path, so the attempt is always finalized.
 */
export async function requestSearchIntent(input: {
  readonly apiKey: string;
  readonly model: string;
  readonly query: string;
  readonly context: IntentContextFlags;
  readonly fetcher?: typeof fetch;
  readonly timeoutMs?: number;
  readonly usage?: AiUsageRecorder;
}): Promise<Result<ModelIntent, ProviderFailure>> {
  await input.usage?.begin("AI_SEARCH", input.model, 1);
  let usageResult: UsageFinish = {
    ...UNKNOWN_USAGE,
    status: "NETWORK_ERROR",
  };
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    input.timeoutMs ?? SEARCH_TIMEOUT_MS,
  );
  try {
    const response = await (input.fetcher ?? fetch)(OPENROUTER_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(searchIntentRequestBody(input)),
      signal: controller.signal,
    });
    usageResult = { ...usageResult, httpStatus: response.status };
    const text = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      usageResult = {
        ...usageResult,
        status: response.ok ? "UNREADABLE" : "PROVIDER_ERROR",
      };
      return fail(response.ok ? "AI_UNREADABLE" : "AI_UNAVAILABLE");
    }
    usageResult = {
      // The recorder's adapter decodes the provider's decimal cost.
      ...(input.usage?.responseUsage(body) ?? UNKNOWN_USAGE),
      httpStatus: response.status,
      status: response.ok ? "UNREADABLE" : "PROVIDER_ERROR",
    };
    if (!response.ok) return fail("AI_UNAVAILABLE");
    const answer = readSearchIntentResponse(body);
    usageResult = {
      ...usageResult,
      status: answer.ok ? "SUCCEEDED" : "UNREADABLE",
    };
    return answer;
  } catch (error) {
    const timedOut =
      controller.signal.aborted ||
      (error instanceof Error && error.name === "AbortError");
    usageResult = {
      ...usageResult,
      status: timedOut ? "TIMEOUT" : "NETWORK_ERROR",
    };
    return fail(timedOut ? "AI_TIMEOUT" : "AI_UNAVAILABLE");
  } finally {
    clearTimeout(timer);
    await input.usage?.finish(1, usageResult);
  }
}
