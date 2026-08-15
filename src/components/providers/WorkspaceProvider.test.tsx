import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { previewEnvironment } from "../../../tests/fixtures/intl-render";
import {
  LEGACY_WAREHOUSE_STORAGE_KEY,
  readStoredWarehouse,
  WAREHOUSE_STORAGE_KEY,
  writeStoredWarehouse,
} from "@/lib/workspace/warehouseStore";

import { EnvironmentProvider } from "./EnvironmentProvider";
import { useWorkspace, WorkspaceProvider } from "./WorkspaceProvider";

/**
 * What the provider costs a screen that has many consumers.
 *
 * `useWorkspace` cannot skip a hook when a provider is above it — hook order is
 * fixed — so its standalone fallback runs for every consumer whether or not its
 * answer is used. The fallback subscribes to `localStorage`, which is a
 * *synchronous* browser API: left ungated, a screen with ten panels attached
 * ten `storage` listeners and re-read the key on every render of every one of
 * them, only to discard each result in favour of the context value.
 *
 * These assert the shape of the cost rather than a duration: the numbers below
 * are identical for one consumer and for twenty, which is the property that
 * would break if the gate were removed. Before it existed the same tree
 * produced 21 listeners and 63 reads on mount, and 84 reads per warehouse
 * switch.
 */
const BANG_PU = "prv_wh_bangpoo";
const LAMPHUN = "prv_wh_lamphun";

function Consumer({ index }: { readonly index: number }) {
  const workspace = useWorkspace();
  return (
    <span data-testid={`consumer-${index}`}>
      {workspace.selectedWarehouseId ?? "none"}
    </span>
  );
}

function Switcher() {
  const workspace = useWorkspace();
  return (
    <button type="button" onClick={() => workspace.selectWarehouse(LAMPHUN)}>
      switch
    </button>
  );
}

const consumers = (count: number) =>
  Array.from({ length: count }, (_, index) => (
    <Consumer key={index} index={index} />
  ));

const renderUnderProvider = (children: React.ReactNode) =>
  render(
    <EnvironmentProvider environment={previewEnvironment}>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </EnvironmentProvider>,
  );

/** Counts the two things a redundant subscription actually costs. */
function storageCounters() {
  const getItem = vi.spyOn(Storage.prototype, "getItem");
  const addEventListener = vi.spyOn(window, "addEventListener");

  return {
    listeners: () =>
      addEventListener.mock.calls.filter(([type]) => type === "storage").length,
    reads: () =>
      getItem.mock.calls.filter(([key]) => key === WAREHOUSE_STORAGE_KEY)
        .length,
  };
}

describe("the workspace provider", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("subscribes to storage once for the screen, not once per consumer", () => {
    const counters = storageCounters();

    renderUnderProvider(<>{consumers(20)}</>);

    expect(counters.listeners()).toBe(1);
  });

  it("migrates the warehouse choice from the former product storage key", () => {
    window.localStorage.setItem(LEGACY_WAREHOUSE_STORAGE_KEY, BANG_PU);

    expect(readStoredWarehouse()).toBe(BANG_PU);
    expect(window.localStorage.getItem(WAREHOUSE_STORAGE_KEY)).toBe(BANG_PU);
    expect(
      window.localStorage.getItem(LEGACY_WAREHOUSE_STORAGE_KEY),
    ).toBeNull();
  });

  it("reads storage the same number of times whatever the consumer count", () => {
    const one = storageCounters();
    renderUnderProvider(<>{consumers(1)}</>);
    const readsForOne = one.reads();

    vi.restoreAllMocks();

    const many = storageCounters();
    renderUnderProvider(<>{consumers(20)}</>);

    expect(many.reads()).toBe(readsForOne);
  });

  it("re-reads storage once per warehouse switch, not once per consumer", () => {
    renderUnderProvider(<>{consumers(20)}</>);
    // Spy after the mount so this counts the switch alone.
    const counters = storageCounters();

    act(() => {
      writeStoredWarehouse(BANG_PU);
    });

    expect(counters.reads()).toBeLessThanOrEqual(4);
  });

  it("still shows every consumer the warehouse that was chosen", () => {
    renderUnderProvider(
      <>
        <Switcher />
        {consumers(3)}
      </>,
    );

    act(() => {
      writeStoredWarehouse(BANG_PU);
    });
    expect(screen.getByTestId("consumer-2")).toHaveTextContent(BANG_PU);

    // And through a consumer's own `selectWarehouse`, which is the real path.
    act(() => {
      screen.getByRole("button", { name: "switch" }).click();
    });
    for (const index of [0, 1, 2]) {
      expect(screen.getByTestId(`consumer-${index}`)).toHaveTextContent(
        LAMPHUN,
      );
    }
  });
});

/**
 * The fallback is load-bearing for the test suite: `ShellSelects.test.tsx` and
 * the inbound suites render a panel with no provider above it, on purpose. What
 * the gate must not do is turn that case into a component that reads nothing.
 */
describe("a consumer with no provider above it", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves the stored warehouse on its own", () => {
    window.localStorage.setItem(WAREHOUSE_STORAGE_KEY, BANG_PU);

    render(
      <EnvironmentProvider environment={previewEnvironment}>
        <Consumer index={0} />
      </EnvironmentProvider>,
    );

    expect(screen.getByTestId("consumer-0")).toHaveTextContent(BANG_PU);
  });

  it("follows a choice made in another tab", () => {
    render(
      <EnvironmentProvider environment={previewEnvironment}>
        <Consumer index={0} />
      </EnvironmentProvider>,
    );

    act(() => {
      window.localStorage.setItem(WAREHOUSE_STORAGE_KEY, LAMPHUN);
      window.dispatchEvent(
        new StorageEvent("storage", { key: WAREHOUSE_STORAGE_KEY }),
      );
    });

    expect(screen.getByTestId("consumer-0")).toHaveTextContent(LAMPHUN);
  });
});
