// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, expectTypeOf, it, vi } from "vitest";
import type { useOperation } from "@/features/finishedGoods/shared";
import { IDEMPOTENCY_RETENTION_MS } from "../../convex/lib/idempotency";
import type { RequestIdentityPolicy } from "./useRequestIdentity";
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
  const { "@minted": minted, ...requests } = document();
  expect(Object.keys(minted).sort()).toEqual(Object.keys(requests).sort());
  return requests;
};
const mount = () => renderHook(() => useRequestIdentity(scope));
beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

it("retains retry identity only within its scope and stores the pre-pilot flat map", () => {
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
    const hook = mount();
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
  const hook = mount();
  const id = hook.result.current.request(key, "durable");
  write.mockRestore();
  expect(hook.result.current.request(key, "durable")).toBe(id);
  hook.unmount();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Full", "QuotaExceededError");
  });
  expect(mount().result.current.request(key, "durable")).toBe(id);
});

it("shares one document with a tab still running the pre-pilot bundle", () => {
  const ours = mount().result.current.request(key, "durable");
  // The pre-pilot bundle reads `saved[key]` and writes `{ ...saved, [key]: id }`.
  const legacy = crypto.randomUUID();
  expect(document()[key]).toBe(ours);
  localStorage.setItem(
    storageKey,
    JSON.stringify({ ...document(), "create:legacy": legacy }),
  );
  const next = mount();
  expect(next.result.current.request("create:legacy", "durable")).toBe(legacy);
  expect(next.result.current.request(key, "durable")).toBe(ours);
  const fresh = next.result.current.request("fresh", "durable");
  expect(stored()).toEqual({ [key]: ours, "create:legacy": legacy, fresh });
});

it.each(['{"unfinished"', '"old scalar"', "null", "[]"])(
  "preserves an unreadable recovery document, even after success: %s",
  (raw) => {
    localStorage.setItem(storageKey, raw);
    const hook = mount();
    const id = hook.result.current.request(key, "durable");
    expect(hook.result.current.request(key, "durable")).toBe(id);
    hook.result.current.clearRequests(key);
    hook.result.current.request(key, "durable");
    expect(hook.result.current.clearRequests()).toBe(false);
    expect(localStorage.getItem(storageKey)).toBe(raw);
  },
);

it("drops invalid entries and unknown metadata when it next writes", () => {
  const id = crypto.randomUUID();
  localStorage.setItem(
    storageKey,
    JSON.stringify({
      [key]: id,
      broken: "invalid",
      nested: { requestId: id },
      "@minted": "not a map",
    }),
  );
  const hook = mount();
  expect(hook.result.current.request(key, "durable")).toBe(id);
  const fresh = hook.result.current.request("fresh", "durable");
  expect(stored()).toEqual({ [key]: id, fresh });
  expect(hook.result.current.clearRequests()).toBe(true);
  expect(localStorage.getItem(storageKey)).toBeNull();
});

it("clears only the successful step, retaining other durable commands through remount", () => {
  const hook = mount();
  const id = hook.result.current.request(key, "durable");
  hook.result.current.request("verify", "ephemeral");
  hook.result.current.clearRequests("verify");
  hook.unmount();
  expect(mount().result.current.request(key, "durable")).toBe(id);
  expect(stored()).toEqual({ [key]: id });
});

it("retains a durable ID after failed removal, both live and after remount", () => {
  const hook = mount();
  const id = hook.result.current.request(key, "durable");
  const remove = vi
    .spyOn(Storage.prototype, "removeItem")
    .mockImplementation(() => {
      throw new Error("Removal blocked");
    });
  expect(hook.result.current.clearRequests()).toBe(false);
  expect(hook.result.current.request(key, "durable")).toBe(id);
  hook.unmount();
  const next = mount();
  expect(next.result.current.request(key, "durable")).toBe(id);
  remove.mockRestore();
  expect(next.result.current.clearRequests()).toBe(true);
  expect(next.result.current.request(key, "durable")).not.toBe(id);
});

it("uses the live durable ID when reads fail, then restores it after remount", () => {
  const hook = mount();
  const id = hook.result.current.request(key, "durable");
  const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("Blocked");
  });
  expect(hook.result.current.request(key, "durable")).toBe(id);
  hook.unmount();
  read.mockRestore();
  expect(mount().result.current.request(key, "durable")).toBe(id);
});

