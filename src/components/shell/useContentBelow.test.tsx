import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useContentBelow } from "./useContentBelow";

/** A ResizeObserver that, like browsers, reports each target once on observe. */
class ReportingResizeObserver {
  constructor(private readonly callback: () => void) {}
  observe() {
    queueMicrotask(this.callback);
  }
  unobserve() {}
  disconnect() {}
}

const ROW_HEIGHT = 40;
const WINDOW = 400;

function List({
  rows,
  hiddenFrom = rows,
}: {
  readonly rows: number;
  /** Rows from this index on sit in a closed submenu. */
  readonly hiddenFrom?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const below = useContentBelow(ref, "[data-row]");
  return (
    <>
      <div ref={ref} data-testid="list">
        {Array.from({ length: rows }, (_, i) => (
          <p key={i} data-row={i} hidden={i >= hiddenFrom}>
            Row {i}
          </p>
        ))}
      </div>
      <output>{below ? "more below" : "at the end"}</output>
    </>
  );
}

/**
 * jsdom has no layout: give the list a 400px window at the top of the page,
 * rows of 40px after `padTop`, and the list's own scroll position.
 */
function layout(list: HTMLElement, padTop = 16) {
  Object.defineProperty(list, "clientHeight", {
    configurable: true,
    value: WINDOW,
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      if (this === list) return DOMRect.fromRect({ height: WINDOW });
      const index = Number(this.getAttribute("data-row"));
      if (Number.isNaN(index) || this.hasAttribute("hidden"))
        return DOMRect.fromRect();
      return DOMRect.fromRect({
        y: padTop + index * ROW_HEIGHT - list.scrollTop,
        height: ROW_HEIGHT,
      });
    },
  );
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ReportingResizeObserver);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("reports a row below until the list is scrolled to its last row", async () => {
  // Rows end at 16 + 20 × 40 = 816px.
  render(<List rows={20} />);
  const list = screen.getByTestId("list");
  layout(list);
  await act(async () => {});
  expect(screen.getByRole("status")).toHaveTextContent("more below");

  list.scrollTop = 416;
  fireEvent.scroll(list);
  expect(screen.getByRole("status")).toHaveTextContent("at the end");

  list.scrollTop = 200;
  fireEvent.scroll(list);
  expect(screen.getByRole("status")).toHaveTextContent("more below");
});

it("reports nothing below when every row is visible, even if padding is cut off", async () => {
  // The last row ends at 16 + 9 × 40 = 376px, inside the 400px window; the
  // padded scroll box would be taller than the window.
  render(<List rows={9} />);
  layout(screen.getByTestId("list"));
  await act(async () => {});
  expect(screen.getByRole("status")).toHaveTextContent("at the end");
});

it("tolerates a row that overhangs the window by a rounding hairline", async () => {
  // 10 rows from 2px end at 402px: within the 2px tolerance.
  render(<List rows={10} />);
  layout(screen.getByTestId("list"), 2);
  await act(async () => {});
  expect(screen.getByRole("status")).toHaveTextContent("at the end");
});

it("ignores rows inside a closed submenu", async () => {
  render(<List rows={20} hiddenFrom={8} />);
  layout(screen.getByTestId("list"));
  await act(async () => {});
  expect(screen.getByRole("status")).toHaveTextContent("at the end");
});

it("measures again when rows arrive after the first measurement", async () => {
  const view = render(<List rows={1} />);
  const list = screen.getByTestId("list");
  layout(list);
  await act(async () => {});
  expect(screen.getByRole("status")).toHaveTextContent("at the end");

  view.rerender(<List rows={16} />);
  await act(async () => {});
  expect(screen.getByRole("status")).toHaveTextContent("more below");
});
