import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithIntl } from "@tests/fixtures/intl-render";

const link = vi.hoisted(() => ({
  state: {
    isWebSocketConnected: false,
    hasEverConnected: false,
    connectionCount: 0,
  },
  listeners: new Set<() => void>(),
  client: true,
}));

vi.mock("convex/react", () => ({
  useConvex: () =>
    link.client
      ? {
          connectionState: () => link.state,
          subscribeToConnectionState: (listener: () => void) => {
            link.listeners.add(listener);
            return () => link.listeners.delete(listener);
          },
        }
      : undefined,
}));

import {
  ConnectionNotice,
  FIRST_CONNECTION_GRACE_MS,
  RECONNECTION_GRACE_MS,
} from "./ConnectionNotice";

function setLink(next: Partial<typeof link.state>) {
  act(() => {
    link.state = { ...link.state, ...next };
    for (const listener of [...link.listeners]) listener();
  });
}

const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

const notice = () => screen.queryByTestId("connection-notice");

beforeEach(() => {
  vi.useFakeTimers();
  link.state = {
    isWebSocketConnected: false,
    hasEverConnected: false,
    connectionCount: 0,
  };
  link.listeners.clear();
  link.client = true;
});
afterEach(() => vi.useRealTimers());

describe("ConnectionNotice", () => {
  it("stays silent on a normal load that connects within the grace period", () => {
    renderWithIntl(<ConnectionNotice />);
    advance(FIRST_CONNECTION_GRACE_MS - 1_000);
    setLink({
      isWebSocketConnected: true,
      hasEverConnected: true,
      connectionCount: 1,
    });
    advance(FIRST_CONNECTION_GRACE_MS * 2);
    expect(notice()).toBeNull();
  });

  it("warns once the first connection has not opened after 8 s and clears when it connects", () => {
    renderWithIntl(<ConnectionNotice />);
    advance(FIRST_CONNECTION_GRACE_MS - 1);
    expect(notice()).toBeNull();
    advance(1);

    const shown = screen.getByRole("status");
    expect(shown).toBe(notice());
    expect(shown).toHaveTextContent("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้");
    // Nothing has loaded yet, so it never claims the data is merely stale.
    expect(shown).toHaveTextContent(
      "หน้านี้ยังโหลดข้อมูลไม่ได้จนกว่าจะเชื่อมต่อได้",
    );
    expect(shown).toHaveTextContent("ระบบกำลังลองเชื่อมต่อใหม่ให้อัตโนมัติ");
    expect(shown).not.toHaveTextContent("อาจไม่เป็นปัจจุบัน");
    expect(
      screen.getByRole("button", { name: "โหลดหน้าใหม่" }),
    ).toBeInTheDocument();

    setLink({
      isWebSocketConnected: true,
      hasEverConnected: true,
      connectionCount: 1,
    });
    expect(notice()).toBeNull();
  });

  it("ignores a brief drop but warns when a dropped connection stays down for 4 s", () => {
    setLink({
      isWebSocketConnected: true,
      hasEverConnected: true,
      connectionCount: 1,
    });
    renderWithIntl(<ConnectionNotice />, { locale: "en" });

    setLink({ isWebSocketConnected: false });
    advance(RECONNECTION_GRACE_MS - 1_000);
    setLink({ isWebSocketConnected: true, connectionCount: 2 });
    advance(RECONNECTION_GRACE_MS * 2);
    expect(notice()).toBeNull();

    setLink({ isWebSocketConnected: false });
    advance(RECONNECTION_GRACE_MS);
    expect(notice()).toHaveTextContent("Can't reach the server");
    // Data had loaded before the drop: what is shown may be out of date.
    expect(notice()).toHaveTextContent(
      "Until then, data on this page may be out of date.",
    );
    expect(notice()).not.toHaveTextContent("can't load its data");

    setLink({ isWebSocketConnected: true, connectionCount: 3 });
    expect(notice()).toBeNull();
    // A later outage waits its own grace period again.
    setLink({ isWebSocketConnected: false });
    expect(notice()).toBeNull();
  });

  it("reloads the page through the unsaved-work guard", () => {
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...original, reload },
    });
    try {
      renderWithIntl(<ConnectionNotice />, { locale: "en" });
      advance(FIRST_CONNECTION_GRACE_MS);
      fireEvent.click(screen.getByRole("button", { name: "Reload page" }));
      expect(reload).toHaveBeenCalledOnce();
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: original,
      });
    }
  });

  it("has nothing to watch without a configured backend", () => {
    link.client = false;
    renderWithIntl(<ConnectionNotice />);
    advance(FIRST_CONNECTION_GRACE_MS * 2);
    expect(notice()).toBeNull();
  });
});
