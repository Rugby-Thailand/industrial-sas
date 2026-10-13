import { act, render, renderHook, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useStorageLayoutMobile } from "@/components/storageLayouts/useStorageLayoutMobile";

import { useIsMobile } from "./use-mobile";
import { useMediaQuery } from "./useMediaQuery";

/**
 * A viewport whose `matchMedia` returns a new list per call, as browsers do,
 * so cleanup is checked against the exact list a subscription used.
 */
class FakeMediaQueryList {
  readonly listeners = new Set<EventListenerOrEventListenerObject>();
  constructor(readonly media: string) {}
  get matches() {
    const max = /\(max-width: (\d+)px\)/.exec(this.media)?.[1];
    return max !== undefined && viewport <= Number(max);
  }
  addEventListener(
    _type: "change",
    listener: EventListenerOrEventListenerObject,
  ) {
    this.listeners.add(listener);
  }
  removeEventListener(
    _type: "change",
    listener: EventListenerOrEventListenerObject,
  ) {
    this.listeners.delete(listener);
  }
}

let viewport: number;
let lists: FakeMediaQueryList[];

const live = () => lists.reduce((sum, list) => sum + list.listeners.size, 0);
function resize(width: number) {
  viewport = width;
  act(() => {
    for (const list of lists)
      for (const listener of [...list.listeners])
        if (typeof listener === "function") listener(new Event("change"));
        else listener.handleEvent(new Event("change"));
  });
}

beforeEach(() => {
  viewport = 1200;
  lists = [];
  vi.spyOn(window, "matchMedia").mockImplementation((media: string) => {
    const list = new FakeMediaQueryList(media);
    lists.push(list);
    return list as unknown as MediaQueryList;
  });
});
afterEach(() => vi.restoreAllMocks());

function Probe({ query }: { query: string }) {
  return <output>{String(useMediaQuery(query))}</output>;
}

describe("useMediaQuery", () => {
  it("renders false on the server and hydrates before reading the client match", async () => {
    viewport = 500;
    const html = renderToString(<Probe query="(max-width: 580px)" />);
    expect(html).toContain("false");
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.append(container);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const seen: string[] = [];
    function Recording() {
      const matches = String(useMediaQuery("(max-width: 580px)"));
      seen.push(matches);
      return <output>{matches}</output>;
    }
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(container, <Recording />);
    });
    expect(seen[0]).toBe("false");
    expect(container.textContent).toBe("true");
    expect(errors).not.toHaveBeenCalled();
    act(() => root.unmount());
    container.remove();
    expect(live()).toBe(0);
  });

  it("follows change events, keeps one subscription per query and cleans up the same list", () => {
    const view = render(<Probe query="(max-width: 1099px)" />);
    expect(screen.getByRole("status")).toHaveTextContent("false");
    expect(live()).toBe(1);
    const subscribed = lists.filter((list) => list.listeners.size > 0);

    resize(1099);
    expect(screen.getByRole("status")).toHaveTextContent("true");
    view.rerender(<Probe query="(max-width: 1099px)" />);
    expect(lists.filter((list) => list.listeners.size > 0)).toEqual(subscribed);

    view.rerender(<Probe query="(max-width: 850px)" />);
    expect(screen.getByRole("status")).toHaveTextContent("false");
    expect(subscribed[0]?.listeners.size).toBe(0);
    expect(live()).toBe(1);
    resize(850);
    expect(screen.getByRole("status")).toHaveTextContent("true");

    view.unmount();
    expect(live()).toBe(0);
  });

  it("balances subscriptions under Strict Mode", () => {
    const view = render(
      <StrictMode>
        <Probe query="(max-width: 1023px)" />
      </StrictMode>,
    );
    expect(live()).toBe(1);
    resize(1000);
    expect(screen.getByRole("status")).toHaveTextContent("true");
    view.unmount();
    expect(live()).toBe(0);
  });
});

describe("media-query wrappers keep their breakpoints", () => {
  it.each([
    [1022, true],
    [1023, true],
    [1024, false],
  ])("useIsMobile at %ipx is %s", (width, expected) => {
    viewport = width;
    expect(renderHook(useIsMobile).result.current).toBe(expected);
  });

  it.each([
    [579, true],
    [580, true],
    [581, false],
  ])("useStorageLayoutMobile at %ipx is %s", (width, expected) => {
    viewport = width;
    expect(renderHook(useStorageLayoutMobile).result.current).toBe(expected);
  });
});
