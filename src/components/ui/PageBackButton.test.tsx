import { act, fireEvent, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { renderWithIntl } from "@tests/fixtures/intl-render";
const router = vi.hoisted(() => ({ back: vi.fn(), replace: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => router }));
import { trackAppHistory } from "@/lib/browser/appHistory";
import { PageBackButton } from "./PageBackButton";
beforeEach(() => vi.clearAllMocks());
it("uses the parent for a directly opened page even when the browser has older external entries", () => {
  window.history.replaceState({}, "", "/outside-app");
  window.history.pushState(
    { appNavigationIndex: 0 },
    "",
    "/en/finished-goods/new",
  );
  renderWithIntl(<PageBackButton fallbackHref="/finished-goods" />, {
    workspace: false,
    locale: "en",
  });
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(router.back).not.toHaveBeenCalled();
  expect(router.replace).toHaveBeenCalledWith("/finished-goods");
});
it("returns through history when a previous app entry exists", () => {
  window.history.replaceState(
    { appNavigationIndex: 1 },
    "",
    "/en/finished-goods/new",
  );
  renderWithIntl(<PageBackButton fallbackHref="/finished-goods" />, {
    workspace: false,
    locale: "en",
  });
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(router.back).toHaveBeenCalledOnce();
  expect(router.replace).not.toHaveBeenCalled();
});
it("follows tracked writes and traversals, and stops listening after unmount", () => {
  window.history.replaceState({ appNavigationIndex: 0 }, "", "/en/hr/leave");
  const stopTracking = trackAppHistory();
  const remove = vi.spyOn(window, "removeEventListener");
  const view = renderWithIntl(<PageBackButton fallbackHref={null} />, {
    workspace: false,
    locale: "en",
  });
  expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  // A tracked push adds an app entry.
  act(() => window.history.pushState({}, "", "/en/hr/leave/review"));
  expect(screen.getByRole("button", { name: "Back" })).toBeEnabled();
  // A metadata-only write is not reported; the traversal event is.
  act(() => window.history.replaceState({ appNavigationIndex: 0 }, ""));
  expect(screen.getByRole("button", { name: "Back" })).toBeEnabled();
  act(() => {
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  view.unmount();
  expect(remove).toHaveBeenCalledWith("popstate", expect.any(Function));
  // A remount reads the current depth rather than a stale snapshot.
  act(() => window.history.pushState({}, "", "/en/hr/leave/review"));
  renderWithIntl(<PageBackButton fallbackHref={null} />, {
    workspace: false,
    locale: "en",
  });
  expect(screen.getByRole("button", { name: "Back" })).toBeEnabled();
  stopTracking();
});
