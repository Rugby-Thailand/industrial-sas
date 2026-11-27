import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithIntl } from "@tests/fixtures/intl-render";

const link = vi.hoisted(() => ({
  state: {
    isWebSocketConnected: false,
    hasEverConnected: false,
    connectionCount: 0,
    inflightMutations: 0,
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

import { registerNavigationGuardOwner } from "@/lib/navigationGuard";
import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { RouteLoading } from "@/components/system/RouteLoading";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  ConnectionNotice,
  ConnectionStallProvider,
  FIRST_CONNECTION_GRACE_MS,
  RECONNECTION_GRACE_MS,
} from "./ConnectionNotice";

/** The notice reads the shell's stall answer, so it renders inside it. */
const renderNotice = (options?: { locale: "en" | "th" }) =>
  renderWithIntl(
    <ConnectionStallProvider>
      <ConnectionNotice focusFallbackId="fallback" />
      <main id="fallback" tabIndex={-1} />
    </ConnectionStallProvider>,
    options,
  );

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

function setOnline(online: boolean) {
  act(() => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get: () => online,
    });
    window.dispatchEvent(new Event(online ? "online" : "offline"));
  });
}

function stubReload() {
  const reload = vi.fn();
  const original = window.location;
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...original, reload },
  });
  return {
    reload,
    restore: () =>
      Object.defineProperty(window, "location", {
        configurable: true,
        value: original,
      }),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  link.state = {
    isWebSocketConnected: false,
    hasEverConnected: false,
    connectionCount: 0,
    inflightMutations: 0,
  };
  link.listeners.clear();
  link.client = true;
  setOnline(true);
});
afterEach(() => vi.useRealTimers());

