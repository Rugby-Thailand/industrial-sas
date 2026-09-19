import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithIntl } from "@tests/fixtures/intl-render";
import { chooseOption } from "@tests/fixtures/select-control";

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
      option: "🇬🇧 อังกฤษ",
    },
    {
      locale: "en" as const,
      next: "th",
      label: "Language",
      option: "🇹🇭 Thai",
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

    chooseOption("Language", "🇹🇭 Thai");

    expect(replace).toHaveBeenCalledExactlyOnceWith(pathname, { locale: "th" });
  });

  it("keeps a resume ID added after rendering when the user changes language", () => {
    window.history.replaceState(null, "", `/en${pathname}`);
    renderWithIntl(<LocaleSwitcher />, { locale: "en", workspace: false });
    const suffix = "?resumePalletId=newly-created-pallet#measure";
    window.history.replaceState(null, "", `/en${pathname}${suffix}`);

    chooseOption("Language", "🇹🇭 Thai");

    expect(replace).toHaveBeenCalledExactlyOnceWith(`${pathname}${suffix}`, {
      locale: "th",
    });
  });
});
