import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { SearchResultsViewport } from "./SearchResultsViewport";

afterEach(() => vi.unstubAllGlobals());

describe("search results continuation", () => {
  it("shows a continuation cue only while results remain below, without adding a history step", () => {
    let measure = () => {};
    class Observer implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        measure = () => callback([], this);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", Observer);
    const historyLength = window.history.length;
    renderWithIntl(
      <SearchResultsViewport id="results" label="Results">
        <div role="option" aria-selected="false">
          A result
        </div>
      </SearchResultsViewport>,
      { locale: "en" },
    );
    const list = screen.getByRole("listbox");
    Object.defineProperties(list, {
      clientHeight: { configurable: true, value: 300 },
      scrollHeight: { configurable: true, value: 600 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    });
    vi.spyOn(list, "getBoundingClientRect").mockImplementation(
      () => new DOMRect(0, 0, 390, list.clientHeight),
    );
    vi.spyOn(
      screen.getByRole("option"),
      "getBoundingClientRect",
    ).mockImplementation(
      () => new DOMRect(0, list.scrollHeight - list.scrollTop - 56, 390, 48),
    );
    act(measure);
    expect(screen.getByTestId("search-more-below")).toHaveTextContent(
      "Scroll for more results",
    );
    // Eight pixels of group padding remain after the last visible option.
    list.scrollTop = 292;
    fireEvent.scroll(list);
    expect(screen.queryByTestId("search-more-below")).toBeNull();
    list.scrollTop = 0;
    fireEvent.scroll(list);
    expect(screen.getByTestId("search-more-below")).toBeVisible();
    Object.defineProperty(list, "scrollHeight", {
      configurable: true,
      value: 200,
    });
    act(measure);
    expect(screen.queryByTestId("search-more-below")).toBeNull();
    expect(window.history.length).toBe(historyLength);
  });
});
