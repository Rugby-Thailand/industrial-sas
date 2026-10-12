import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import {
  startTransition,
  StrictMode,
  Suspense,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { describe, expect, it, vi } from "vitest";
import { useAsyncOperation } from "./useAsyncOperation";

describe("useAsyncOperation", () => {
  it("keeps the committed scope current while a different scope render is suspended", async () => {
    let finish!: (value: string) => void;
    const response = new Promise<string>((resolve) => {
      finish = resolve;
    });
    const blocked = new Promise<void>(() => {});
    const complete = vi.fn();
    let result!: Promise<string | null>;
    function Owner() {
      const [scope, setScope] = useState("A");
      const operation = useAsyncOperation({
        scope,
        describeError: (code) => code,
      });
      if (scope === "B") throw blocked;
      return (
        <>
          <p>Scope A</p>
          <button
            onClick={() => {
              result = operation.run(() => response, complete);
            }}
          >
            Save
          </button>
          <button onClick={() => startTransition(() => setScope("B"))}>
            Switch
          </button>
        </>
      );
    }
    render(
      <Suspense fallback={<p>Blocked</p>}>
        <Owner />
      </Suspense>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(screen.getByRole("button", { name: "Switch" }));
    expect(screen.getByText("Scope A")).toBeVisible();
    expect(screen.queryByText("Blocked")).not.toBeInTheDocument();
    await act(async () => {
      finish("saved-A");
      expect(await result).toBe("saved-A");
    });
    expect(complete).toHaveBeenCalledExactlyOnceWith("saved-A");
  });

  it("keeps a new scope started by a descendant layout effect busy until it finishes", async () => {
    const pending = new Map<string, Promise<string>>();
    const finish = new Map<string, (value: string) => void>();
    const results = new Map<string, Promise<string | null>>();
    for (const scope of ["A", "B"])
      pending.set(
        scope,
        new Promise((resolve) => {
          finish.set(scope, resolve);
        }),
      );
    function StartInLayout({
      scope,
      run,
    }: {
      scope: string;
      run: (action: () => Promise<string>) => Promise<string | null>;
    }) {
      const started = useRef<string | null>(null);
      useLayoutEffect(() => {
        if (started.current === scope) return;
        started.current = scope;
        results.set(
          scope,
          run(() => pending.get(scope)!),
        );
      }, [run, scope]);
      return null;
    }
    function Owner({ scope }: { scope: string }) {
      const operation = useAsyncOperation({
        scope,
        describeError: (code) => code,
      });
      return (
        <>
          <StartInLayout scope={scope} run={operation.run} />
          <p>{operation.busy ? "Pending" : "Idle"}</p>
        </>
      );
    }
    const view = render(<Owner scope="A" />);
    expect(screen.getByText("Pending")).toBeInTheDocument();
    view.rerender(<Owner scope="B" />);
    expect(screen.getByText("Pending")).toBeInTheDocument();
    await act(async () => {
      finish.get("A")!("old");
      expect(await results.get("A")).toBeNull();
    });
    expect(screen.getByText("Pending")).toBeInTheDocument();
    await act(async () => {
      finish.get("B")!("current");
      expect(await results.get("B")).toBe("current");
    });
    expect(screen.getByText("Idle")).toBeInTheDocument();
  });

  it("invalidates an operation started before StrictMode's lifetime replay", async () => {
    let finish!: (value: string) => void;
    const response = new Promise<string>((resolve) => {
      finish = resolve;
    });
    const complete = vi.fn();
    let initial!: Promise<string | null>;
    const hook = renderHook(
      () => {
        const operation = useAsyncOperation((code) => code);
        const { run } = operation;
        const started = useRef(false);
        useLayoutEffect(() => {
          if (started.current) return;
          started.current = true;
          initial = run(() => response, complete);
        }, [run]);
        return operation;
      },
      { wrapper: StrictMode },
    );
    let finishCurrent!: (value: string) => void;
    let current!: Promise<string | null>;
    act(() => {
      current = hook.result.current.run(
        () =>
          new Promise((resolve) => {
            finishCurrent = resolve;
          }),
      );
    });
    await act(async () => {
      finish("old-lifetime");
      expect(await initial).toBeNull();
    });
    expect(complete).not.toHaveBeenCalled();
    expect(hook.result.current.busy).toBe(true);
    await act(async () => {
      finishCurrent("current");
      expect(await current).toBe("current");
    });
    expect(hook.result.current.busy).toBe(false);
  });

  it("does not revive a terminal error or late manual setter after returning to a scope", async () => {
    const hook = renderHook(
      ({ scope }) =>
        useAsyncOperation({ scope, describeError: (code) => code }),
      { initialProps: { scope: "A" } },
    );
    const staleSetter = hook.result.current.setError;
    await act(async () => {
      await hook.result.current.run(async () => {
        throw new Error("OLD_ERROR");
      });
    });
    expect(hook.result.current.error).toBe("OLD_ERROR");
    hook.rerender({ scope: "B" });
    act(() => {
      hook.result.current.setError("CURRENT_ERROR");
      staleSetter("LATE_ERROR");
    });
    expect(hook.result.current.error).toBe("CURRENT_ERROR");
    hook.rerender({ scope: "A" });
    expect(hook.result.current.error).toBe("");
    expect(hook.result.current.errorCode).toBe("");
    expect(hook.result.current.busy).toBe(false);
  });

  it.each(["scope", "unmount", "return-to-scope"])(
    "does not return or complete an old success after %s",
    async (change) => {
      let finish!: (value: string) => void;
      const hook = renderHook(
        ({ scope }) =>
          useAsyncOperation({ scope, describeError: (code) => code }),
        { initialProps: { scope: "A" } },
      );
      const complete = vi.fn();
      let result!: Promise<string | null>;
      act(() => {
        result = hook.result.current.run(
          () =>
            new Promise((resolve) => {
              finish = resolve;
            }),
          complete,
        );
      });
      if (change === "unmount") hook.unmount();
      else {
        hook.rerender({ scope: "B" });
        if (change === "return-to-scope") hook.rerender({ scope: "A" });
      }
      await act(async () => {
        finish("old-document");
        expect(await result).toBeNull();
      });
      expect(complete).not.toHaveBeenCalled();
    },
  );

  it("releases before synchronous completion and leaves a newly started action busy", async () => {
    const hook = renderHook(() => useAsyncOperation((code) => code));
    let finish!: () => void;
    const response = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const nextAction = vi.fn(() => response);
    let next!: Promise<void | null>;
    const complete = vi.fn((value: string) => {
      expect(value).toBe("saved-document");
      next = hook.result.current.run(nextAction);
    });
    await act(async () => {
      expect(
        await hook.result.current.run(async () => "saved-document", complete),
      ).toBe("saved-document");
    });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(nextAction).toHaveBeenCalledTimes(1);
    expect(hook.result.current.busy).toBe(true);
    await act(async () => {
      finish();
      await next;
    });
    expect(hook.result.current.busy).toBe(false);
  });

  it("completes a legitimate null result but skips completion for a rejected action", async () => {
    const hook = renderHook(() => useAsyncOperation((code) => code));
    const complete = vi.fn();
    await act(async () => {
      expect(
        await hook.result.current.run(async () => null, complete),
      ).toBeNull();
    });
    expect(complete).toHaveBeenCalledExactlyOnceWith(null);
    complete.mockClear();
    await act(async () => {
      await hook.result.current.run(async () => {
        throw new Error("REFUSED");
      }, complete);
    });
    expect(complete).not.toHaveBeenCalled();
    expect(hook.result.current.error).toBe("REFUSED");
  });

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
