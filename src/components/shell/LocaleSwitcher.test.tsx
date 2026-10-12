import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fireEvent, waitFor, within } from "@testing-library/react";

import { renderWithIntl } from "@tests/fixtures/intl-render";
import { chooseOption, openSelect } from "@tests/fixtures/select-control";

const { replace, pathname } = vi.hoisted(() => ({
  replace: vi.fn(),
  pathname: "/finished-goods/new",
}));

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ replace }),
}));

import { LocaleSwitcher } from "./LocaleSwitcher";

describe("LocaleSwitcher navigation", () => {
  const originalUrl = window.location.href;

  beforeEach(() => replace.mockReset());
  afterEach(() => window.history.replaceState(null, "", originalUrl));

  it.each([
    {
      locale: "th" as const,
      next: "en",
      label: "ภาษา",
      option: "อังกฤษ",
    },
    {
      locale: "en" as const,
      next: "th",
      label: "Language",
      option: "Thai",
    },
  ])(
    "preserves the pallet resume URL when switching $locale to $next",
    ({ locale, next, label, option }) => {
      const suffix =
        "?resumePalletId=pallet-123&filter=awaiting%20measurement&tag=a&tag=b#measurement";
      window.history.replaceState(null, "", `/${locale}${pathname}${suffix}`);
      renderWithIntl(<LocaleSwitcher />, { locale, workspace: false });

      chooseOption(label, option);

      expect(replace).toHaveBeenCalledExactlyOnceWith(`${pathname}${suffix}`, {
        locale: next,
      });
    },
  );

  it("switches a plain page without adding an empty query or hash", () => {
    window.history.replaceState(null, "", `/en${pathname}`);
    renderWithIntl(<LocaleSwitcher />, { locale: "en", workspace: false });

    chooseOption("Language", "Thai");

    expect(replace).toHaveBeenCalledExactlyOnceWith(pathname, { locale: "th" });
  });

  it("keeps a resume ID added after rendering when the user changes language", () => {
    window.history.replaceState(null, "", `/en${pathname}`);
    renderWithIntl(<LocaleSwitcher />, { locale: "en", workspace: false });
    const suffix = "?resumePalletId=newly-created-pallet#measure";
    window.history.replaceState(null, "", `/en${pathname}${suffix}`);

    chooseOption("Language", "Thai");

    expect(replace).toHaveBeenCalledExactlyOnceWith(`${pathname}${suffix}`, {
      locale: "th",
    });
  });

  it("pairs each language with its hidden flag and keeps names, check and typeahead on the language", async () => {
    window.history.replaceState(null, "", `/en${pathname}`);
    renderWithIntl(<LocaleSwitcher />, { locale: "en", workspace: false });

    const menu = openSelect("Language");
    const thai = within(menu).getByRole("option", { name: "Thai" });
    const english = within(menu).getByRole("option", { name: "English" });
    for (const [option, flag] of [
      [thai, "🇹🇭"],
      [english, "🇬🇧"],
    ] as const) {
      const shown = within(option).getByText(flag);
      expect(shown).toHaveAttribute("aria-hidden", "true");
    }
    // The active language keeps its check mark.
    expect(english).toHaveAttribute("data-state", "checked");
    expect(english.querySelector("svg")).not.toBeNull();
    expect(thai).toHaveAttribute("data-state", "unchecked");
    expect(thai.querySelector("svg")).toBeNull();

    // Typeahead matches the language name, not the flag before it.
    fireEvent.keyDown(menu, { key: "t" });
    await waitFor(() => expect(thai).toHaveFocus());
    fireEvent.keyDown(thai, { key: "Enter" });
    expect(replace).toHaveBeenCalledExactlyOnceWith(pathname, { locale: "th" });
  });
});
