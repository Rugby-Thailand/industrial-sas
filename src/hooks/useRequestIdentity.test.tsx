// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
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
