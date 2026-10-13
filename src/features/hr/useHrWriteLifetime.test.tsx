import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearHrClockRecoveryExcept,
  useHrClockWrite,
  useHrWrite,
} from "./useHrWrite";

const access = vi.hoisted(() => ({ identityKey: "org-a:actor-a:employee-a" }));
vi.mock("@/components/providers/HrAccessProvider", () => ({
  useHrAccess: () => access,
}));

afterEach(() => {
  cleanup();
  clearHrClockRecoveryExcept();
  vi.restoreAllMocks();
  sessionStorage.clear();
  access.identityKey = "org-a:actor-a:employee-a";
});

describe("HR live command lifetime", () => {
  it("does not revive an already settled HR receipt after leaving and returning to its intent", async () => {
    const hook = renderHook(({ scope }) => useHrWrite(scope), {
      initialProps: { scope: "A" },
    });
    await act(async () => {
      await hook.result.current.submit(async () => ({
        ok: true,
        value: { written: true },
      }));
    });
    expect(hook.result.current.state.kind).toBe("SAVED");
    hook.rerender({ scope: "B" });
    hook.rerender({ scope: "A" });
    expect(hook.result.current.state.kind).toBe("IDLE");
  });

  it("an unmounted clock completion cannot clear a newer descriptor after signing in again", async () => {
    let finishOld!: (value: unknown) => void;
    const old = renderHook(() =>
      useHrClockWrite(
        "employee-a",
        "2026-10-12",
        () =>
          new Promise((resolve) => {
            finishOld = resolve;
          }),
      ),
    );
    let oldResult!: Promise<{ kind: string }>;
    act(() => {
      oldResult = old.result.current.submit("CLOCK_IN");
    });
    const oldId = JSON.parse(
      sessionStorage.getItem("hr-clock-command:v1")!,
    ).requestId;
    old.unmount();
    clearHrClockRecoveryExcept();
    let finishNew!: (value: unknown) => void;
    const next = renderHook(() =>
      useHrClockWrite(
        "employee-a",
        "2026-10-12",
        () =>
          new Promise((resolve) => {
            finishNew = resolve;
          }),
      ),
    );
    let nextResult!: Promise<{ kind: string }>;
    act(() => {
      nextResult = next.result.current.submit("CLOCK_IN");
    });
    const descriptor = sessionStorage.getItem("hr-clock-command:v1");
    expect(JSON.parse(descriptor!).requestId).not.toBe(oldId);
    await act(async () => {
      finishOld({ ok: true, value: { written: true } });
      expect((await oldResult).kind).toBe("IDLE");
    });
    expect(sessionStorage.getItem("hr-clock-command:v1")).toBe(descriptor);
    expect(next.result.current.pending).toBe(true);
    await act(async () => {
      finishNew(null);
      expect((await nextResult).kind).toBe("UNCERTAIN");
    });
    expect(sessionStorage.getItem("hr-clock-command:v1")).toBe(descriptor);
  });

  it("does not restore a delayed success after an intent changes A to B to A", async () => {
    let finish!: (value: unknown) => void;
    const hook = renderHook(({ scope }) => useHrWrite(scope), {
      initialProps: { scope: "A" },
    });
    let pending!: Promise<{ kind: string }>;
    act(() => {
      pending = hook.result.current.submit(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
    });
    hook.rerender({ scope: "B" });
    hook.rerender({ scope: "A" });
    await act(async () => {
      finish({
        ok: true,
        value: { written: true, documentId: "old-document" },
      });
      expect((await pending).kind).toBe("IDLE");
    });
    expect(hook.result.current.state.kind).toBe("IDLE");
  });

  it("does not restore a clock receipt after organization A to B to A", async () => {
    let finish!: (value: unknown) => void;
    const send = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const hook = renderHook(() =>
      useHrClockWrite("employee-a", "2026-10-12", send),
    );
    let pending!: Promise<{ kind: string }>;
    act(() => {
      pending = hook.result.current.submit("CLOCK_IN");
    });
    access.identityKey = "org-b:actor-a:employee-a";
    hook.rerender();
    access.identityKey = "org-a:actor-a:employee-a";
    hook.rerender();
    await act(async () => {
      finish({ ok: true, value: { written: true, kind: "CLOCK_IN" } });
      expect((await pending).kind).toBe("IDLE");
    });
    expect(hook.result.current.state.kind).toBe("IDLE");
    expect(hook.result.current.command).toBeNull();
    expect(sessionStorage.getItem("hr-clock-command:v1")).toBeNull();
  });

  it("blocks duplicates locally under StrictMode and permits another intent while pending", async () => {
    const hook = renderHook(({ scope }) => useHrWrite(scope), {
      initialProps: { scope: "A" },
      wrapper: StrictMode,
    });
    let finish!: (value: unknown) => void;
    let pending!: Promise<{ kind: string }>;
    act(() => {
      pending = hook.result.current.submit(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
    });
    const duplicate = vi.fn();
    await act(async () => {
      expect((await hook.result.current.submit(duplicate)).kind).toBe(
        "PENDING",
      );
    });
    expect(duplicate).not.toHaveBeenCalled();
    hook.rerender({ scope: "B" });
    await act(async () => {
      expect(
        (
          await hook.result.current.submit(async () => ({
            ok: true,
            value: { written: true },
          }))
        ).kind,
      ).toBe("SAVED");
      finish({ ok: true, value: { written: true } });
      expect((await pending).kind).toBe("IDLE");
    });
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

  it("a pending clock remount subscribes to the original promise without submitting a second command", async () => {
    let finish!: (value: unknown) => void;
    const send = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = renderHook(() =>
      useHrClockWrite("employee-a", "2026-10-13", send),
    );
    let pending!: Promise<{ kind: string }>;
    act(() => {
      pending = first.result.current.submit("CLOCK_IN");
    });
    const descriptor = sessionStorage.getItem("hr-clock-command:v1");
    first.unmount();
    const second = renderHook(() =>
      useHrClockWrite("employee-a", "2026-10-14", send),
    );
    expect(second.result.current.pending).toBe(true);
    expect(second.result.current.command?.expectedBusinessDate).toBe(
      "2026-10-13",
    );
    await act(async () => {
      expect((await second.result.current.submit("CLOCK_IN")).kind).toBe(
        "PENDING",
      );
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("hr-clock-command:v1")).toBe(descriptor);
    await act(async () => {
      finish({
        ok: true,
        value: { written: true, businessDate: "2026-10-13" },
      });
      expect((await pending).kind).toBe("IDLE");
    });
    expect(second.result.current.state.kind).toBe("SAVED");
    expect(sessionStorage.getItem("hr-clock-command:v1")).toBeNull();
  });

  it("a fresh clock requires readable durable storage before sending and can start after storage returns", async () => {
    const read = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("Blocked");
      });
    const write = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("Blocked");
      });
    const send = vi.fn(async () => ({ ok: true, value: { written: true } }));
    const hook = renderHook(() =>
      useHrClockWrite("employee-a", "2026-10-13", send),
    );
    await act(async () => {
      expect(await hook.result.current.submit("CLOCK_IN")).toEqual({
        kind: "REFUSED",
        code: "REQUEST_RECOVERY_UNAVAILABLE",
      });
    });
    expect(send).not.toHaveBeenCalled();
    expect(hook.result.current.command).toBeNull();
    read.mockRestore();
    write.mockRestore();
    await act(async () => {
      await hook.result.current.submit("CLOCK_IN");
    });
    expect(send).toHaveBeenCalledOnce();
    expect(hook.result.current.state.kind).toBe("SAVED");
  });

  it("a clock owner remains usable after StrictMode replays its subscription lifetime", async () => {
    const send = vi.fn(async () => ({ ok: true, value: { written: true } }));
    const hook = renderHook(
      () => useHrClockWrite("employee-a", "2026-10-13", send),
      { wrapper: StrictMode },
    );
    await act(async () => {
      await hook.result.current.submit("CLOCK_IN");
    });
    expect(send).toHaveBeenCalledOnce();
    expect(hook.result.current.state.kind).toBe("SAVED");
  });
});
