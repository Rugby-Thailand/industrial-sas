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

describe("HR write recovery contract", () => {
  it("does not let an unmounted write remove the scalar ID retained by a newer uncertain retry", async () => {
    const intent = "overlapping-retry";
    const key = `hr-request:${access.identityKey}|${intent}`;
    const sent: string[] = [];
    let finishOld!: (value: unknown) => void;
    const old = renderHook(() => useHrWrite(intent));
    let oldResult!: Promise<{ kind: string }>;
    act(() => {
      oldResult = old.result.current.submit((requestId) => {
        sent.push(requestId);
        return new Promise((resolve) => {
          finishOld = resolve;
        });
      });
    });
    old.unmount();
    const next = renderHook(() => useHrWrite(intent));
    await act(async () => {
      expect(
        (
          await next.result.current.submit(async (requestId) => {
            sent.push(requestId);
            throw new Error("Retry response was lost");
          })
        ).kind,
      ).toBe("UNCERTAIN");
    });
    expect(sent[1]).toBe(sent[0]);
    await act(async () => {
      finishOld({
        ok: true,
        value: { written: true, documentId: "saved-document" },
      });
      expect((await oldResult).kind).toBe("IDLE");
    });
    expect(sessionStorage.getItem(key)).toBe(JSON.stringify(sent[0]));
    next.unmount();
    const remounted = renderHook(() => useHrWrite(intent));
    await act(async () => {
      await remounted.result.current.submit(async (requestId) => {
        sent.push(requestId);
        return {
          ok: true,
          value: { written: true, documentId: "saved-document" },
        };
      });
    });
    expect(sent[2]).toBe(sent[0]);
    expect(sessionStorage.getItem(key)).toBeNull();
  });

  it("restores the existing scalar request ID and keeps it on denial until a definite refusal", async () => {
    const key = `hr-request:${access.identityKey}|scalar-format`;
    const id = "existing_request_123";
    sessionStorage.setItem(key, JSON.stringify(id));
    const hook = renderHook(() => useHrWrite("scalar-format"));
    const sent: string[] = [];
    await act(async () => {
      expect(
        (
          await hook.result.current.submit(async (requestId) => {
            sent.push(requestId);
            return { ok: false };
          })
        ).kind,
      ).toBe("DENIED");
    });
    expect(sent).toEqual([id]);
    expect(JSON.parse(sessionStorage.getItem(key)!)).toBe(id);
    await act(async () => {
      expect(
        (
          await hook.result.current.submit(async (requestId) => {
            sent.push(requestId);
            return {
              ok: true,
              value: { written: false, error: { code: "LOCKED" } },
            };
          })
        ).kind,
      ).toBe("REFUSED");
    });
    expect(sent).toEqual([id, id]);
    expect(sessionStorage.getItem(key)).toBeNull();
  });

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
