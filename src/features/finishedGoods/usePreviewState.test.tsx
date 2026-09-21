import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { usePreviewState } from "./usePreviewState";

beforeEach(() => sessionStorage.clear());

it("restores each scope without copying another actor's preview into it", () => {
  const { result, rerender } = renderHook(
    ({ scope }) =>
      usePreviewState<{ zoom: number; labels: boolean }>(scope, {
        zoom: 1,
        labels: true,
      }),
    { initialProps: { scope: "actor-a:warehouse-a" } },
  );
  act(() => result.current[1]({ zoom: 2, labels: false }));
  rerender({ scope: "actor-b:warehouse-a" });
  expect(result.current[0]).toEqual({ zoom: 1, labels: true });
  act(() => result.current[1]((previous) => ({ ...previous, zoom: 3 })));
  rerender({ scope: "actor-a:warehouse-a" });
  expect(result.current[0]).toEqual({ zoom: 2, labels: false });
  expect(JSON.parse(sessionStorage.getItem("actor-b:warehouse-a")!)).toEqual({
    zoom: 3,
    labels: true,
  });
});

it("ignores invalid stored values when entering a different scope", () => {
  sessionStorage.setItem(
    "bad",
    JSON.stringify({ zoom: "bad", labels: false, injected: true }),
  );
  const { result, rerender } = renderHook(
    ({ scope }) =>
      usePreviewState<{ zoom: number; labels: boolean }>(scope, {
        zoom: 1,
        labels: true,
      }),
    { initialProps: { scope: "first" } },
  );
  rerender({ scope: "bad" });
  expect(result.current[0]).toEqual({ zoom: 1, labels: false });
});
