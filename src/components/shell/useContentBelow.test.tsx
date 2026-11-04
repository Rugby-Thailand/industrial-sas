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

function List({ rows }: { readonly rows: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const below = useContentBelow(ref);
  return (
    <>
      <div ref={ref} data-testid="list">
        {Array.from({ length: rows }, (_, i) => (
          <p key={i}>Row {i}</p>
        ))}
      </div>
      <output>{below ? "more below" : "at the end"}</output>
    </>
  );
}

/** jsdom has no layout: give the list a 400px window over its rows. */
function layout(list: HTMLElement, contentHeight: number) {
  Object.defineProperty(list, "clientHeight", {
    configurable: true,
    value: 400,
  });
  Object.defineProperty(list, "scrollHeight", {
    configurable: true,
    value: contentHeight,
  });
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ReportingResizeObserver);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

it("reports content below until the list is scrolled to its end", async () => {
  render(<List rows={3} />);
  const list = screen.getByTestId("list");
  layout(list, 900);
  await act(async () => {});
  expect(screen.getByRole("status")).toHaveTextContent("more below");

  list.scrollTop = 499.5;
  fireEvent.scroll(list);
  expect(screen.getByRole("status")).toHaveTextContent("at the end");

  list.scrollTop = 200;
  fireEvent.scroll(list);
  expect(screen.getByRole("status")).toHaveTextContent("more below");
});

it("reports nothing below when every row fits", async () => {
  render(<List rows={3} />);
  layout(screen.getByTestId("list"), 400);
  await act(async () => {});
  expect(screen.getByRole("status")).toHaveTextContent("at the end");
});

it("measures again when rows arrive after the first measurement", async () => {
  const view = render(<List rows={1} />);
  const list = screen.getByTestId("list");
  layout(list, 400);
  await act(async () => {});
  expect(screen.getByRole("status")).toHaveTextContent("at the end");

  layout(list, 700);
  view.rerender(<List rows={6} />);
  await act(async () => {});
  expect(screen.getByRole("status")).toHaveTextContent("more below");
});
