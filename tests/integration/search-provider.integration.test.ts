/**
 * The AI Search transport adapter (`convex/lib/searchProvider.ts`): exactly
 * one provider request, a deadline that starts after the usage `begin` is
 * acknowledged, the original failure codes, and a finalized usage attempt on
 * every path. The provider is a stubbed `fetch`; no network is used.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import * as searchProvider from "../../convex/lib/searchProvider";
import {
  OPENROUTER_CHAT_URL,
  SEARCH_TIMEOUT_MS,
  requestSearchIntent,
} from "../../convex/lib/searchProvider";
import {
  UNKNOWN_USAGE,
  type AiUsageRecorder,
} from "../../convex/model/aiUsage/usage";
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
const completion = (content: unknown, usage?: unknown) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
      ...(usage === undefined ? {} : { usage }),
    }),
    { status: 200 },
  );

function recorder(
  begin: AiUsageRecorder["begin"] = vi.fn(async () => undefined),
) {
  const events: string[] = [];
  const finish = vi.fn(async () => {
    events.push("finish");
  });
  const usage: AiUsageRecorder = {
    begin: vi.fn(async (...args: Parameters<AiUsageRecorder["begin"]>) => {
      events.push("begin");
      await begin(...args);
    }),
    finish,
    abandon: vi.fn(async () => undefined),
    responseUsage: vi.fn(() => UNKNOWN_USAGE),
  };
  return { usage, finish, events };
}

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
    const { usage, finish, events } = recorder();
    const result = await request(fetcher, { usage });
    expect(result).toEqual({ ok: true, value: expect.anything() });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(OPENROUTER_CHAT_URL);
    expect(JSON.parse(init.body as string)).toEqual(
      pureProvider.searchIntentRequestBody({
        model: "test/search-model",
        query: QUERY_SENTINEL,
        context: NO_CONTEXT,
      }),
    );
    expect(usage.begin).toHaveBeenCalledWith(
      "AI_SEARCH",
      "test/search-model",
      1,
    );
    expect(events).toEqual(["begin", "finish"]);
    expect(finish).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ status: "SUCCEEDED", httpStatus: 200 }),
    );
  });

  it("starts the 12-second deadline only after begin is acknowledged", async () => {
    vi.useFakeTimers();
    let acknowledge!: () => void;
    const acknowledged = new Promise<void>((resolve) => {
      acknowledge = resolve;
    });
    const fetcher = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
        }),
    );
    const { usage, finish } = recorder(() => acknowledged);
    let settled = false;
    const pending = request(fetcher, { usage }).then((result) => {
      settled = true;
      return result;
    });

    // A slow begin does not consume the provider's deadline.
    await vi.advanceTimersByTimeAsync(SEARCH_TIMEOUT_MS * 2);
    expect(fetcher).not.toHaveBeenCalled();
    expect(settled).toBe(false);

    acknowledge();
    await vi.advanceTimersByTimeAsync(SEARCH_TIMEOUT_MS - 1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(await pending).toEqual({ ok: false, error: "AI_TIMEOUT" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ status: "TIMEOUT" }),
    );
  });

  it("does not retry provider errors and refuses non-JSON bodies", async () => {
    const failing = vi.fn(async () => new Response("busy", { status: 503 }));
    const busy = recorder();
    expect(await request(failing, { usage: busy.usage })).toEqual({
      ok: false,
      error: "AI_UNAVAILABLE",
    });
    expect(failing).toHaveBeenCalledTimes(1);
    expect(busy.finish).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ status: "PROVIDER_ERROR", httpStatus: 503 }),
    );

    const html = vi.fn(async () => new Response("<html>", { status: 200 }));
    expect(await request(html)).toEqual({ ok: false, error: "AI_UNREADABLE" });
    expect(html).toHaveBeenCalledTimes(1);
  });

  it("reports an unreadable answer and a network error with their original codes", async () => {
    const unreadable = recorder();
    expect(
      await request(
        vi.fn(async () => completion("not json")),
        { usage: unreadable.usage },
      ),
    ).toEqual({ ok: false, error: "AI_UNREADABLE" });
    expect(unreadable.finish).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ status: "UNREADABLE" }),
    );

    const offline = recorder();
    const network = vi.fn(async () => {
      throw new TypeError("network down");
    });
    expect(await request(network, { usage: offline.usage })).toEqual({
      ok: false,
      error: "AI_UNAVAILABLE",
    });
    expect(network).toHaveBeenCalledTimes(1);
    expect(offline.finish).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ status: "NETWORK_ERROR" }),
    );
  });

  it("keeps the query and key out of the usage record", async () => {
    const { usage, finish } = recorder();
    await request(
      vi.fn(async () => completion(JSON.stringify(INTENT))),
      { usage },
    );
    const recorded = JSON.stringify([
      (usage.begin as ReturnType<typeof vi.fn>).mock.calls,
      finish.mock.calls,
    ]);
    expect(recorded).not.toContain(QUERY_SENTINEL);
    expect(recorded).not.toContain(KEY_SENTINEL);
  });
});
