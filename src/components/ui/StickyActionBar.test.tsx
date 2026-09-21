import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PageContainer } from "./PageContainer";
import { StickyActionBar } from "./StickyActionBar";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("reserves the measured action height and updates it as content grows", () => {
  let height = 160;
  let resize: () => void = () => {};
  const disconnect = vi.fn();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 500,
      bottom: height,
      width: 500,
      height,
      toJSON: () => ({}),
    }),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  const view = render(
    <PageContainer data-testid="page" actionInset="fixed">
      <p>Last record</p>
      <StickyActionBar placement="fixed">
        <button>Save</button>
      </StickyActionBar>
    </PageContainer>,
  );
  const page = screen.getByTestId("page");
  expect(page.style.getPropertyValue("--sticky-action-height")).toBe("160px");
  height = 240;
  resize();
  expect(page.style.getPropertyValue("--sticky-action-height")).toBe("240px");
  view.unmount();
  expect(disconnect).toHaveBeenCalled();
});
