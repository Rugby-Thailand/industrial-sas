import { render, renderHook } from "@testing-library/react";
import { useMutation } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { useEffect } from "react";
import { expect, it, vi } from "vitest";
import {
  finishTestMutations,
  registerTestMutation,
  takeUnexpectedTestMutations,
} from "@tests/fixtures/convex-mutation";

const expected = makeFunctionReference<"mutation">("test/writes:expected");
const unexpected = makeFunctionReference<"mutation">("test/writes:unexpected");

it("rejects an unexpected write even when another mutation has a registered success", async () => {
  const handler = vi.fn().mockResolvedValue({ ok: true });
  registerTestMutation(expected, handler);
  const { result } = renderHook(() => useMutation(unexpected));
  await expect(result.current({})).rejects.toThrow(
    "Unexpected test mutation: test/writes:unexpected",
  );
  expect(handler).not.toHaveBeenCalled();
  // Recorded so the global afterEach fails a test that swallows the rejection.
  expect(takeUnexpectedTestMutations()).toEqual(["test/writes:unexpected"]);
});

it("passes arguments and the registered outcome through the global mutation mock", async () => {
  const handler = vi.fn().mockResolvedValue({ ok: false, code: "REFUSED" });
  registerTestMutation(expected, handler);
  const { result } = renderHook(() => useMutation(expected));
  await expect(result.current({ id: "a" })).resolves.toEqual({
    ok: false,
    code: "REFUSED",
  });
  expect(handler).toHaveBeenCalledExactlyOnceWith({ id: "a" });
});

it("does not retain registrations from the preceding test", async () => {
  const { result } = renderHook(() => useMutation(expected));
  await expect(result.current({})).rejects.toThrow(
    "Unexpected test mutation: test/writes:expected",
  );
  expect(takeUnexpectedTestMutations()).toEqual(["test/writes:expected"]);
});

it("fails a swallowed write that an unmount starts a microtask later", async () => {
  function SavesOnLeave() {
    const save = useMutation(unexpected);
    useEffect(
      () => () => {
        void Promise.resolve()
          .then(() => save({}))
          .catch(() => {});
      },
      [save],
    );
    return null;
  }
  render(<SavesOnLeave />);
  await expect(finishTestMutations()).rejects.toThrow(
    "Unexpected test mutation: test/writes:unexpected",
  );
});
