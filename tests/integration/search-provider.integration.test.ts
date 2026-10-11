/**
 * The AI Search transport adapter (`convex/lib/searchProvider.ts`): exactly
 * one provider request with a hard deadline and the original failure codes.
 * The provider is a stubbed `fetch`; no network is used.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import * as searchProvider from "../../convex/lib/searchProvider";
import {
  OPENROUTER_CHAT_URL,
  SEARCH_TIMEOUT_MS,
  requestSearchIntent,
} from "../../convex/lib/searchProvider";
import * as pureProvider from "../../convex/model/search/provider";

const NO_CONTEXT = { page: null, employee: false, date: false, period: false };
const QUERY_SENTINEL = "SENTINEL-QUERY สมชาย EMP-SENTINEL-001";
const KEY_SENTINEL = "synthetic-sentinel-search-key";
const INTENT = {
  kind: "OPEN_PAGE",
  page: "hr.today",
  settingsSection: null,
  employeeCode: null,
  employeeName: null,
  dateText: null,
  employeeFocus: null,
  useContextEmployee: false,
  useContextDate: false,
  useContextPeriod: false,
  clarify: null,
  unsupportedTopic: null,
};
const completion = (content: unknown) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
  });

const request = (fetcher: unknown, extra: object = {}) =>
  requestSearchIntent({
    apiKey: KEY_SENTINEL,
    model: "test/search-model",
    query: QUERY_SENTINEL,
    context: NO_CONTEXT,
    fetcher: fetcher as typeof fetch,
    ...extra,
  });

afterEach(() => {
  vi.useRealTimers();
});

describe("AI Search transport adapter", () => {
  it("lives outside the pure model directory, which keeps only values", () => {
    expect(searchProvider.requestSearchIntent).toBeTypeOf("function");
    expect(Object.keys(searchProvider).sort()).toEqual([
      "OPENROUTER_CHAT_URL",
      "SEARCH_TIMEOUT_MS",
      "requestSearchIntent",
    ]);
    expect(SEARCH_TIMEOUT_MS).toBe(12_000);
    expect(OPENROUTER_CHAT_URL).toBe(
      "https://openrouter.ai/api/v1/chat/completions",
    );
    expect(Object.keys(pureProvider).sort()).toEqual([
      "SEARCH_INTENT_PROMPT",
      "SEARCH_MAX_COMPLETION_TOKENS",
      "readSearchIntentResponse",
      "searchIntentRequestBody",
    ]);
  });

  it("sends the pure request body once and returns the validated intent", async () => {
    const fetcher = vi.fn(async () => completion(JSON.stringify(INTENT)));
    const result = await request(fetcher);
    expect(result).toEqual({ ok: true, value: expect.anything() });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(OPENROUTER_CHAT_URL);
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("Authorization")).toBe(
      `Bearer ${KEY_SENTINEL}`,
    );
    expect(JSON.parse(init.body as string)).toEqual(
      pureProvider.searchIntentRequestBody({
        model: "test/search-model",
        query: QUERY_SENTINEL,
        context: NO_CONTEXT,
      }),
    );
  });

  it("aborts at the 12-second deadline and reports a timeout", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
        }),
    );
    let settled = false;
    const pending = request(fetcher).then((result) => {
      settled = true;
      return result;
    });

    await vi.advanceTimersByTimeAsync(SEARCH_TIMEOUT_MS - 1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(await pending).toEqual({ ok: false, error: "AI_TIMEOUT" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("honours a shorter injected deadline", async () => {
    const fetcher = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
        }),
    );
    expect(await request(fetcher, { timeoutMs: 20 })).toEqual({
      ok: false,
      error: "AI_TIMEOUT",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not retry provider errors and refuses non-JSON bodies", async () => {
    const failing = vi.fn(async () => new Response("busy", { status: 503 }));
    expect(await request(failing)).toEqual({
      ok: false,
      error: "AI_UNAVAILABLE",
    });
    expect(failing).toHaveBeenCalledTimes(1);

    const html = vi.fn(async () => new Response("<html>", { status: 200 }));
    expect(await request(html)).toEqual({ ok: false, error: "AI_UNREADABLE" });
    expect(html).toHaveBeenCalledTimes(1);
  });

  it("reports an unreadable answer and a network error with their original codes", async () => {
    const unreadable = vi.fn(async () => completion("not json"));
    expect(await request(unreadable)).toEqual({
      ok: false,
      error: "AI_UNREADABLE",
    });
    expect(unreadable).toHaveBeenCalledTimes(1);

    const network = vi.fn(async () => {
      throw new TypeError("network down");
    });
    expect(await request(network)).toEqual({
      ok: false,
      error: "AI_UNAVAILABLE",
    });
    expect(network).toHaveBeenCalledTimes(1);
  });
});
