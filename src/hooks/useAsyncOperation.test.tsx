import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import { useAsyncOperation } from "./useAsyncOperation";

describe("useAsyncOperation", () => {
  it("still updates busy state under StrictMode effect replay", async () => {
    const hook = renderHook(() => useAsyncOperation((code) => code), {
      wrapper: StrictMode,
    });
    let resolve!: () => void;
    const pending = new Promise<void>((done) => {
      resolve = done;
    });
    let run!: Promise<void | null>;
    act(() => {
      run = hook.result.current.run(() => pending);
    });
    expect(hook.result.current.busy).toBe(true);
    await act(async () => {
      resolve();
      await run;
    });
    expect(hook.result.current.busy).toBe(false);
  });

  it("does not let an earlier scope completion overwrite the current scope", async () => {
    let settleA!: (value: string) => void;
    const a = new Promise<string>((resolve) => {
      settleA = resolve;
    });
    const hook = renderHook(
      ({ scope }) =>
        useAsyncOperation({ scope, describeError: (code) => code }),
      { initialProps: { scope: "A" } },
    );
    act(() => {
      void hook.result.current.run(() => a);
    });
    hook.rerender({ scope: "B" });
    let settleB!: (value: string) => void;
    const b = new Promise<string>((resolve) => {
      settleB = resolve;
    });
    act(() => {
      void hook.result.current.run(() => b);
    });
    expect(hook.result.current.busy).toBe(true);
    const duplicate = vi.fn(async () => "duplicate");
    await act(async () => {
      expect(await hook.result.current.run(duplicate)).toBeNull();
    });
    expect(duplicate).not.toHaveBeenCalled();
    await act(async () => {
      settleA("old");
      await Promise.resolve();
    });
    expect(hook.result.current.busy).toBe(true);
    await act(async () => {
      settleB("current");
      await Promise.resolve();
    });
    expect(hook.result.current.busy).toBe(false);
    expect(hook.result.current.error).toBe("");
  });

  it("blocks duplicate actions only within the same workflow", async () => {
    let resolve!: (value: number) => void;
    const deferred = new Promise<number>((done) => {
      resolve = done;
    });
    const first = renderHook(() => useAsyncOperation((code) => code));
    const second = renderHook(() => useAsyncOperation((code) => code));
    let result!: Promise<number | null>;
    act(() => {
      result = first.result.current.run(() => deferred);
    });
    const duplicate = vi.fn(async () => 2);
    await act(async () => {
      expect(await first.result.current.run(duplicate)).toBeNull();
      expect(await second.result.current.run(async () => 3)).toBe(3);
    });
    expect(duplicate).not.toHaveBeenCalled();
    await act(async () => {
      resolve(1);
      expect(await result).toBe(1);
    });
    expect(first.result.current.busy).toBe(false);
  });
  it("retains structured error codes, translates them, and clears them on explicit retry", async () => {
    const hook = renderHook(() =>
      useAsyncOperation((code) => `Message: ${code}`),
    );
    await act(async () => {
      await hook.result.current.run(async () => {
        throw { data: { code: "VERSION_CONFLICT" } };
      });
    });
    expect(hook.result.current.errorCode).toBe("VERSION_CONFLICT");
    expect(hook.result.current.error).toBe("Message: VERSION_CONFLICT");
    await act(async () => {
      await hook.result.current.run(async () => "saved");
    });
    expect(hook.result.current.error).toBe("");
    expect(hook.result.current.busy).toBe(false);
  });
});
