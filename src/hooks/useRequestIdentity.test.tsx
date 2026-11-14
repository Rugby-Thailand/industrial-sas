// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, expectTypeOf, it, vi } from "vitest";
import type { useOperation } from "@/features/finishedGoods/shared";
import type { RequestIdentityPolicy } from "./useRequestIdentity";
import { useRequestIdentity } from "./useRequestIdentity";

const scope = "org:user:warehouse";
const storageKey = `fg-requests:${scope}`;
const key = "save:payload";
beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

it("retains retry identity only within its scope and writes versioned records", () => {
  const { result, rerender } = renderHook(
    ({ scope }) => useRequestIdentity(scope),
    { initialProps: { scope } },
  );
  const first = result.current.request(key, "durable");
  expect(result.current.request(key, "durable")).toBe(first);
  rerender({ scope: "org:user:warehouse-B" });
  expect(result.current.request(key, "durable")).not.toBe(first);
  rerender({ scope });
  expect(result.current.request(key, "durable")).toBe(first);
  expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual({
    version: 1,
    requests: { [key]: first },
  });
  expect(result.current.clearRequests()).toBe(true);
  expect(localStorage.getItem(storageKey)).toBeNull();
});

it("keeps the ephemeral in-memory fallback when storage is blocked, renewing only after clearing", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("Storage unavailable");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Storage unavailable");
  });
  const hook = renderHook(() => useRequestIdentity(scope));
  const id = hook.result.current.request(key, "ephemeral");
  expect(hook.result.current.request(key, "ephemeral")).toBe(id);
  expect(hook.result.current.request("other", "ephemeral")).not.toBe(id);
  hook.result.current.clearRequests();
  expect(hook.result.current.request(key, "ephemeral")).not.toBe(id);
});

it.each(["read", "write"])(
  "keeps a durable in-memory ID when storage blocks %s",
  (failure) => {
    vi.spyOn(
      Storage.prototype,
      failure === "read" ? "getItem" : "setItem",
    ).mockImplementation(() => {
      throw new DOMException("Quota or access failure", "QuotaExceededError");
    });
    const hook = renderHook(() => useRequestIdentity(scope));
    const id = hook.result.current.request(key, "durable");
    expect(hook.result.current.request(key, "durable")).toBe(id);
    hook.result.current.clearRequests();
    expect(hook.result.current.request(key, "durable")).not.toBe(id);
  },
);

it("keeps a durable in-memory ID without a persistence scope", () => {
  const hook = renderHook(() => useRequestIdentity());
  const id = hook.result.current.request(key, "durable");
  expect(hook.result.current.request(key, "durable")).toBe(id);
});

it("recovers after quota is restored, then reuses the persisted ID on remount at quota", () => {
  const write = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new DOMException("Full", "QuotaExceededError");
    });
  const hook = renderHook(() => useRequestIdentity(scope));
  const id = hook.result.current.request(key, "durable");
  write.mockRestore();
  expect(hook.result.current.request(key, "durable")).toBe(id);
  hook.unmount();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Full", "QuotaExceededError");
  });
  const next = renderHook(() => useRequestIdentity(scope));
  expect(next.result.current.request(key, "durable")).toBe(id);
});

it.each(["legacy", "versioned"])(
  "honors %s saved IDs and preserves unrelated identities when adding a command",
  (format) => {
    const id = crypto.randomUUID();
    const entries = { [key]: id, unrelated: crypto.randomUUID() };
    localStorage.setItem(
      storageKey,
      JSON.stringify(
        format === "legacy" ? entries : { version: 1, requests: entries },
      ),
    );
    const hook = renderHook(() => useRequestIdentity(scope));
    expect(hook.result.current.request(key, "durable")).toBe(id);
    const fresh = hook.result.current.request("fresh", "durable");
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual({
      version: 1,
      requests: { ...entries, fresh },
    });
  },
);

