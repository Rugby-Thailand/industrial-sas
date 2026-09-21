// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useCatalogueSync, type CatalogueOutcome } from "./useCatalogueSync";

function setup() {
  const continuation = { cursor: undefined as string | undefined, advance: vi.fn() };
  const paging = {
    cursor: "page-2",
    canPrevious: true,
    reset: vi.fn(),
    previous: vi.fn(),
  };
  return { continuation, paging };
}

it("continues scans and recovers an empty last page only once per criteria", () => {
  const { continuation, paging } = setup();
  type Props = { outcome: CatalogueOutcome; key: string };
  const hook = renderHook<void, Props>(
    ({ outcome, key }) =>
      useCatalogueSync({
        outcome,
        continuation,
        paging,
        resetKey: key,
      }),
    {
      initialProps: {
        key: "criteria-a",
        outcome: { ok: true as const, value: { status: "scanning" as const, scanCursor: "scan-2" } },
      },
    },
  );
  expect(continuation.advance).toHaveBeenCalledWith("scan-2");

  act(() => {
    hook.rerender({
      key: "criteria-a",
      outcome: { ok: true as const, value: { status: "reset" as const } },
    });
  });
  expect(paging.reset).toHaveBeenCalledTimes(1);
  expect(continuation.advance).toHaveBeenLastCalledWith();

  act(() => {
    hook.rerender({
      key: "criteria-a",
      outcome: { ok: true as const, value: { status: "reset" as const } },
    });
  });
  expect(paging.reset).toHaveBeenCalledTimes(1);

  act(() => {
    hook.rerender({
      key: "criteria-a",
      outcome: {
        ok: true as const,
        value: { status: "ready" as const, isDone: true, page: [] },
      },
    });
  });
  expect(paging.previous).toHaveBeenCalledTimes(1);
});
