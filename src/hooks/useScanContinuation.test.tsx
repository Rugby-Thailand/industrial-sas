import { act, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { useScanContinuation } from "./useScanContinuation";

it("does not reuse a partial scan after criteria, warehouse, or page changes", () => {
  const hook = renderHook(({ key }) => useScanContinuation(key), {
    initialProps: { key: "warehouse-a:search:first-page" },
  });
  act(() => hook.result.current.advance("scan-private"));
  expect(hook.result.current.cursor).toBe("scan-private");
  hook.rerender({ key: "warehouse-b:search:first-page" });
  expect(hook.result.current.cursor).toBeUndefined();
  act(() => hook.result.current.advance("scan-other"));
  hook.rerender({ key: "warehouse-b:other-search:first-page" });
  expect(hook.result.current.cursor).toBeUndefined();
  hook.rerender({ key: "warehouse-a:search:first-page" });
  expect(hook.result.current.cursor).toBeUndefined();
});
