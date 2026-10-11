import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { renderWithIntl } from "@tests/fixtures/intl-render";
const router = vi.hoisted(() => ({ back: vi.fn(), replace: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => router }));
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
