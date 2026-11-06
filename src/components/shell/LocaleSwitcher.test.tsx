import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { act, fireEvent, screen } from "@testing-library/react";

import { NavigationGuardProvider } from "@/components/navigation/NavigationGuardProvider";
import { useDraftGuard } from "@/components/providers/draftGuard";
import { renderWithIntl } from "@tests/fixtures/intl-render";

const { replace, pathname } = vi.hoisted(() => ({
  replace: vi.fn(),
  pathname: "/finished-goods/new",
}));

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ replace }),
}));

import { LocaleSwitcher } from "./LocaleSwitcher";

const SWITCH = {
  th: "เปลี่ยนภาษาเป็น English",
  en: "Switch language to ไทย",
} as const;

describe("LocaleSwitcher navigation", () => {
  const originalUrl = window.location.href;

  beforeEach(() => replace.mockReset());
  afterEach(() => window.history.replaceState(null, "", originalUrl));

  it.each([
    { locale: "th" as const, next: "en" },
    { locale: "en" as const, next: "th" },
  ])(
    "preserves the pallet resume URL when switching $locale to $next",
    ({ locale, next }) => {
      const suffix =
        "?resumePalletId=pallet-123&filter=awaiting%20measurement&tag=a&tag=b#measurement";
      window.history.replaceState(null, "", `/${locale}${pathname}${suffix}`);
      renderWithIntl(<LocaleSwitcher />, { locale, workspace: false });

      fireEvent.click(screen.getByRole("button", { name: SWITCH[locale] }));

      expect(replace).toHaveBeenCalledExactlyOnceWith(`${pathname}${suffix}`, {
        locale: next,
      });
    },
  );

  it("switches a plain page without adding an empty query or hash", () => {
    window.history.replaceState(null, "", `/en${pathname}`);
    renderWithIntl(<LocaleSwitcher />, { locale: "en", workspace: false });

    fireEvent.click(screen.getByRole("button", { name: SWITCH.en }));

    expect(replace).toHaveBeenCalledExactlyOnceWith(pathname, { locale: "th" });
  });

  it("keeps a resume ID added after rendering when the user changes language", () => {
    window.history.replaceState(null, "", `/en${pathname}`);
    renderWithIntl(<LocaleSwitcher />, { locale: "en", workspace: false });
    const suffix = "?resumePalletId=newly-created-pallet#measure";
    window.history.replaceState(null, "", `/en${pathname}${suffix}`);

    fireEvent.click(screen.getByRole("button", { name: SWITCH.en }));

    expect(replace).toHaveBeenCalledExactlyOnceWith(`${pathname}${suffix}`, {
      locale: "th",
    });
  });

  it.each([
    { locale: "th" as const, shown: "English", lang: "en" },
    { locale: "en" as const, shown: "ไทย", lang: "th" },
  ])(
    "names the other language in that language on $locale pages, with no popup",
    ({ locale, shown, lang }) => {
      renderWithIntl(<LocaleSwitcher />, { locale, workspace: false });

      const button = screen.getByRole("button", { name: SWITCH[locale] });
      expect(screen.getByText(shown)).toHaveAttribute("lang", lang);
      expect(button).toContainElement(screen.getByText(shown));
      expect(button).toHaveAttribute("data-testid", "locale-select");
      expect(button).not.toHaveAttribute("aria-haspopup");
      expect(button).not.toHaveAttribute("aria-expanded");
      expect(screen.queryByRole("combobox")).toBeNull();
    },
  );

  it("asks before a language switch discards unsaved work", () => {
    vi.spyOn(window.history, "back").mockImplementation(() => {});
    window.history.replaceState(null, "", `/th${pathname}`);
    function UnsavedDraft() {
      useDraftGuard(true, () => undefined);
      return null;
    }
    renderWithIntl(
      <NavigationGuardProvider>
        <UnsavedDraft />
        <LocaleSwitcher />
      </NavigationGuardProvider>,
      { locale: "th", workspace: false },
    );

    fireEvent.click(screen.getByRole("button", { name: SWITCH.th }));
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(replace).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "ละทิ้งการเปลี่ยนแปลง" }),
    );
    act(() => {
      window.dispatchEvent(
        new PopStateEvent("popstate", { state: window.history.state }),
      );
    });

    expect(replace).toHaveBeenCalledExactlyOnceWith(pathname, { locale: "en" });
    vi.mocked(window.history.back).mockRestore();
  });
});