it("keeps ephemeral IDs and their cleanup in memory only", () => {
  // Even an ID an older bundle stored under the same key is left alone.
  const legacy = crypto.randomUUID();
  localStorage.setItem(storageKey, JSON.stringify({ [key]: legacy }));
  const write = vi.spyOn(Storage.prototype, "setItem");
  const remove = vi.spyOn(Storage.prototype, "removeItem");
  const hook = mount();
  const id = hook.result.current.request(key, "ephemeral");
  expect(id).not.toBe(legacy);
  expect(hook.result.current.request(key, "ephemeral")).toBe(id);
  expect(hook.result.current.clearRequests(key)).toBe(true);
  const renewed = hook.result.current.request(key, "ephemeral");
  expect(renewed).not.toBe(id);
  expect(hook.result.current.clearRequests()).toBe(true);
  hook.unmount();
  expect(mount().result.current.request(key, "ephemeral")).not.toBe(renewed);
  expect(write).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
  expect(document()).toEqual({ [key]: legacy });
});

it("pins a live durable ID and never overwrites another tab's ID for the key", () => {
  const hook = mount();
  const id = hook.result.current.request(key, "durable");
  const other = crypto.randomUUID();
  localStorage.setItem(storageKey, JSON.stringify({ [key]: other }));
  expect(hook.result.current.request(key, "durable")).toBe(id);
  expect(document()[key]).toBe(other);
});

it("does not let a late acknowledgment retire a newer ID for the same key", () => {
  const pending = crypto.randomUUID();
  localStorage.setItem(storageKey, JSON.stringify({ [key]: pending }));
  const [first, late] = [mount(), mount()];
  expect(first.result.current.request(key, "durable")).toBe(pending);
  expect(late.result.current.request(key, "durable")).toBe(pending);
  first.result.current.clearRequests();
  // A new form stores a fresh ID for an identical command.
  const fresh = mount().result.current.request(key, "durable");
  expect(late.result.current.clearRequests()).toBe(true);
  expect(stored()).toEqual({ [key]: fresh });
});

it("retires only its own commands on success, keeping another tab's pending ID", () => {
  const tabA = mount();
  const tabB = mount();
  const pending = tabA.result.current.request("create:a", "durable");
  tabB.result.current.request("create:b", "durable");
  expect(tabB.result.current.clearRequests()).toBe(true);
  tabA.unmount();
  expect(mount().result.current.request("create:a", "durable")).toBe(pending);
  expect(stored()).toEqual({ "create:a": pending });
});

it("defaults to the durable policy for callers outside finished goods", () => {
  const id = mount().result.current.request(key);
  expect(mount().result.current.request(key)).toBe(id);
});

it("restarts retention on each dispatch, outlasting the server's receipt", () => {
  expect(REQUEST_ID_RETENTION_MS).toBeGreaterThan(IDEMPOTENCY_RETENTION_MS);
  const legacy = crypto.randomUUID();
  localStorage.setItem(storageKey, JSON.stringify({ [key]: legacy }));
  const start = Date.now();
  const now = vi.spyOn(Date, "now").mockReturnValue(start);
  // Adopting an older bundle's entry stamps it; a later retry restamps it.
  expect(mount().result.current.request(key, "durable")).toBe(legacy);
  expect(document()["@minted"][key]).toBe(start);
  now.mockReturnValue(start + REQUEST_ID_RETENTION_MS - 1);
  expect(mount().result.current.request(key, "durable")).toBe(legacy);
  expect(document()["@minted"][key]).toBe(start + REQUEST_ID_RETENTION_MS - 1);
  now.mockReturnValue(start + 2 * REQUEST_ID_RETENTION_MS - 2);
  expect(mount().result.current.request(key, "durable")).toBe(legacy);
});

it("expires stored IDs once retention has passed since their last dispatch", () => {
  const now = Date.now();
  const [expired, live] = [crypto.randomUUID(), crypto.randomUUID()];
  localStorage.setItem(
    storageKey,
    JSON.stringify({
      [key]: expired,
      other: live,
      "@minted": { [key]: now - REQUEST_ID_RETENTION_MS, other: now },
    }),
  );
  const id = mount().result.current.request(key, "durable");
  expect(id).not.toBe(expired);
  expect(stored()).toEqual({ [key]: id, other: live });
  expect(document()["@minted"].other).toBe(now);
});

it("requires an explicit typed policy on every finished-goods request", () => {
  expectTypeOf<
    Parameters<ReturnType<typeof useOperation>["request"]>
  >().toEqualTypeOf<[string, RequestIdentityPolicy]>();
});