it.each(['{"unfinished"', '"old scalar"', "null", "[]"])(
  "preserves unreadable recovery until whole-scope success: %s",
  (raw) => {
    localStorage.setItem(storageKey, raw);
    const hook = renderHook(() => useRequestIdentity(scope));
    const id = hook.result.current.request(key, "durable");
    expect(hook.result.current.request(key, "durable")).toBe(id);
    expect(localStorage.getItem(storageKey)).toBe(raw);
    hook.result.current.clearRequests("verify");
    expect(localStorage.getItem(storageKey)).toBe(raw);
    hook.result.current.clearRequests();
    expect(localStorage.getItem(storageKey)).toBeNull();
  },
);

it.each([false, true])(
  "drops invalid entries and ignores versioned top-level extras: %s",
  (versioned) => {
    const id = crypto.randomUUID();
    const entries = { [key]: id, broken: "invalid", nested: { requestId: id } };
    localStorage.setItem(
      storageKey,
      JSON.stringify(
        versioned
          ? {
              version: 1,
              requests: entries,
              recovery: "unknown",
              oldBundleKey: crypto.randomUUID(),
            }
          : entries,
      ),
    );
    const hook = renderHook(() => useRequestIdentity(scope));
    expect(hook.result.current.request(key, "durable")).toBe(id);
    const fresh = hook.result.current.request("fresh", "durable");
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual({
      version: 1,
      requests: { [key]: id, fresh },
    });
    expect(hook.result.current.clearRequests()).toBe(true);
    expect(localStorage.getItem(storageKey)).toBeNull();
  },
);

it("clears only the successful step, retaining other durable commands through remount", () => {
  const hook = renderHook(() => useRequestIdentity(scope));
  const id = hook.result.current.request(key, "durable");
  hook.result.current.request("verify", "ephemeral");
  hook.result.current.clearRequests("verify");
  hook.unmount();
  const next = renderHook(() => useRequestIdentity(scope));
  expect(next.result.current.request(key, "durable")).toBe(id);
  expect(JSON.parse(localStorage.getItem(storageKey)!).requests).toEqual({
    [key]: id,
  });
});

it("retains a durable ID after failed removal, both live and after remount", () => {
  const hook = renderHook(() => useRequestIdentity(scope));
  const id = hook.result.current.request(key, "durable");
  const remove = vi
    .spyOn(Storage.prototype, "removeItem")
    .mockImplementation(() => {
      throw new Error("Removal blocked");
    });
  expect(hook.result.current.clearRequests()).toBe(false);
  expect(hook.result.current.request(key, "durable")).toBe(id);
  hook.unmount();
  const next = renderHook(() => useRequestIdentity(scope));
  expect(next.result.current.request(key, "durable")).toBe(id);
  remove.mockRestore();
  expect(next.result.current.clearRequests()).toBe(true);
  expect(next.result.current.request(key, "durable")).not.toBe(id);
});

it("uses the live durable ID when reads fail, then restores it after remount", () => {
  const hook = renderHook(() => useRequestIdentity(scope));
  const id = hook.result.current.request(key, "durable");
  const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("Blocked");
  });
  expect(hook.result.current.request(key, "durable")).toBe(id);
  hook.unmount();
  read.mockRestore();
  const next = renderHook(() => useRequestIdentity(scope));
  expect(next.result.current.request(key, "durable")).toBe(id);
});

it("keeps ephemeral IDs usable at quota and clears their in-memory fallback", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Full", "QuotaExceededError");
  });
  const hook = renderHook(() => useRequestIdentity(scope));
  const id = hook.result.current.request(key, "ephemeral");
  expect(hook.result.current.request(key, "ephemeral")).toBe(id);
  hook.result.current.clearRequests();
  expect(hook.result.current.request(key, "ephemeral")).not.toBe(id);
});

it("requires an explicit typed policy on every finished-goods request", () => {
  expectTypeOf<
    Parameters<ReturnType<typeof useOperation>["request"]>
  >().toEqualTypeOf<[string, RequestIdentityPolicy]>();
});
