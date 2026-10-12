// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useRequestIdentity } from "./useRequestIdentity";
it("retains retry identity only within its scope and restores the existing persisted format", () => {
  localStorage.clear();
  const { result, rerender } = renderHook(
    ({ scope }) => useRequestIdentity(scope),
    { initialProps: { scope: "org:user:warehouse-A" } },
  );
  const first = result.current.request("save:payload");
  expect(result.current.request("save:payload")).toBe(first);
  rerender({ scope: "org:user:warehouse-B" });
  expect(result.current.request("save:payload")).not.toBe(first);
  rerender({ scope: "org:user:warehouse-A" });
  expect(result.current.request("save:payload")).toBe(first);
  expect(
    JSON.parse(localStorage.getItem("fg-requests:org:user:warehouse-A")!),
  ).toEqual({ "save:payload": first });
  result.current.clearRequests();
  expect(localStorage.getItem("fg-requests:org:user:warehouse-A")).toBeNull();
});

it("keeps an in-memory retry ID when storage is blocked and renews it only after clearing", () => {
  localStorage.clear();
  const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("Storage unavailable");
  });
  const write = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
  try {
    const hook = renderHook(() => useRequestIdentity("org:user:warehouse"));
    const id = hook.result.current.request("save:payload");
    expect(hook.result.current.request("save:payload")).toBe(id);
    expect(hook.result.current.request("save:other-payload")).not.toBe(id);
    hook.result.current.clearRequests();
    expect(hook.result.current.request("save:payload")).not.toBe(id);
  } finally {
    read.mockRestore();
    write.mockRestore();
  }
});

it("replaces invalid saved IDs without dropping unrelated request identities", () => {
  const scope = "org:user:warehouse";
  const existing = crypto.randomUUID();
  localStorage.setItem(
    `fg-requests:${scope}`,
    JSON.stringify({
      invalid: { requestId: "not-a-string" },
      unrelated: existing,
    }),
  );
  const hook = renderHook(() => useRequestIdentity(scope));
  const id = hook.result.current.request("invalid");
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  expect(hook.result.current.request("unrelated")).toBe(existing);
  expect(JSON.parse(localStorage.getItem(`fg-requests:${scope}`)!)).toEqual({
    invalid: id,
    unrelated: existing,
  });
});