describe("ConnectionNotice", () => {
  it("stays silent on a normal load that connects within the grace period", () => {
    renderNotice();
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
    renderNotice();
    advance(FIRST_CONNECTION_GRACE_MS - 1);
    expect(notice()).toBeNull();
    advance(1);

    const shown = screen.getByRole("status");
    expect(notice()).toContainElement(shown);
    expect(shown).toHaveTextContent(
      // Nothing has loaded yet, so it never claims the data is merely stale.
      /^กำลังเชื่อมต่อเซิร์ฟเวอร์ ยังโหลดข้อมูลไม่ได้จนกว่าจะเชื่อมต่อได้$/,
    );
    expect(shown).not.toHaveTextContent("ข้อมูลอาจไม่อัปเดต");
    expect(
      within(notice()!).getByRole("button", { name: "โหลดหน้าใหม่" }),
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
    renderNotice({ locale: "en" });

    setLink({ isWebSocketConnected: false });
    advance(RECONNECTION_GRACE_MS - 1_000);
    setLink({ isWebSocketConnected: true, connectionCount: 2 });
    advance(RECONNECTION_GRACE_MS * 2);
    expect(notice()).toBeNull();

    setLink({ isWebSocketConnected: false });
    advance(RECONNECTION_GRACE_MS);
    // Data had loaded before the drop: what is shown may be out of date.
    expect(screen.getByRole("status")).toHaveTextContent(
      /^Reconnecting Data may be out of date\.$/,
    );

    setLink({ isWebSocketConnected: true, connectionCount: 3 });
    expect(notice()).toBeNull();
    // A later outage waits its own grace period again.
    setLink({ isWebSocketConnected: false });
    expect(notice()).toBeNull();
  });

  it("reloads the page through the unsaved-work guard", () => {
    const { reload, restore } = stubReload();
    try {
      renderNotice({ locale: "en" });
      advance(FIRST_CONNECTION_GRACE_MS);
      fireEvent.click(screen.getByRole("button", { name: "Reload page" }));
      expect(reload).toHaveBeenCalledOnce();
    } finally {
      restore();
    }
  });

  it("keeps one mounted live region per outage, with the reload button outside it", () => {
    renderNotice({ locale: "en" });
    const region = screen.getByRole("status");
    expect(region).toBeEmptyDOMElement();

    advance(FIRST_CONNECTION_GRACE_MS);
    expect(screen.getByRole("status")).toBe(region);
    expect(region).toHaveTextContent("Connecting to the server");
    expect(within(region).queryByRole("button")).toBeNull();
    expect(
      within(notice()!).getByRole("button", { name: "Reload page" }),
    ).toBeInTheDocument();

    setLink({
      isWebSocketConnected: true,
      hasEverConnected: true,
      connectionCount: 1,
    });
    expect(screen.getByRole("status")).toBe(region);
    expect(region).toBeEmptyDOMElement();
  });

  it("disables reload with a reason while a save is unconfirmed", () => {
    const { reload, restore } = stubReload();
    try {
      renderNotice({ locale: "en" });
      advance(FIRST_CONNECTION_GRACE_MS);
      setLink({ inflightMutations: 1 });

      const button = screen.getByRole("button", { name: "Save pending" });
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(button).toHaveAccessibleDescription(
        "You can reload after your save is confirmed.",
      );
      fireEvent.click(button);
      expect(reload).not.toHaveBeenCalled();

      setLink({ inflightMutations: 0 });
      expect(button).not.toHaveAttribute("aria-disabled");
      expect(
        screen.queryByText("You can reload after your save is confirmed."),
      ).toBeNull();
      fireEvent.click(button);
      expect(reload).toHaveBeenCalledOnce();
    } finally {
      restore();
    }
  });

  it("rechecks pending saves and the browser's network after the draft guard approves", () => {
    const { reload, restore } = stubReload();
    const requests: Array<{
      action: () => void;
      isValid?: (() => boolean) | undefined;
    }> = [];
    const release = registerNavigationGuardOwner({
      requestTransition: (action, options) =>
        requests.push({ action, isValid: options?.isValid }),
      isTraversing: () => false,
    });
    // The owner re-evaluates validity before running an approved move.
    const approve = () => {
      const request = requests.shift()!;
      if (request.isValid?.() !== false) request.action();
    };
    try {
      renderNotice({ locale: "en" });
      advance(FIRST_CONNECTION_GRACE_MS);
      const button = screen.getByRole("button", { name: "Reload page" });

      fireEvent.click(button);
      // A save starts while the unsaved-work prompt is open.
      link.state = { ...link.state, inflightMutations: 1 };
      approve();
      expect(reload).not.toHaveBeenCalled();

      link.state = { ...link.state, inflightMutations: 0 };
      fireEvent.click(button);
      Object.defineProperty(navigator, "onLine", {
        configurable: true,
        get: () => false,
      });
      approve();
      expect(reload).not.toHaveBeenCalled();

      setOnline(true);
      fireEvent.click(button);
      approve();
      expect(reload).toHaveBeenCalledOnce();
    } finally {
      release();
      restore();
    }
  });

  it("omits reload while the browser is offline and keeps focus on the page when it vanishes", () => {
    renderNotice({ locale: "en" });
    advance(FIRST_CONNECTION_GRACE_MS);
    const button = screen.getByRole("button", { name: "Reload page" });
    act(() => button.focus());

    setOnline(false);
    expect(screen.queryByRole("button", { name: "Reload page" })).toBeNull();
    expect(notice()).toHaveTextContent("This device is offline");
    // The announcement is unchanged: going offline is not a second outage.
    expect(screen.getByRole("status")).toHaveTextContent(
      /^Connecting to the server Data can't load until it connects\.$/,
    );
    expect(document.getElementById("fallback")).toHaveFocus();

    setOnline(true);
    act(() => screen.getByRole("button", { name: "Reload page" }).focus());
    setLink({
      isWebSocketConnected: true,
      hasEverConnected: true,
      connectionCount: 1,
    });
    expect(notice()).toBeNull();
    expect(document.getElementById("fallback")).toHaveFocus();
  });

  it("announces a new outage while a dialog owns focus and keeps reload behind it", () => {
    renderWithIntl(
      <ConnectionStallProvider>
        <ConnectionNotice />
        <Dialog open>
          <DialogContent>
            <DialogTitle>Active editor</DialogTitle>
            <DialogDescription>Its draft is still open.</DialogDescription>
            <button type="button">Keep working</button>
          </DialogContent>
        </Dialog>
      </ConnectionStallProvider>,
      { locale: "en" },
    );
    expect(screen.getByRole("dialog")).toBeVisible();
    const live = screen.getByRole("status");
    advance(FIRST_CONNECTION_GRACE_MS);
    expect(screen.getByRole("status")).toBe(live);
    expect(live).toHaveTextContent("Connecting to the server");
    expect(screen.queryByRole("button", { name: "Reload page" })).toBeNull();
  });

  it("lets loading presenters wait without motion while stalled, under one announcement, and load again on reconnect", () => {
    const { container } = renderWithIntl(
      <ConnectionStallProvider>
        <ConnectionNotice />
        <LedgerPanelStatus
          state={{ kind: "LOADING" }}
          label="กำลังโหลดสินค้าสำเร็จรูป…"
        />
        <RouteLoading />
      </ConnectionStallProvider>,
    );
    const panel = () => screen.getByTestId("panel-LOADING");
    const route = () => screen.getByTestId("route-loading");
    const spinning = () => container.querySelectorAll(".animate-spin");
    const pulsing = () => container.querySelectorAll(".animate-pulse");
    const skeletons = container.querySelectorAll("[data-slot=skeleton]");

    advance(FIRST_CONNECTION_GRACE_MS - 1);
    expect(panel()).toHaveAttribute("role", "status");
    expect(panel()).toHaveTextContent("กำลังโหลดสินค้าสำเร็จรูป…");
    expect(route()).toHaveAttribute("role", "status");
    expect(spinning()).toHaveLength(2);
    expect(pulsing()).toHaveLength(skeletons.length);

    advance(1);
    // The notice is the one live announcement; the presenters say what they
    // wait for, hold still, and are not read out a second time.
    expect(screen.getAllByRole("status")).toEqual([
      within(notice()!).getByRole("status"),
    ]);
    expect(panel()).not.toHaveAttribute("role");
    expect(panel()).toHaveTextContent(/^ยังโหลดข้อมูลไม่ได้$/);
    expect(route()).not.toHaveAttribute("role");
    expect(route()).not.toHaveAttribute("aria-live");
    expect(route()).toHaveTextContent(/^ยังโหลดข้อมูลไม่ได้$/);
    expect(spinning()).toHaveLength(0);
    expect(panel().querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(pulsing()).toHaveLength(0);
    expect(panel().querySelector("[data-slot=skeleton]")).not.toBeVisible();
    expect(route().querySelector("[data-slot=skeleton]")).not.toBeVisible();
    expect(container.querySelectorAll("[data-slot=skeleton]")).toHaveLength(
      skeletons.length,
    );

    setLink({
      isWebSocketConnected: true,
      hasEverConnected: true,
      connectionCount: 1,
    });
    expect(notice()).toBeNull();
    expect(panel()).toHaveAttribute("role", "status");
    expect(panel()).toHaveTextContent("กำลังโหลดสินค้าสำเร็จรูป…");
    expect(route()).toHaveTextContent("กำลังโหลดหน้า…");
    expect(spinning()).toHaveLength(2);
    expect(pulsing()).toHaveLength(skeletons.length);
    expect(panel().querySelector("[data-slot=skeleton]")).toBeVisible();
    expect(route().querySelector("[data-slot=skeleton]")).toBeVisible();
  });

  it("leaves presenters outside the shell loading as usual", () => {
    const { container } = renderWithIntl(
      <LedgerPanelStatus state={{ kind: "LOADING" }} label="Loading" />,
    );
    advance(FIRST_CONNECTION_GRACE_MS * 2);
    expect(screen.getByRole("status")).toBe(
      screen.getByTestId("panel-LOADING"),
    );
    expect(container.querySelector(".animate-spin")).not.toBeNull();
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(4);
  });

  it("has nothing to watch without a configured backend", () => {
    link.client = false;
    renderNotice();
    advance(FIRST_CONNECTION_GRACE_MS * 2);
    expect(notice()).toBeNull();
  });
});
