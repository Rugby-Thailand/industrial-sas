/**
 * The OpenRouter transport behind AI Search: one HTTP request with a hard
 * deadline.
 *
 * The request body and the reading of the answer are pure and live in
 * `convex/model/search/provider.ts`; this adapter owns everything that is
 * not — `fetch` and the abort timer.
 */
import { fail, type Result } from "../model/result";
import type { IntentContextFlags, ModelIntent } from "../model/search/intent";
import {
  readSearchIntentResponse,
  searchIntentRequestBody,
} from "../model/search/provider";

export const OPENROUTER_CHAT_URL =
  "https://openrouter.ai/api/v1/chat/completions";
export const SEARCH_TIMEOUT_MS = 12_000;

export type ProviderFailure = "AI_UNAVAILABLE" | "AI_TIMEOUT" | "AI_UNREADABLE";

/** Exactly one request with a hard deadline; no retry and no logging of text. */
export async function requestSearchIntent(input: {
  readonly apiKey: string;
  readonly model: string;
  readonly query: string;
  readonly context: IntentContextFlags;
  readonly fetcher?: typeof fetch;
  readonly timeoutMs?: number;
}): Promise<Result<ModelIntent, ProviderFailure>> {
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
    if (!response.ok) return fail("AI_UNAVAILABLE");
    const text = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return fail("AI_UNREADABLE");
    }
    return readSearchIntentResponse(body);
  } catch (error) {
    return fail(
      controller.signal.aborted ||
        (error instanceof Error && error.name === "AbortError")
        ? "AI_TIMEOUT"
        : "AI_UNAVAILABLE",
    );
  } finally {
    clearTimeout(timer);
  }
}
