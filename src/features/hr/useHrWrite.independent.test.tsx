import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useHrWrite } from "./useHrWrite";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe("HR write recovery contract", () => {
  it("retries a lost response with the same request ID when session storage is unavailable", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    const sentIds: string[] = [];
    const hook = renderHook(() => useHrWrite("attendance-retry-contract"));
    await act(async () => {
      await hook.result.current.run(async (requestId) => {
        sentIds.push(requestId);
        throw new Error("Connection lost after server committed");
      });
    });
    expect(hook.result.current.state.kind).toBe("UNCERTAIN");
    await act(async () => {
      await hook.result.current.run(async (requestId) => {
        sentIds.push(requestId);
        return {
          ok: true,
          value: { written: true, documentId: "saved-event" },
        };
      });
    });
    expect(sentIds).toHaveLength(2);
    expect(sentIds[1]).toBe(sentIds[0]);
    expect(hook.result.current.state.kind).toBe("SAVED");
  });

  it("does not display a previous intent's delayed success after switching records", async () => {
    const hook = renderHook(({ scope }) => useHrWrite(scope), {
      initialProps: { scope: "record-a" },
    });
    let finish: ((value: unknown) => void) | undefined;
    const response = new Promise<unknown>((resolve) => {
      finish = resolve;
    });
    let pending: Promise<unknown> | undefined;
    act(() => {
      pending = hook.result.current.run(() => response);
    });
    expect(hook.result.current.state.kind).toBe("PENDING");
    hook.rerender({ scope: "record-b" });
    await act(async () => {
      finish?.({ ok: true, value: { written: true, documentId: "record-a" } });
      await pending;
    });
    expect(hook.result.current.state.kind).toBe("IDLE");
  });
});
