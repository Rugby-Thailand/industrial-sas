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
    const sentIds: string[] = [];
    const send = vi.fn(async (requestId: string) => {
      sentIds.push(requestId);
      if (sentIds.length === 1)
        throw new Error("Connection lost after server committed");
      return { ok: true, value: { written: true, documentId: "saved-event" } };
    });
    const hook = renderHook(() => useHrWrite("attendance-retry-contract"));
    await act(async () => {
      await hook.result.current.run(send);
    });
    expect(hook.result.current.state.kind).toBe("UNCERTAIN");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    await act(async () => {
      await hook.result.current.retry();
    });
    expect(sentIds).toHaveLength(2);
    expect(sentIds[1]).toBe(sentIds[0]);
    expect(hook.result.current.state.kind).toBe("SAVED");
  });

  it("rehydrates an exact command after a cold mount and requires retry before a fresh submission", async () => {
    const scope = "cold-command";
    sessionStorage.setItem(
      `hr-request:anonymous|${scope}`,
      JSON.stringify({
        version: 1,
        requestId: "cold_request_123",
        payload: { value: "original" },
      }),
    );
    const send = vi.fn(
      async (payload: { value: string }, requestId: string) => ({
        ok: true,
        value: { written: true, payload, requestId },
      }),
    );
    const hook = renderHook(() =>
      useHrWrite<Record<string, unknown>, { value: string }>(scope, {
        decode: (value) =>
          typeof value === "object" &&
          value !== null &&
          "value" in value &&
          typeof value.value === "string"
            ? (value as { value: string })
            : undefined,
        send,
      }),
    );
    expect(hook.result.current.state.kind).toBe("UNCERTAIN");
    expect(hook.result.current.locked).toBe(true);
    await act(async () => {
      await hook.result.current.submitCommand({ value: "new" });
    });
    expect(send).not.toHaveBeenCalled();
    await act(async () => {
      await hook.result.current.retry();
    });
    expect(send).toHaveBeenCalledWith(
      { value: "original" },
      "cold_request_123",
    );
    await act(async () => {
      await hook.result.current.submitCommand({ value: "new" });
    });
    expect(send.mock.calls[1]![0]).toEqual({ value: "new" });
    expect(send.mock.calls[1]![1]).not.toBe("cold_request_123");
  });

  it("a pending command keeps its live owner across remounts and ignores duplicate submissions", async () => {
    let finish!: (outcome: unknown) => void;
    const send = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = renderHook(() => useHrWrite("pending-remount"));
    let original!: Promise<unknown>;
    act(() => {
      original = first.result.current.submit(send);
    });
    first.unmount();
    const second = renderHook(() => useHrWrite("pending-remount"));
    expect(second.result.current.state.kind).toBe("PENDING");
    await act(async () => {
      await second.result.current.submit(send);
    });
    expect(send).toHaveBeenCalledOnce();
    await act(async () => {
      finish({ ok: true, value: { written: true } });
      await original;
    });
    expect(await original).toEqual({ kind: "IDLE" });
    expect(second.result.current.state.kind).toBe("SAVED");
  });

  it("an uncertain command survives a remount when browser storage is unavailable", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("Response lost"))
      .mockResolvedValue({ ok: true, value: { written: true } });
    const first = renderHook(() => useHrWrite("storage-remount"));
    await act(async () => {
      await first.result.current.submit(send);
    });
    const originalId = send.mock.calls[0]![0];
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    first.unmount();
    const second = renderHook(() => useHrWrite("storage-remount"));
    expect(second.result.current.locked).toBe(true);
    await act(async () => {
      await second.result.current.retry();
    });
    expect(send.mock.calls[1]![0]).toBe(originalId);
    expect(second.result.current.state.kind).toBe("SAVED");
  });

  it("legacy ID-only recovery remains locked until definitive reconciliation and never reports a new-form success", async () => {
    sessionStorage.setItem(
      "hr-request:anonymous|shortcut-preferences",
      JSON.stringify("legacy_request_123"),
    );
    const hook = renderHook(() => useHrWrite("shortcut-preferences"));
    const newCommand = vi.fn(async (_requestId: string) => ({
      ok: true,
      value: { written: true },
    }));
    await act(async () => {
      await hook.result.current.submit(newCommand);
    });
    expect(newCommand).not.toHaveBeenCalled();
    const recovery =
      hook.result.current.state.kind === "UNCERTAIN"
        ? hook.result.current.state.recovery
        : undefined;
    expect(recovery).toMatchObject({
      requestId: "legacy_request_123",
      operation: "hr.preferences.save",
    });
    await act(async () => {
      await recovery!.reconcile(async () => {
        throw new Error("Recovery response lost");
      });
    });
    expect(hook.result.current.locked).toBe(true);
    expect(
      sessionStorage.getItem("hr-request:anonymous|shortcut-preferences"),
    ).not.toBeNull();
    await act(async () => {
      await recovery!.reconcile(async () => ({
        ok: true,
        value: { resolved: true, status: "COMMITTED" },
      }));
    });
    expect(hook.result.current.state).toEqual({
      kind: "RECONCILED",
      applied: true,
    });
    expect(hook.result.current.locked).toBe(false);
    await act(async () => {
      await hook.result.current.submit(newCommand);
    });
    expect(newCommand).toHaveBeenCalledOnce();
    expect(newCommand.mock.calls[0]![0]).not.toBe("legacy_request_123");
  });

  it("refuses before sending when durable recovery cannot be saved and allows an explicit new attempt after storage returns", async () => {
    const unavailable = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("Storage unavailable");
      });
    const send = vi.fn(async (_requestId: string) => ({
      ok: true,
      value: { written: true },
    }));
    const hook = renderHook(() => useHrWrite("no-storage-new-command"));
    await act(async () => {
      await hook.result.current.submit(send);
    });
    expect(send).not.toHaveBeenCalled();
    expect(hook.result.current.state).toEqual({
      kind: "REFUSED",
      code: "REQUEST_RECOVERY_UNAVAILABLE",
    });
    expect(hook.result.current.locked).toBe(false);
    unavailable.mockRestore();
    await act(async () => {
      await hook.result.current.submit(send);
    });
    expect(send).toHaveBeenCalledOnce();
    expect(hook.result.current.state.kind).toBe("SAVED");
  });

  it("unreadable storage cannot overwrite an unknown persisted command even when writes work", async () => {
    const key = "hr-request:anonymous|employee:unreadable:1";
    sessionStorage.setItem(key, JSON.stringify("unreadable_old_request"));
    const read = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("Cannot read storage");
      });
    const send = vi.fn();
    const hook = renderHook(() => useHrWrite("employee:unreadable:1"));
    await act(async () => {
      await hook.result.current.submit(send);
    });
    expect(send).not.toHaveBeenCalled();
    read.mockRestore();
    expect(sessionStorage.getItem(key)).toBe(
      JSON.stringify("unreadable_old_request"),
    );
    await act(async () => {
      await hook.result.current.submit(send);
    });
    expect(hook.result.current.locked).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it("malformed recovery storage never manufactures an ID or sends a fresh command", async () => {
    sessionStorage.setItem(
      "hr-request:anonymous|employee:malformed:1",
      "{not json",
    );
    const send = vi.fn();
    const hook = renderHook(() => useHrWrite("employee:malformed:1"));
    expect(hook.result.current.locked).toBe(true);
    expect(hook.result.current.state).toMatchObject({
      kind: "UNCERTAIN",
      recoveryUnavailable: true,
    });
    await act(async () => {
      await hook.result.current.submit(send);
      await hook.result.current.retry();
    });
    expect(send).not.toHaveBeenCalled();
    expect(
      sessionStorage.getItem("hr-request:anonymous|employee:malformed:1"),
    ).toBe("{not json");
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

it("an opaque multi-action command restores its persisted registered operation without storing form evidence", async () => {
  sessionStorage.setItem(
    "hr-request:anonymous|announcement-editor:restored",
    JSON.stringify({
      version: 1,
      requestId: "announcement_publish_original",
      operation: "hr.announcements.publish",
    }),
  );
  const hook = renderHook(() => useHrWrite("announcement-editor:restored"));
  expect(hook.result.current.locked).toBe(true);
  const state = hook.result.current.state;
  expect(state.kind).toBe("UNCERTAIN");
  if (state.kind !== "UNCERTAIN") throw new Error("Expected recovery");
  expect(state.recovery).toMatchObject({
    operation: "hr.announcements.publish",
    requestId: "announcement_publish_original",
  });
  const fresh = vi.fn();
  await act(async () => {
    await hook.result.current.submit(fresh);
  });
  expect(fresh).not.toHaveBeenCalled();
  expect(
    JSON.parse(
      sessionStorage.getItem(
        "hr-request:anonymous|announcement-editor:restored",
      )!,
    ),
  ).not.toHaveProperty("payload");
});
