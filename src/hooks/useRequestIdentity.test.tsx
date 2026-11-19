// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, expectTypeOf, it, vi } from "vitest";
import type { useOperation } from "@/features/finishedGoods/shared";
import type { RequestIdentityPolicy } from "./useRequestIdentity";
import { IDEMPOTENCY_RETENTION_MS } from "../../convex/lib/idempotency";
import {
  REQUEST_ID_RETENTION_MS,
  useRequestIdentity,
} from "./useRequestIdentity";

const scope = "org:user:warehouse";
const storageKey = `fg-requests:${scope}`;
const key = "save:payload";
const document = () => JSON.parse(localStorage.getItem(storageKey)!);
/** The stored IDs, after checking each has a mint time. */
const stored = () => {
  const { version, requests, minted } = document();
  expect(version).toBe(1);
  expect(Object.keys(minted).sort()).toEqual(Object.keys(requests).sort());
  return requests;
};
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
  expect(stored()).toEqual({ [key]: first });
  expect(result.current.clearRequests()).toBe(true);
  expect(localStorage.getItem(storageKey)).toBeNull();
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
    expect(stored()).toEqual({ ...entries, fresh });
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
    expect(stored()).toEqual({ [key]: id, fresh });
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
  expect(stored()).toEqual({
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

it("keeps ephemeral IDs in memory only, so a remount mints a new one", () => {
  const write = vi.spyOn(Storage.prototype, "setItem");
  const hook = renderHook(() => useRequestIdentity(scope));
  const id = hook.result.current.request(key, "ephemeral");
  expect(hook.result.current.request(key, "ephemeral")).toBe(id);
  expect(hook.result.current.clearRequests(key)).toBe(true);
  const renewed = hook.result.current.request(key, "ephemeral");
  expect(renewed).not.toBe(id);
  hook.unmount();
  const next = renderHook(() => useRequestIdentity(scope));
  expect(next.result.current.request(key, "ephemeral")).not.toBe(renewed);
  expect(write).not.toHaveBeenCalled();
  expect(localStorage.length).toBe(0);
});

it("pins a live durable ID even if another tab stores a different one", () => {
  const hook = renderHook(() => useRequestIdentity(scope));
  const id = hook.result.current.request(key, "durable");
  localStorage.setItem(
    storageKey,
    JSON.stringify({ version: 1, requests: { [key]: crypto.randomUUID() } }),
  );
  expect(hook.result.current.request(key, "durable")).toBe(id);
});

it("retires only its own commands on success, keeping another tab's pending ID", () => {
  const tabA = renderHook(() => useRequestIdentity(scope));
  const tabB = renderHook(() => useRequestIdentity(scope));
  const pending = tabA.result.current.request("create:a", "durable");
  tabB.result.current.request("create:b", "durable");
  expect(tabB.result.current.clearRequests()).toBe(true);
  tabA.unmount();
  const remounted = renderHook(() => useRequestIdentity(scope));
  expect(remounted.result.current.request("create:a", "durable")).toBe(pending);
  expect(stored()).toEqual({
    "create:a": pending,
  });
});

it("defaults to the durable policy for callers outside finished goods", () => {
  const hook = renderHook(() => useRequestIdentity(scope));
  const id = hook.result.current.request(key);
  hook.unmount();
  const next = renderHook(() => useRequestIdentity(scope));
  expect(next.result.current.request(key)).toBe(id);
});

it("requires an explicit typed policy on every finished-goods request", () => {
  expectTypeOf<
    Parameters<ReturnType<typeof useOperation>["request"]>
  >().toEqualTypeOf<[string, RequestIdentityPolicy]>();
});

it("expires stored IDs with the server's receipt retention", () => {
  expect(REQUEST_ID_RETENTION_MS).toBe(IDEMPOTENCY_RETENTION_MS);
  const now = Date.now();
  const [expired, live] = [crypto.randomUUID(), crypto.randomUUID()];
  localStorage.setItem(
    storageKey,
    JSON.stringify({
      version: 1,
      requests: { [key]: expired, other: live },
      minted: { [key]: now - REQUEST_ID_RETENTION_MS, other: now },
    }),
  );
  const hook = renderHook(() => useRequestIdentity(scope));
  const id = hook.result.current.request(key, "durable");
  expect(id).not.toBe(expired);
  expect(stored()).toEqual({ [key]: id, other: live });
  expect(document().minted.other).toBe(now);
});

it("treats an unknown document version as unreadable and preserves it", () => {
  const raw = JSON.stringify({ version: 2, entries: [] });
  localStorage.setItem(storageKey, raw);
  const hook = renderHook(() => useRequestIdentity(scope));
  const id = hook.result.current.request(key, "durable");
  expect(hook.result.current.request(key, "durable")).toBe(id);
  expect(localStorage.getItem(storageKey)).toBe(raw);
});
